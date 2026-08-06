/**
 * Server-side Goose ACP client (Node.js runtime only).
 * Bridges Next.js API routes to the Goose Agent Client Protocol server.
 *
 * Uses Node 22's built-in global WebSocket (no `ws` dependency — the npm
 * `ws` package breaks when Next.js bundles it: "t.mask is not a function").
 *
 * ACP requires `initialize` once per WebSocket connection, so we hold ONE
 * persistent connection and multiplex sessions over it.
 *
 * Protocol (agent-client-protocol v1, Goose 1.45):
 *   initialize            -> { protocolVersion, clientCapabilities }
 *   session/new           -> { sessionId }
 *   session/prompt        -> { sessionId, prompt: [ContentBlock] }
 *   session/update (note) -> { sessionId, update: { sessionUpdate, content } }
 *                            sessionUpdate: "agent_message_chunk" carries text.
 */

const GOOSE_WS_URL = process.env.GOOSE_ACP_URL || 'ws://127.0.0.1:3284/acp';

// ACP protocol version accepted by Goose 1.45 (schema 1.0.1, "2026-01-26").
const ACP_PROTOCOL_VERSION = 1;

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

type ChunkListener = (sessionId: string, text: string) => void;
type FinalListener = (result: unknown) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Persistent ACP connection. Lazily connects + initializes on first use,
 * reconnects on drop. Serializes prompt turns (ACP is one turn at a time).
 */
class AcpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private chunkListeners = new Set<ChunkListener>();
  private connectPromise: Promise<void> | null = null;
  private initialized = false;

  /** Ensure a live, initialized connection. */
  private ensureConnected(): Promise<void> {
    if (this.ws && this.initialized && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(GOOSE_WS_URL);
      this.ws = ws;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error('ACP connect timeout'));
        }
      }, 15_000);

      ws.addEventListener('open', async () => {
        try {
          await this.rpc(
            'initialize',
            {
              protocolVersion: ACP_PROTOCOL_VERSION,
              clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
            },
            15_000,
          );
          this.initialized = true;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err as Error);
          }
        }
      });

      ws.addEventListener('message', (ev: MessageEvent) => {
        this.onMessage(ev.data);
      });

      ws.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('ACP WebSocket error'));
        }
      });

      ws.addEventListener('close', () => {
        this.initialized = false;
        this.ws = null;
        // Fail any in-flight requests so callers can retry.
        for (const [, p] of this.pending) {
          p.reject(new Error('ACP connection closed'));
        }
        this.pending.clear();
      });
    });
  }

  private onMessage(data: unknown) {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }

    // Streaming notification (no id).
    if (msg.method === 'session/update') {
      const params = msg.params ?? {};
      const sessionId = String(params.sessionId ?? '');
      const update = (params.update ?? {}) as Record<string, unknown>;
      if (update.sessionUpdate === 'agent_message_chunk') {
        const content = update.content as { type?: string; text?: string } | undefined;
        if (content?.type === 'text' && content.text) {
          for (const listener of this.chunkListeners) listener(sessionId, content.text);
        }
      }
      return;
    }

    // Server-to-client request (e.g. permission, fs) — decline politely.
    if (msg.id !== undefined && msg.method !== undefined) {
      this.sendRaw({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported' } });
      return;
    }

    // Response to one of our requests.
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`ACP ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }

  private sendRaw(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private rpc(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP timeout (${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.sendRaw({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Create a Goose session. Returns the session id. */
  async createSession(cwd: string): Promise<string> {
    await this.ensureConnected();
    const result = (await this.rpc('session/new', { cwd, mcpServers: [] })) as { sessionId?: string };
    if (!result.sessionId) throw new Error('ACP session/new returned no sessionId');
    return result.sessionId;
  }

  /**
   * Send a prompt and stream text chunks. Yields strings as they arrive;
   * resolves when the turn completes (stopReason received).
   */
  async *prompt(sessionId: string, text: string): AsyncGenerator<string> {
    await this.ensureConnected();

    const queue: string[] = [];
    let finished = false;
    let error: string | null = null;
    let wake: (() => void) | null = null;

    const onChunk = (sid: string, chunk: string) => {
      if (sid !== sessionId) return;
      queue.push(chunk);
      wake?.();
    };
    this.chunkListeners.add(onChunk);

    const id = this.nextId++;
    const promptPromise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.sendRaw({
      jsonrpc: '2.0',
      id,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text }] },
    });

    // Resolve the turn when the prompt response arrives.
    promptPromise
      .then(() => { finished = true; wake?.(); })
      .catch((err: Error) => { error = err.message; finished = true; wake?.(); });

    const waitSignal = () => new Promise<void>((r) => { wake = r; });

    try {
      while (!finished || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (!finished) {
          await waitSignal();
        }
      }
    } finally {
      this.chunkListeners.delete(onChunk);
      this.pending.delete(id);
    }

    if (error) throw new Error(error);
  }
}

// Module-level singleton — connection persists across HTTP requests.
const client = new AcpClient();

/**
 * Create a Goose session. Returns the goose session id.
 * `systemPrompt` is accepted for caller compatibility but not sent as a
 * separate turn (that would burn a model round-trip); callers should fold
 * standing identity into the prompt text instead.
 */
export async function createSession(
  workingDir: string,
  _systemPrompt?: string,
): Promise<string> {
  return client.createSession(workingDir);
}

/**
 * Send a message to a Goose session and stream text chunks.
 * Yields strings as they arrive; resolves when the turn completes.
 */
export async function* streamMessage(
  sessionId: string,
  message: string,
): AsyncGenerator<string> {
  yield* client.prompt(sessionId, message);
}

/** Health check against the Goose HTTP /health endpoint. */
export async function gooseHealth(): Promise<boolean> {
  try {
    const base = GOOSE_WS_URL.replace(/^ws/, 'http').replace(/\/acp$/, '');
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * What model is actually behind Goose right now. Goose's ACP surface does not
 * report its model, so read the config it was started with. Path override:
 * FRANK_GOOSE_CONFIG. Env wins over config file (Goose's own precedence).
 */
export async function gooseModelInfo(): Promise<{ provider: string | null; model: string | null }> {
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const path =
    process.env.FRANK_GOOSE_CONFIG ?? join(homedir(), '.config', 'goose', 'config.yaml');
  try {
    const raw = await readFile(path, 'utf8');
    const grab = (k: string) => {
      const m = raw.match(new RegExp(`^\\s*${k}\\s*:\\s*["']?([^"'\\n]+)`, 'im'));
      return m ? m[1].trim() : null;
    };
    return {
      provider: process.env.GOOSE_PROVIDER ?? grab('GOOSE_PROVIDER') ?? grab('provider'),
      model: process.env.GOOSE_MODEL ?? grab('GOOSE_MODEL') ?? grab('model'),
    };
  } catch {
    return {
      provider: process.env.GOOSE_PROVIDER ?? null,
      model: process.env.GOOSE_MODEL ?? null,
    };
  }
}

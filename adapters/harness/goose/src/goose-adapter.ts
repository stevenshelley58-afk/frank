/**
 * GooseAdapter — FRANK HarnessAdapter implementation for Goose.
 *
 * Talks to a Goose ACP server (started via `goose serve`) over WebSocket.
 * Each Frank room maps to one Goose session.
 *
 * ACP protocol: JSON-RPC 2.0 over WebSocket.
 * Key methods: session/create, session/message, session/switch_model.
 */

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type {
  HarnessAdapter,
  ProviderConfig,
  ProviderInfo,
  SessionHandle,
  StreamChunk,
} from './types.js';

export interface GooseAdapterConfig {
  /** Goose ACP server URL. Default: http://localhost:3284 */
  baseUrl: string;
  /** WebSocket URL for ACP. Default: ws://localhost:3284/acp */
  wsUrl?: string;
  /** ACP secret key for authentication (GOOSE_SERVER__SECRET_KEY). */
  secretKey?: string;
  /** Request timeout in ms. Default: 30000 */
  timeoutMs?: number;
  /** Long timeout for agent turns (LLM calls). Default: 300000 */
  agentTimeoutMs?: number;
}

interface AcpResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export class GooseAdapter implements HarnessAdapter {
  readonly name = 'Goose';

  private config: Required<Omit<GooseAdapterConfig, 'secretKey'>> & {
    secretKey: string;
  };
  private sessions = new Map<
    string,
    { roomId: string; gooseSessionId: string }
  >();

  constructor(config: GooseAdapterConfig) {
    const base = config.baseUrl.replace(/\/$/, '');
    this.config = {
      baseUrl: base,
      wsUrl: config.wsUrl ?? base.replace(/^http/, 'ws') + '/acp',
      secretKey: config.secretKey ?? '',
      timeoutMs: config.timeoutMs ?? 30_000,
      agentTimeoutMs: config.agentTimeoutMs ?? 300_000,
    };
  }

  async startSession(input: {
    roomId: string;
    workspacePath: string;
    systemPrompt: string;
    provider?: ProviderConfig;
  }): Promise<SessionHandle> {
    const id = randomUUID();
    const result = await this.rpc('session/create', {
      working_dir: input.workspacePath,
      system_prompt: input.systemPrompt,
      provider: input.provider
        ? this.toGooseProvider(input.provider)
        : undefined,
    });

    const gooseSessionId =
      (result as { session_id?: string })?.session_id ?? id;

    this.sessions.set(id, { roomId: input.roomId, gooseSessionId });

    return {
      id,
      harness: this.name,
      roomId: input.roomId,
      createdAt: new Date().toISOString(),
    };
  }

  async *sendMessage(
    session: SessionHandle,
    message: string,
  ): AsyncIterable<StreamChunk> {
    const entry = this.sessions.get(session.id);
    if (!entry) throw new Error(`Session ${session.id} not found`);

    const ws = this.openWs();
    const chunks: StreamChunk[] = [];
    let done = false;
    let notify: (() => void) | null = null;

    const waitSignal = () =>
      new Promise<void>((r) => {
        notify = r;
      });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Streaming events from Goose ACP
        if (msg.method === 'session/event' || msg.method === 'notification') {
          const evt = msg.params ?? {};
          chunks.push(this.toStreamChunk(evt));
          notify?.();
          return;
        }
        // Final JSON-RPC response
        if (msg.id && (msg.result !== undefined || msg.error)) {
          if (msg.error) {
            chunks.push({
              type: 'error',
              content: msg.error.message ?? 'Unknown ACP error',
            });
          }
          chunks.push({ type: 'done', content: '' });
          done = true;
          notify?.();
        }
      } catch {
        chunks.push({ type: 'error', content: 'Malformed ACP message' });
        done = true;
        notify?.();
      }
    });

    ws.on('error', (err) => {
      chunks.push({ type: 'error', content: err.message });
      done = true;
      notify?.();
    });

    ws.on('close', () => {
      done = true;
      notify?.();
    });

    // Send the message once connected
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: randomUUID(),
            method: 'session/message',
            params: {
              session_id: entry.gooseSessionId,
              message,
              stream: true,
            },
          }),
        );
        resolve();
      });
      ws.on('error', reject);
    });

    // Yield chunks as they arrive
    while (!done || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else if (!done) {
        await waitSignal();
      }
    }

    ws.close();
  }

  async switchModel(
    session: SessionHandle,
    provider: ProviderConfig,
  ): Promise<void> {
    const entry = this.sessions.get(session.id);
    if (!entry) throw new Error(`Session ${session.id} not found`);

    await this.rpc('session/switch_model', {
      session_id: entry.gooseSessionId,
      provider: this.toGooseProvider(provider),
    });
  }

  async listProviders(): Promise<ProviderInfo[]> {
    try {
      const result = await this.rpc('providers/list', {});
      const providers = (result as Array<Record<string, unknown>>) ?? [];
      return providers.map((p) => ({
        id: String(p.id ?? p.name ?? ''),
        provider: String(p.provider ?? ''),
        model: String(p.model ?? ''),
        type: (p.type as ProviderInfo['type']) ?? 'api_key',
        status: (p.status as ProviderInfo['status']) ?? 'active',
        harness: [this.name],
      }));
    } catch {
      // If providers/list isn't supported, return the configured default
      return [
        {
          id: 'alibaba-qwen',
          provider: 'anthropic',
          model: 'qwen3.7-max',
          type: 'api_key',
          status: 'active',
          harness: [this.name],
        },
      ];
    }
  }

  async stopSession(session: SessionHandle): Promise<void> {
    const entry = this.sessions.get(session.id);
    if (!entry) return;

    try {
      await this.rpc('session/close', {
        session_id: entry.gooseSessionId,
      });
    } catch {
      // Session may already be gone
    }
    this.sessions.delete(session.id);
  }

  async status(): Promise<{
    healthy: boolean;
    version?: string;
    sessions?: number;
  }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.config.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      return {
        healthy: res.ok && text.trim() === 'ok',
        version: '1.45.0',
        sessions: this.sessions.size,
      };
    } catch {
      return { healthy: false, sessions: this.sessions.size };
    }
  }

  // --- internals ---

  private openWs(): WebSocket {
    const headers: Record<string, string> = {};
    if (this.config.secretKey) {
      headers['Authorization'] = `Bearer ${this.config.secretKey}`;
    }
    return new WebSocket(this.config.wsUrl, { headers });
  }

  private toGooseProvider(p: ProviderConfig): Record<string, unknown> {
    const out: Record<string, unknown> = {
      name: p.provider,
      model: p.model,
    };
    if (p.apiKey) out.api_key = p.apiKey;
    if (p.acpSubscription) out.acp_subscription = p.acpSubscription;
    if (p.baseUrl) out.base_url = p.baseUrl;
    return out;
  }

  private toStreamChunk(evt: Record<string, unknown>): StreamChunk {
    const kind = String(evt.type ?? evt.kind ?? 'text');
    if (kind === 'tool_call' || kind === 'tool_use') {
      return {
        type: 'tool_call',
        content: String(evt.content ?? ''),
        toolName: String(evt.tool_name ?? evt.name ?? ''),
        toolArgs: (evt.tool_args ?? evt.args ?? {}) as Record<
          string,
          unknown
        >,
      };
    }
    if (kind === 'tool_result') {
      return { type: 'tool_result', content: String(evt.content ?? '') };
    }
    if (kind === 'error') {
      return {
        type: 'error',
        content: String(evt.content ?? evt.message ?? ''),
      };
    }
    return { type: 'text', content: String(evt.content ?? evt.text ?? '') };
  }

  /**
   * JSON-RPC 2.0 over WebSocket.
   * Opens a connection, sends one request, waits for the matching
   * response by id, then closes.
   */
  private async rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = randomUUID();
    const ws = this.openWs();

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`ACP RPC timeout after ${this.config.agentTimeoutMs}ms: ${method}`));
      }, this.config.agentTimeoutMs);

      ws.on('open', () => {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as AcpResponse;
          if (msg.id !== id) return; // not our response
          clearTimeout(timer);
          ws.close();
          if (msg.error) {
            reject(
              new Error(
                `Goose ACP error ${msg.error.code}: ${msg.error.message}`,
              ),
            );
          } else {
            resolve(msg.result);
          }
        } catch {
          clearTimeout(timer);
          ws.close();
          reject(new Error('Malformed ACP response'));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`ACP WebSocket error: ${err.message}`));
      });
    });
  }
}

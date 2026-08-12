/**
 * GooseAdapter — FRANK HarnessAdapter implementation for Goose.
 *
 * Talks to a Goose ACP server (`goose serve`) over WebSocket, one long-lived
 * connection per Frank session.
 *
 * ## Protocol
 *
 * Goose 1.45 speaks standard Agent Client Protocol over JSON-RPC 2.0:
 *
 *   initialize                -> agentCapabilities, agentInfo
 *   session/new               -> { sessionId, modes, configOptions }
 *   session/prompt            -> { stopReason, usage }, streamed via
 *                                session/update notifications
 *   session/set_config_option -> { sessionId, configId, value }
 *   session/close             -> {}
 *   session/list              -> { sessions }
 *
 * An earlier revision of this file used `session/create`, `session/message`
 * and `providers/list`, none of which exist. Every turn died with
 * `-32601 Method not found`, and because the runner dispatches turns as a
 * floating promise the failure surfaced only as a turn stuck in `queued`.
 *
 * ## One connection per session, not one per request
 *
 * A session lives on the connection that created it: `initialize` is a
 * per-connection handshake and `session/update` notifications are delivered
 * only to that socket. Opening a socket per RPC — as the earlier revision
 * did — throws the session away and loses the stream.
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

/** ACP protocol version this client negotiates. */
const ACP_PROTOCOL_VERSION = 1;

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface SessionUpdate {
  sessionUpdate: string;
  content?: { type?: string; text?: string };
  title?: string;
  kind?: string;
  rawInput?: Record<string, unknown>;
  status?: string;
  toolCallId?: string;
  [key: string]: unknown;
}

export interface ConfigOption {
  id: string;
  name?: string;
  type?: string;
  currentValue?: string;
  options?: Array<{ value: string; name?: string }>;
}

interface NewSessionResult {
  sessionId: string;
  configOptions?: ConfigOption[];
  modes?: { currentModeId?: string };
}

/**
 * One JSON-RPC connection to the ACP server, already through `initialize`.
 *
 * Inbound requests from the agent (permission prompts, filesystem reads) are
 * answered with `-32601` rather than ignored: an unanswered request leaves
 * the agent waiting until its own timeout, which would present as a turn that
 * hangs rather than one that fails.
 */
class AcpConnection {
  #nextId = 1;
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  readonly #updateListeners = new Set<(sessionId: string, update: SessionUpdate) => void>();
  #closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => this.handle(raw.toString()));
    ws.on('close', () => this.failAll(new Error('ACP connection closed.')));
    ws.on('error', (error: Error) => this.failAll(new Error(`ACP WebSocket error: ${error.message}`)));
  }

  static async open(wsUrl: string, secretKey: string, timeoutMs: number): Promise<AcpConnection> {
    const headers: Record<string, string> = {};
    if (secretKey) headers.Authorization = `Bearer ${secretKey}`;
    const ws = new WebSocket(wsUrl, { headers });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`ACP connect timeout after ${timeoutMs}ms: ${wsUrl}`));
      }, timeoutMs);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (error: Error) => { clearTimeout(timer); reject(new Error(`ACP WebSocket error: ${error.message}`)); });
    });
    const connection = new AcpConnection(ws);
    // Frank proxies no filesystem or terminal capability to the agent: Goose
    // runs on the host with its own working directory.
    await connection.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    }, timeoutMs);
    return connection;
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('ACP connection is closed.'));
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`ACP RPC timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  onSessionUpdate(listener: (sessionId: string, update: SessionUpdate) => void): () => void {
    this.#updateListeners.add(listener);
    return () => this.#updateListeners.delete(listener);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.failAll(new Error('ACP connection closed.'));
    try { this.ws.close(); } catch { /* already gone */ }
  }

  private handle(raw: string): void {
    let message: JsonRpcMessage;
    try { message = JSON.parse(raw) as JsonRpcMessage; }
    catch { return; }

    if (message.method === 'session/update') {
      const sessionId = String(message.params?.sessionId ?? '');
      const update = (message.params?.update ?? {}) as SessionUpdate;
      for (const listener of this.#updateListeners) listener(sessionId, update);
      return;
    }

    // An inbound request (has both id and method) must be answered.
    if (message.id !== undefined && message.method) {
      try {
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Frank does not implement ${message.method}.` },
        }));
      } catch { /* connection already gone */ }
      return;
    }

    if (typeof message.id !== 'number') return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`Goose ACP error ${message.error.code}: ${message.error.message}`));
    else pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

interface SessionEntry {
  roomId: string;
  gooseSessionId: string;
  connection: AcpConnection;
  configOptions: ConfigOption[];
  /** ACP has no system-prompt field; it is prepended to the first prompt. */
  pendingSystemPrompt?: string;
}

export class GooseAdapter implements HarnessAdapter {
  readonly name = 'Goose';

  private config: Required<Omit<GooseAdapterConfig, 'secretKey'>> & { secretKey: string };
  private sessions = new Map<string, SessionEntry>();

  constructor(config: GooseAdapterConfig) {
    const base = config.baseUrl.replace(/\/$/, '');
    this.config = {
      baseUrl: base,
      wsUrl: config.wsUrl ?? `${base.replace(/^http/, 'ws')}/acp`,
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
    const connection = await AcpConnection.open(this.config.wsUrl, this.config.secretKey, this.config.timeoutMs);
    try {
      const result = await connection.request('session/new', {
        cwd: input.workspacePath,
        mcpServers: [],
      }, this.config.timeoutMs) as NewSessionResult;

      const gooseSessionId = result?.sessionId;
      if (!gooseSessionId) throw new Error('Goose returned no sessionId for session/new.');

      const configOptions = result.configOptions ?? [];
      const entry: SessionEntry = {
        roomId: input.roomId,
        gooseSessionId,
        connection,
        configOptions,
        ...(input.systemPrompt ? { pendingSystemPrompt: input.systemPrompt } : {}),
      };

      if (input.provider) await this.applyProvider(entry, input.provider);

      this.sessions.set(id, entry);
      return { id, harness: this.name, roomId: input.roomId, createdAt: new Date().toISOString() };
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  async *sendMessage(session: SessionHandle, message: string): AsyncIterable<StreamChunk> {
    const entry = this.sessions.get(session.id);
    if (!entry) throw new Error(`Session ${session.id} not found`);

    const queue: StreamChunk[] = [];
    let done = false;
    let wake: (() => void) | null = null;
    const push = (chunk: StreamChunk) => { queue.push(chunk); wake?.(); wake = null; };

    const unsubscribe = entry.connection.onSessionUpdate((sessionId, update) => {
      if (sessionId !== entry.gooseSessionId) return;
      const chunk = toStreamChunk(update);
      if (chunk) push(chunk);
    });

    // ACP carries no system prompt on session/new, so it rides in front of the
    // first user turn and is sent exactly once per session.
    const prompt: Array<{ type: 'text'; text: string }> = [];
    if (entry.pendingSystemPrompt) {
      prompt.push({ type: 'text', text: entry.pendingSystemPrompt });
      delete entry.pendingSystemPrompt;
    }
    prompt.push({ type: 'text', text: message });

    const turn = entry.connection
      .request('session/prompt', { sessionId: entry.gooseSessionId, prompt }, this.config.agentTimeoutMs)
      .then(() => undefined)
      .catch((error: unknown) => {
        push({ type: 'error', content: error instanceof Error ? error.message : 'Goose ACP prompt failed.' });
      })
      .finally(() => { done = true; wake?.(); wake = null; });

    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) { yield queue.shift() as StreamChunk; continue; }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
      await turn;
      while (queue.length > 0) yield queue.shift() as StreamChunk;
      yield { type: 'done', content: '' };
    } finally {
      unsubscribe();
    }
  }

  async switchModel(session: SessionHandle, provider: ProviderConfig): Promise<void> {
    const entry = this.sessions.get(session.id);
    if (!entry) throw new Error(`Session ${session.id} not found`);
    await this.applyProvider(entry, provider);
  }

  /**
   * Provider and model are per-session config options in Goose 1.45. A value
   * the running Goose does not offer is rejected here rather than silently
   * ignored, so the caller's fallback chain can move to the next route instead
   * of believing it routed somewhere it did not.
   */
  private async applyProvider(entry: SessionEntry, provider: ProviderConfig): Promise<void> {
    for (const [configId, value] of [['provider', provider.provider], ['model', provider.model]] as const) {
      if (!value) continue;
      const option = entry.configOptions.find((candidate) => candidate.id === configId);
      if (!option) throw new Error(`Goose exposes no "${configId}" config option.`);
      if (option.currentValue === value) continue;
      const offered = option.options?.some((candidate) => candidate.value === value) ?? false;
      if (!offered) throw new Error(`Goose does not offer ${configId} "${value}".`);
      await entry.connection.request('session/set_config_option', {
        sessionId: entry.gooseSessionId,
        configId,
        value,
      }, this.config.timeoutMs);
      option.currentValue = value;
    }
  }

  async listProviders(): Promise<ProviderInfo[]> {
    let connection: AcpConnection | undefined;
    try {
      connection = await AcpConnection.open(this.config.wsUrl, this.config.secretKey, this.config.timeoutMs);
      const result = await connection.request('session/new', { cwd: process.cwd(), mcpServers: [] }, this.config.timeoutMs) as NewSessionResult;
      const options = result.configOptions ?? [];
      const providerOption = options.find((option) => option.id === 'provider');
      const modelOption = options.find((option) => option.id === 'model');
      const activeProvider = providerOption?.currentValue ?? 'goose';
      if (result.sessionId) {
        await connection.request('session/close', { sessionId: result.sessionId }, this.config.timeoutMs).catch(() => undefined);
      }
      const models = modelOption?.options ?? (modelOption?.currentValue ? [{ value: modelOption.currentValue }] : []);
      return models.map((model) => ({
        id: `${activeProvider}:${model.value}`,
        provider: activeProvider,
        model: model.value,
        type: 'api_key' as const,
        status: model.value === modelOption?.currentValue ? ('active' as const) : ('inactive' as const),
        harness: [this.name],
      }));
    } catch {
      return [];
    } finally {
      connection?.close();
    }
  }

  async stopSession(session: SessionHandle): Promise<void> {
    const entry = this.sessions.get(session.id);
    if (!entry) return;
    try {
      await entry.connection.request('session/close', { sessionId: entry.gooseSessionId }, this.config.timeoutMs);
    } catch {
      // Session may already be gone; the connection close below is what matters.
    }
    entry.connection.close();
    this.sessions.delete(session.id);
  }

  /**
   * Goose serves ACP only — it publishes no HTTP health route — so liveness is
   * an `initialize` handshake on a throwaway connection.
   */
  async status(): Promise<{ healthy: boolean; version?: string; sessions?: number }> {
    let connection: AcpConnection | undefined;
    try {
      connection = await AcpConnection.open(this.config.wsUrl, this.config.secretKey, 5_000);
      return { healthy: true, sessions: this.sessions.size };
    } catch {
      return { healthy: false, sessions: this.sessions.size };
    } finally {
      connection?.close();
    }
  }
}

/** Maps one ACP session update to a Frank stream chunk, or null to drop it. */
function toStreamChunk(update: SessionUpdate): StreamChunk | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return { type: 'text', content: update.content?.text ?? '' };
    case 'tool_call':
      return {
        type: 'tool_call',
        content: update.title ?? '',
        toolName: String(update.kind ?? update.title ?? 'unknown'),
        toolArgs: update.rawInput ?? {},
      };
    case 'tool_call_update':
      return update.status === 'completed'
        ? { type: 'tool_result', content: update.title ?? '' }
        : null;
    // Thought chunks, plans, usage, command lists and title changes are
    // telemetry, not conversation: emitting them would put them in the reply.
    default:
      return null;
  }
}

/**
 * Minimal MCP "Streamable HTTP" client — just enough for tool discovery and
 * invocation against a Zapier MCP endpoint.
 *
 * We deliberately do not take a dependency on the full `@modelcontextprotocol/sdk`:
 * Frank only needs `initialize`, `tools/list`, and `tools/call`, and pulling the
 * SDK (and its transport/peer machinery) into an adapter would violate the
 * "provider coupling stays small" spirit of FRANK-§6.5. Node 22 ships a global
 * `fetch`, so the whole transport is a handful of functions.
 *
 * The MCP Streamable HTTP transport answers a JSON-RPC POST with either
 * `application/json` (one JSON-RPC message) or `text/event-stream` (a stream of
 * `data:` frames, the last of which carries the response). Both are handled: the
 * fake server in tests uses the plain-JSON path, real Zapier may use either.
 */

import { randomUUID } from 'node:crypto';

export interface McpClientConfig {
  /** The MCP endpoint URL, e.g. `https://mcp.zapier.com/.../mcp`. */
  readonly url: string;
  /** Bearer token for the endpoint (ZAPIER_MCP_TOKEN). */
  readonly token: string;
  /** Request timeout in ms. Default 30s. */
  readonly timeoutMs?: number;
  /** Injectable fetch, for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** The subset of an MCP tool entry Frank reads off the wire. */
export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class McpProtocolError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'McpProtocolError';
  }
}

const PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIMEOUT_MS = 30_000;

export class McpClient {
  readonly #config: Required<Pick<McpClientConfig, 'url' | 'token'>> & {
    timeoutMs: number;
    fetchImpl: typeof fetch;
  };
  /** The session id the server hands back on initialize, echoed on later calls. */
  #sessionId: string | null = null;

  constructor(config: McpClientConfig) {
    this.#config = {
      url: config.url,
      token: config.token,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: config.fetchImpl ?? fetch,
    };
  }

  /**
   * MCP handshake. Establishes the protocol version and captures the session id
   * the server returns in `Mcp-Session-Id`, which every subsequent request must
   * echo. Idempotent — a second call reuses the established session.
   */
  async initialize(): Promise<void> {
    if (this.#sessionId !== null) return;

    await this.#rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'frank-adapter-tools-zapier-mcp', version: '0.1.0' },
    });

    // Tell the server we're ready. Notification — no id, no response expected.
    await this.#notify('notifications/initialized', {});
  }

  /** `tools/list` — the raw MCP tool entries. */
  async listTools(): Promise<readonly McpTool[]> {
    await this.initialize();
    const result = (await this.#rpc('tools/list', {})) as {
      tools?: McpTool[];
    };
    return result.tools ?? [];
  }

  /**
   * `tools/call` — invoke one tool. Returns the raw MCP result object
   * (`{ content, isError? }`); the adapter maps it onto Frank's ToolResult.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content?: unknown; isError?: boolean }> {
    await this.initialize();
    const result = (await this.#rpc('tools/call', {
      name,
      arguments: args,
    })) as { content?: unknown; isError?: boolean };
    return result;
  }

  // --- transport internals ---

  async #rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const response = await this.#post(body);

    const message = await this.#readMessage(response);
    if (message.error) {
      throw new McpProtocolError(
        `MCP ${method} failed: ${message.error.message}`,
        message.error.code,
      );
    }
    return message.result;
  }

  async #notify(method: string, params: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params });
    // Notifications expect a 202 with no body; #post tolerates an empty one.
    await this.#post(body);
  }

  async #post(body: string): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.#config.token}`,
    };
    if (this.#sessionId !== null) {
      headers['Mcp-Session-Id'] = this.#sessionId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    let response: Response;
    try {
      response = await this.#config.fetchImpl(this.#config.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      throw new McpProtocolError(`MCP transport error: ${message}`);
    }
    clearTimeout(timer);

    // Capture the session id the server assigns on the first response.
    const sid = response.headers.get('mcp-session-id');
    if (sid && this.#sessionId === null) {
      this.#sessionId = sid;
    }

    if (!response.ok) {
      throw new McpProtocolError(
        `MCP HTTP ${response.status} ${response.statusText}`,
        response.status,
      );
    }
    return response;
  }

  /**
   * Read one JSON-RPC message out of either a bare `application/json` body or a
   * `text/event-stream` body. For SSE we scan the `data:` frames and return the
   * last one that parses as a JSON-RPC message carrying an id (the terminal
   * response); notifications in the stream are skipped.
   */
  async #readMessage(response: Response): Promise<JsonRpcResponse> {
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('text/event-stream')) {
      return this.#parseSse(text);
    }

    const trimmed = text.trim();
    if (trimmed === '') {
      throw new McpProtocolError('MCP returned an empty JSON body');
    }
    try {
      return JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      throw new McpProtocolError('MCP returned malformed JSON');
    }
  }

  #parseSse(text: string): JsonRpcResponse {
    // Frames are separated by blank lines; each `data:` line is one chunk. A
    // single event may span multiple `data:` lines joined by newlines.
    let last: JsonRpcResponse | null = null;
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const dataLines = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const payload = dataLines.join('\n').trim();
      if (payload === '') continue;
      try {
        const parsed = JSON.parse(payload) as JsonRpcResponse;
        if (parsed.id !== undefined) last = parsed;
      } catch {
        // Skip non-JSON keep-alive frames.
      }
    }
    if (last === null) {
      throw new McpProtocolError('MCP SSE stream carried no JSON-RPC response');
    }
    return last;
  }
}

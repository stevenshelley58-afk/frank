/**
 * ZapierMcpToolProvider — the ToolProvider implementation for Zapier's MCP
 * server, exposing Gmail, Google Calendar, and Google Tasks as Frank tools.
 *
 * Composition:
 *   config.ts   reads ZAPIER_MCP_URL / ZAPIER_MCP_TOKEN
 *   mcp-client.ts  speaks MCP Streamable HTTP over fetch
 *   classify.ts    maps MCP tools onto Frank families + action boundaries
 *   this file      glues them into the ToolProvider seam
 *
 * The provider is a *proposer* (FRANK-§6.9). `callTool` performs the external
 * call only; the composition root decides whether to route the action through
 * the boundary first. Nothing here imports `@frank/policy`, so there is no path
 * from this package to bypassing policy.
 */

import { McpClient, McpProtocolError, type McpClientConfig } from './mcp-client.js';
import { classifyTool } from './classify.js';
import type {
  ToolDescriptor,
  ToolProvider,
  ToolProviderStatus,
  ToolResult,
  ToolResultContent,
} from './types.js';

export interface ZapierMcpToolProviderConfig extends McpClientConfig {
  /** Cache discovered tools for this long. Default: no caching (0). */
  readonly cacheTtlMs?: number;
}

export class ZapierMcpToolProvider implements ToolProvider {
  readonly name = 'Zapier MCP';

  readonly #client: McpClient;
  readonly #cacheTtlMs: number;
  #cached: { tools: readonly ToolDescriptor[]; at: number } | null = null;

  constructor(config: ZapierMcpToolProviderConfig) {
    this.#client = new McpClient(config);
    this.#cacheTtlMs = config.cacheTtlMs ?? 0;
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    if (this.#cached !== null && this.#cacheTtlMs > 0) {
      if (Date.now() - this.#cached.at < this.#cacheTtlMs) {
        return this.#cached.tools;
      }
    }

    const raw = await this.#client.listTools();
    // Classify and drop anything outside the three families or with an
    // unrecognised verb. Order is preserved from the server.
    const tools: ToolDescriptor[] = [];
    for (const entry of raw) {
      const classified = classifyTool(entry);
      if (classified !== null) tools.push(classified);
    }

    this.#cached = { tools, at: Date.now() };
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // Refuse unknown tools up front so a caller can't invoke something we never
    // advertised. This is a correctness guard, not a policy check.
    const known = await this.listTools();
    if (!known.some((t) => t.name === name)) {
      return {
        ok: false,
        content: [],
        error: `Unknown tool: ${name}`,
        trust: 'external-untrusted',
      };
    }

    try {
      const raw = await this.#client.callTool(name, args);
      const content = mapContent(raw.content);
      if (raw.isError === true) {
        return {
          ok: false,
          content,
          error: firstText(content) ?? 'Tool reported an error',
          trust: 'external-untrusted',
        };
      }
      return { ok: true, content, trust: 'external-untrusted' };
    } catch (err) {
      const message =
        err instanceof McpProtocolError
          ? err.message
          : err instanceof Error
            ? `MCP call failed: ${err.message}`
            : 'MCP call failed';
      return { ok: false, content: [], error: message, trust: 'external-untrusted' };
    }
  }

  async status(): Promise<ToolProviderStatus> {
    try {
      const tools = await this.listTools();
      return { healthy: true, version: 'mcp/2025-03-26', toolCount: tools.length };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { healthy: false, reason };
    }
  }
}

/**
 * Map MCP's loosely-typed `content` array onto Frank's ToolResultContent union.
 * Unknown block shapes are dropped rather than passed through, so a malicious
 * or buggy server cannot smuggle an unexpected block type into a context pack.
 */
function mapContent(content: unknown): readonly ToolResultContent[] {
  if (!Array.isArray(content)) return [];
  const out: ToolResultContent[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    const type = b.type;
    if (type === 'text') {
      out.push({ type: 'text', text: typeof b.text === 'string' ? b.text : '' });
    } else if (type === 'image') {
      out.push({
        type: 'image',
        ...(typeof b.data === 'string' ? { uri: b.data } : {}),
        ...(typeof b.mimeType === 'string' ? { mimeType: b.mimeType } : {}),
      });
    } else if (type === 'resource') {
      const resource = b.resource as Record<string, unknown> | undefined;
      const uri = typeof resource?.uri === 'string' ? resource.uri : undefined;
      out.push({
        type: 'resource',
        ...(uri === undefined ? {} : { uri }),
        ...(typeof resource?.mimeType === 'string' ? { mimeType: resource.mimeType } : {}),
      });
    }
  }
  return out;
}

function firstText(content: readonly ToolResultContent[]): string | undefined {
  for (const block of content) {
    if (block.type === 'text' && block.text) return block.text;
  }
  return undefined;
}

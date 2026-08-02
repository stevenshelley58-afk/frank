/**
 * @frank/adapter-tools-zapier-mcp
 *
 * Implements the FRANK ToolProvider protocol against Zapier's MCP server,
 * exposing Gmail, Google Calendar, and Google Tasks as Frank tools.
 *
 * Two ways in:
 *   - `createZapierMcpToolProvider(env)` — reads ZAPIER_MCP_URL / ZAPIER_MCP_TOKEN
 *     from an env-shaped object and returns either a ready provider or an error
 *     string (misconfiguration is reported, not thrown).
 *   - `new ZapierMcpToolProvider({ url, token })` — direct construction for tests
 *     and callers that already hold config.
 *
 * Tools are proposals: the composition root routes each call through the action
 * boundary (FRANK-§6.9). This package never imports `@frank/policy`.
 */

import { loadConfig, type ZapierMcpEnvSource } from './config.js';
import { ZapierMcpToolProvider } from './zapier-mcp-provider.js';

export type CreateResult =
  | { readonly ok: true; readonly provider: ZapierMcpToolProvider }
  | { readonly ok: false; readonly reason: string };

/**
 * Build a provider from environment. Never throws; returns `{ ok: false }` when
 * ZAPIER_MCP_URL / ZAPIER_MCP_TOKEN are missing or malformed so the caller can
 * degrade gracefully.
 */
export function createZapierMcpToolProvider(
  source: ZapierMcpEnvSource = process.env,
): CreateResult {
  const config = loadConfig(source);
  if (!config.ok) return { ok: false, reason: config.reason };
  return { ok: true, provider: new ZapierMcpToolProvider(config.config) };
}

export { ZapierMcpToolProvider } from './zapier-mcp-provider.js';
export type { ZapierMcpToolProviderConfig } from './zapier-mcp-provider.js';
export { McpClient, McpProtocolError } from './mcp-client.js';
export type { McpClientConfig, McpTool } from './mcp-client.js';
export { classifyTool, familyOf } from './classify.js';
export type { GoogleFamily } from './classify.js';
export { loadConfig } from './config.js';
export type {
  ZapierMcpEnv,
  ZapierMcpEnvSource,
  ConfigResult,
} from './config.js';
export type {
  ToolProvider,
  ToolDescriptor,
  ToolActionBoundary,
  ToolResult,
  ToolResultContent,
  ToolProviderStatus,
} from './types.js';

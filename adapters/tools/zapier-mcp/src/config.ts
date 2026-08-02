/**
 * Environment configuration for the Zapier MCP tool provider.
 *
 * One env var names the endpoint; a second carries the bearer token. Both are
 * required for the provider to be healthy — {@link loadConfig} reports a missing
 * value in-band via {@link ToolProviderStatus} rather than throwing at import,
 * so a misconfigured cell degrades to "no external tools" instead of crashing
 * the composition root.
 */

export interface ZapierMcpEnv {
  /** ZAPIER_MCP_URL — the MCP Streamable HTTP endpoint. */
  readonly url: string;
  /** ZAPIER_MCP_TOKEN — bearer token for the endpoint. */
  readonly token: string;
  /** Optional request timeout override in ms. */
  readonly timeoutMs?: number;
}

export interface ZapierMcpEnvSource {
  readonly ZAPIER_MCP_URL?: string;
  readonly ZAPIER_MCP_TOKEN?: string;
  readonly ZAPIER_MCP_TIMEOUT_MS?: string;
  /** Accept a full `process.env` (arbitrary extra keys) without a cast. */
  readonly [key: string]: string | undefined;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ZapierMcpEnv }
  | { readonly ok: false; readonly reason: string };

/**
 * Read and validate config from an env-shaped object (defaults to
 * `process.env`). Pure and testable: pass a fixture object in tests.
 */
export function loadConfig(source: ZapierMcpEnvSource = process.env): ConfigResult {
  const url = source.ZAPIER_MCP_URL?.trim();
  const token = source.ZAPIER_MCP_TOKEN?.trim();

  if (!url) {
    return { ok: false, reason: 'ZAPIER_MCP_URL is not set' };
  }
  if (!token) {
    return { ok: false, reason: 'ZAPIER_MCP_TOKEN is not set' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `ZAPIER_MCP_URL is not a valid URL: ${url}` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `ZAPIER_MCP_URL must be http(s): ${url}` };
  }

  const timeoutMsRaw = source.ZAPIER_MCP_TIMEOUT_MS?.trim();
  let timeoutMs: number | undefined;
  if (timeoutMsRaw) {
    const n = Number(timeoutMsRaw);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: `ZAPIER_MCP_TIMEOUT_MS must be a positive number: ${timeoutMsRaw}` };
    }
    timeoutMs = n;
  }

  return {
    ok: true,
    config: {
      url,
      token,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  };
}

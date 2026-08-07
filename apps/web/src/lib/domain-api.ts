/**
 * Server-side client for the FRANK Domain API (apps/api) — WB-05.
 *
 * The delegation front door posts to `POST /v1/workbenches` from this
 * process, exactly as the browser does (same-origin `/v1/*` in production;
 * `FRANK_DOMAIN_API_URL` server-side). Server-only — never import from a
 * 'use client' module.
 *
 * ## Auth
 *
 * Slice 1 has one user and dev-session minting (routes/auth.ts refuses to
 * exist outside development/test). Server-side we mint a session the same
 * way the tasks console does, then send the bearer token. When real
 * identity lands (Workstream 3), this file swaps the mint for the
 * service principal — no call site changes.
 */

const DEFAULT_BASE = 'http://127.0.0.1:8080';

/** Base URL of the FRANK Domain API. Env wins (12-factor). */
export function domainApiBase(): string {
  return (process.env.FRANK_DOMAIN_API_URL ?? DEFAULT_BASE).replace(/\/$/, '');
}

let cachedToken: string | null = null;

/**
 * Mint (and cache) a dev session bearer token. Returns null when the API is
 * unreachable or refuses to mint (e.g. production) — callers degrade to the
 * legacy in-process path and record the error honestly.
 */
export async function domainApiToken(): Promise<string | null> {
  if (cachedToken !== null) return cachedToken;
  try {
    const res = await fetch(`${domainApiBase()}/v1/auth/dev-session`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string };
    if (typeof body.access_token !== 'string') return null;
    cachedToken = body.access_token;
    return cachedToken;
  } catch {
    return null;
  }
}

/** Drop the cached token (call on 401 to force a re-mint). */
export function dropDomainApiToken(): void {
  cachedToken = null;
}

/** One authenticated JSON call against the domain API. */
export async function domainApiFetch(
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const token = await domainApiToken();
  if (token === null) return { status: 503, body: null };
  const res = await fetch(`${domainApiBase()}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) dropDomainApiToken();
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

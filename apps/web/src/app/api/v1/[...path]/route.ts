/**
 * Catch-all proxy for /v1/* requests from the browser → Frank Domain API.
 *
 * Caddy strips Authorization headers before proxying to the API container,
 * so browser-sourced Bearer tokens never reach /v1/*. This route proxies
 * through the web container's server-side FRANK_DOMAIN_SERVICE_TOKEN instead.
 *
 * GET/DELETE: forwarded with query string intact.
 * POST/PUT/PATCH: body is read and forwarded as JSON.
 */
import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { domainApiBase, domainApiToken } from '@/lib/domain-api';
import { hasStrictBrowserMutationProvenance, isAllowedBrowserOperation } from './policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname.replace(/^\/api\/v1/, '/v1');
  if (!isAllowedBrowserOperation(req.method, pathname)) {
    return NextResponse.json(
      { error: 'operation_not_allowed', detail: 'This browser API operation is not exposed.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !hasStrictBrowserMutationProvenance(req)) {
    return NextResponse.json(
      { error: 'forbidden', detail: 'Domain API mutations require browser same-origin provenance.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const path = pathname + req.nextUrl.search;

  const token = await domainApiToken();
  if (token === null) {
    return NextResponse.json(
      { error: 'domain_api_unavailable', detail: 'Could not authenticate with the Frank API.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  // Forward relevant original headers
  const idempotencyKey = req.headers.get('idempotency-key');
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'DELETE' && req.method !== 'HEAD') {
    try {
      body = await req.text();
    } catch {
      body = undefined;
    }
  }

  try {
    const upstream = await fetch(`${domainApiBase()}${path}`, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });

    const responseHeaders: Record<string, string> = { 'Cache-Control': 'no-store' };
    const etag = upstream.headers.get('etag');
    if (etag) responseHeaders.etag = etag;

    // A conditional GET must remain a bodyless 304. JSON-wrapping it turns a
    // cache hit into an invalid response and loses the upstream validator.
    if (upstream.status === 304) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }

    const responseBody = await upstream.text();
    let json: unknown;
    try {
      json = JSON.parse(responseBody);
    } catch {
      return NextResponse.json(
        upstream.status >= 400
          ? { error: 'domain_api_error', detail: `The Frank API returned HTTP ${upstream.status}.` }
          : { error: 'domain_api_invalid_response', detail: 'The Frank API returned an invalid response.' },
        { status: upstream.status >= 400 ? upstream.status : 502, headers: responseHeaders },
      );
    }

    return NextResponse.json(json, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    const correlationId = randomUUID();
    console.error('[domain-api-proxy] upstream request failed', {
      correlationId,
      method: req.method,
      pathname,
      error: err,
    });
    return NextResponse.json(
      {
        error: 'domain_api_unreachable',
        detail: 'Could not reach the Frank API.',
        correlation_id: correlationId,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(req: NextRequest) { return proxy(req); }
export async function POST(req: NextRequest) { return proxy(req); }
export async function PUT(req: NextRequest) { return proxy(req); }
export async function PATCH(req: NextRequest) { return proxy(req); }
export async function DELETE(req: NextRequest) { return proxy(req); }

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
import { NextRequest, NextResponse } from 'next/server';
import { domainApiBase, domainApiToken } from '@/lib/domain-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.pathname.replace(/^\/api\/v1/, '/v1') + req.nextUrl.search;
  const token = await domainApiToken();
  if (token === null) {
    return NextResponse.json(
      { error: 'domain_api_unavailable', detail: 'Could not authenticate with the Frank API.' },
      { status: 503 },
    );
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  // Forward relevant original headers
  const idempotencyKey = req.headers.get('idempotency-key');
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

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

    const responseBody = await upstream.text();
    let json: unknown;
    try {
      json = JSON.parse(responseBody);
    } catch {
      json = { raw: responseBody };
    }

    return NextResponse.json(json, {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'domain_api_unreachable',
        detail: err instanceof Error ? err.message : 'Could not reach the Frank API.',
      },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest) { return proxy(req); }
export async function POST(req: NextRequest) { return proxy(req); }
export async function PUT(req: NextRequest) { return proxy(req); }
export async function PATCH(req: NextRequest) { return proxy(req); }
export async function DELETE(req: NextRequest) { return proxy(req); }

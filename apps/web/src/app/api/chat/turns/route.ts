/**
 * Streaming bridge for chat turns — POST /api/chat/turns.
 *
 * The generic /api/v1/* BFF proxy reads the upstream body as text and
 * JSON-parses it, which would swallow the Hermes SSE stream. This route
 * forwards the turn submission to the Domain API with the service token
 * and pipes the upstream text/event-stream straight through, so the
 * browser consumes the live stream from `streamChatTurn()` in chat-api.
 */
import { NextRequest, NextResponse } from 'next/server';

import { domainApiBase, domainApiToken } from '@/lib/domain-api';
import { requestPublicOrigin } from '@/lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same-origin guard used by the /api/v1/* proxy — mutations need provenance. */
function hasBrowserProvenance(request: NextRequest): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === requestPublicOrigin(request);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!hasBrowserProvenance(req)) {
    return NextResponse.json(
      { error: 'forbidden', detail: 'Chat turns require browser same-origin provenance.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', detail: 'Could not read the request body.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

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
  const idempotencyKey = req.headers.get('idempotency-key');
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  try {
    const upstream = await fetch(`${domainApiBase()}/v1/chat/turns`, {
      method: 'POST',
      headers,
      body,
      // No client-side timeout: the turn stream is long-lived and Hermes
      // closes it (done/error) when the reply finishes.
      signal: AbortSignal.timeout(120_000),
    });

    if (upstream.status !== 200 || !upstream.body) {
      const text = await upstream.text();
      let detail = `The Frank API returned HTTP ${upstream.status}.`;
      try {
        const parsed = JSON.parse(text) as { detail?: string; error?: string };
        detail = parsed.detail ?? parsed.error ?? detail;
      } catch {
        // non-JSON body — keep the generic detail
      }
      return NextResponse.json(
        { error: 'domain_api_error', detail },
        { status: upstream.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Pipe the SSE stream through untouched.
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[chat-turns-bridge] upstream request failed', err);
    return NextResponse.json(
      { error: 'domain_api_unreachable', detail: 'Could not reach the Frank API.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

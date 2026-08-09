import { domainEventStream, domainUnavailable } from '@/lib/workbench/domain-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Relay the authenticated upstream SSE stream. The browser sees only this
 * same-origin URL; bearer material is sent upstream in a header and never
 * appears in the browser URL, referrer, or edge access log.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const url = new URL(request.url);
  const headerCursor = request.headers.get('last-event-id')?.trim();
  const queryCursor = url.searchParams.get('lastEventId')?.trim();
  const lastEventId = headerCursor || queryCursor || undefined;

  try {
    const { id } = await context.params;
    const upstream = await domainEventStream(
      `/v1/workbenches/${encodeURIComponent(id)}/events`,
      {
        ...(lastEventId === undefined ? {} : { lastEventId }),
        signal: request.signal,
      },
    );
    if (upstream === null) return domainUnavailable();

    if (!upstream.ok || upstream.body === null) {
      const body = await upstream.text();
      return new Response(body || null, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('content-type') ?? 'application/problem+json',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: 'domain_api_unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

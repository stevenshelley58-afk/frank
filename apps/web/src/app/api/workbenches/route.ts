import { domainJson, domainProblem, domainUnavailable } from '@/lib/workbench/domain-server';
import { mapDomainWorkbenchList } from '@/lib/workbench/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List durable workbenches for one room through the authenticated BFF. */
export async function GET(request: Request): Promise<Response> {
  const roomId = new URL(request.url).searchParams.get('roomId')?.trim();
  if (!roomId) {
    return Response.json(
      { error: 'validation_failed', detail: 'roomId is required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const result = await domainJson(
      `/v1/rooms/${encodeURIComponent(roomId)}/workbenches`,
      { method: 'GET' },
    );
    if (result.status < 200 || result.status >= 300 || result.body === null) {
      return result.status === 503 && result.body === null
        ? domainUnavailable()
        : domainProblem(result);
    }
    return Response.json(mapDomainWorkbenchList(result.body), {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error: 'domain_api_invalid_response',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

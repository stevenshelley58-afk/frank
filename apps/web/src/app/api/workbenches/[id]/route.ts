import { domainJson, domainProblem, domainUnavailable } from '@/lib/workbench/domain-server';
import { mapDomainWorkbenchDetail } from '@/lib/workbench/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fetch the durable plan and receipt for a selected workbench. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await domainJson(
      `/v1/workbenches/${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
    if (result.status < 200 || result.status >= 300 || result.body === null) {
      return result.status === 503 && result.body === null
        ? domainUnavailable()
        : domainProblem(result);
    }
    return Response.json(mapDomainWorkbenchDetail(result.body), {
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

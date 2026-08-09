import { missionDomainJson, missionDomainProblem } from '@/lib/missions/domain-server';
import { mapMissionSnapshot } from '@/lib/missions/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await missionDomainJson(
      `/v1/missions/${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
    if (result.status < 200 || result.status >= 300 || result.body === null) {
      return missionDomainProblem(result);
    }
    return Response.json(mapMissionSnapshot(result.body), {
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

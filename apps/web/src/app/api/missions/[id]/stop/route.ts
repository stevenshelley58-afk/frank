import { randomUUID } from 'node:crypto';

import {
  isSameOriginMissionMutation,
  missionDomainJson,
  missionDomainProblem,
} from '@/lib/missions/domain-server';
import { mapMissionStop } from '@/lib/missions/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isSameOriginMissionMutation(request)) {
    return Response.json(
      { error: 'forbidden', detail: 'Mission mutations must be same-origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const input = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (!reason) {
    return Response.json(
      { error: 'validation_failed', detail: 'A stop reason is required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const { id } = await context.params;
    const result = await missionDomainJson(
      `/v1/missions/${encodeURIComponent(id)}/stop`,
      { method: 'POST', body: { command_id: randomUUID(), reason } },
    );
    if (result.status < 200 || result.status >= 300 || result.body === null) {
      return missionDomainProblem(result);
    }
    return Response.json(mapMissionStop(result.body), {
      status: result.status,
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

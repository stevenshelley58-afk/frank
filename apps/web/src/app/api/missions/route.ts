import { randomUUID } from 'node:crypto';

import {
  isSameOriginMissionMutation,
  missionDomainJson,
  missionDomainProblem,
} from '@/lib/missions/domain-server';
import { mapMissionSnapshot } from '@/lib/missions/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MissionRequestBody {
  objective?: unknown;
  title?: unknown;
  roomName?: unknown;
  budget?: unknown;
}

function optionalPositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMissionMutation(request)) {
    return Response.json(
      { error: 'forbidden', detail: 'Mission creation must be same-origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const input = (await request.json().catch(() => null)) as MissionRequestBody | null;
  const objective = typeof input?.objective === 'string' ? input.objective.trim() : '';
  if (objective.length < 12) {
    return Response.json(
      { error: 'validation_failed', detail: 'Describe a substantial objective (at least 12 characters).' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const budgetInput = input?.budget;
  const rawBudget =
    budgetInput !== null && typeof budgetInput === 'object' && !Array.isArray(budgetInput)
      ? (budgetInput as Record<string, unknown>)
      : null;
  const spendCapUsd = optionalPositive(rawBudget?.spendCapUsd);
  const tokenBudget = optionalPositive(rawBudget?.tokenBudget);
  const wallClockSec = optionalPositive(rawBudget?.wallClockSec);
  const maxAttempts = optionalPositive(rawBudget?.maxAttempts);
  const budget =
    spendCapUsd === undefined &&
    tokenBudget === undefined &&
    wallClockSec === undefined &&
    maxAttempts === undefined
      ? undefined
      : {
          ...(spendCapUsd === undefined ? {} : { spend_cap_usd: spendCapUsd }),
          ...(tokenBudget === undefined ? {} : { token_budget: tokenBudget }),
          ...(wallClockSec === undefined ? {} : { wall_clock_sec: wallClockSec }),
          ...(maxAttempts === undefined ? {} : { max_attempts: maxAttempts }),
        };
  const title = typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : undefined;
  const roomName =
    typeof input?.roomName === 'string' && input.roomName.trim()
      ? input.roomName.trim()
      : undefined;

  try {
    const result = await missionDomainJson('/v1/missions', {
      method: 'POST',
      body: {
        command_id: randomUUID(),
        objective,
        ...(title === undefined ? {} : { title }),
        ...(roomName === undefined ? {} : { room_name: roomName }),
        ...(budget === undefined ? {} : { budget }),
      },
    });
    if (result.status < 200 || result.status >= 300 || result.body === null) {
      return missionDomainProblem(result);
    }
    return Response.json(mapMissionSnapshot(result.body), {
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

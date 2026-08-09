'use client';

import {
  MISSION_API,
  type CreateMissionInput,
  type MissionRecord,
  type MissionSnapshot,
} from './types';

async function problem(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as
    | { detail?: unknown; error?: unknown }
    | null;
  const detail =
    typeof body?.detail === 'string'
      ? body.detail
      : typeof body?.error === 'string'
        ? body.error
        : `HTTP ${response.status}`;
  return new Error(detail);
}

export async function createMission(
  input: CreateMissionInput,
  signal?: AbortSignal,
): Promise<MissionSnapshot> {
  const response = await fetch(MISSION_API.create, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await problem(response);
  return response.json() as Promise<MissionSnapshot>;
}

export async function getMission(
  missionId: string,
  signal?: AbortSignal,
): Promise<MissionSnapshot> {
  const response = await fetch(MISSION_API.get(missionId), {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await problem(response);
  return response.json() as Promise<MissionSnapshot>;
}

export async function stopMission(
  missionId: string,
  reason: string,
): Promise<MissionRecord> {
  const response = await fetch(MISSION_API.stop(missionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
    cache: 'no-store',
  });
  if (!response.ok) throw await problem(response);
  const body = (await response.json()) as { mission: MissionRecord };
  return body.mission;
}

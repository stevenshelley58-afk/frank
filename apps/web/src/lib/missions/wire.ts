import {
  MISSION_STATES,
  type MissionBudget,
  type MissionRecord,
  type MissionSnapshot,
  type MissionState,
  type MissionWorkNode,
} from './types';

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is not a finite number`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is not a boolean`);
  return value;
}

function missionState(value: unknown): MissionState {
  if (typeof value === 'string' && (MISSION_STATES as readonly string[]).includes(value)) {
    return value as MissionState;
  }
  throw new Error('mission.state is invalid');
}

function budget(value: unknown): MissionBudget {
  const row = object(value, 'mission.budget');
  return {
    spendCapUsd: number(row.spend_cap_usd, 'mission.budget.spend_cap_usd'),
    tokenBudget: number(row.token_budget, 'mission.budget.token_budget'),
    wallClockSec: number(row.wall_clock_sec, 'mission.budget.wall_clock_sec'),
    maxAttempts: number(row.max_attempts, 'mission.budget.max_attempts'),
  };
}

export function mapMissionRecord(value: unknown): MissionRecord {
  const row = object(value, 'mission');
  return {
    id: string(row.id, 'mission.id'),
    roomId: string(row.room_id, 'mission.room_id'),
    roomName: string(row.room_name, 'mission.room_name'),
    objective: string(row.objective, 'mission.objective'),
    state: missionState(row.state),
    stopNewWork: boolean(row.stop_new_work, 'mission.stop_new_work'),
    createdAt: string(row.created_at, 'mission.created_at'),
    updatedAt: string(row.updated_at, 'mission.updated_at'),
    completedAt: nullableString(row.completed_at, 'mission.completed_at'),
    lastError: nullableString(row.last_error, 'mission.last_error'),
    budget: budget(row.budget),
  };
}

function modelTier(value: unknown): 'cheap' | 'strong' {
  if (value === 'cheap' || value === 'strong') return value;
  throw new Error('work_graph.model_tier is invalid');
}

export function mapMissionWorkNode(value: unknown): MissionWorkNode {
  const row = object(value, 'work_graph node');
  if (!Array.isArray(row.depends_on) || !row.depends_on.every((id) => typeof id === 'string')) {
    throw new Error('work_graph.depends_on is not a string array');
  }
  return {
    workItemId: string(row.work_item_id, 'work_graph.work_item_id'),
    title: string(row.title, 'work_graph.title'),
    state: string(row.state, 'work_graph.state'),
    dependsOn: [...row.depends_on] as string[],
    workbenchId: nullableString(row.workbench_id, 'work_graph.workbench_id'),
    workbenchState: nullableString(row.workbench_state, 'work_graph.workbench_state'),
    attempts: number(row.attempts, 'work_graph.attempts'),
    modelTier: modelTier(row.model_tier),
  };
}

export function mapMissionSnapshot(value: unknown): MissionSnapshot {
  const body = object(value, 'mission response');
  if (!Array.isArray(body.work_graph)) throw new Error('mission response.work_graph is not an array');
  return {
    mission: mapMissionRecord(body.mission),
    workGraph: body.work_graph.map(mapMissionWorkNode),
  };
}

export function mapMissionStop(value: unknown): { mission: MissionRecord } {
  const body = object(value, 'mission stop response');
  return { mission: mapMissionRecord(body.mission) };
}

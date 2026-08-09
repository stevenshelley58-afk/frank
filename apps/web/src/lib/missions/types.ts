export const MISSION_STATES = [
  'planning',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const;

export type MissionState = (typeof MISSION_STATES)[number];

export interface MissionBudget {
  spendCapUsd: number;
  tokenBudget: number;
  wallClockSec: number;
  maxAttempts: number;
}

export interface MissionRecord {
  id: string;
  roomId: string;
  roomName: string;
  objective: string;
  state: MissionState;
  stopNewWork: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  budget: MissionBudget;
}

export interface MissionWorkNode {
  workItemId: string;
  title: string;
  state: string;
  dependsOn: string[];
  workbenchId: string | null;
  workbenchState: string | null;
  attempts: number;
  modelTier: 'cheap' | 'strong';
}

export interface MissionSnapshot {
  mission: MissionRecord;
  workGraph: MissionWorkNode[];
}

export interface CreateMissionInput {
  objective: string;
  title?: string;
  roomName?: string;
  budget?: Partial<MissionBudget>;
}

export function isMissionTerminal(state: MissionState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export const MISSION_API = {
  create: '/api/missions',
  get: (id: string) => `/api/missions/${encodeURIComponent(id)}`,
  stop: (id: string) => `/api/missions/${encodeURIComponent(id)}/stop`,
} as const;

import type { WorkState } from '@frank/adapter-postgres';

import type {
  MissionBudgetInput,
  MissionLifecycle,
  MissionModelTier,
  ResolvedMissionBudget,
} from './types.js';

export const DEFAULT_MISSION_BUDGET: ResolvedMissionBudget = {
  spendCapUsd: 10,
  tokenBudget: 250_000,
  wallClockSec: 7_200,
  maxAttempts: 2,
};

export function resolveMissionBudget(input: MissionBudgetInput | undefined): ResolvedMissionBudget {
  const budget = {
    spendCapUsd: input?.spendCapUsd ?? DEFAULT_MISSION_BUDGET.spendCapUsd,
    tokenBudget: input?.tokenBudget ?? DEFAULT_MISSION_BUDGET.tokenBudget,
    wallClockSec: input?.wallClockSec ?? DEFAULT_MISSION_BUDGET.wallClockSec,
    maxAttempts: input?.maxAttempts ?? DEFAULT_MISSION_BUDGET.maxAttempts,
  };

  if (
    !Number.isFinite(budget.spendCapUsd) ||
    budget.spendCapUsd < 0 ||
    budget.spendCapUsd >= 10_000_000_000_000_000
  ) {
    throw new Error('mission budget spendCapUsd must be finite, non-negative, and fit numeric(24,8)');
  }
  assertInteger('tokenBudget', budget.tokenBudget, 0);
  assertInteger('wallClockSec', budget.wallClockSec, 1);
  assertInteger('maxAttempts', budget.maxAttempts, 1);
  return budget;
}

export function selectModelTier(
  plannedTier: MissionModelTier,
  attempt: number,
): MissionModelTier {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('mission attempt must be a positive integer');
  }
  return attempt > 1 ? 'strong' : plannedTier;
}

export function dependenciesSatisfied(
  dependencies: readonly string[],
  stateByWorkItemId: ReadonlyMap<string, WorkState>,
): boolean {
  return dependencies.every((id) => stateByWorkItemId.get(id) === 'done');
}

export function deriveMissionLifecycle(states: readonly WorkState[]): MissionLifecycle {
  if (states.length > 0 && states.every((state) => state === 'done')) return 'completed';
  if (states.some((state) => state === 'failed')) return 'failed';
  if (
    states.length > 0 &&
    states.every((state) => state === 'cancelled' || state === 'done') &&
    states.some((state) => state === 'cancelled')
  ) {
    return 'cancelled';
  }
  if (
    states.some((state) => state === 'waiting' || state === 'blocked') &&
    !states.some((state) => state === 'ready' || state === 'active' || state === 'reviewing')
  ) {
    return 'waiting';
  }
  return 'running';
}

function assertInteger(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647) {
    throw new Error(
      `mission budget ${name} must be an integer from ${String(minimum)} to 2147483647`,
    );
  }
}

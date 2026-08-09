import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MISSION_BUDGET,
  dependenciesSatisfied,
  deriveMissionLifecycle,
  resolveMissionBudget,
  selectModelTier,
} from './helpers.js';
import { buildFallbackMissionPlan } from './planner.js';

describe('mission orchestration policy helpers', () => {
  it('builds a bounded provider-independent recovery graph', () => {
    const plan = buildFallbackMissionPlan('Inspect the repository and publish evidence.');
    expect(plan.tasks.map((task) => task.key)).toEqual([
      'execute-objective',
      'independent-review',
      'publish-evidence',
    ]);
    expect(plan.tasks[1]?.depends_on).toEqual(['execute-objective']);
    expect(plan.tasks[2]?.depends_on).toEqual(['independent-review']);
    expect(plan.tasks.every((task) => task.instruction.includes('/workspace/out'))).toBe(true);
  });

  it('resolves bounded defaults and preserves explicit zero spend/token ceilings', () => {
    expect(resolveMissionBudget(undefined)).toEqual(DEFAULT_MISSION_BUDGET);
    expect(
      resolveMissionBudget({
        spendCapUsd: 0,
        tokenBudget: 0,
        wallClockSec: 60,
        maxAttempts: 1,
      }),
    ).toEqual({ spendCapUsd: 0, tokenBudget: 0, wallClockSec: 60, maxAttempts: 1 });
  });

  it.each([
    [{ spendCapUsd: Number.NaN }, 'spendCapUsd'],
    [{ spendCapUsd: -1 }, 'spendCapUsd'],
    [{ tokenBudget: -1 }, 'tokenBudget'],
    [{ wallClockSec: 0 }, 'wallClockSec'],
    [{ maxAttempts: 0 }, 'maxAttempts'],
    [{ maxAttempts: 1.5 }, 'maxAttempts'],
  ] as const)('rejects an invalid budget %o', (budget, field) => {
    expect(() => resolveMissionBudget(budget)).toThrow(field);
  });

  it('escalates every retry to the strong model tier', () => {
    expect(selectModelTier('cheap', 1)).toBe('cheap');
    expect(selectModelTier('strong', 1)).toBe('strong');
    expect(selectModelTier('cheap', 2)).toBe('strong');
    expect(selectModelTier('strong', 3)).toBe('strong');
  });

  it('releases a node only when every declared dependency is done', () => {
    const states = new Map([
      ['a', 'done' as const],
      ['b', 'active' as const],
    ]);
    expect(dependenciesSatisfied(['a'], states)).toBe(true);
    expect(dependenciesSatisfied(['a', 'b'], states)).toBe(false);
    expect(dependenciesSatisfied([], states)).toBe(true);
  });

  it('derives terminal and waiting lifecycle without hiding runnable work', () => {
    expect(deriveMissionLifecycle(['done', 'done'])).toBe('completed');
    expect(deriveMissionLifecycle(['done', 'failed'])).toBe('failed');
    expect(deriveMissionLifecycle(['done', 'cancelled'])).toBe('cancelled');
    expect(deriveMissionLifecycle(['waiting', 'planned'])).toBe('waiting');
    expect(deriveMissionLifecycle(['waiting', 'ready'])).toBe('running');
  });
});

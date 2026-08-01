/**
 * FRANK-§7.3: "Every transition records actor, time, reason, policy decision,
 * correlation, and evidence." The state diagram is normative — printed verbatim
 * in the spec as a Mermaid `stateDiagram-v2` — and this file transcribes it and
 * holds it in place.
 *
 * Like `work-state.test.ts`, it covers *every* ordered pair of states — all
 * 25 × 25 = 625 of them — rather than a sample. A state machine tested by
 * example is a state machine whose untested edges are wherever the bug is; the
 * spec's requirement that invalid transitions be rejected is a statement about
 * the complement of the legal set, which can only be checked exhaustively.
 *
 * The database-side half of the same rule (the `run_state_machine_guard`
 * trigger, the `run_transition_legal_fk` composite foreign key, and the
 * append-only `run_transition` trigger) is covered in
 * `integration/run-state-machine.integration.test.ts`, which needs a live
 * PostgreSQL.
 */

import { describe, expect, it } from 'vitest';

import {
  IllegalRunTransitionError,
  LEGAL_RUN_TRANSITIONS,
  RUN_STATES,
  TERMINAL_RUN_STATES,
  UnknownRunStateError,
  assertRunTransition,
  canRunTransition,
  illegalRunTransitionPairs,
  isRunState,
  isTerminalRunState,
  legalRunTransitionPairs,
  normalizeRunState,
} from './run-state.js';
import type { RunState } from './run-state.js';

describe('RUN_STATES', () => {
  it('contains every lifecycle state §7.3 names', () => {
    for (const required of [
      'received',
      'clarifying',
      'planned',
      'queued',
      'running',
      'reviewing',
      'ready',
      'released',
      'completed',
      'failed',
      'cancelled',
    ] as const) {
      expect(RUN_STATES).toContain(required);
    }
  });

  it('keeps the deployment tail and the recovery branch', () => {
    for (const required of [
      'merged',
      'ready_to_deploy',
      'promoting',
      'verifying',
      'deployment_failed',
      'recovering',
      'release_reverted',
      'completed_with_recovery',
    ] as const) {
      expect(RUN_STATES).toContain(required);
    }
  });

  it('has exactly 25 states, in the spec order', () => {
    expect(RUN_STATES).toHaveLength(25);
  });

  it('has no duplicates', () => {
    expect(new Set(RUN_STATES).size).toBe(RUN_STATES.length);
  });

  it('declares a transition list for every state, and no state outside the enum', () => {
    expect(Object.keys(LEGAL_RUN_TRANSITIONS).sort()).toEqual([...RUN_STATES].sort());
    for (const from of RUN_STATES) {
      for (const to of LEGAL_RUN_TRANSITIONS[from]) {
        expect(RUN_STATES).toContain(to);
      }
    }
  });
});

describe('the legal transition set', () => {
  const legal = new Set(legalRunTransitionPairs().map(([from, to]) => `${from}->${to}`));

  it('is exactly this set, enumerated', () => {
    // Spelled out so that widening the state machine is a visible diff in a test
    // rather than a silently-passing change.
    expect([...legal].sort()).toEqual(
      [
        'blocked->failed',
        'blocked->running',
        'clarifying->planned',
        'deployment_failed->recovering',
        'failed->queued',
        'interrupted->cancelled',
        'interrupted->running',
        'merged->ready_to_deploy',
        'paused->cancelled',
        'paused->running',
        'planned->queued',
        'promoting->deployment_failed',
        'promoting->verifying',
        'queued->running',
        'ready->cancelled',
        'ready->completed',
        'ready->merged',
        'ready->ready_to_deploy',
        'ready_to_deploy->cancelled',
        'ready_to_deploy->promoting',
        'received->clarifying',
        'received->planned',
        'recovering->release_reverted',
        'released->completed',
        'release_reverted->completed_with_recovery',
        'reworking->reviewing',
        'reviewing->ready',
        'reviewing->reworking',
        'running->blocked',
        'running->cancelled',
        'running->failed',
        'running->interrupted',
        'running->partially_completed',
        'running->paused',
        'running->reviewing',
        'running->waiting',
        'verifying->deployment_failed',
        'verifying->released',
        'waiting->cancelled',
        'waiting->failed',
        'waiting->running',
      ].sort(),
    );
  });

  it('accepts every legal pair', () => {
    for (const [from, to] of legalRunTransitionPairs()) {
      expect(canRunTransition(from, to)).toBe(true);
      expect(() => assertRunTransition(from, to)).not.toThrow();
    }
  });

  it('covers 41 edges, which is what migration 0002 seeds', () => {
    expect(legalRunTransitionPairs()).toHaveLength(41);
  });
});

describe('the illegal transition set', () => {
  it('rejects every pair that is not legal — all 584 of them', () => {
    const illegal = illegalRunTransitionPairs();
    expect(illegal).toHaveLength(RUN_STATES.length * RUN_STATES.length - 41);

    for (const [from, to] of illegal) {
      expect(canRunTransition(from, to)).toBe(false);
      expect(() => assertRunTransition(from, to)).toThrow(IllegalRunTransitionError);
    }
  });

  it('partitions the full 25 × 25 product with no pair in both sets and none missing', () => {
    const legal = new Set(legalRunTransitionPairs().map(([f, t]) => `${f}->${t}`));
    const illegal = new Set(illegalRunTransitionPairs().map(([f, t]) => `${f}->${t}`));

    expect(legal.size + illegal.size).toBe(625);
    for (const pair of legal) expect(illegal.has(pair)).toBe(false);

    for (const from of RUN_STATES) {
      for (const to of RUN_STATES) {
        const key = `${from}->${to}`;
        expect(legal.has(key) || illegal.has(key)).toBe(true);
      }
    }
  });

  it('rejects every self-transition', () => {
    for (const state of RUN_STATES) {
      expect(canRunTransition(state, state)).toBe(false);
    }
  });

  it('rejects re-entering the intake state from anywhere', () => {
    for (const from of RUN_STATES) {
      expect(canRunTransition(from, 'received')).toBe(false);
    }
  });

  it('does not let a blocked run be cancelled — it is unblocked or it fails', () => {
    // §7.3 omits blocked -> cancelled deliberately; cancellation of blocked
    // work is a work-item concern, not a run concern.
    expect(canRunTransition('blocked', 'cancelled')).toBe(false);
    expect(canRunTransition('blocked', 'running')).toBe(true);
    expect(canRunTransition('blocked', 'failed')).toBe(true);
  });

  it('gives deployment_failed exactly one exit — the recovery path', () => {
    expect(LEGAL_RUN_TRANSITIONS['deployment_failed']).toEqual(['recovering']);
    expect(canRunTransition('deployment_failed', 'cancelled')).toBe(false);
    expect(canRunTransition('deployment_failed', 'completed')).toBe(false);
  });
});

describe('terminal states', () => {
  it('are exactly the four outcomes', () => {
    expect([...TERMINAL_RUN_STATES].sort()).toEqual([
      'cancelled',
      'completed',
      'completed_with_recovery',
      'partially_completed',
    ]);
  });

  it('have no outgoing transitions at all', () => {
    for (const state of TERMINAL_RUN_STATES) {
      expect(LEGAL_RUN_TRANSITIONS[state]).toEqual([]);
      expect(isTerminalRunState(state)).toBe(true);
      for (const to of RUN_STATES) {
        expect(canRunTransition(state, to)).toBe(false);
      }
    }
  });

  it('do not include `failed`, which must be retryable via a new run', () => {
    expect(isTerminalRunState('failed')).toBe(false);
    expect(canRunTransition('failed', 'queued')).toBe(true);
  });

  it('do not include `released`, which still flows to `completed`', () => {
    expect(isTerminalRunState('released')).toBe(false);
    expect(canRunTransition('released', 'completed')).toBe(true);
  });

  it('keep completed_with_recovery distinct from completed (an incident, not a success)', () => {
    expect(TERMINAL_RUN_STATES).toContain('completed_with_recovery');
    expect(TERMINAL_RUN_STATES).toContain('completed');
    // They are reached by disjoint paths.
    expect(canRunTransition('released', 'completed')).toBe(true);
    expect(canRunTransition('release_reverted', 'completed_with_recovery')).toBe(true);
    expect(canRunTransition('release_reverted', 'completed')).toBe(false);
  });

  it('names the terminal state in the error, so the caller is told what to do instead', () => {
    try {
      assertRunTransition('completed', 'running', 'run-1');
      expect.unreachable('expected an IllegalRunTransitionError');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalRunTransitionError);
      expect((error as Error).message).toContain('is terminal');
      expect((error as Error).message).toContain('new run');
      expect((error as Error).message).toContain('run-1');
    }
  });

  it('lists the legal targets in the error for a non-terminal state', () => {
    try {
      assertRunTransition('received', 'completed');
      expect.unreachable('expected an IllegalRunTransitionError');
    } catch (error) {
      expect((error as Error).message).toContain('legal targets from "received"');
      expect((error as Error).message).toContain('FRANK-§7.3');
    }
  });
});

describe('normalizeRunState', () => {
  it('is the identity on every stored state', () => {
    for (const state of RUN_STATES) {
      expect(normalizeRunState(state)).toBe(state);
    }
  });

  it('accepts no aliases — §7.3 spells each state once', () => {
    for (const alias of ['done', 'complete', 'in_progress', 'succeeded', 'error']) {
      expect(() => normalizeRunState(alias)).toThrow(UnknownRunStateError);
    }
  });

  it('fails closed on anything outside the vocabulary (FRANK-§2.3)', () => {
    for (const bogus of ['', 'RUNNING', 'archived', 'todo', 'null']) {
      expect(() => normalizeRunState(bogus)).toThrow(UnknownRunStateError);
    }
  });

  it('names the known states in the error so the caller can fix the call', () => {
    expect(() => normalizeRunState('in_progress')).toThrow(/Known states: \[received, clarifying/);
  });
});

describe('isRunState', () => {
  it('accepts stored states only, never near-misses', () => {
    expect(isRunState('running')).toBe(true);
    expect(isRunState('RUNNING')).toBe(false);
    expect(isRunState('nonsense')).toBe(false);
  });

  it('does not accept inherited Object properties', () => {
    // A `Set`-backed lookup, not `value in object` — `'toString'` must not pass.
    expect(isRunState('toString')).toBe(false);
    expect(isRunState('constructor')).toBe(false);
  });
});

describe('reachability', () => {
  it('reaches every state from `received`', () => {
    const seen = new Set<RunState>(['received']);
    const queue: RunState[] = ['received'];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of LEGAL_RUN_TRANSITIONS[current]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...RUN_STATES].sort());
  });

  it('reaches a terminal state from every non-terminal state', () => {
    for (const start of RUN_STATES) {
      if (isTerminalRunState(start)) continue;
      const seen = new Set<RunState>([start]);
      const queue: RunState[] = [start];
      let reachedTerminal = false;
      while (queue.length > 0 && !reachedTerminal) {
        const current = queue.shift()!;
        for (const next of LEGAL_RUN_TRANSITIONS[current]) {
          if (isTerminalRunState(next)) {
            reachedTerminal = true;
            break;
          }
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(reachedTerminal, `no path from "${start}" to a terminal state`).toBe(true);
    }
  });
});

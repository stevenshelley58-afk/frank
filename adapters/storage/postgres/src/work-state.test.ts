/**
 * WORK-004: "Waiting, blocked, scheduled, active, reviewing, completed,
 * cancelled, and failed states must be explicit. Invalid transitions are
 * rejected and valid transitions are audited."
 *
 * This file covers *every* ordered pair of states — all 11 × 11 = 121 of them —
 * rather than a sample. A state machine tested by example is a state machine
 * whose untested edges are wherever the bug is; the acceptance evidence asks for
 * invalid transitions to be rejected, which is a statement about the complement
 * of the legal set and can only be checked exhaustively.
 *
 * The database-side half of the same rule (the trigger and the composite foreign
 * key) is covered in `integration/work-state-machine.integration.test.ts`, which
 * needs a live PostgreSQL.
 */

import { describe, expect, it } from 'vitest';

import {
  IllegalWorkTransitionError,
  LEGAL_WORK_TRANSITIONS,
  TERMINAL_WORK_STATES,
  UnknownWorkStateError,
  WORK_STATES,
  assertTransition,
  canTransition,
  illegalTransitionPairs,
  isTerminalWorkState,
  isWorkState,
  legalTransitionPairs,
  normalizeWorkState,
} from './work-state.js';
import type { WorkState } from './work-state.js';

describe('WORK_STATES', () => {
  it('contains every state WORK-004 requires to be explicit', () => {
    // `completed` is spelled `done` per FRANK-§11.3; see normalizeWorkState below.
    for (const required of [
      'waiting',
      'blocked',
      'scheduled',
      'active',
      'reviewing',
      'done',
      'cancelled',
      'failed',
    ] as const) {
      expect(WORK_STATES).toContain(required);
    }
  });

  it('contains every state the FRANK-§11.3 normative aggregate declares', () => {
    for (const required of [
      'inbox',
      'planned',
      'ready',
      'active',
      'waiting',
      'blocked',
      'reviewing',
      'done',
      'cancelled',
    ] as const) {
      expect(WORK_STATES).toContain(required);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(WORK_STATES).size).toBe(WORK_STATES.length);
  });

  it('declares a transition list for every state, and no state outside the enum', () => {
    expect(Object.keys(LEGAL_WORK_TRANSITIONS).sort()).toEqual([...WORK_STATES].sort());
    for (const from of WORK_STATES) {
      for (const to of LEGAL_WORK_TRANSITIONS[from]) {
        expect(WORK_STATES).toContain(to);
      }
    }
  });
});

describe('the legal transition set', () => {
  const legal = new Set(legalTransitionPairs().map(([from, to]) => `${from}->${to}`));

  it('is exactly this set, enumerated', () => {
    // Spelled out so that widening the state machine is a visible diff in a test
    // rather than a silently-passing change.
    expect([...legal].sort()).toEqual(
      [
        'active->blocked',
        'active->cancelled',
        'active->done',
        'active->failed',
        'active->reviewing',
        'active->waiting',
        'blocked->active',
        'blocked->cancelled',
        'blocked->failed',
        'blocked->ready',
        'blocked->scheduled',
        'blocked->waiting',
        'failed->active',
        'failed->cancelled',
        'failed->ready',
        'failed->scheduled',
        'inbox->blocked',
        'inbox->cancelled',
        'inbox->planned',
        'inbox->ready',
        'inbox->scheduled',
        'inbox->waiting',
        'planned->blocked',
        'planned->cancelled',
        'planned->ready',
        'planned->scheduled',
        'planned->waiting',
        'ready->active',
        'ready->blocked',
        'ready->cancelled',
        'ready->scheduled',
        'ready->waiting',
        'reviewing->active',
        'reviewing->blocked',
        'reviewing->cancelled',
        'reviewing->done',
        'reviewing->failed',
        'reviewing->waiting',
        'scheduled->active',
        'scheduled->blocked',
        'scheduled->cancelled',
        'scheduled->ready',
        'scheduled->waiting',
        'waiting->active',
        'waiting->blocked',
        'waiting->cancelled',
        'waiting->failed',
        'waiting->ready',
        'waiting->scheduled',
      ].sort(),
    );
  });

  it('accepts every legal pair', () => {
    for (const [from, to] of legalTransitionPairs()) {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it('covers 49 edges, which is what migration 0001 seeds', () => {
    expect(legalTransitionPairs()).toHaveLength(49);
  });
});

describe('the illegal transition set', () => {
  it('rejects every pair that is not legal — all 72 of them', () => {
    const illegal = illegalTransitionPairs();
    expect(illegal).toHaveLength(WORK_STATES.length * WORK_STATES.length - 49);

    for (const [from, to] of illegal) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(IllegalWorkTransitionError);
    }
  });

  it('partitions the full 11 × 11 product with no pair in both sets and none missing', () => {
    const legal = new Set(legalTransitionPairs().map(([f, t]) => `${f}->${t}`));
    const illegal = new Set(illegalTransitionPairs().map(([f, t]) => `${f}->${t}`));

    expect(legal.size + illegal.size).toBe(121);
    for (const pair of legal) expect(illegal.has(pair)).toBe(false);

    for (const from of WORK_STATES) {
      for (const to of WORK_STATES) {
        const key = `${from}->${to}`;
        expect(legal.has(key) || illegal.has(key)).toBe(true);
      }
    }
  });

  it('rejects every self-transition', () => {
    for (const state of WORK_STATES) {
      expect(canTransition(state, state)).toBe(false);
    }
  });

  it('rejects reaching an outcome without doing the work', () => {
    // `done` is only reachable from a state where execution happened.
    for (const from of WORK_STATES) {
      const expected = from === 'active' || from === 'reviewing';
      expect(canTransition(from, 'done')).toBe(expected);
    }
  });

  it('rejects failing from a state where nothing was ever attempted', () => {
    expect(canTransition('inbox', 'failed')).toBe(false);
    expect(canTransition('planned', 'failed')).toBe(false);
    expect(canTransition('ready', 'failed')).toBe(false);
    expect(canTransition('scheduled', 'failed')).toBe(false);
  });

  it('rejects re-entering the inbox from anywhere', () => {
    for (const from of WORK_STATES) {
      expect(canTransition(from, 'inbox')).toBe(false);
    }
  });
});

describe('terminal states', () => {
  it('are exactly `done` and `cancelled`', () => {
    expect([...TERMINAL_WORK_STATES].sort()).toEqual(['cancelled', 'done']);
  });

  it('have no outgoing transitions at all', () => {
    for (const state of TERMINAL_WORK_STATES) {
      expect(LEGAL_WORK_TRANSITIONS[state]).toEqual([]);
      expect(isTerminalWorkState(state)).toBe(true);
      for (const to of WORK_STATES) {
        expect(canTransition(state, to)).toBe(false);
      }
    }
  });

  it('do not include `failed`, which must be retryable', () => {
    expect(isTerminalWorkState('failed')).toBe(false);
    expect(canTransition('failed', 'active')).toBe(true);
    expect(canTransition('failed', 'ready')).toBe(true);
  });

  it('name the terminal state in the error, so the caller is told what to do instead', () => {
    try {
      assertTransition('done', 'active', 'wi-1');
      expect.unreachable('expected an IllegalWorkTransitionError');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalWorkTransitionError);
      expect((error as Error).message).toContain('is terminal');
      expect((error as Error).message).toContain('successor work item');
      expect((error as Error).message).toContain('wi-1');
    }
  });

  it('lists the legal targets in the error for a non-terminal state', () => {
    try {
      assertTransition('inbox', 'done');
      expect.unreachable('expected an IllegalWorkTransitionError');
    } catch (error) {
      expect((error as Error).message).toContain('legal targets from "inbox"');
      expect((error as Error).message).toContain('WORK-004');
    }
  });
});

describe('normalizeWorkState', () => {
  it('maps WORK-004 spelling onto the FRANK-§11.3 stored value', () => {
    expect(normalizeWorkState('completed')).toBe('done');
    expect(normalizeWorkState('complete')).toBe('done');
  });

  it('is the identity on every stored state', () => {
    for (const state of WORK_STATES) {
      expect(normalizeWorkState(state)).toBe(state);
    }
  });

  it('fails closed on anything outside the vocabulary (FRANK-§2.3)', () => {
    for (const bogus of ['', 'DONE', 'in_progress', 'archived', 'todo', 'null']) {
      expect(() => normalizeWorkState(bogus)).toThrow(UnknownWorkStateError);
    }
  });

  it('names the known states in the error so the caller can fix the call', () => {
    expect(() => normalizeWorkState('in_progress')).toThrow(/Known states: \[inbox, planned/);
  });
});

describe('isWorkState', () => {
  it('accepts stored states only, never aliases', () => {
    expect(isWorkState('done')).toBe(true);
    expect(isWorkState('completed')).toBe(false);
    expect(isWorkState('nonsense')).toBe(false);
  });

  it('does not accept inherited Object properties', () => {
    // A `Set`-backed lookup, not `value in object` — `'toString'` must not pass.
    expect(isWorkState('toString')).toBe(false);
    expect(isWorkState('constructor')).toBe(false);
  });
});

describe('reachability', () => {
  it('reaches every state from `inbox`', () => {
    const seen = new Set<WorkState>(['inbox']);
    const queue: WorkState[] = ['inbox'];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of LEGAL_WORK_TRANSITIONS[current]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...WORK_STATES].sort());
  });

  it('reaches a terminal state from every non-terminal state', () => {
    for (const start of WORK_STATES) {
      if (isTerminalWorkState(start)) continue;
      const seen = new Set<WorkState>([start]);
      const queue: WorkState[] = [start];
      let reachedTerminal = false;
      while (queue.length > 0 && !reachedTerminal) {
        const current = queue.shift()!;
        for (const next of LEGAL_WORK_TRANSITIONS[current]) {
          if (isTerminalWorkState(next)) {
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

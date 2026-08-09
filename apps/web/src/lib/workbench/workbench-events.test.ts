/**
 * UI-07 core guarantees, tested without a browser:
 *  - snapshot replay is ordered + complete;
 *  - seq-dedupe: reconnect replays NEVER duplicate events;
 *  - step k/n + waiting + receipt derivation from the frozen event list.
 */

import { describe, expect, it } from 'vitest';

import { RUNNING_LIVE, RUNNING_SNAPSHOT, WAITING_SNAPSHOT } from './fixtures';
import {
  applySnapshot,
  deriveLifecycle,
  elapsedMs,
  emptyRunState,
  foldEvents,
  formatElapsed,
  mergeWorkbenchDetail,
  stepProgress,
} from './run-state';
import { parseWorkbenchEvent } from './types';

describe('applySnapshot', () => {
  it('hydrates the full ordered history', () => {
    const { state, accepted, duplicates } = applySnapshot(RUNNING_SNAPSHOT);
    expect(duplicates).toBe(0);
    expect(accepted).toBe(RUNNING_SNAPSHOT.length);
    expect(state.events.map((e) => e.seq)).toEqual(RUNNING_SNAPSHOT.map((e) => e.seq));
    expect(state.lastSeq).toBe(10);
    expect(state.totalSteps).toBe(5);
    expect(state.activeStep).toBe(3);
    expect(state.activeStepNote).toBe('Tagging batch 1/4…');
    expect(state.hydrated).toBe(true);
  });

  it('orders an out-of-order snapshot by seq', () => {
    const scrambled = [...RUNNING_SNAPSHOT].reverse();
    const { state } = applySnapshot(scrambled);
    expect(state.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('seq dedupe — the UI-07 reconnect guarantee', () => {
  it('drops replayed events after a reconnect (snapshot then overlapping live)', () => {
    // First connect: snapshot + some live events.
    const first = applySnapshot(RUNNING_SNAPSHOT);
    const withLive = foldEvents(first.state, RUNNING_LIVE.slice(0, 3));
    expect(withLive.accepted).toBe(3);

    // Reconnect: the backend replays the snapshot PLUS everything since
    // Last-Event-ID. Every seq <= 13 must be dropped.
    const replay = [...RUNNING_SNAPSHOT, ...RUNNING_LIVE];
    const after = foldEvents(withLive.state, replay);
    expect(after.duplicates).toBe(13);
    expect(after.accepted).toBe(RUNNING_LIVE.length - 3);
    // No duplicate seqs in the rendered log.
    const seqs = after.state.events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(after.state.lastSeq).toBe(17);
  });

  it('never duplicates even when the same live event arrives twice', () => {
    const base = applySnapshot(RUNNING_SNAPSHOT).state;
    const once = foldEvents(base, [RUNNING_LIVE[0]]);
    const twice = foldEvents(once.state, [RUNNING_LIVE[0]]);
    expect(twice.duplicates).toBe(1);
    expect(twice.accepted).toBe(0);
    expect(twice.state.events.length).toBe(once.state.events.length);
  });

  it('snapshot after a full run does not regress lastSeq or duplicate', () => {
    const full = foldEvents(applySnapshot(RUNNING_SNAPSHOT).state, RUNNING_LIVE).state;
    const replayed = foldEvents(full, [...RUNNING_SNAPSHOT, ...RUNNING_LIVE]);
    expect(replayed.accepted).toBe(0);
    expect(replayed.duplicates).toBe(RUNNING_SNAPSHOT.length + RUNNING_LIVE.length);
    expect(replayed.state.events.length).toBe(full.events.length);
    expect(replayed.state.lastSeq).toBe(full.lastSeq);
  });
});

describe('run-state derivation', () => {
  it('derives step k/n from plan_published + step_updated', () => {
    const { state } = applySnapshot(RUNNING_SNAPSHOT);
    expect(stepProgress(state)).toEqual({ current: 3, total: 5 });
  });

  it('derives the waiting surface from decision_requested + paused', () => {
    const { state } = applySnapshot(WAITING_SNAPSHOT);
    expect(deriveLifecycle(state)).toBe('paused');
    expect(state.waiting).not.toBeNull();
    expect(state.waiting?.workItemId).toBe('wi-2241');
    expect(state.waiting?.question).toContain('Send the ChannelPort launch email');
    expect(state.waiting?.whyNow).toContain('11:00 UTC');
    // And resumed clears it.
    const resumed = foldEvents(state, [
      { seq: 9, type: 'resumed', at: '2026-08-07T09:32:00Z', payload: {} },
    ]);
    expect(resumed.state.waiting).toBeNull();
    expect(deriveLifecycle(resumed.state)).toBe('running');
  });

  it('freezes elapsed at the terminal event', () => {
    const full = foldEvents(applySnapshot(RUNNING_SNAPSHOT).state, RUNNING_LIVE).state;
    expect(full.terminal).toBe('completed');
    const atNow = elapsedMs(full, Date.now() + 10_000_000);
    const atLater = elapsedMs(full, Date.now() + 99_000_000);
    expect(atNow).toBe(atLater); // frozen — no longer ticking
    expect(full.receipt?.whatDone).toContain('Ingested the Meta ad library export');
    expect(full.artifacts.map((a) => a.name)).toEqual(['raw-ads.jsonl', 'scores.csv']);
  });

  it('formats elapsed as mm:ss / h:mm:ss', () => {
    expect(formatElapsed(null)).toBe('—');
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(61_000)).toBe('1:01');
    expect(formatElapsed(3_661_000)).toBe('1:01:01');
  });

  it('keeps lifecycle honest for an empty stream', () => {
    expect(deriveLifecycle(emptyRunState())).toBe('unknown');
  });

  it('adds durable plan titles and receipt without regressing live progress', () => {
    const live = applySnapshot(RUNNING_SNAPSHOT).state;
    const merged = mergeWorkbenchDetail(live, {
      workbench: { id: 'wb-1' },
      plan: Array.from({ length: 5 }, (_, index) => ({
        seq: index + 1,
        step: `Durable step ${index + 1}`,
        state: 'pending' as const,
        note: null,
        updatedAt: '2026-08-06T15:00:00Z',
      })),
      receipt: {
        summary: 'Durable completion receipt.',
        publishedAt: '2026-08-06T15:01:00Z',
      },
    });

    expect(merged.planSteps[2]).toMatchObject({
      index: 3,
      title: 'Durable step 3',
      state: 'doing',
    });
    expect(merged.receipt?.summary).toBe('Durable completion receipt.');
  });
});

describe('parseWorkbenchEvent — contract envelope strictness', () => {
  it('accepts the frozen envelope shape', () => {
    const raw = {
      seq: 12,
      type: 'step_updated',
      at: '2026-08-06T15:00:00Z',
      payload: { step: 3, state: 'doing', note: '…' },
    };
    const parsed = parseWorkbenchEvent(raw);
    expect(parsed.type).toBe('step_updated');
    expect(parsed.seq).toBe(12);
  });

  it('normalizes the durable runner payload aliases', () => {
    const plan = parseWorkbenchEvent({
      seq: 4,
      type: 'plan_published',
      at: '2026-08-06T15:00:00Z',
      payload: { steps: 3 },
    });
    const step = parseWorkbenchEvent({
      seq: 5,
      type: 'step_updated',
      at: '2026-08-06T15:00:01Z',
      payload: { seq: 1, state: 'doing' },
    });
    const artifact = parseWorkbenchEvent({
      seq: 6,
      type: 'artifact_registered',
      at: '2026-08-06T15:00:02Z',
      payload: {
        artifactId: 'artifact-1',
        path: '/workspace/out/report.md',
        previewUrl: 'https://preview.frank.fail/report-v1/',
      },
    });
    const decision = parseWorkbenchEvent({
      seq: 7,
      type: 'decision_requested',
      at: '2026-08-06T15:00:03Z',
      payload: { decisionWorkItemId: 'decision-1', question: 'Publish it?' },
    });

    expect(plan.payload).toEqual({ total: 3 });
    expect(step.payload).toEqual({ seq: 1, state: 'doing', step: 1 });
    expect(artifact.payload).toMatchObject({
      id: 'artifact-1',
      name: 'report.md',
      path: '/workspace/out/report.md',
      url: 'https://preview.frank.fail/report-v1/',
    });
    expect(decision.payload).toMatchObject({ workItemId: 'decision-1' });
  });

  it('rejects unknown event types (fixed list is binding)', () => {
    expect(() =>
      parseWorkbenchEvent({ seq: 1, type: 'invented_event', at: 'x', payload: {} }),
    ).toThrow();
  });

  it('rejects envelopes missing seq/type/at', () => {
    expect(() => parseWorkbenchEvent({ type: 'paused', at: 'x', payload: {} })).toThrow();
    expect(() => parseWorkbenchEvent({ seq: 2, type: 'paused', payload: {} })).toThrow();
    expect(() => parseWorkbenchEvent(null)).toThrow();
  });
});

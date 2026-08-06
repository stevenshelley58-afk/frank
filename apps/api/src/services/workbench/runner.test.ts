/**
 * WB-02 runner unit tests — no database. The claim/recovery SQL is tested
 * against real PostgreSQL in `runner.claim.integration.test.ts`; here the
 * store is a recording fake so we can assert the runner's own logic:
 * concurrency limit, terminal-state landing, failure cleanup, recovery.
 */
import { describe, expect, it } from 'vitest';

import { WorkbenchRunner } from './runner.js';
import type { ExecuteOutcome, WorkbenchExecutor } from './runner.js';
import type { WorkbenchRecord, WorkbenchState } from './types.js';

function fakeRecord(id: string, state: WorkbenchState = 'queued'): WorkbenchRecord {
  const now = new Date('2026-08-06T10:00:00.000Z');
  return {
    id,
    cellId: 'cell-test',
    workItemId: 'wi-1',
    roomId: null,
    idempotencyKey: `key-${id}`,
    taskDef: { instruction: 'test' },
    state,
    attempts: 0,
    claimedBy: null,
    claimedAt: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    containerId: null,
    scheduleCron: null,
    scheduleTimezone: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

class FakeStore {
  queue: WorkbenchRecord[] = [];
  claimed: Array<{ id: string; runnerId: string }> = [];
  stateChanges: Array<{ id: string; state: WorkbenchState }> = [];
  events: Array<{ id: string; type: string }> = [];
  recovered: WorkbenchRecord[] = [];
  claimBehavior: (cellId: string, runnerId: string) => WorkbenchRecord | null = () => null;

  async claimNext(cellId: string, runnerId: string, _now: Date) {
    const rec = this.claimBehavior(cellId, runnerId);
    if (rec) this.claimed.push({ id: rec.id, runnerId });
    return rec;
  }
  async recoverStale(runnerId: string, now: Date, staleAfterMs: number) {
    void runnerId; void now; void staleAfterMs;
    return this.recovered;
  }
  async appendEvent(id: string, type: string, _payload: unknown, _at: Date) {
    this.events.push({ id, type });
    return this.events.length;
  }
  async setState(id: string, state: WorkbenchState, _by: string, _now: Date, _patch?: unknown) {
    this.stateChanges.push({ id, state });
    return fakeRecord(id, state);
  }
}

class RecordingExecutor implements WorkbenchExecutor {
  calls: string[] = [];
  outcomes = new Map<string, ExecuteOutcome>();
  delays = new Map<string, number>();
  async execute(record: WorkbenchRecord): Promise<ExecuteOutcome> {
    this.calls.push(`execute:${record.id}`);
    const delay = this.delays.get(record.id) ?? 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    return this.outcomes.get(record.id) ?? { kind: 'done' };
  }
  async cleanup(record: WorkbenchRecord): Promise<void> {
    this.calls.push(`cleanup:${record.id}`);
  }
}

describe('WorkbenchRunner', () => {
  it('claims and runs queued workbenches to done, landing terminal state', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const a = fakeRecord('wb-a');
    store.claimBehavior = (() => {
      let i = 0;
      return () => [a][i++] ?? null;
    })();

    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      now: () => new Date('2026-08-06T10:00:01.000Z'),
      log: () => {},
    });

    await runner.start();
    // One poll cycle: claim the single queued record.
    const claimed = await runner.pollOnce();
    expect(claimed).toBeGreaterThanOrEqual(0);
    await runner.stop();

    expect(executor.calls).toContain('execute:wb-a');
    expect(store.stateChanges.some((c) => c.id === 'wb-a' && c.state === 'done')).toBe(true);
    expect(store.events.some((e) => e.id === 'wb-a' && e.type === 'completed')).toBe(true);
    expect(runner.inflightCount).toBe(0);
  });

  it('lands failed state and cleans up when the executor reports failure', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const a = fakeRecord('wb-fail');
    executor.outcomes.set('wb-fail', { kind: 'failed', error: 'boom' });
    store.claimBehavior = (() => {
      let i = 0;
      return () => [a][i++] ?? null;
    })();

    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      log: () => {},
    });

    await runner.start();
    await runner.pollOnce();
    await runner.stop();

    expect(store.stateChanges.some((c) => c.id === 'wb-fail' && c.state === 'failed')).toBe(true);
    expect(executor.calls).toContain('cleanup:wb-fail');
    expect(store.events.some((e) => e.id === 'wb-fail' && e.type === 'failed')).toBe(true);
  });

  it('lands failed state even when the executor throws', async () => {
    const store = new FakeStore();
    const throwing: WorkbenchExecutor = {
      execute: async () => {
        throw new Error('exec crashed');
      },
      cleanup: async () => {},
    };
    const a = fakeRecord('wb-crash');
    store.claimBehavior = (() => {
      let i = 0;
      return () => [a][i++] ?? null;
    })();

    const runner = new WorkbenchRunner({
      store: store as never,
      executor: throwing,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      log: () => {},
    });

    await runner.start();
    await runner.pollOnce();
    await runner.stop();

    expect(store.stateChanges.some((c) => c.id === 'wb-crash' && c.state === 'failed')).toBe(true);
    const change = store.stateChanges.find((c) => c.id === 'wb-crash');
    expect(change?.state).toBe('failed');
  });

  it('respects the concurrency limit: never more than N in flight', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const records = ['wb-1', 'wb-2', 'wb-3', 'wb-4'].map((id) => fakeRecord(id));
    // Slow execution so claims stack up.
    for (const r of records) executor.delays.set(r.id, 40);

    let peak = 0;
    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      concurrency: 2,
      pollIntervalMs: 5,
      log: () => {},
    });

    // Hand out records one per claim call.
    let i = 0;
    store.claimBehavior = () => {
      const rec = records[i] ?? null;
      if (rec) i++;
      return rec;
    };

    // Wrap execute to observe peak inflight.
    const innerExecute = executor.execute.bind(executor);
    executor.execute = async (rec) => {
      peak = Math.max(peak, runner.inflightCount);
      return innerExecute(rec);
    };

    await runner.start();
    // Poll repeatedly until all four are claimed.
    for (let p = 0; p < 8 && i < records.length; p++) {
      await runner.pollOnce();
      await new Promise((r) => setTimeout(r, 15));
    }
    await runner.stop();

    expect(i).toBe(records.length); // all claimed
    expect(peak).toBeLessThanOrEqual(2);
    expect(executor.calls.filter((c) => c.startsWith('execute:'))).toHaveLength(4);
  });

  it('recovery: re-queues stale claims and calls cleanup for their orphans', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const stale = fakeRecord('wb-stale', 'provisioning');
    store.recovered = [stale];

    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      log: () => {},
    });

    await runner.start(); // start() runs recover()
    await runner.stop();

    expect(executor.calls).toContain('cleanup:wb-stale');
    expect(store.events.some((e) => e.id === 'wb-stale' && e.type === 'resumed')).toBe(true);
  });

  it('stop() drains in-flight runs before resolving', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const a = fakeRecord('wb-slow');
    executor.delays.set('wb-slow', 30);
    store.claimBehavior = (() => {
      let i = 0;
      return () => [a][i++] ?? null;
    })();

    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      log: () => {},
    });

    await runner.start();
    await runner.pollOnce();
    await runner.stop();
    expect(runner.inflightCount).toBe(0);
    expect(executor.calls).toContain('execute:wb-slow');
  });
});

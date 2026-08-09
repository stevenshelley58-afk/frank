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
  receipts: Array<{ id: string; summary: string }> = [];
  recovered: WorkbenchRecord[] = [];
  nonTerminal: WorkbenchRecord[] = [];
  honestFailures: Array<{ id: string; reason: string }> = [];
  staleAfterMs: number | null = null;
  claimBehavior: (cellId: string, runnerId: string) => WorkbenchRecord | null = () => null;

  async claimNext(cellId: string, runnerId: string, _now: Date) {
    const rec = this.claimBehavior(cellId, runnerId);
    if (rec) this.claimed.push({ id: rec.id, runnerId });
    return rec;
  }
  async recoverStale(runnerId: string, now: Date, staleAfterMs: number) {
    void runnerId; void now;
    this.staleAfterMs = staleAfterMs;
    return this.recovered;
  }
  async listNonTerminal() {
    return this.nonTerminal;
  }
  async failHonest(workbenchId: string, reason: string, _receipt: string, _by: string, _now: Date) {
    this.honestFailures.push({ id: workbenchId, reason });
    this.stateChanges.push({ id: workbenchId, state: 'failed' });
    // Mirror the real store.failHonest: failed + receipt_published events.
    this.events.push({ id: workbenchId, type: 'failed' });
    this.events.push({ id: workbenchId, type: 'receipt_published' });
  }
  async appendEvent(id: string, type: string, _payload: unknown, _at: Date) {
    this.events.push({ id, type });
    return this.events.length;
  }
  async setState(id: string, state: WorkbenchState, _by: string, _now: Date, _patch?: unknown) {
    this.stateChanges.push({ id, state });
    return fakeRecord(id, state);
  }
  async publishReceipt(id: string, receipt: { summary: string }, _by: string, _at: Date) {
    this.receipts.push({ id, summary: receipt.summary });
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
    expect(store.staleAfterMs).toBe(90_000);
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

  /* ------------------------------------------------------------- WB-07 --- */

  it('WB-07: requestStop cancels the active run -> cancelled state + events + honest receipt', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const rec = fakeRecord('wb-stop');
    // A long-running execute that the stop must interrupt.
    executor.delays.set('wb-stop', 5000);
    store.claimBehavior = (() => {
      let i = 0;
      return () => [rec][i++] ?? null;
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
    // Wait until the run is live in the stop registry.
    await new Promise((r) => setTimeout(r, 20));
    const stopped = await runner.requestStop('wb-stop', 'user pressed stop');
    expect(stopped).toBe(true);
    await runner.stop();

    expect(store.stateChanges).toContainEqual({ id: 'wb-stop', state: 'cancelled' });
    const types = store.events.filter((e) => e.id === 'wb-stop').map((e) => e.type);
    expect(types).toContain('stop_requested');
    expect(types).toContain('cancelled');
    // Honest receipt for the leash termination.
    expect(store.receipts.some((r) => r.id === 'wb-stop' && /stopped/i.test(r.summary))).toBe(true);
  });

  it('WB-07: requestStop returns false when no run is live', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      log: () => {},
    });
    await runner.start();
    expect(await runner.requestStop('wb-never-claimed', 'stop')).toBe(false);
    await runner.stop();
  });

  it('WB-07: wall-clock timeout -> timed_out + failed + honest receipt', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const rec = fakeRecord('wb-timeout');
    // Very short leash; execute never finishes in time.
    (rec.taskDef as { leash?: { wallClockSec: number } }).leash = { wallClockSec: 0 };
    executor.delays.set('wb-timeout', 5000);
    store.claimBehavior = (() => {
      let i = 0;
      return () => [rec][i++] ?? null;
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

    expect(store.stateChanges).toContainEqual({ id: 'wb-timeout', state: 'failed' });
    const types = store.events.filter((e) => e.id === 'wb-timeout').map((e) => e.type);
    expect(types).toContain('timed_out');
    expect(types).toContain('failed');
    expect(store.receipts.some((r) => r.id === 'wb-timeout' && /timed out/i.test(r.summary))).toBe(true);
  });

  it('WB-09: a workbench over the attempt budget fails honestly instead of re-queueing', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    // A crash-looping workbench: already at the budget ceiling.
    const stale = fakeRecord('wb-overbudget', 'provisioning');
    (stale as { attempts: number }).attempts = 5;
    store.recovered = [stale];

    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      maxAttempts: 5,
      log: () => {},
    });

    await runner.start(); // recover() runs
    await runner.stop();

    // Failed honestly, NOT re-queued.
    expect(store.honestFailures).toHaveLength(1);
    expect(store.honestFailures[0]?.id).toBe('wb-overbudget');
    expect(store.stateChanges).toContainEqual({ id: 'wb-overbudget', state: 'failed' });
    // Cleanup was attempted and a failure receipt recorded.
    expect(executor.calls).toContain('cleanup:wb-overbudget');
    expect(store.events.some((e) => e.id === 'wb-overbudget' && e.type === 'failed')).toBe(true);
  });

  it('WB-09: waiting workbenches survive recovery untouched (never resumed/orphaned)', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    // A waiting workbench with an outstanding human decision.
    const waiting = fakeRecord('wb-waiting', 'waiting');
    store.nonTerminal = [waiting];
    store.recovered = []; // nothing stale

    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      log: () => {},
    });

    await runner.start();
    await runner.stop();

    // Recovery did NOT touch the waiting workbench — no state change, no
    // resume, no failure. It stays waiting for its command-envelope resolution.
    expect(store.stateChanges).not.toContainEqual(
      expect.objectContaining({ id: 'wb-waiting' }),
    );
    expect(store.events.some((e) => e.id === 'wb-waiting')).toBe(false);
  });

  it('WB-09: a workbench under the attempt budget is re-queued for another try', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const stale = fakeRecord('wb-underbudget', 'provisioning');
    (stale as { attempts: number }).attempts = 2; // under the default budget of 5
    store.recovered = [stale];

    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      maxAttempts: 5,
      log: () => {},
    });

    await runner.start();
    await runner.stop();

    // Re-queued (a resumed event), NOT failed.
    expect(store.honestFailures).toHaveLength(0);
    expect(store.events.some((e) => e.id === 'wb-underbudget' && e.type === 'resumed')).toBe(true);
  });

  it('WB-07: terminal reporter receives the terminal outcome when wired', async () => {
    const store = new FakeStore();
    const executor = new RecordingExecutor();
    const rec = fakeRecord('wb-report');
    executor.outcomes.set('wb-report', { kind: 'done' });
    store.claimBehavior = (() => {
      let i = 0;
      return () => [rec][i++] ?? null;
    })();

    const reported: Array<{ kind: string }> = [];
    const runner = new WorkbenchRunner({
      store: store as never,
      executor,
      runnerId: 'runner-1',
      cellIds: ['cell-test'],
      pollIntervalMs: 5,
      log: () => {},
      terminalReporter: {
        async reportTerminal(_record, outcome) {
          reported.push({ kind: outcome.kind });
        },
      },
    });

    await runner.start();
    await runner.pollOnce();
    await runner.stop();
    expect(reported).toContainEqual({ kind: 'done' });
  });
});

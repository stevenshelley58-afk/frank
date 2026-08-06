/**
 * WorkbenchRunner — the WB-02 queue runner.
 *
 * One runner per process (or per cell); it polls the `workbench` table for
 * `queued` rows, claims them, and executes them through the provisioner +
 * harness seam. Everything durable about a run lives in Postgres (WB-01);
 * this file is the scheduler that moves rows through the states.
 *
 * ## Claim safety (the whole point of WB-02)
 *
 * Two runners polling the same cell must never execute the same workbench
 * twice. The claim is a single transaction:
 *
 *     SELECT id FROM workbench WHERE state='queued' ... FOR UPDATE SKIP LOCKED
 *     UPDATE workbench SET state='provisioning', claimed_by=..., ... WHERE id=... AND state='queued'
 *
 * `SKIP LOCKED` (not `NOWAIT`): a loser's scan skips the row the winner is
 * locking and takes the next candidate, so N runners drain the queue in
 * parallel instead of serialising on contention. The `state='queued'` guard
 * on the UPDATE is the belt to `FOR UPDATE`'s braces — even a claim built on
 * a stale read cannot double-move the row. Claim idempotency is tested
 * against the real database in `runner.claim.integration.test.ts`.
 *
 * ## Concurrency limit
 *
 * At most {@link WorkbenchRunnerOptions.concurrency} (default 2) workbenches
 * are in flight per runner. The loop only claims while a slot is free.
 *
 * ## Recovery
 *
 * On start, {@link WorkbenchRunner.start} runs a recovery scan: rows left in
 * `provisioning`/`running` with a claim older than `staleClaimMs` belonged
 * to a runner that died. They are reset to `queued` (attempts survives, so a
 * retry budget can see them) and their containers/volumes are cleaned up
 * through the provisioner seam before re-queue.
 *
 * ## Terminal states
 *
 * `done`, `failed`, `cancelled` are terminal: the runner never claims or
 * recovers a terminal row, and finishing a run always lands in one of them
 * (success -> done, execution error -> failed, cancel -> cancelled). A run
 * that errors is NOT automatically re-queued here; re-queue policy (attempt
 * budgets) is a caller decision (WB-05).
 *
 * ## What this file deliberately does not import
 *
 * No Docker, no Goose. Execution happens through the injected
 * {@link WorkbenchExecutor} seam, so the runner is unit-testable with a fake
 * and the real executor (WB-03 provisioner + WB-04 harness adapter) can be
 * wired at composition time.
 */

import type { WorkbenchStore } from './store.js';
import type { WorkbenchRecord } from './types.js';
import { isTerminalWorkbenchState } from './types.js';

/**
 * What a run needs to do, injected so the runner stays harness/provisioner
 * agnostic (WB-04: the real executor is provisioner + AgentHarnessAdapter;
 * tests use a fake that records calls).
 */
export interface WorkbenchExecutor {
  /** Execute one claimed workbench to a terminal outcome. */
  execute(record: WorkbenchRecord): Promise<ExecuteOutcome>;
  /**
   * Best-effort cleanup of a workbench's container/volume (WB-02 orphan
   * path + failed-run path). Must be idempotent — cleaning something that
   * never provisioned is a no-op.
   */
  cleanup(record: WorkbenchRecord): Promise<void>;
}

export type ExecuteOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; error: string };

export interface WorkbenchRunnerOptions {
  readonly store: WorkbenchStore;
  readonly executor: WorkbenchExecutor;
  /** Stable identity stamped into claimed_by. */
  readonly runnerId: string;
  /** Cells this runner serves. Polled round-robin, oldest-first per cell. */
  readonly cellIds: readonly string[];
  /** Max workbenches in flight per runner. Default 2. */
  readonly concurrency?: number;
  /** Poll interval when the queue was empty. Default 2000ms. */
  readonly pollIntervalMs?: number;
  /** Claims older than this with no terminal state are recovered. Default 10min. */
  readonly staleClaimMs?: number;
  /** Injectable clock (tests). Default Date.now. */
  readonly now?: () => Date;
  /** Injectable logger. Default: console. */
  readonly log?: (message: string) => void;
}

export class WorkbenchRunner {
  private readonly store: WorkbenchStore;
  private readonly executor: WorkbenchExecutor;
  private readonly runnerId: string;
  private readonly cellIds: readonly string[];
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly staleClaimMs: number;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: WorkbenchRunnerOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.runnerId = options.runnerId;
    this.cellIds = options.cellIds;
    this.concurrency = options.concurrency ?? 2;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.staleClaimMs = options.staleClaimMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((m) => console.error(m));
  }

  /**
   * Start the runner: recovery scan first (crashed predecessor's claims are
   * ours to clean before we accept new work), then the claim loop.
   * Resolves once recovery is done; the loop runs on timers until stop().
   */
  async start(): Promise<void> {
    this.stopped = false;
    await this.recover();
    this.schedule(0);
  }

  /** Stop claiming. In-flight runs finish; returns when they do. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Visible for tests: how many runs are currently executing. */
  get inflightCount(): number {
    return this.inFlight;
  }

  /**
   * WB-02 recovery scan: re-queue stale claims and clean their orphans.
   * Runs at start; also safe to invoke manually (e.g. after a deploy).
   */
  async recover(): Promise<WorkbenchRecord[]> {
    const stale = await this.store.recoverStale(
      this.runnerId,
      this.now(),
      this.staleClaimMs,
    );
    for (const record of stale) {
      this.log(
        `workbench ${record.id}: recovered stale claim (${record.state} claimed ${record.claimedAt?.toISOString() ?? '?'}) — cleaning up and re-queueing`,
      );
      try {
        await this.executor.cleanup(record);
      } catch (error) {
        this.log(
          `workbench ${record.id}: orphan cleanup failed (${describeError(error)}) — row re-queued anyway`,
        );
      }
      await this.store.appendEvent(
        record.id,
        'resumed',
        { reason: 'stale-claim-recovery', by: this.runnerId },
        this.now(),
      );
    }
    return stale;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.pollOnce();
    }, delayMs);
    // The runner must never keep the process alive on its own.
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref: () => void }).unref();
    }
  }

  /** One poll cycle: claim while slots are free. Visible for tests. */
  async pollOnce(): Promise<number> {
    if (this.stopped) return 0;
    let claimed = 0;
    while (!this.stopped && this.inFlight < this.concurrency) {
      const record = await this.claimFromAnyCell();
      if (record === null) break; // queue drained for now
      claimed += 1;
      this.inFlight += 1;
      void this.run(record);
    }
    this.schedule(this.pollIntervalMs);
    return claimed;
  }

  private async claimFromAnyCell(): Promise<WorkbenchRecord | null> {
    for (const cellId of this.cellIds) {
      const record = await this.store.claimNext(cellId, this.runnerId, this.now());
      if (record !== null) return record;
    }
    return null;
  }

  private async run(record: WorkbenchRecord): Promise<void> {
    try {
      const outcome = await this.executor.execute(record);
      if (this.stopped) {
        // We finished while stopping; still land the terminal state.
      }
      if (outcome.kind === 'done') {
        await this.store.setState(record.id, 'done', this.runnerId, this.now(), {
          finishedAt: this.now(),
        });
        await this.store.appendEvent(record.id, 'completed', { by: this.runnerId }, this.now());
      } else {
        await this.store.setState(record.id, 'failed', this.runnerId, this.now(), {
          finishedAt: this.now(),
          lastError: outcome.error,
        });
        await this.store.appendEvent(
          record.id,
          'failed',
          { by: this.runnerId, error: outcome.error },
          this.now(),
        );
        try {
          await this.executor.cleanup(record);
        } catch (error) {
          this.log(
            `workbench ${record.id}: post-failure cleanup failed (${describeError(error)})`,
          );
        }
      }
    } catch (error) {
      // Executor itself threw (as opposed to returning { kind:'failed' }).
      const message = describeError(error);
      this.log(`workbench ${record.id}: executor crashed (${message})`);
      try {
        await this.store.setState(record.id, 'failed', this.runnerId, this.now(), {
          finishedAt: this.now(),
          lastError: `executor crashed: ${message}`,
        });
        await this.store.appendEvent(
          record.id,
          'failed',
          { by: this.runnerId, error: `executor crashed: ${message}` },
          this.now(),
        );
        await this.executor.cleanup(record);
      } catch (innerError) {
        this.log(
          `workbench ${record.id}: could not record executor crash (${describeError(innerError)}) — recovery scan will pick it up`,
        );
      }
    } finally {
      this.inFlight -= 1;
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Guard for callers holding a WorkbenchRecord from elsewhere: never hand a
 * terminal record to a runner path. Kept here (not in types.ts) because it
 * is queue policy, not record shape.
 */
export function isClaimable(record: WorkbenchRecord): boolean {
  return record.state === 'queued' && !isTerminalWorkbenchState(record.state);
}

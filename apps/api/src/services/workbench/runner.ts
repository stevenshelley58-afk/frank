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
  /**
   * WB-07: cancel the active run cooperatively (adapter.cancel → kill). The
   * leash calls this on stop/timeout; it must return promptly (the runner
   * gives it a short grace window before forcing terminal bookkeeping).
   * Optional so existing fakes keep working; absent = stop lands state only.
   */
  cancel?(record: WorkbenchRecord, reason: string): Promise<void>;
}

export type ExecuteOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; error: string };

/**
 * WB-07: canonical side effects of a terminal run (work-item transition,
 * audit entry, outbox event — §3.1). The runner stays Postgres-execution-only;
 * composition wires this hook to the domain store so EVERY terminal outcome
 * carries its canonical record.
 */
export interface TerminalReporter {
  reportTerminal(
    record: WorkbenchRecord,
    outcome:
      | { kind: 'done' }
      | { kind: 'failed'; error: string; cause: 'error' | 'timeout' }
      | { kind: 'cancelled'; reason: string },
  ): Promise<void>;
}

/** One in-flight run the runner can stop (WB-07 stop registry). */
interface ActiveRun {
  readonly record: WorkbenchRecord;
  /** Resolves with the stop reason the moment a stop is requested. */
  readonly stopSignal: Promise<string>;
  /** Set by requestStop; resolves stopSignal. */
  notifyStop: ((reason: string) => void) | null;
}

/** Small deferred promise helper. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The leash's discriminated outcome for one run. */
type LeashOutcome =
  | { kind: 'execute'; outcome: ExecuteOutcome }
  | { kind: 'stopped'; reason: string }
  | { kind: 'timeout'; wallClockSec: number };

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
  /**
   * WB-07: canonical side effects of a terminal run (§3.1 — work-item
   * transition + audit + outbox). Optional: composition wires the domain
   * store here; absent (unit tests) the runner lands workbench state only.
   */
  readonly terminalReporter?: TerminalReporter;
  /**
   * WB-07: default wall-clock leash in seconds when a task def carries none.
   * Every run is leashed — the runner enforces it, never the model (W10).
   */
  readonly defaultWallClockSec?: number;
  /**
   * WB-07: grace the executor gets to cancel cooperatively before the runner
   * forces terminal bookkeeping. Default 5s (Stop must halt < 5s under load).
   */
  readonly stopGraceMs?: number;
  /**
   * WB-09: maximum claim attempts before a crash-looping workbench is failed
   * honestly instead of re-queued forever. Default 5. Each claim (including a
   * re-claim after stale recovery) consumes one attempt.
   */
  readonly maxAttempts?: number;
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
  private readonly terminalReporter: TerminalReporter | null;
  private readonly defaultWallClockSec: number;
  private readonly stopGraceMs: number;
  private readonly maxAttempts: number;

  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** WB-07 stop registry: workbench id -> its live run handle. */
  private readonly active = new Map<string, ActiveRun>();

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
    this.terminalReporter = options.terminalReporter ?? null;
    this.defaultWallClockSec = options.defaultWallClockSec ?? 3600;
    this.stopGraceMs = options.stopGraceMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 5;
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
   * WB-07: first-class Stop. Requests cancellation of the active run for
   * `workbenchId`. Returns true if a run was live and the stop was signalled.
   *
   * The leash is authoritative and lives ONLY here — the model/harness cannot
   * disable it (W10). We:
   *   1. record `stop_requested` (append-only evidence),
   *   2. signal the run's leash to cancel the executor,
   *   3. let the executor a short grace to cooperate, then the `run()` loop
   *      lands the terminal `cancelled` state + audit regardless.
   *
   * If the workbench is not live here (queued, or running under another
   * runner), returns false so the caller can persist the stop for recovery.
   */
  async requestStop(workbenchId: string, reason: string): Promise<boolean> {
    const handle = this.active.get(workbenchId);
    if (handle === undefined) return false;

    // Idempotent: a second stop on an already-stopping run is a no-op.
    if (handle.notifyStop === null) return true;

    await this.store.appendEvent(
      workbenchId,
      'stop_requested',
      { by: this.runnerId, reason },
      this.now(),
    );
    const notify = handle.notifyStop;
    handle.notifyStop = null;
    notify(reason);
    return true;
  }

  /**
   * WB-02 recovery scan: re-queue stale claims and clean their orphans.
   * Runs at start; also safe to invoke manually (e.g. after a deploy).
   *
   * WB-09 extends this into a full restart reconciliation. The durable state
   * lives in Postgres, so a restart is safe IF we handle each non-terminal
   * state correctly (§11.3):
   *
   *   provisioning/running — the old process is gone and its in-memory
   *     claim/container state is untrusted. recoverStale re-queues them once
   *     the claim goes stale. But a workbench that keeps crashing on every
   *     attempt would be re-queued forever; the attempt budget caps that and
   *     fails it honestly with a receipt instead.
   *   waiting — a human decision is outstanding. Its resolution arrives via
   *     the command envelope; a restart must never resume or orphan it, so we
   *     leave it exactly where it is.
   *   verifying — review is external state; also left alone.
   *   queued — the normal claim loop picks it up; nothing to do.
   *
   * Returns the records whose state this scan touched (re-queued or failed),
   * so tests and callers can observe the reconciliation.
   */
  async recover(): Promise<WorkbenchRecord[]> {
    const touched: WorkbenchRecord[] = [];

    /* ---- 1. stale provisioning/running claims: re-queue or honest-fail --- */
    const stale = await this.store.recoverStale(
      this.runnerId,
      this.now(),
      this.staleClaimMs,
    );
    for (const record of stale) {
      // Each recovery consumes one attempt. Over budget => stop the loop and
      // fail honestly rather than re-queueing a crash-looping run forever.
      if (record.attempts >= this.maxAttempts) {
        this.log(
          `workbench ${record.id}: attempt budget exhausted (${record.attempts}/${this.maxAttempts}) — failing honestly instead of re-queueing`,
        );
        try {
          await this.executor.cleanup(record);
        } catch (error) {
          this.log(
            `workbench ${record.id}: cleanup on budget-exhaustion failed (${describeError(error)})`,
          );
        }
        await this.store.failHonest(
          record.id,
          `recovery exhausted the attempt budget (${record.attempts} attempts)`,
          'Run could not be recovered: it exceeded the retry budget. The runner stopped retrying rather than looping. Inspect the last_error and events for the underlying failure.',
          this.runnerId,
          this.now(),
        );
        await this.reportTerminal(record, {
          kind: 'failed',
          error: `attempt budget exhausted (${record.attempts})`,
          cause: 'error',
        });
        touched.push(record);
        continue;
      }

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
      touched.push(record);
    }

    /* ---- 2. report the full non-terminal picture (read-only) ------------- */
    const open = await this.store.listNonTerminal();
    const byState = new Map<string, number>();
    for (const record of open) {
      byState.set(record.state, (byState.get(record.state) ?? 0) + 1);
    }
    this.log(
      `workbench reconcile: ${open.length} non-terminal ` +
        `(${[...byState.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || 'none'})`,
    );

    return touched;
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
    // WB-07: register in the stop registry so requestStop() can reach this
    // run. The leash is enforced HERE (never by the model — W10).
    const stop = deferred<string>();
    const handle: ActiveRun = { record, stopSignal: stop.promise, notifyStop: stop.resolve };
    this.active.set(record.id, handle);

    const wallClockSec = record.taskDef.leash?.wallClockSec ?? this.defaultWallClockSec;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const outcome = await Promise.race([
        this.executor
          .execute(record)
          .then((o): LeashOutcome => ({ kind: 'execute', outcome: o })),
        new Promise<LeashOutcome>((resolve) => {
          timer = setTimeout(
            () => resolve({ kind: 'timeout', wallClockSec }),
            wallClockSec * 1000,
          );
        }),
        handle.stopSignal.then(
          (reason): LeashOutcome => ({ kind: 'stopped', reason }),
        ),
      ]);
      if (timer !== undefined) clearTimeout(timer);

      if (outcome.kind === 'execute') {
        await this.landExecuteOutcome(record, outcome.outcome);
      } else if (outcome.kind === 'stopped') {
        await this.landCancellation(record, outcome.reason);
      } else {
        await this.landTimeout(record, outcome.wallClockSec);
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
        await this.reportTerminal(record, {
          kind: 'failed',
          error: `executor crashed: ${message}`,
          cause: 'error',
        });
        await this.executor.cleanup(record);
      } catch (innerError) {
        this.log(
          `workbench ${record.id}: could not record executor crash (${describeError(innerError)}) — recovery scan will pick it up`,
        );
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.active.delete(record.id);
      this.inFlight -= 1;
    }
  }

  /** Normal done/failed from the executor. */
  private async landExecuteOutcome(
    record: WorkbenchRecord,
    outcome: ExecuteOutcome,
  ): Promise<void> {
    if (outcome.kind === 'done') {
      await this.store.setState(record.id, 'done', this.runnerId, this.now(), {
        finishedAt: this.now(),
      });
      await this.store.appendEvent(record.id, 'completed', { by: this.runnerId }, this.now());
      await this.reportTerminal(record, { kind: 'done' });
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
      await this.reportTerminal(record, { kind: 'failed', error: outcome.error, cause: 'error' });
      try {
        await this.executor.cleanup(record);
      } catch (error) {
        this.log(
          `workbench ${record.id}: post-failure cleanup failed (${describeError(error)})`,
        );
      }
    }
  }

  /** WB-07: Stop → cooperative cancel with a short grace, then cancelled. */
  private async landCancellation(record: WorkbenchRecord, reason: string): Promise<void> {
    await this.cancelExecutor(record, reason);
    await this.store.setState(record.id, 'cancelled', this.runnerId, this.now(), {
      finishedAt: this.now(),
      lastError: `stopped: ${reason}`,
    });
    await this.store.appendEvent(
      record.id,
      'cancelled',
      { by: this.runnerId, reason },
      this.now(),
    );
    // Truthful receipt — the run ended by Stop, not by completing its work.
    await this.publishLeashReceipt(record, `Run stopped before completion. Reason: ${reason}`);
    await this.reportTerminal(record, { kind: 'cancelled', reason });
    try {
      await this.executor.cleanup(record);
    } catch (error) {
      this.log(`workbench ${record.id}: post-cancel cleanup failed (${describeError(error)})`);
    }
  }

  /** WB-07: wall-clock timeout → timed_out event + honest failed receipt. */
  private async landTimeout(record: WorkbenchRecord, wallClockSec: number): Promise<void> {
    await this.cancelExecutor(record, `wall-clock leash (${wallClockSec}s) elapsed`);
    await this.store.appendEvent(
      record.id,
      'timed_out',
      { by: this.runnerId, wallClockSec },
      this.now(),
    );
    await this.store.setState(record.id, 'failed', this.runnerId, this.now(), {
      finishedAt: this.now(),
      lastError: `timed out after ${wallClockSec}s (runner-enforced leash)`,
    });
    await this.store.appendEvent(
      record.id,
      'failed',
      { by: this.runnerId, error: `timed out after ${wallClockSec}s`, cause: 'timeout' },
      this.now(),
    );
    await this.publishLeashReceipt(
      record,
      `Run timed out after ${wallClockSec}s and was stopped by the runner leash. No completion receipt was produced.`,
    );
    await this.reportTerminal(record, {
      kind: 'failed',
      error: `timed out after ${wallClockSec}s`,
      cause: 'timeout',
    });
    try {
      await this.executor.cleanup(record);
    } catch (error) {
      this.log(`workbench ${record.id}: post-timeout cleanup failed (${describeError(error)})`);
    }
  }

  /**
   * Give the executor a bounded grace window to cancel cooperatively. The
   * terminal bookkeeping lands regardless of whether cancel returns in time —
   * the leash is authoritative (W10: Stop halts < 5s).
   */
  private async cancelExecutor(record: WorkbenchRecord, reason: string): Promise<void> {
    if (this.executor.cancel === undefined) return;
    try {
      await withTimeout(
        this.executor.cancel(record, reason),
        this.stopGraceMs,
        'stop grace window elapsed',
      );
    } catch (error) {
      this.log(
        `workbench ${record.id}: cancel did not cooperate within ${this.stopGraceMs}ms (${describeError(error)}) — forcing terminal state`,
      );
    }
  }

  /** Honest receipt for leash terminations (timeout/stop) — WB-07/W10. */
  private async publishLeashReceipt(record: WorkbenchRecord, summary: string): Promise<void> {
    try {
      await this.store.publishReceipt(
        record.id,
        { summary, assumptions: [], evidence: [] },
        `runner/${this.runnerId}`,
        this.now(),
      );
      await this.store.appendEvent(record.id, 'receipt_published', { by: this.runnerId }, this.now());
    } catch (error) {
      this.log(`workbench ${record.id}: leash receipt failed (${describeError(error)})`);
    }
  }

  /** Canonical side effects of a terminal run (§3.1), when wired. */
  private async reportTerminal(
    record: WorkbenchRecord,
    outcome:
      | { kind: 'done' }
      | { kind: 'failed'; error: string; cause: 'error' | 'timeout' }
      | { kind: 'cancelled'; reason: string },
  ): Promise<void> {
    if (this.terminalReporter === null) return;
    try {
      await this.terminalReporter.reportTerminal(record, outcome);
    } catch (error) {
      // A reporter failure must not mask the run's terminal state — log it.
      this.log(
        `workbench ${record.id}: terminal reporter failed (${describeError(error)})`,
      );
    }
  }
}

/** Race a promise against a deadline; reject with `message` if it overruns. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
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

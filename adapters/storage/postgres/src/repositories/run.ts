/**
 * Run repository — FRANK-§7.3 ("Durable run state").
 *
 * The run analogue of {@link WorkItemRepository} (`work.ts`). Every mutating
 * method does the same three things in one transaction, because FRANK-§11.5
 * requires it:
 *
 *     domain mutation  ->  canonical audit entry  ->  outbox event
 *
 * and takes a {@link FrankTransaction} so it cannot do otherwise.
 *
 * Two distinct concepts live here, as in the spec: the *work* (a `work_item`,
 * governed by `work-state.ts`) and an *execution* of an assignment against that
 * work (a `run`, governed by `run-state.ts`). A work item may produce many runs
 * — retries, recovery, rework — each with its own lifecycle, executor, policy
 * decision, and evidence trail.
 *
 * The state machine is enforced three times on the transition path, matching
 * WORK-004's layering:
 *
 *   1. `assertRunTransition` — a typed error before the round trip;
 *   2. the `run_state_machine_guard` trigger on `run` — rejects the UPDATE;
 *   3. the `run_transition_legal_fk` composite foreign key — rejects the
 *      history row.
 *
 * `run-state-machine.integration.test.ts` proves layers 2 and 3 independently
 * by issuing raw SQL that skips this class entirely.
 */

import { and, eq, sql } from 'drizzle-orm';

import type { DataClass, PolicyResult } from '@frank/contracts';

import type { FrankExecutor, FrankTransaction } from '../db.js';
import { EVENT_TYPES, buildEventEnvelope, eventSource } from '../events.js';
import { newId } from '../ids.js';
import { run, runTransition } from '../schema/run.js';
import type { RunRow } from '../schema/run.js';
import type { ActorKind, Provenance, VersionedRef } from '../schema/shared.js';
import {
  assertRunTransition,
  isTerminalRunState,
  normalizeRunState,
} from '../run-state.js';
import type { RunState } from '../run-state.js';
import { AuditRepository } from './audit.js';
import { OutboxRepository } from './outbox.js';

/** Raised when the caller's `expected_version` no longer matches (FRANK-§12.3). */
export class RunOptimisticConcurrencyError extends Error {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(runId: string, expectedVersion: number, actualVersion: number) {
    super(
      `run ${runId} was modified concurrently: expected version ${expectedVersion}, found ${actualVersion} (FRANK-§11.1, FRANK-§12.3).`,
    );
    this.name = 'RunOptimisticConcurrencyError';
    this.runId = runId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run ${runId} does not exist.`);
    this.name = 'RunNotFoundError';
  }
}

export interface CreateRunInput {
  readonly id?: string | undefined;
  readonly cellId: string;
  /** Must be a non-terminal intake state; defaults to `received`. */
  readonly state?: RunState | undefined;
  readonly workItemId: string;
  /** The failed/interrupted run this one retries or recovers from, if any. */
  readonly predecessorRunId?: string | undefined;
  readonly executorKind: ActorKind;
  readonly executorId: string;
  readonly harness: string;
  readonly policyRef: VersionedRef;
  readonly policyResult?: PolicyResult | undefined;
  readonly contextPackRef?: VersionedRef | undefined;
  readonly workflowVersion?: string | undefined;
  readonly dataClass?: DataClass | undefined;
  readonly provenance: Provenance;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export interface RunTransitionInput {
  readonly runId: string;
  readonly cellId: string;
  /** FRANK-§12.3 `expected_version`. Omit only for a caller that just read the row. */
  readonly expectedVersion?: number | undefined;
  readonly toState: RunState;
  readonly actor: { kind: ActorKind; id: string };
  readonly reason?: string | undefined;
  readonly correlationId: string;
  readonly now: Date;
  readonly policyVersion?: string | undefined;
  readonly policyDecision?: PolicyResult | undefined;
  /** FRANK-§7.3: evidence for the transition — a versioned ref to an artifact/audit entry. */
  readonly evidenceRef?: VersionedRef | undefined;
}

export interface RunTransitionResult {
  readonly runId: string;
  readonly fromState: RunState;
  readonly toState: RunState;
  readonly version: number;
  readonly auditEntryId: string;
  readonly eventId: string;
}

export class RunRepository {
  readonly #audit: AuditRepository;
  readonly #outbox: OutboxRepository;

  constructor(audit = new AuditRepository(), outbox = new OutboxRepository()) {
    this.#audit = audit;
    this.#outbox = outbox;
  }

  async create(tx: FrankTransaction, input: CreateRunInput): Promise<RunRow> {
    const state = input.state ?? 'received';
    if (isTerminalRunState(state)) {
      throw new Error(
        `Refusing to create run directly in terminal state "${state}": an outcome with no transition history cannot be explained (FRANK-§7.3).`,
      );
    }

    const id = input.id ?? newId();
    const dataClass = input.dataClass ?? 'private';

    const inserted = await tx
      .insert(run)
      .values({
        id,
        cellId: input.cellId,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: `${input.actor.kind}/${input.actor.id}`,
        updatedBy: `${input.actor.kind}/${input.actor.id}`,
        provenance: input.provenance,
        state,
        workItemId: input.workItemId,
        predecessorRunId: input.predecessorRunId ?? null,
        executorKind: input.executorKind,
        executorId: input.executorId,
        harness: input.harness,
        policyRef: input.policyRef,
        policyResult: input.policyResult ?? 'allow',
        contextPackRef: input.contextPackRef ?? null,
        dataClass,
        workflowVersion: input.workflowVersion ?? '1',
        version: 1,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) throw new Error('insert into run returned no row');

    await this.#audit.append(tx, {
      cellId: input.cellId,
      occurredAt: input.now,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      action: 'run.created',
      targetKind: 'run',
      targetId: id,
      correlationId: input.correlationId,
      dataClass,
      changeRedacted: {
        fields: ['work_item', 'executor', 'harness', 'state'],
        state,
      },
    });

    const envelope = buildEventEnvelope({
      type: EVENT_TYPES.runCreated,
      source: eventSource('run', id),
      cellId: input.cellId,
      actorId: `${input.actor.kind}/${input.actor.id}`,
      correlationId: input.correlationId,
      classification: dataClass,
      subject: `run/${id}`,
      occurredAt: input.now,
      data: {
        runId: id,
        workItemId: input.workItemId,
        harness: input.harness,
        state,
      },
    });

    await this.#outbox.enqueue(tx, envelope, {
      aggregateKind: 'run',
      aggregateId: id,
      createdAt: input.now,
    });

    return row;
  }

  /**
   * Move a run to a new state — FRANK-§7.3.
   *
   * Order of operations mirrors `WorkItemRepository.transition` and is not
   * arbitrary:
   *
   *   1. lock the row (`FOR UPDATE`) so concurrent transitions serialize;
   *   2. check `expected_version` (FRANK-§12.3);
   *   3. check the transition against the pure table, for a useful error;
   *   4. UPDATE — where the `run_state_machine_guard` trigger checks again;
   *   5. append the history row, whose composite foreign key checks a third time;
   *   6. append the audit entry;
   *   7. enqueue the outbox event.
   *
   * Steps 4–7 share the caller's transaction, so a failure anywhere leaves no
   * partial record.
   */
  async transition(tx: FrankTransaction, input: RunTransitionInput): Promise<RunTransitionResult> {
    const toState = normalizeRunState(input.toState);

    const locked = await tx
      .select()
      .from(run)
      .where(and(eq(run.id, input.runId), eq(run.cellId, input.cellId)))
      .for('update');

    const current = locked[0];
    if (current === undefined) throw new RunNotFoundError(input.runId);

    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new RunOptimisticConcurrencyError(input.runId, input.expectedVersion, current.version);
    }

    const fromState = current.state;
    assertRunTransition(fromState, toState, input.runId);

    const nextVersion = current.version + 1;
    const actorRef = `${input.actor.kind}/${input.actor.id}`;

    await tx
      .update(run)
      .set({
        state: toState,
        version: nextVersion,
        updatedAt: input.now,
        updatedBy: actorRef,
        // FRANK-§7.3: execution start and finish are recorded once, on the
        // first transition that reaches them. `running` begins execution; any
        // terminal state ends it.
        startedAt: toState === 'running' && current.startedAt === null ? input.now : current.startedAt,
        finishedAt: isTerminalRunState(toState) ? input.now : current.finishedAt,
      })
      .where(eq(run.id, input.runId));

    const seqRows = await tx
      .select({ next: sql<number>`coalesce(max(${runTransition.seq}), 0) + 1` })
      .from(runTransition)
      .where(eq(runTransition.runId, input.runId));
    const seq = Number(seqRows[0]?.next ?? 1);

    const transitionId = newId();
    const audited = await this.#audit.append(tx, {
      cellId: input.cellId,
      occurredAt: input.now,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      action: 'run.state_changed',
      targetKind: 'run',
      targetId: input.runId,
      correlationId: input.correlationId,
      dataClass: current.dataClass,
      policyVersion: input.policyVersion,
      policyDecision: input.policyDecision,
      changeRedacted: {
        field: 'state',
        from: fromState,
        to: toState,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
    });

    await tx.insert(runTransition).values({
      id: transitionId,
      cellId: input.cellId,
      runId: input.runId,
      seq,
      fromState,
      toState,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      reason: input.reason ?? null,
      policyResult: input.policyDecision ?? 'allow',
      evidenceRef: input.evidenceRef ?? null,
      occurredAt: input.now,
      auditEntryId: audited.id,
      correlationId: input.correlationId,
      resultingVersion: nextVersion,
    });

    const envelope = buildEventEnvelope({
      type: runEventTypeForTransition(toState),
      source: eventSource('run', input.runId),
      cellId: input.cellId,
      actorId: actorRef,
      correlationId: input.correlationId,
      classification: current.dataClass,
      subject: `run/${input.runId}`,
      occurredAt: input.now,
      data: {
        runId: input.runId,
        from: fromState,
        to: toState,
        version: nextVersion,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
    });

    const eventId = await this.#outbox.enqueue(tx, envelope, {
      aggregateKind: 'run',
      aggregateId: input.runId,
      createdAt: input.now,
    });

    return {
      runId: input.runId,
      fromState,
      toState,
      version: nextVersion,
      auditEntryId: audited.id,
      eventId,
    };
  }

  async findById(db: FrankExecutor, cellId: string, runId: string): Promise<RunRow | undefined> {
    const rows = await db
      .select()
      .from(run)
      .where(and(eq(run.id, runId), eq(run.cellId, cellId)))
      .limit(1);
    return rows[0];
  }

  async history(db: FrankExecutor, runId: string) {
    return db
      .select()
      .from(runTransition)
      .where(eq(runTransition.runId, runId))
      .orderBy(runTransition.seq);
  }
}

/**
 * FRANK-§7.3 outcome events. Terminal failures, releases, and completions are
 * distinct event types so consumers (escalation, billing, notifications) can
 * subscribe to exactly what they care about rather than filtering every
 * `run.state_changed`.
 */
function runEventTypeForTransition(toState: RunState): string {
  if (toState === 'failed') return EVENT_TYPES.runFailed;
  if (toState === 'released') return EVENT_TYPES.runReleased;
  if (toState === 'completed' || toState === 'completed_with_recovery' || toState === 'partially_completed') {
    return EVENT_TYPES.runCompleted;
  }
  return EVENT_TYPES.runStateChanged;
}

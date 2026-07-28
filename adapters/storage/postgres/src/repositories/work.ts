/**
 * Work item repository — WORK-001..006, FRANK-§11.3, ADR-004, FRANK-§11.5.
 *
 * Every mutating method here does the same three things in one transaction,
 * because FRANK-§11.5 requires it:
 *
 *     domain mutation  ->  canonical audit entry  ->  outbox event
 *
 * and takes a {@link FrankTransaction} so it cannot do otherwise.
 *
 * The state machine is enforced twice on this path: `assertTransition` gives the
 * caller a typed error before the round trip, and the
 * `work_item_state_machine_guard` trigger rejects the UPDATE if this code is
 * ever bypassed. `work-state-machine.integration.test.ts` proves the trigger
 * independently by issuing raw SQL that skips this class entirely.
 */

import { and, eq, sql } from 'drizzle-orm';

import type { FrankExecutor, FrankTransaction } from '../db.js';
import { EVENT_TYPES, buildEventEnvelope, eventSource } from '../events.js';
import { newId } from '../ids.js';
import { workItem, workItemAssignment, workItemTransition } from '../schema/work.js';
import type { WorkItemRow, WorkKind, WorkPriority } from '../schema/work.js';
import type { ActorKind, Provenance, VersionedRef } from '../schema/shared.js';
import { assertTransition, isTerminalWorkState, normalizeWorkState } from '../work-state.js';
import type { WorkState } from '../work-state.js';
import { AuditRepository } from './audit.js';
import { OutboxRepository } from './outbox.js';

/** Raised when the caller's `expected_version` no longer matches (FRANK-§12.3). */
export class OptimisticConcurrencyError extends Error {
  readonly workItemId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(workItemId: string, expectedVersion: number, actualVersion: number) {
    super(
      `work_item ${workItemId} was modified concurrently: expected version ${expectedVersion}, found ${actualVersion} (FRANK-§11.1, FRANK-§12.3).`,
    );
    this.name = 'OptimisticConcurrencyError';
    this.workItemId = workItemId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class WorkItemNotFoundError extends Error {
  constructor(workItemId: string) {
    super(`work_item ${workItemId} does not exist.`);
    this.name = 'WorkItemNotFoundError';
  }
}

export interface CreateWorkItemInput {
  readonly id?: string | undefined;
  readonly cellId: string;
  readonly kind: WorkKind;
  readonly title: string;
  readonly description?: string | undefined;
  /** Must be a legal intake state; defaults to `inbox`. */
  readonly state?: WorkState | undefined;
  readonly priority?: WorkPriority | undefined;
  readonly ownerKind: ActorKind;
  readonly ownerId: string;
  readonly projectId?: string | undefined;
  readonly parentId?: string | undefined;
  readonly policyRef: VersionedRef;
  readonly provenance: Provenance;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
  readonly whyNow?: string | undefined;
  readonly nextSafeAction?: string | undefined;
  readonly definitionOfDone?: ReadonlyArray<{ id: string; statement: string; verification: string }> | undefined;
  readonly dataClass?: 'open' | 'internal' | 'private' | 'sensitive' | 'secret' | undefined;
  readonly scheduledFor?: { at: Date; timezone: string } | undefined;
  readonly dueAt?: { at: Date; timezone: string } | undefined;
  readonly recurrence?:
    | { seriesId: string; rule: string; timezone: string; occurrenceKey: string }
    | undefined;
}

export interface TransitionInput {
  readonly workItemId: string;
  readonly cellId: string;
  /** FRANK-§12.3 `expected_version`. Omit only for a caller that just read the row. */
  readonly expectedVersion?: number | undefined;
  /** Accepts WORK-004's `completed` as well as FRANK-§11.3's `done`. */
  readonly toState: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly reason?: string | undefined;
  readonly correlationId: string;
  readonly now: Date;
  readonly policyVersion?: string | undefined;
  readonly policyDecision?: 'allow' | 'allow_with_limits' | 'hold_for_review' | 'deny' | undefined;
}

export interface TransitionResult {
  readonly workItemId: string;
  readonly fromState: WorkState;
  readonly toState: WorkState;
  readonly version: number;
  readonly auditEntryId: string;
  readonly eventId: string;
}

export class WorkItemRepository {
  readonly #audit: AuditRepository;
  readonly #outbox: OutboxRepository;

  constructor(audit = new AuditRepository(), outbox = new OutboxRepository()) {
    this.#audit = audit;
    this.#outbox = outbox;
  }

  async create(tx: FrankTransaction, input: CreateWorkItemInput): Promise<WorkItemRow> {
    const state = input.state ?? 'inbox';
    if (isTerminalWorkState(state)) {
      throw new Error(
        `Refusing to create work_item directly in terminal state "${state}": an outcome with no transition history cannot be explained (WORK-002, WORK-004).`,
      );
    }

    const id = input.id ?? newId();

    const inserted = await tx
      .insert(workItem)
      .values({
        id,
        cellId: input.cellId,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: `${input.actor.kind}/${input.actor.id}`,
        updatedBy: `${input.actor.kind}/${input.actor.id}`,
        provenance: input.provenance,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        state,
        priority: input.priority ?? 'none',
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        projectId: input.projectId ?? null,
        parentId: input.parentId ?? null,
        policyRef: input.policyRef,
        whyNow: input.whyNow ?? null,
        nextSafeAction: input.nextSafeAction ?? null,
        definitionOfDone: [...(input.definitionOfDone ?? [])],
        dataClass: input.dataClass ?? 'private',
        scheduledForAt: input.scheduledFor?.at ?? null,
        scheduledForTimezone: input.scheduledFor?.timezone ?? null,
        dueAt: input.dueAt?.at ?? null,
        dueTimezone: input.dueAt?.timezone ?? null,
        recurrenceSeriesId: input.recurrence?.seriesId ?? null,
        recurrenceRule: input.recurrence?.rule ?? null,
        recurrenceTimezone: input.recurrence?.timezone ?? null,
        occurrenceKey: input.recurrence?.occurrenceKey ?? null,
        version: 1,
      })
      .returning();

    const row = inserted[0];
    if (row === undefined) throw new Error('insert into work_item returned no row');

    await this.#audit.append(tx, {
      cellId: input.cellId,
      occurredAt: input.now,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      action: 'work.created',
      targetKind: 'work_item',
      targetId: id,
      correlationId: input.correlationId,
      dataClass: input.dataClass ?? 'private',
      changeRedacted: { fields: ['kind', 'title', 'state', 'priority', 'owner'], state },
    });

    const envelope = buildEventEnvelope({
      type: EVENT_TYPES.workCreated,
      source: eventSource('work', id),
      cellId: input.cellId,
      actorId: `${input.actor.kind}/${input.actor.id}`,
      correlationId: input.correlationId,
      classification: input.dataClass ?? 'private',
      subject: `work_item/${id}`,
      occurredAt: input.now,
      data: { workItemId: id, kind: input.kind, state, priority: input.priority ?? 'none' },
    });

    await this.#outbox.enqueue(tx, envelope, {
      aggregateKind: 'work_item',
      aggregateId: id,
      createdAt: input.now,
    });

    return row;
  }

  /**
   * Move a work item to a new state — WORK-004.
   *
   * Order of operations matters and is not arbitrary:
   *
   *   1. lock the row (`FOR UPDATE`), so two concurrent transitions serialize
   *      rather than both reading the same `from` state;
   *   2. check `expected_version` (FRANK-§12.3);
   *   3. check the transition against the pure table, for a useful error;
   *   4. UPDATE — where the database trigger checks it again;
   *   5. append the history row, whose composite foreign key checks it a third time;
   *   6. append the audit entry (WORK-004: "valid transitions are audited");
   *   7. enqueue the outbox event (ADR-004).
   *
   * Steps 4–7 are in the caller's transaction, so a failure anywhere leaves no
   * partial record — no state change without its audit entry, no event without
   * its state change.
   */
  async transition(tx: FrankTransaction, input: TransitionInput): Promise<TransitionResult> {
    const toState = normalizeWorkState(input.toState);

    const locked = await tx
      .select()
      .from(workItem)
      .where(and(eq(workItem.id, input.workItemId), eq(workItem.cellId, input.cellId)))
      .for('update');

    const current = locked[0];
    if (current === undefined) throw new WorkItemNotFoundError(input.workItemId);

    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new OptimisticConcurrencyError(input.workItemId, input.expectedVersion, current.version);
    }

    const fromState = current.state;
    assertTransition(fromState, toState, input.workItemId);

    const nextVersion = current.version + 1;
    const actorRef = `${input.actor.kind}/${input.actor.id}`;

    await tx
      .update(workItem)
      .set({
        state: toState,
        version: nextVersion,
        updatedAt: input.now,
        updatedBy: actorRef,
        // WORK-002 "dates": entering execution and reaching an outcome are
        // recorded once, on the first transition that reaches them.
        startedAt: toState === 'active' && current.startedAt === null ? input.now : current.startedAt,
        completedAt: toState === 'done' ? input.now : current.completedAt,
      })
      .where(eq(workItem.id, input.workItemId));

    const seqRows = await tx
      .select({ next: sql<number>`coalesce(max(${workItemTransition.seq}), 0) + 1` })
      .from(workItemTransition)
      .where(eq(workItemTransition.workItemId, input.workItemId));
    const seq = Number(seqRows[0]?.next ?? 1);

    const transitionId = newId();
    const audited = await this.#audit.append(tx, {
      cellId: input.cellId,
      occurredAt: input.now,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      action: 'work.state_changed',
      targetKind: 'work_item',
      targetId: input.workItemId,
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

    await tx.insert(workItemTransition).values({
      id: transitionId,
      cellId: input.cellId,
      workItemId: input.workItemId,
      seq,
      fromState,
      toState,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      reason: input.reason ?? null,
      occurredAt: input.now,
      auditEntryId: audited.id,
      correlationId: input.correlationId,
      resultingVersion: nextVersion,
    });

    const envelope = buildEventEnvelope({
      type: eventTypeForTransition(toState),
      source: eventSource('work', input.workItemId),
      cellId: input.cellId,
      actorId: actorRef,
      correlationId: input.correlationId,
      classification: current.dataClass,
      subject: `work_item/${input.workItemId}`,
      occurredAt: input.now,
      data: {
        workItemId: input.workItemId,
        from: fromState,
        to: toState,
        version: nextVersion,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
    });

    const eventId = await this.#outbox.enqueue(tx, envelope, {
      aggregateKind: 'work_item',
      aggregateId: input.workItemId,
      createdAt: input.now,
    });

    return {
      workItemId: input.workItemId,
      fromState,
      toState,
      version: nextVersion,
      auditEntryId: audited.id,
      eventId,
    };
  }

  /**
   * WORK-003: "Work can be delegated to a person, agent profile, team of agents,
   * or external system without changing its identity."
   *
   * The work item's `id`, `version`, dependencies, and history are untouched.
   * Only an assignment row is added — which is what "without changing its
   * identity" has to mean in a schema.
   */
  async assign(
    tx: FrankTransaction,
    input: {
      workItemId: string;
      cellId: string;
      assignee: { kind: ActorKind; id: string };
      role?: string | undefined;
      actor: { kind: ActorKind; id: string };
      correlationId: string;
      now: Date;
    },
  ): Promise<string> {
    const id = newId();
    await tx.insert(workItemAssignment).values({
      id,
      cellId: input.cellId,
      workItemId: input.workItemId,
      assigneeKind: input.assignee.kind,
      assigneeId: input.assignee.id,
      role: input.role ?? 'collaborator',
      assignedAt: input.now,
      assignedBy: `${input.actor.kind}/${input.actor.id}`,
    });

    await this.#audit.append(tx, {
      cellId: input.cellId,
      occurredAt: input.now,
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      action: 'work.assigned',
      targetKind: 'work_item',
      targetId: input.workItemId,
      correlationId: input.correlationId,
      changeRedacted: {
        assigneeKind: input.assignee.kind,
        assigneeId: input.assignee.id,
        role: input.role ?? 'collaborator',
      },
    });

    const envelope = buildEventEnvelope({
      type: EVENT_TYPES.workAssigned,
      source: eventSource('work', input.workItemId),
      cellId: input.cellId,
      actorId: `${input.actor.kind}/${input.actor.id}`,
      correlationId: input.correlationId,
      classification: 'internal',
      subject: `work_item/${input.workItemId}`,
      occurredAt: input.now,
      data: {
        workItemId: input.workItemId,
        assigneeKind: input.assignee.kind,
        assigneeId: input.assignee.id,
      },
    });

    await this.#outbox.enqueue(tx, envelope, {
      aggregateKind: 'work_item',
      aggregateId: input.workItemId,
      createdAt: input.now,
    });

    return id;
  }

  async findById(
    db: FrankExecutor,
    cellId: string,
    workItemId: string,
  ): Promise<WorkItemRow | undefined> {
    const rows = await db
      .select()
      .from(workItem)
      .where(and(eq(workItem.id, workItemId), eq(workItem.cellId, cellId)))
      .limit(1);
    return rows[0];
  }

  async history(db: FrankExecutor, workItemId: string) {
    return db
      .select()
      .from(workItemTransition)
      .where(eq(workItemTransition.workItemId, workItemId))
      .orderBy(workItemTransition.seq);
  }
}

/**
 * FRANK-§12.5 requires `work.blocked` and `work.completed` as distinct events,
 * not just `work.state_changed` with a payload field. Consumers subscribe to
 * event types, so a blocked-item escalation should not have to receive and
 * discard every other transition.
 */
function eventTypeForTransition(toState: WorkState): string {
  if (toState === 'blocked') return EVENT_TYPES.workBlocked;
  if (toState === 'done') return EVENT_TYPES.workCompleted;
  return EVENT_TYPES.workStateChanged;
}

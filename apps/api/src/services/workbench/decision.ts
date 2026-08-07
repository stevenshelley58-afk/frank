/**
 * WorkbenchDecisionService — HITL-01 + HITL-02: the decision seam.
 *
 * ## HITL-01: a decision FROM INSIDE a run is a normal work item
 *
 * The harness/runner calls `requestDecision` with structured context. Frank
 * creates a NORMAL decision work item (kind `decision`, state `waiting`) —
 * indistinguishable in the API from any other ADR-022 approval — links it to
 * the paused workbench, and appends `decision_requested` + `paused`. The run
 * pauses (workbench `waiting`); nothing else is blocked.
 *
 * ## HITL-02: resolution flows through the command envelope
 *
 * The decision is resolved by the normal command envelope on the decision work
 * item (`POST /v1/work/{id}/commands/ready` approves, `cancel` denies).
 * `resolveDecision` is the hook that work-item transition path calls: it moves
 * the linked workbench in the same breath —
 *   ready  -> workbench resumes (`waiting` -> `running`), event `resumed`
 *   cancel -> workbench safe-fails (`waiting` -> `failed`) with an honest
 *             receipt, event `failed`
 * Optimistic concurrency on the work-item version rejects stale/duplicate
 * commands (a resolved decision cannot be re-resolved). Waiting workbenches
 * survive runner restart because their state is durable in Postgres (WB-09
 * recovery leaves `waiting` rows alone).
 *
 * Everything canonical (the decision item's lifecycle, audit, outbox) stays on
 * `work_item`; the `workbench_decision` table only records the linkage and the
 * resolution path.
 */

import { sql } from 'drizzle-orm';

import {
  AuditRepository,
  OutboxRepository,
  WorkItemRepository,
  buildEventEnvelope,
  eventSource,
  newId,
  schema,
} from '@frank/adapter-postgres';
import type { FrankDatabase, FrankTransaction } from '@frank/adapter-postgres';

import { WorkbenchStore } from './store.js';

type ActorKind = schema.ActorKind;

/** The decision is already open or already resolved. */
export class DecisionConflictError extends Error {
  constructor(readonly workbenchId: string, readonly reason: string) {
    super(`decision conflict on workbench ${workbenchId}: ${reason}`);
  }
}

export class WorkbenchNotFoundError extends Error {
  constructor(readonly workbenchId: string) {
    super(`workbench ${workbenchId} not found`);
  }
}

export interface RequestDecisionCommand {
  readonly cellId: string;
  readonly workbenchId: string;
  /** What is being asked of the human. */
  readonly question: string;
  /** Why now (WORK-006 guidance). */
  readonly whyNow?: string;
  /** The next safe action (WORK-006 guidance). */
  readonly nextSafeAction?: string;
  /** Material evidence supporting the decision. */
  readonly evidence?: readonly string[];
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export interface RequestDecisionOutcome {
  readonly decisionWorkItemId: string;
  readonly workbenchState: 'waiting';
}

export type DecisionResolution = 'ready' | 'cancel';

export interface ResolveDecisionCommand {
  readonly cellId: string;
  readonly decisionWorkItemId: string;
  readonly resolution: DecisionResolution;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

const WORKBENCH_STATE_CHANGED_EVENT = 'frank.workbench.state_changed.v1';

export class WorkbenchDecisionService {
  readonly #store: WorkbenchStore;
  readonly #work: WorkItemRepository;
  readonly #audit = new AuditRepository();
  readonly #outbox = new OutboxRepository();
  readonly #db: FrankDatabase;

  constructor(db: FrankDatabase) {
    this.#db = db;
    this.#store = new WorkbenchStore(db);
    this.#work = new WorkItemRepository(this.#audit, this.#outbox);
  }

  get store(): WorkbenchStore {
    return this.#store;
  }

  /**
   * HITL-01: create the decision work item + link, pause the workbench.
   * Idempotent-safe: a second request while a decision is OPEN fails with
   * DecisionConflictError (the partial unique index is the backstop).
   */
  async requestDecision(
    command: RequestDecisionCommand,
  ): Promise<RequestDecisionOutcome> {
    const record = await this.#store.getWorkbench(command.cellId, command.workbenchId);
    if (record === null) throw new WorkbenchNotFoundError(command.workbenchId);
    if (record.state !== 'running' && record.state !== 'provisioning') {
      throw new DecisionConflictError(
        record.id,
        `cannot request a decision while the workbench is "${record.state}"`,
      );
    }

    const decisionWorkItemId = newId();
    const actorRef = `${command.actor.kind}/${command.actor.id}`;

    await this.#db.transaction(async (tx) => {
      // 1) The decision work item — a NORMAL ADR-022 decision in `waiting`.
      const item = await this.#work.create(tx, {
        id: decisionWorkItemId,
        cellId: command.cellId,
        kind: 'decision',
        title: command.question,
        description: command.question,
        // WORK-006 guidance rides on the item itself.
        ...(command.whyNow === undefined ? {} : { whyNow: command.whyNow }),
        ...(command.nextSafeAction === undefined
          ? {}
          : { nextSafeAction: command.nextSafeAction }),
        ownerKind: command.actor.kind,
        ownerId: command.actor.id,
        policyRef: { ref: 'frank.operating-policy', version: 'v1' },
        provenance: {
          method: 'automation',
          producer: 'apps/api/workbench-decision',
          correlationId: command.correlationId,
        },
        actor: command.actor,
        correlationId: command.correlationId,
        now: command.now,
        dataClass: 'private',
      });

      // 2) Move it straight to `waiting` — this is what makes it an approval.
      await this.#work.transition(tx, {
        workItemId: item.id,
        cellId: command.cellId,
        toState: 'waiting',
        expectedVersion: item.version,
        actor: command.actor,
        reason: command.question,
        correlationId: command.correlationId,
        now: command.now,
      });

      // 3) Link it to the workbench (partial unique index = at most one open).
      const linked = await tx.execute(sql`
        insert into "frank_domain"."workbench_decision"
          (workbench_id, decision_work_item_id, requested_at)
        values (${record.id}, ${decisionWorkItemId}, ${command.now})
        on conflict do nothing
        returning workbench_id
      `);
      if (linked.rows.length === 0) {
        throw new DecisionConflictError(
          record.id,
          'a decision is already open for this workbench',
        );
      }

      // 4) Pause the workbench + append the two durable events.
      await tx.execute(sql`
        update "frank_domain"."workbench" set
          state = 'waiting',
          updated_by = ${actorRef},
          updated_at = ${command.now},
          version = version + 1
        where id = ${record.id} and cell_id = ${command.cellId}
          and state in ('running', 'provisioning')
      `);
      await this.#appendEvent(tx, record.id, 'decision_requested', {
        decisionWorkItemId,
        question: command.question,
        ...(command.evidence === undefined ? {} : { evidence: command.evidence }),
      }, command.now);
      await this.#appendEvent(tx, record.id, 'paused', {
        reason: 'decision_requested',
        decisionWorkItemId,
      }, command.now);

      // 5) Audit the pause (§3.1).
      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: 'workbench.decision_requested',
        targetKind: 'workbench',
        targetId: record.id,
        correlationId: command.correlationId,
        dataClass: 'private',
        changeRedacted: { fields: ['state'], state: 'waiting' },
      });

      const envelope = buildEventEnvelope({
        type: WORKBENCH_STATE_CHANGED_EVENT,
        source: eventSource('workbench', record.id),
        cellId: command.cellId,
        actorId: actorRef,
        correlationId: command.correlationId,
        classification: 'private',
        subject: `workbench/${record.id}`,
        occurredAt: command.now,
        data: {
          workbenchId: record.id,
          toState: 'waiting',
          decisionWorkItemId,
        },
      });
      await this.#outbox.enqueue(tx, envelope, {
        aggregateKind: 'workbench',
        aggregateId: record.id,
        createdAt: command.now,
      });
    });

    return { decisionWorkItemId, workbenchState: 'waiting' };
  }

  /**
   * HITL-02: resolve the decision. Called after the decision work item's own
   * command envelope lands (`ready` approves, `cancel` denies). Moves the
   * linked workbench and marks the link resolved — idempotent: resolving an
   * already-resolved decision is a safe no-op.
   */
  async resolveDecision(command: ResolveDecisionCommand): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const rows = await tx.execute<{
        workbench_id: string;
        resolved_at: Date | null;
        wb_state: string;
      }>(sql`
        select d.workbench_id, d.resolved_at, w.state as wb_state
        from "frank_domain"."workbench_decision" d
        join "frank_domain"."workbench" w on w.id = d.workbench_id
        where d.decision_work_item_id = ${command.decisionWorkItemId}
      `);
      const link = rows.rows[0];
      if (link === undefined) return; // not a workbench decision; nothing to do
      if (link.resolved_at !== null) return; // already resolved — no-op

      const actorRef = `${command.actor.kind}/${command.actor.id}`;

      // Mark the link resolved first (idempotency guard for concurrent calls).
      await tx.execute(sql`
        update "frank_domain"."workbench_decision" set
          resolved_at = ${command.now},
          resolution = ${command.resolution}
        where decision_work_item_id = ${command.decisionWorkItemId}
          and resolved_at is null
      `);

      if (command.resolution === 'ready') {
        // Approved -> resume the run.
        await tx.execute(sql`
          update "frank_domain"."workbench" set
            state = 'running',
            updated_by = ${actorRef},
            updated_at = ${command.now},
            version = version + 1
          where id = ${link.workbench_id} and state = 'waiting'
        `);
        await this.#appendEvent(tx, link.workbench_id, 'resumed', {
          decisionWorkItemId: command.decisionWorkItemId,
        }, command.now);
      } else {
        // Denied -> safe-fail with an honest receipt.
        await tx.execute(sql`
          update "frank_domain"."workbench" set
            state = 'failed',
            updated_by = ${actorRef},
            updated_at = ${command.now},
            finished_at = ${command.now},
            last_error = ${'decision denied'},
            version = version + 1
          where id = ${link.workbench_id} and state = 'waiting'
        `);
        await this.#appendEvent(tx, link.workbench_id, 'failed', {
          error: 'decision denied',
          decisionWorkItemId: command.decisionWorkItemId,
        }, command.now);
        await tx.execute(sql`
          insert into "frank_domain"."workbench_receipt"
            (workbench_id, summary, assumptions, evidence, published_at, published_by)
          values (${link.workbench_id},
                  'Run stopped: a required decision was denied.',
                  '[]'::jsonb, '[]'::jsonb, ${command.now}, ${actorRef})
          on conflict (workbench_id) do update
            set summary = excluded.summary, published_at = excluded.published_at,
                published_by = excluded.published_by
        `);
        await this.#appendEvent(tx, link.workbench_id, 'receipt_published', {}, command.now);
      }

      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: command.resolution === 'ready' ? 'workbench.resumed' : 'workbench.decision_denied',
        targetKind: 'workbench',
        targetId: link.workbench_id,
        correlationId: command.correlationId,
        dataClass: 'private',
        changeRedacted: { fields: ['state'], state: command.resolution === 'ready' ? 'running' : 'failed' },
      });
    });
  }

  /** Append a workbench event inside an open transaction (seq via max+1). */
  async #appendEvent(
    tx: FrankTransaction,
    workbenchId: string,
    type: string,
    payload: Record<string, unknown>,
    at: Date,
  ): Promise<void> {
    await tx.execute(sql`
      insert into "frank_domain"."workbench_event" (workbench_id, seq, type, payload, occurred_at)
      values (
        ${workbenchId},
        (select coalesce(max(seq), 0) + 1 from "frank_domain"."workbench_event" where workbench_id = ${workbenchId}),
        ${type},
        ${JSON.stringify(payload)}::jsonb,
        ${at}
      )
    `);
  }
}

/**
 * WB-05 — the delegation front door.
 *
 * The ONLY path that turns a delegation into a durable workbench. It
 * replaces the old web-side `delegation-store.run() → runTurn()` in-process
 * execution: canonical state lives in Postgres from the first write (M15),
 * and the work item stays the task authority (§3.1) — this service creates
 * it, transitions it, and creates the workbench row that executes it.
 *
 * ## One transaction, per FRANK-§11.5
 *
 *   work item (kind `agent_job`, inbox → ready)
 *   workbench row (state `queued`, idempotent on the delegation command key)
 *   audit entries + outbox events for both
 *
 * …commit together or not at all. A replay of the same idempotency key
 * returns the original workbench and creates nothing new — the unique index
 * `(cell_id, idempotency_key)` on `frank_domain.workbench` is the enforcement
 * (migration 0004), with a read-back so the replay is indistinguishable from
 * the original response except `created: false`.
 *
 * ## State mapping (GOV-01)
 *
 * The front door files the work item at `ready`: the runner's claim moves it
 * on when the workbench leaves `queued` (the runner owns that transition,
 * WB-05 wiring on the claim path). `inbox → ready` is legal under WORK-004.
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
import type { FrankDatabase } from '@frank/adapter-postgres';

import { WorkbenchStore } from './store.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from './types.js';

type ActorKind = schema.ActorKind;

/** Versioned outbox event type for workbench creation (ADR-017 shape). */
const WORKBENCH_CREATED_EVENT = 'frank.workbench.created.v1';

export interface CreateWorkbenchCommand {
  readonly cellId: string;
  /** The delegation command envelope's command_id (FRANK-§12.1/§12.3). */
  readonly idempotencyKey: string;
  readonly taskDef: WorkbenchTaskDef;
  readonly roomId?: string;
  /** Human-facing work-item title; defaults to the instruction's first line. */
  readonly title?: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly policyVersion: string;
  readonly now: Date;
}

export interface CreateWorkbenchOutcome {
  readonly workbench: WorkbenchRecord;
  readonly workItemId: string;
  /** False when the idempotency key was already seen (replay). */
  readonly created: boolean;
  readonly auditEntryId: string | null;
}

export class WorkbenchFrontDoor {
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

  /** Direct access for routes that read workbench state (GET endpoints). */
  get store(): WorkbenchStore {
    return this.#store;
  }

  /**
   * Create the work item + workbench atomically, idempotent on
   * `idempotencyKey`. A replay returns the original pair with `created:
   * false` and no new audit entries.
   */
  async createWorkbench(command: CreateWorkbenchCommand): Promise<CreateWorkbenchOutcome> {
    const workbenchId = newId();
    const workItemId = newId();
    const actorRef = `${command.actor.kind}/${command.actor.id}`;
    const title = command.title ?? defaultTitleFor(command.taskDef.instruction);

    return this.#db.transaction(async (tx) => {
      /* ---- idempotent replay: read back, never duplicate ----------------- */
      const existing = await tx.execute<{ id: string; work_item_id: string }>(
        // Raw SQL (not WorkbenchStore) because we are inside the caller's
        // transaction — the store's own methods open their own.
        sqlLookup(command.cellId, command.idempotencyKey),
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        const record = await this.#store.getWorkbench(command.cellId, replay.id);
        if (record === null) {
          throw new Error(
            `workbench ${replay.id} found by idempotency key but unreadable — refusing to fabricate`,
          );
        }
        return {
          workbench: record,
          workItemId: replay.work_item_id,
          created: false,
          auditEntryId: null,
        };
      }

      /* ---- 1. work item: create + transition to ready -------------------- */
      const item = await this.#work.create(tx, {
        id: workItemId,
        cellId: command.cellId,
        kind: 'agent_job',
        title,
        description: command.taskDef.instruction,
        ownerKind: command.actor.kind,
        ownerId: command.actor.id,
        policyRef: { ref: 'frank.operating-policy', version: command.policyVersion },
        provenance: {
          method: 'automation',
          producer: 'apps/api/workbench-front-door',
          correlationId: command.correlationId,
        },
        actor: command.actor,
        correlationId: command.correlationId,
        now: command.now,
        dataClass: 'private',
      });

      const transition = await this.#work.transition(tx, {
        workItemId: item.id,
        cellId: command.cellId,
        toState: 'ready',
        actor: command.actor,
        reason: 'Delegation accepted — workbench queued for the runner.',
        correlationId: command.correlationId,
        now: command.now,
      });

      /* ---- 2. workbench row (queued) -------------------------------------- */
      const created = await this.#store.createWorkbenchInTransaction(tx, {
        id: workbenchId,
        cellId: command.cellId,
        workItemId: item.id,
        ...(command.roomId === undefined ? {} : { roomId: command.roomId }),
        idempotencyKey: command.idempotencyKey,
        taskDef: command.taskDef,
        createdBy: actorRef,
        now: command.now,
      });
      if (!created.created) {
        // Lost an insert race the replay check above should have caught —
        // surface it rather than double-creating the work item's audit trail.
        throw new Error(
          `workbench idempotency key ${command.idempotencyKey} conflicted after replay check — aborting`,
        );
      }

      /* ---- 3. workbench audit entry + outbox event ------------------------ */
      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: 'workbench.created',
        targetKind: 'workbench',
        targetId: workbenchId,
        correlationId: command.correlationId,
        dataClass: 'private',
        changeRedacted: {
          fields: ['task_def', 'state'],
          state: created.record.state,
        },
      });

      const envelope = buildEventEnvelope({
        type: WORKBENCH_CREATED_EVENT,
        source: eventSource('workbench', workbenchId),
        cellId: command.cellId,
        actorId: actorRef,
        correlationId: command.correlationId,
        classification: 'private',
        subject: `workbench/${workbenchId}`,
        occurredAt: command.now,
        idempotencyKey: command.idempotencyKey,
        data: {
          workbenchId,
          workItemId: item.id,
          roomId: command.roomId ?? null,
          state: created.record.state,
        },
      });
      await this.#outbox.enqueue(tx, envelope, {
        aggregateKind: 'workbench',
        aggregateId: workbenchId,
        createdAt: command.now,
      });

      return {
        workbench: created.record,
        workItemId: item.id,
        created: true,
        auditEntryId: transition.auditEntryId,
      };
    });
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function defaultTitleFor(instruction: string): string {
  const firstLine = instruction.split('\n', 1)[0]?.trim() ?? '';
  return firstLine.length <= 200 ? firstLine : `${firstLine.slice(0, 199)}…`;
}

/** Replay lookup inside the caller's transaction. */
function sqlLookup(cellId: string, idempotencyKey: string) {
  return sql`
    select id, work_item_id from "frank_domain"."workbench"
    where cell_id = ${cellId} and idempotency_key = ${idempotencyKey}
  `;
}

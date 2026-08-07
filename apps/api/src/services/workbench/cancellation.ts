/**
 * WorkbenchCancellationService — WB-07: first-class Stop/cancel.
 *
 * The contract (`docs/plans/WORKBENCH_API_CONTRACT.md`) gives
 * `POST /v1/workbenches/:id/stop` one job: halt the run under 5 seconds and
 * leave canonical truth behind. Two cases:
 *
 *  1. **Live run** — a {@link WorkbenchRunner} in this process is executing
 *     the workbench. `requestStop` signals its leash; the runner lands the
 *     terminal state, events, and an honest receipt (W10: the leash is
 *     authoritative, the model cannot disable it).
 *  2. **No live run** — the workbench is queued, or its runner is elsewhere /
 *     gone. We cancel durably in Postgres in ONE transaction (§3.1): the
 *     workbench row moves to `cancelled`, the work item moves to `cancelled`
 *     (legal from every non-terminal WORK-004 state), with audit + outbox,
 *     and an honest receipt. Recovery (WB-09) treats a cancelled row as
 *     terminal and never re-claims it.
 *
 * Stopping a terminal workbench is refused (AlreadyTerminalError → 409): a
 * second stop must fail safely, not re-cancel history.
 */

import { sql } from 'drizzle-orm';

import {
  AuditRepository,
  OutboxRepository,
  WorkItemRepository,
  buildEventEnvelope,
  eventSource,
  schema,
} from '@frank/adapter-postgres';
import type { FrankDatabase } from '@frank/adapter-postgres';

import type { WorkbenchRunner } from './runner.js';
import { WorkbenchStore } from './store.js';
import { isTerminalWorkbenchState } from './types.js';

type ActorKind = schema.ActorKind;

export class AlreadyTerminalError extends Error {
  constructor(
    readonly workbenchId: string,
    readonly state: string,
  ) {
    super(`workbench ${workbenchId} is already in terminal state "${state}"`);
  }
}

export class WorkbenchNotFoundError extends Error {
  constructor(readonly workbenchId: string) {
    super(`workbench ${workbenchId} not found`);
  }
}

export interface CancelWorkbenchCommand {
  readonly cellId: string;
  readonly workbenchId: string;
  readonly reason: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export interface CancelWorkbenchOutcome {
  /** 'live-run' when a runner's leash handled it; 'durable' when we wrote it. */
  readonly via: 'live-run' | 'durable';
  readonly workbenchState: 'cancelled';
  readonly workItemId: string;
}

const WORKBENCH_STATE_CHANGED_EVENT = 'frank.workbench.state_changed.v1';

export class WorkbenchCancellationService {
  readonly #store: WorkbenchStore;
  readonly #work: WorkItemRepository;
  readonly #audit = new AuditRepository();
  readonly #outbox = new OutboxRepository();
  readonly #db: FrankDatabase;
  readonly #runner: WorkbenchRunner | null;

  constructor(db: FrankDatabase, runner?: WorkbenchRunner) {
    this.#db = db;
    this.#store = new WorkbenchStore(db);
    this.#work = new WorkItemRepository(this.#audit, this.#outbox);
    this.#runner = runner ?? null;
  }

  async cancel(command: CancelWorkbenchCommand): Promise<CancelWorkbenchOutcome> {
    const record = await this.#store.getWorkbench(command.cellId, command.workbenchId);
    if (record === null) throw new WorkbenchNotFoundError(command.workbenchId);
    if (isTerminalWorkbenchState(record.state)) {
      throw new AlreadyTerminalError(record.id, record.state);
    }

    /* ---- case 1: a live run in this process — the leash handles it ------ */
    if (this.#runner !== null) {
      const signalled = await this.#runner.requestStop(record.id, command.reason);
      if (signalled) {
        // The runner lands workbench state + events + receipt; we still owe
        // the canonical work-item side (§3.1).
        await this.cancelWorkItem(record.workItemId, command);
        return { via: 'live-run', workbenchState: 'cancelled', workItemId: record.workItemId };
      }
      // Not live here (queued, or executing elsewhere) — fall through.
    }

    /* ---- case 2: durable cancellation in one transaction ----------------- */
    await this.#db.transaction(async (tx) => {
      const updated = await tx.execute(sql`
        update "frank_domain"."workbench" set
          state = 'cancelled',
          updated_by = ${`${command.actor.kind}/${command.actor.id}`},
          updated_at = ${command.now},
          finished_at = ${command.now},
          last_error = ${`stopped: ${command.reason}`},
          version = version + 1
        where id = ${record.id} and cell_id = ${command.cellId}
          and state not in ('done', 'failed', 'cancelled')
        returning state
      `);
      if (updated.rows.length === 0) {
        // Lost a race to a terminal transition that landed between our read
        // and this update — surface it honestly rather than double-cancelling.
        throw new AlreadyTerminalError(record.id, 'raced to terminal');
      }

      // Event order is durable (WB-01): `seq` is part of the composite primary
      // key, so every insert must supply it. Within this single transaction
      // each successive insert sees the previous row, so `max(seq)+1` yields a
      // gap-free, monotonic sequence — the same convention `store.appendEvent`
      // uses when the caller does not pre-allocate a seq.
      await tx.execute(sql`
        insert into "frank_domain"."workbench_event" (workbench_id, seq, type, payload, occurred_at)
        values (
          ${record.id},
          (select coalesce(max(seq), 0) + 1 from "frank_domain"."workbench_event" where workbench_id = ${record.id}),
          'stop_requested',
          ${JSON.stringify({ reason: command.reason })}::jsonb,
          ${command.now}
        )
      `);
      await tx.execute(sql`
        insert into "frank_domain"."workbench_event" (workbench_id, seq, type, payload, occurred_at)
        values (
          ${record.id},
          (select coalesce(max(seq), 0) + 1 from "frank_domain"."workbench_event" where workbench_id = ${record.id}),
          'cancelled',
          ${JSON.stringify({ reason: command.reason, via: 'durable' })}::jsonb,
          ${command.now}
        )
      `);

      // Honest receipt: the run ended by Stop, not by completing its work.
      await tx.execute(sql`
        insert into "frank_domain"."workbench_receipt"
          (workbench_id, summary, assumptions, evidence, published_at, published_by)
        values (${record.id},
                ${`Run stopped before completion. Reason: ${command.reason}`},
                '[]'::jsonb, '[]'::jsonb, ${command.now},
                ${`${command.actor.kind}/${command.actor.id}`})
        on conflict (workbench_id) do update
          set summary = excluded.summary, published_at = excluded.published_at,
              published_by = excluded.published_by
      `);
      await tx.execute(sql`
        insert into "frank_domain"."workbench_event" (workbench_id, seq, type, payload, occurred_at)
        values (
          ${record.id},
          (select coalesce(max(seq), 0) + 1 from "frank_domain"."workbench_event" where workbench_id = ${record.id}),
          'receipt_published',
          '{}'::jsonb,
          ${command.now}
        )
      `);

      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: 'workbench.cancelled',
        targetKind: 'workbench',
        targetId: record.id,
        correlationId: command.correlationId,
        dataClass: 'private',
        changeRedacted: { fields: ['state'], state: 'cancelled' },
      });

      const envelope = buildEventEnvelope({
        type: WORKBENCH_STATE_CHANGED_EVENT,
        source: eventSource('workbench', record.id),
        cellId: command.cellId,
        actorId: `${command.actor.kind}/${command.actor.id}`,
        correlationId: command.correlationId,
        classification: 'private',
        subject: `workbench/${record.id}`,
        occurredAt: command.now,
        data: { workbenchId: record.id, toState: 'cancelled', reason: command.reason },
      });
      await this.#outbox.enqueue(tx, envelope, {
        aggregateKind: 'workbench',
        aggregateId: record.id,
        createdAt: command.now,
      });
    });

    await this.cancelWorkItem(record.workItemId, command);

    return { via: 'durable', workbenchState: 'cancelled', workItemId: record.workItemId };
  }

  /**
   * Canonical work-item side of a cancellation (§3.1). `cancelled` is legal
   * from every non-terminal WORK-004 state; a work item already terminal is
   * left as-is (its own history is authoritative).
   */
  async cancelWorkItem(workItemId: string, command: CancelWorkbenchCommand): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const rows = await tx.execute<{ state: string; version: number }>(sql`
        select state, version from "frank_domain"."work_item"
        where id = ${workItemId} and cell_id = ${command.cellId}
      `);
      const item = rows.rows[0];
      if (item === undefined) return;
      if (item.state === 'done' || item.state === 'cancelled') return;
      await this.#work.transition(tx, {
        workItemId,
        cellId: command.cellId,
        toState: 'cancelled',
        expectedVersion: item.version,
        actor: command.actor,
        reason: `Workbench stopped: ${command.reason}`,
        correlationId: command.correlationId,
        now: command.now,
      });
    });
  }
}

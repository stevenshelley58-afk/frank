/**
 * WorkbenchStore — the PostgreSQL persistence for the workbench record.
 *
 * WB-01: "Postgres schema for the workbench record, plan steps, append-only
 * events, artifacts, receipt, and optional schedule reference." The tables
 * come from migration `0004_workbench.sql`; this module is the one place that
 * knows their column names (the app-layer analogue of `postgres-store.ts`'s
 * role for the canonical domain — everything else in this directory takes the
 * {@link WorkbenchStore} interface shapes and could not name a table).
 *
 * Raw SQL via drizzle's `sql` template rather than Drizzle schema objects,
 * because 0004 is hand-written (like 0003's brain_entry) and has no generated
 * drizzle projection. The same pattern `routes/brain.ts` uses.
 *
 * ## What the database enforces here, not this file
 *
 *  - Idempotent creation: `workbench_idem_uidx (cell_id, idempotency_key)`.
 *    {@link WorkbenchStore.createWorkbench} is INSERT ... ON CONFLICT DO
 *    NOTHING + read-back, so two identical delegation commands produce one row.
 *  - Append-only events: the `workbench_event_append_only` /
 *    `workbench_event_no_truncate` triggers (migration 0004, reusing
 *    `append_only_guard()` from 0001). This file simply never issues UPDATE or
 *    DELETE against `workbench_event`; the triggers make that a database
 *    property rather than a code-review property.
 *  - FK integrity: work_item_id restricts workbench deletion, children
 *    cascade from the workbench row.
 */

import { sql } from 'drizzle-orm';

import type { FrankDatabase, FrankTransaction } from '@frank/adapter-postgres';

import type { WorkbenchEventBus } from './event-bus.js';

import type {
  ArtifactDetail,
  CreateWorkbenchInput,
  RoomArtifact,
  WorkbenchArtifact,
  WorkbenchEvent,
  WorkbenchEventType,
  WorkbenchPlanStep,
  WorkbenchPlanStepState,
  WorkbenchReceipt,
  WorkbenchRecord,
  WorkbenchSnapshot,
  WorkbenchState,
  WorkbenchTaskDef,
} from './types.js';

/* ------------------------------------------------------------ row mapping --- */

/**
 * `type` (not `interface`) because drizzle's `execute<T>` constrains T to
 * `Record<string, unknown>`, which only object-literal-shaped types satisfy.
 */
type WorkbenchRow = {
  id: string;
  cell_id: string;
  work_item_id: string;
  room_id: string | null;
  idempotency_key: string;
  task_def: WorkbenchTaskDef;
  state: WorkbenchState;
  attempts: number;
  claimed_by: string | null;
  claimed_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  last_error: string | null;
  container_id: string | null;
  schedule_cron: string | null;
  schedule_timezone: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * The raw-SQL `execute` path returns `timestamptz` columns as ISO strings on
 * some driver configurations (no custom type parser is registered — see
 * `db.ts`). Every row mapping funnels through here, so all consumers get
 * real Dates regardless of driver behavior.
 */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

function toRecord(row: WorkbenchRow): WorkbenchRecord {
  return {
    id: row.id,
    cellId: row.cell_id,
    workItemId: row.work_item_id,
    roomId: row.room_id,
    idempotencyKey: row.idempotency_key,
    taskDef: row.task_def,
    state: row.state,
    attempts: row.attempts,
    claimedBy: row.claimed_by,
    claimedAt: asDateOrNull(row.claimed_at),
    startedAt: asDateOrNull(row.started_at),
    finishedAt: asDateOrNull(row.finished_at),
    lastError: row.last_error,
    containerId: row.container_id,
    scheduleCron: row.schedule_cron,
    scheduleTimezone: row.schedule_timezone,
    version: row.version,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

const WORKBENCH_COLUMNS = sql`id, cell_id, work_item_id, room_id, idempotency_key, task_def, state, attempts, claimed_by, claimed_at, started_at, finished_at, last_error, container_id, schedule_cron, schedule_timezone, version, created_at, updated_at`;

/* ------------------------------------------------------------------- store --- */

export interface CreateWorkbenchResult {
  readonly record: WorkbenchRecord;
  /** True when this call inserted the row; false on idempotent replay. */
  readonly created: boolean;
}

export class WorkbenchStore {
  constructor(
    private readonly db: FrankDatabase,
    /**
     * WB-06: optional wake-up bus. When present, every successful appendEvent
     * notifies subscribers so the SSE route can deliver live. Absent (tests,
     * the front door) the store is unchanged.
     */
    private readonly bus?: WorkbenchEventBus,
  ) {}

  /**
   * Idempotent workbench creation (WB-01 rule): the unique index on
   * `(cell_id, idempotency_key)` means a replayed delegation command returns
   * the row the first attempt created instead of a second workbench.
   */
  async createWorkbench(input: CreateWorkbenchInput): Promise<CreateWorkbenchResult> {
    return this.#createWorkbench(this.db, input);
  }

  /**
   * Transactional variant for the WB-05 front door, which must create the
   * work item and the workbench in ONE transaction (FRANK-§11.5). Same
   * INSERT ... ON CONFLICT DO NOTHING + read-back semantics as
   * {@link createWorkbench}.
   */
  async createWorkbenchInTransaction(
    tx: FrankTransaction,
    input: CreateWorkbenchInput,
  ): Promise<CreateWorkbenchResult> {
    return this.#createWorkbench(tx, input);
  }

  async #createWorkbench(
    executor: FrankDatabase | FrankTransaction,
    input: CreateWorkbenchInput,
  ): Promise<CreateWorkbenchResult> {
    const inserted = await executor.execute<WorkbenchRow>(sql`
      insert into "frank_domain"."workbench"
        (id, cell_id, created_at, updated_at, created_by, updated_by,
         work_item_id, room_id, idempotency_key, task_def, state,
         schedule_cron, schedule_timezone)
      values
        (${input.id}, ${input.cellId}, ${input.now}, ${input.now},
         ${input.createdBy}, ${input.createdBy},
         ${input.workItemId}, ${input.roomId ?? null}, ${input.idempotencyKey},
         ${JSON.stringify(input.taskDef)}::jsonb, 'queued',
         ${input.schedule?.cron ?? null}, ${input.schedule?.tz ?? null})
      on conflict (cell_id, idempotency_key) do nothing
      returning ${WORKBENCH_COLUMNS}
    `);

    const row = inserted.rows[0];
    if (row !== undefined) return { record: toRecord(row), created: true };

    // Replay: read back the row the first attempt created.
    const existing = await executor.execute<WorkbenchRow>(sql`
      select ${WORKBENCH_COLUMNS} from "frank_domain"."workbench"
      where cell_id = ${input.cellId} and idempotency_key = ${input.idempotencyKey}
    `);
    const found = existing.rows[0];
    if (found === undefined) {
      // Lost a race to a concurrent deleter — surface it, do not fabricate.
      throw new Error(
        `workbench idempotency key ${input.idempotencyKey} lost a race: neither inserted nor readable`,
      );
    }
    return { record: toRecord(found), created: false };
  }

  async getWorkbench(cellId: string, id: string): Promise<WorkbenchRecord | null> {
    const rows = await this.db.execute<WorkbenchRow>(sql`
      select ${WORKBENCH_COLUMNS} from "frank_domain"."workbench"
      where cell_id = ${cellId} and id = ${id}
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /**
   * WB-06: read events with seq greater than `afterSeq`, in durable order.
   * The SSE route uses this for both the initial snapshot (`afterSeq = 0`)
   * and live polling (its highest delivered seq). Reading by seq from the
   * database is what makes resume gap-free and duplicate-free regardless of
   * how notifications arrive.
   */
  async listEventsSince(
    workbenchId: string,
    afterSeq: number,
  ): Promise<readonly WorkbenchEvent[]> {
    const rows = await this.db.execute<{
      seq: number;
      type: WorkbenchEventType;
      payload: Record<string, unknown>;
      occurred_at: Date | string;
    }>(sql`
      select seq, type, payload, occurred_at from "frank_domain"."workbench_event"
      where workbench_id = ${workbenchId} and seq > ${afterSeq}
      order by seq
    `);
    return rows.rows.map((row) => ({
      seq: Number(row.seq),
      type: row.type,
      payload: row.payload,
      occurredAt: asDate(row.occurred_at),
    }));
  }

  /** WB-08 / frozen contract: list workbenches for one room, newest first. */
  async listByRoom(cellId: string, roomId: string): Promise<readonly WorkbenchRecord[]> {
    const rows = await this.db.execute<WorkbenchRow>(sql`
      select ${WORKBENCH_COLUMNS} from "frank_domain"."workbench"
      where cell_id = ${cellId} and room_id = ${roomId}
      order by created_at desc, id
    `);
    return rows.rows.map(toRecord);
  }

  /**
   * Append one event. `seq` defaults to max(seq)+1 within the workbench;
   * pass it explicitly when the caller already allocated one (the claim path
   * does, so event order is decided before the claim commits).
   */
  async appendEvent(
    workbenchId: string,
    type: WorkbenchEventType,
    payload: Record<string, unknown>,
    occurredAt: Date,
    seq?: number,
  ): Promise<number> {
    const rows = await this.db.execute<{ seq: number }>(sql`
      insert into "frank_domain"."workbench_event" (workbench_id, seq, type, payload, occurred_at)
      values (
        ${workbenchId},
        coalesce(${seq ?? null}, (
          select coalesce(max(seq), 0) + 1
          from "frank_domain"."workbench_event"
          where workbench_id = ${workbenchId}
        )),
        ${type},
        ${JSON.stringify(payload)}::jsonb,
        ${occurredAt}
      )
      returning seq
    `);
    const assignedSeq = rows.rows[0]?.seq ?? 0;
    // WB-06: wake SSE subscribers for this workbench. The bus is a hint only —
    // the route re-reads by seq from the database, so a dropped notification
    // cannot lose or duplicate an event (durability comes from the poll path).
    this.bus?.notify(workbenchId);
    return assignedSeq;
  }

  /**
   * Publish the 3-to-10 step plan (master plan §3.4). Replaces any prior plan
   * — a plan may be re-published before substantive execution, never after.
   */
  async publishPlan(
    workbenchId: string,
    steps: readonly { step: string; note?: string }[],
    now: Date,
  ): Promise<void> {
    if (steps.length < 3 || steps.length > 10) {
      throw new Error(`workbench plan must have 3 to 10 steps, got ${steps.length}`);
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        delete from "frank_domain"."workbench_plan_step" where workbench_id = ${workbenchId}
      `);
      for (const [index, step] of steps.entries()) {
        await tx.execute(sql`
          insert into "frank_domain"."workbench_plan_step"
            (workbench_id, seq, step, state, note, updated_at)
          values (${workbenchId}, ${index + 1}, ${step.step}, 'pending', ${step.note ?? null}, ${now})
        `);
      }
    });
  }

  /** Update one plan step's state (and optional note). Returns false when absent. */
  async updatePlanStep(
    workbenchId: string,
    seq: number,
    state: WorkbenchPlanStepState,
    note: string | null,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(sql`
      update "frank_domain"."workbench_plan_step"
      set state = ${state}::"frank_domain"."workbench_plan_step_state",
          note = coalesce(${note}, note),
          updated_at = ${now}
      where workbench_id = ${workbenchId} and seq = ${seq}
      returning seq
    `);
    return rows.rows.length > 0;
  }

  /** Register an artifact; re-registering the same path updates the row. */
  async registerArtifact(
    workbenchId: string,
    artifact: {
      id: string;
      path: string;
      kind: string;
      previewUrl?: string;
      sha256?: string;
      mediaType?: string;
    },
    now: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      insert into "frank_domain"."workbench_artifact"
        (id, workbench_id, path, kind, preview_url, sha256, media_type, created_at)
      values (${artifact.id}, ${workbenchId}, ${artifact.path}, ${artifact.kind},
              ${artifact.previewUrl ?? null}, ${artifact.sha256 ?? null},
              ${artifact.mediaType ?? null}, ${now})
      on conflict (workbench_id, path) do update
        set kind = excluded.kind, preview_url = excluded.preview_url
    `);
  }

  /** Read one artifact by id (FS-05 publish-preview). Null when absent. */
  async getArtifactById(artifactId: string): Promise<ArtifactDetail | null> {
    const rows = await this.db.execute<{
      id: string;
      workbench_id: string;
      path: string;
      kind: string;
      preview_url: string | null;
      sha256: string | null;
      media_type: string | null;
      created_at: Date | string;
    }>(sql`
      select id, workbench_id, path, kind, preview_url, sha256, media_type, created_at
      from "frank_domain"."workbench_artifact"
      where id = ${artifactId}::uuid
    `);
    const row = rows.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      workbenchId: row.workbench_id,
      path: row.path,
      kind: row.kind,
      previewUrl: row.preview_url,
      sha256: row.sha256,
      mediaType: row.media_type,
      createdAt: asDate(row.created_at),
    };
  }

  /**
   * FS-05 room Files listing: every artifact across the room's workbenches
   * (workbench_artifact joined to workbench by room_id), newest first.
   */
  async listRoomFiles(cellId: string, roomId: string): Promise<readonly RoomArtifact[]> {
    const rows = await this.db.execute<{
      id: string;
      workbench_id: string;
      workbench_state: string;
      path: string;
      kind: string;
      preview_url: string | null;
      sha256: string | null;
      media_type: string | null;
      created_at: Date | string;
    }>(sql`
      select a.id, a.workbench_id, wb.state as workbench_state, a.path, a.kind,
             a.preview_url, a.sha256, a.media_type, a.created_at
      from "frank_domain"."workbench_artifact" a
      join "frank_domain"."workbench" wb on wb.id = a.workbench_id
      where wb.cell_id = ${cellId} and wb.room_id = ${roomId}
      order by a.created_at desc, a.id
    `);
    return rows.rows.map((row) => ({
      id: row.id,
      workbenchId: row.workbench_id,
      workbenchState: row.workbench_state,
      path: row.path,
      kind: row.kind,
      previewUrl: row.preview_url,
      sha256: row.sha256,
      mediaType: row.media_type,
      createdAt: asDate(row.created_at),
    }));
  }

  /** Publish the closing receipt. One per workbench (PK on workbench_id). */
  async publishReceipt(
    workbenchId: string,
    receipt: { summary: string; assumptions: readonly string[]; evidence: readonly unknown[] },
    publishedBy: string,
    now: Date,
  ): Promise<void> {
    await this.db.execute(sql`
      insert into "frank_domain"."workbench_receipt"
        (workbench_id, summary, assumptions, evidence, published_at, published_by)
      values (${workbenchId}, ${receipt.summary}, ${JSON.stringify(receipt.assumptions)}::jsonb,
              ${JSON.stringify(receipt.evidence)}::jsonb, ${now}, ${publishedBy})
      on conflict (workbench_id) do update
        set summary = excluded.summary,
            assumptions = excluded.assumptions,
            evidence = excluded.evidence,
            published_at = excluded.published_at,
            published_by = excluded.published_by
    `);
  }

  /**
   * Move the workbench state. `expectedVersion` gives optimistic concurrency
   * when the caller is not holding the row lock (the claim path is).
   */
  async setState(
    workbenchId: string,
    state: WorkbenchState,
    updatedBy: string,
    now: Date,
    patch?: {
      claimedBy?: string | null;
      claimedAt?: Date | null;
      startedAt?: Date | null;
      finishedAt?: Date | null;
      lastError?: string | null;
      containerId?: string | null;
      expectedVersion?: number;
    },
  ): Promise<WorkbenchRecord | null> {
    const rows = await this.db.execute<WorkbenchRow>(sql`
      update "frank_domain"."workbench" set
        state = ${state}::"frank_domain"."workbench_state",
        updated_by = ${updatedBy},
        updated_at = ${now},
        version = version + 1
        ${patch?.claimedBy !== undefined ? sql`, claimed_by = ${patch.claimedBy}` : sql``}
        ${patch?.claimedAt !== undefined ? sql`, claimed_at = ${patch.claimedAt}` : sql``}
        ${patch?.startedAt !== undefined ? sql`, started_at = ${patch.startedAt}` : sql``}
        ${patch?.finishedAt !== undefined ? sql`, finished_at = ${patch.finishedAt}` : sql``}
        ${patch?.lastError !== undefined ? sql`, last_error = ${patch.lastError}` : sql``}
        ${patch?.containerId !== undefined ? sql`, container_id = ${patch.containerId}` : sql``}
      where id = ${workbenchId}
        ${patch?.expectedVersion !== undefined ? sql`and version = ${patch.expectedVersion}` : sql``}
      returning ${WORKBENCH_COLUMNS}
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /**
   * WB-02 — atomically claim the oldest queued workbench for this cell.
   *
   * The claim is the queue's critical section: `FOR UPDATE SKIP LOCKED`
   * inside one transaction means two runners polling the same cell can never
   * claim the same row — the loser's scan simply skips the locked row and
   * takes the next candidate (or gets nothing). Claiming moves the row
   * `queued -> provisioning`, bumps `attempts`, and stamps the claim columns.
   * Returns null when nothing is claimable.
   */
  async claimNext(
    cellId: string,
    runnerId: string,
    now: Date,
  ): Promise<WorkbenchRecord | null> {
    const rows = await this.db.transaction(async (tx) => {
      const candidate = await tx.execute<{ id: string }>(sql`
        select id from "frank_domain"."workbench"
        where cell_id = ${cellId} and state = 'queued'
        order by created_at
        limit 1
        for update skip locked
      `);
      const id = candidate.rows[0]?.id;
      if (id === undefined) return null;
      return tx.execute<WorkbenchRow>(sql`
        update "frank_domain"."workbench" set
          state = 'provisioning',
          claimed_by = ${runnerId},
          claimed_at = ${now},
          attempts = attempts + 1,
          updated_by = ${runnerId},
          updated_at = ${now},
          version = version + 1
        where id = ${id} and state = 'queued'
        returning ${WORKBENCH_COLUMNS}
      `);
    });
    const row = rows?.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /**
   * WB-02 — recovery scan: workbenches left in a claimed-but-not-terminal
   * state (`provisioning`/`running`) whose claim is older than
   * `staleAfterMs` are presumed orphaned (runner crashed mid-run). Reset
   * them to `queued` for another attempt, clearing the claim. Returns the
   * recovered rows so the caller can clean up their containers/volumes.
   */
  async recoverStale(
    runnerId: string,
    now: Date,
    staleAfterMs: number,
  ): Promise<WorkbenchRecord[]> {
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const rows = await this.db.execute<WorkbenchRow>(sql`
      update "frank_domain"."workbench" set
        state = 'queued',
        claimed_by = null,
        claimed_at = null,
        last_error = 'recovered: previous claim went stale',
        updated_by = ${runnerId},
        updated_at = ${now},
        version = version + 1
      where state in ('provisioning', 'running') and claimed_at < ${cutoff}
      returning ${WORKBENCH_COLUMNS}
    `);
    return rows.rows.map(toRecord);
  }

  /** WB-02 — count of workbenches in a given state for one cell. */
  async countByState(cellId: string, state: WorkbenchState): Promise<number> {
    const rows = await this.db.execute<{ n: string }>(sql`
      select count(*) as n from "frank_domain"."workbench"
      where cell_id = ${cellId} and state = ${state}::"frank_domain"."workbench_state"
    `);
    return Number(rows.rows[0]?.n ?? '0');
  }

  /**
   * WB-09 — reconciliation on runner restart. Reads (never mutates) every
   * non-terminal workbench for a cell so the runner can decide per-state:
   *
   *   queued       — picked up by the normal claim loop; nothing to do
   *   provisioning — recoverStale re-queues once the claim goes stale
   *   running      — same; process state is untrusted after a restart
   *   waiting      — left ALONE: a human decision is outstanding and its
   *                  resolution arrives through the command envelope; a
   *                  restart must never orphan or resume it (§11.3)
   *   verifying    — left ALONE: review/verification is external state
   *
   * The read-only design is the point: this method cannot lose work.
   */
  async listNonTerminal(): Promise<WorkbenchRecord[]> {
    const rows = await this.db.execute<WorkbenchRow>(sql`
      select ${WORKBENCH_COLUMNS} from "frank_domain"."workbench"
      where state in ('queued', 'provisioning', 'running', 'waiting', 'verifying')
      order by created_at
    `);
    return rows.rows.map(toRecord);
  }

  /**
   * WB-09 — mark a workbench failed with an honest receipt because automatic
   * recovery was unsafe (e.g. its attempt budget is exhausted). Terminal, so
   * the claim loop and future recovery scans skip it.
   */
  async failHonest(
    workbenchId: string,
    reason: string,
    receiptSummary: string,
    by: string,
    now: Date,
  ): Promise<void> {
    await this.setState(workbenchId, 'failed', by, now, {
      finishedAt: now,
      lastError: reason,
    });
    await this.appendEvent(
      workbenchId,
      'failed',
      { by, error: reason, cause: 'recovery-unsafe' },
      now,
    );
    await this.publishReceipt(
      workbenchId,
      { summary: receiptSummary, assumptions: [], evidence: [] },
      `runner/${by}`,
      now,
    );
    await this.appendEvent(workbenchId, 'receipt_published', { by }, now);
  }

  /**
   * WB-01 verify: reconstruct the whole run snapshot from Postgres.
   * Events come back in durable order (seq).
   */
  async getSnapshot(cellId: string, workbenchId: string): Promise<WorkbenchSnapshot | null> {
    const workbench = await this.getWorkbench(cellId, workbenchId);
    if (workbench === null) return null;

    const [planRows, eventRows, artifactRows, receiptRows] = await Promise.all([
      this.db.execute<{
        seq: number;
        step: string;
        state: WorkbenchPlanStepState;
        note: string | null;
        updated_at: Date | string;
      }>(sql`
        select seq, step, state, note, updated_at from "frank_domain"."workbench_plan_step"
        where workbench_id = ${workbenchId} order by seq
      `),
      this.db.execute<{
        seq: number;
        type: WorkbenchEventType;
        payload: Record<string, unknown>;
        occurred_at: Date | string;
      }>(sql`
        select seq, type, payload, occurred_at from "frank_domain"."workbench_event"
        where workbench_id = ${workbenchId} order by seq
      `),
      this.db.execute<{
        id: string;
        path: string;
        kind: string;
        preview_url: string | null;
        created_at: Date | string;
      }>(sql`
        select id, path, kind, preview_url, created_at from "frank_domain"."workbench_artifact"
        where workbench_id = ${workbenchId} order by created_at, id
      `),
      this.db.execute<{
        summary: string;
        assumptions: string[];
        evidence: unknown[];
        published_at: Date | string;
        published_by: string;
      }>(sql`
        select summary, assumptions, evidence, published_at, published_by
        from "frank_domain"."workbench_receipt" where workbench_id = ${workbenchId}
      `),
    ]);

    const plan: WorkbenchPlanStep[] = planRows.rows.map((row) => ({
      seq: row.seq,
      step: row.step,
      state: row.state,
      note: row.note,
      updatedAt: asDate(row.updated_at),
    }));
    const events: WorkbenchEvent[] = eventRows.rows.map((row) => ({
      // `seq` is a bigint column — pg returns it as a string; normalize to
      // number so callers get a real gap-free integer sequence.
      seq: Number(row.seq),
      type: row.type,
      payload: row.payload,
      occurredAt: asDate(row.occurred_at),
    }));
    const artifacts: WorkbenchArtifact[] = artifactRows.rows.map((row) => ({
      id: row.id,
      path: row.path,
      kind: row.kind,
      previewUrl: row.preview_url,
      createdAt: asDate(row.created_at),
    }));
    const receiptRow = receiptRows.rows[0];
    const receipt: WorkbenchReceipt | null =
      receiptRow === undefined
        ? null
        : {
            summary: receiptRow.summary,
            assumptions: receiptRow.assumptions,
            evidence: receiptRow.evidence,
            publishedAt: asDate(receiptRow.published_at),
            publishedBy: receiptRow.published_by,
          };

    return { workbench, plan, events, artifacts, receipt };
  }
}

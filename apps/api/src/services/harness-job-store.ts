import { createHash } from 'node:crypto';

import { newId, type FrankDatabase, type FrankExecutor } from '@frank/adapter-postgres';
import type {
  HarnessJobCancelRequest,
  HarnessJobEvent,
  HarnessJobInput,
  HarnessJobStatus,
  SourceRef,
} from '@frank/contracts';
import { sql } from 'drizzle-orm';

export type HarnessJobStoreFailure = 'idempotency_conflict' | 'invalid_scope' | 'not_found';

export class HarnessJobStoreError extends Error {
  constructor(readonly failure: HarnessJobStoreFailure) {
    super(failure);
    this.name = 'HarnessJobStoreError';
  }
}

export interface HarnessJobView {
  readonly job_id: string;
  readonly status: HarnessJobStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly finished_at: string | null;
  readonly cancelled_at: string | null;
  readonly artifacts: Array<{ object_id: string; source_ref: SourceRef }>;
  readonly source_refs: SourceRef[];
}

interface JobRow extends Record<string, unknown> {
  id: string;
  status: HarnessJobStatus;
  request_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
  cancelled_at: Date | string | null;
  receipt: unknown;
  inserted?: boolean;
}

interface EventRow extends Record<string, unknown> {
  job_id: string;
  cursor: number;
  kind: HarnessJobEvent['kind'];
  payload: HarnessJobEvent['payload'];
  occurred_at: Date | string;
}

const terminal = new Set<HarnessJobStatus>(['completed', 'failed', 'cancelled']);

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function receiptArrays(receipt: unknown): Pick<HarnessJobView, 'artifacts' | 'source_refs'> {
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    return { artifacts: [], source_refs: [] };
  }
  const value = receipt as { artifacts?: unknown; source_refs?: unknown };
  return {
    artifacts: Array.isArray(value.artifacts)
      ? (value.artifacts as Array<{ object_id: string; source_ref: SourceRef }>)
      : [],
    source_refs: Array.isArray(value.source_refs) ? (value.source_refs as SourceRef[]) : [],
  };
}

function toView(row: JobRow): HarnessJobView {
  return {
    job_id: row.id,
    status: row.status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    finished_at: nullableIso(row.finished_at),
    cancelled_at: nullableIso(row.cancelled_at),
    ...receiptArrays(row.receipt),
  };
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

/** PostgreSQL-owned Night Watch queue/control plane. It never invokes a harness. */
export class HarnessJobStore {
  constructor(private readonly db: FrankDatabase) {}

  async create(input: {
    cellId: string;
    ownerId: string;
    request: HarnessJobInput;
  }): Promise<{ job: HarnessJobView; replayed: boolean }> {
    const { cellId, ownerId, request } = input;
    if (request.scope.room_id !== undefined) {
      const room = await this.db.execute(sql`
        select id
        from frank_domain.room
        where id = ${request.scope.room_id}::uuid
          and cell_id = ${cellId}
          and (${request.scope.project_id ?? null}::text is null
               or identity = ${request.scope.project_id ?? null})
      `);
      if (room.rows.length === 0) throw new HarnessJobStoreError('invalid_scope');
    }

    const hash = requestHash(request);
    const scope = { ...request.scope, cell_id: cellId, owner_id: ownerId };
    const result = await this.db.execute<JobRow>(sql`
      with inserted as (
        insert into frank_domain.harness_job
          (id, cell_id, owner_id, room_id, idempotency_key, request_hash,
           harness, task_type, scope, input, allowed_tools, egress_profile, status)
        values
          (${newId()}, ${cellId}, ${ownerId}, ${request.scope.room_id ?? null}::uuid,
           ${request.idempotency_key}, ${hash}, ${request.harness}, ${request.task_type},
           ${JSON.stringify(scope)}::jsonb, ${JSON.stringify(request.input)}::jsonb,
           ${JSON.stringify(request.allowed_tools)}::jsonb, ${request.egress_profile}, 'queued')
        on conflict (cell_id, owner_id, idempotency_key) do nothing
        returning id, status, request_hash, created_at, updated_at, finished_at,
                  cancelled_at, null::jsonb as receipt, true as inserted
      ), queued_event as (
        insert into frank_domain.harness_job_event (job_id, cell_id, cursor, kind, payload)
        select id, ${cellId}, 0, 'progress', '{"summary":"queued"}'::jsonb from inserted
        returning job_id
      )
      select * from inserted
      union all
      select j.id, j.status, j.request_hash, j.created_at, j.updated_at,
             j.finished_at, j.cancelled_at, r.receipt, false as inserted
      from frank_domain.harness_job j
      left join frank_domain.harness_job_receipt r
        on r.job_id = j.id and r.cell_id = j.cell_id
      where j.cell_id = ${cellId} and j.owner_id = ${ownerId}
        and j.idempotency_key = ${request.idempotency_key}
        and not exists (select 1 from inserted)
      limit 1
    `);
    let row = result.rows[0];
    // A concurrent INSERT that wins the unique key can be invisible to the
    // original statement snapshot after ON CONFLICT waits. This second read is
    // the documented safe replay path and observes the committed winner.
    if (row === undefined) {
      const replay = await this.db.execute<JobRow>(sql`
        select j.id, j.status, j.request_hash, j.created_at, j.updated_at,
               j.finished_at, j.cancelled_at, r.receipt, false as inserted
        from frank_domain.harness_job j
        left join frank_domain.harness_job_receipt r
          on r.job_id = j.id and r.cell_id = j.cell_id
        where j.cell_id = ${cellId} and j.owner_id = ${ownerId}
          and j.idempotency_key = ${request.idempotency_key}
      `);
      row = replay.rows[0];
    }
    if (row === undefined) throw new Error('harness job insert/replay returned no row');
    if (row.request_hash !== hash) throw new HarnessJobStoreError('idempotency_conflict');
    return { job: toView(row), replayed: row.inserted !== true };
  }

  async get(cellId: string, ownerId: string, jobId: string): Promise<HarnessJobView> {
    return this.#get(this.db, cellId, ownerId, jobId);
  }

  async #get(db: FrankExecutor, cellId: string, ownerId: string, jobId: string): Promise<HarnessJobView> {
    const result = await db.execute<JobRow>(sql`
      select j.id, j.status, j.request_hash, j.created_at, j.updated_at,
             j.finished_at, j.cancelled_at, r.receipt
      from frank_domain.harness_job j
      left join frank_domain.harness_job_receipt r
        on r.job_id = j.id and r.cell_id = j.cell_id
      where j.id = ${jobId}::uuid and j.cell_id = ${cellId} and j.owner_id = ${ownerId}
    `);
    const row = result.rows[0];
    if (row === undefined) throw new HarnessJobStoreError('not_found');
    return toView(row);
  }

  async events(input: {
    cellId: string;
    ownerId: string;
    jobId: string;
    afterCursor: number;
    limit: number;
  }): Promise<{ job: HarnessJobView; events: HarnessJobEvent[]; nextCursor: number | null }> {
    const job = await this.get(input.cellId, input.ownerId, input.jobId);
    const result = await this.db.execute<EventRow>(sql`
      select e.job_id, e.cursor, e.kind, e.payload, e.created_at as occurred_at
      from frank_domain.harness_job_event e
      join frank_domain.harness_job j
        on j.id = e.job_id and j.cell_id = e.cell_id
      where e.job_id = ${input.jobId}::uuid and e.cell_id = ${input.cellId}
        and j.owner_id = ${input.ownerId} and e.cursor > ${input.afterCursor}
      order by e.cursor asc
      limit ${input.limit}
    `);
    const events = result.rows.map((event) => ({
      job_id: event.job_id,
      cursor: event.cursor,
      kind: event.kind,
      occurred_at: iso(event.occurred_at),
      payload: event.payload,
    })) as HarnessJobEvent[];
    return {
      job,
      events,
      nextCursor: events.length === 0 ? null : events[events.length - 1]!.cursor,
    };
  }

  async cancel(input: {
    cellId: string;
    ownerId: string;
    jobId: string;
    requestedBy: string;
    request: HarnessJobCancelRequest;
  }): Promise<{ job: HarnessJobView; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
    const current = await this.#get(tx, input.cellId, input.ownerId, input.jobId);
    if (terminal.has(current.status)) return { job: current, replayed: true };

    const hash = requestHash({ job_id: input.jobId, ...input.request });
    const inserted = await tx.execute<{ job_id: string }>(sql`
      insert into frank_domain.harness_job_cancel
        (job_id, cell_id, requested_by, idempotency_key, request_hash, reason)
      values (${input.jobId}::uuid, ${input.cellId}, ${input.requestedBy},
              ${input.request.idempotency_key}, ${hash}, ${input.request.reason ?? null})
      on conflict (job_id) do nothing
      returning job_id
    `);
    const persisted = await tx.execute<{ idempotency_key: string; request_hash: string }>(sql`
      select c.idempotency_key, c.request_hash
      from frank_domain.harness_job_cancel c
      join frank_domain.harness_job j on j.id = c.job_id and j.cell_id = c.cell_id
      where c.job_id = ${input.jobId}::uuid and c.cell_id = ${input.cellId}
        and j.owner_id = ${input.ownerId}
    `);
    const cancellation = persisted.rows[0];
    if (cancellation === undefined) throw new HarnessJobStoreError('not_found');
    if (
      cancellation.idempotency_key !== input.request.idempotency_key ||
      cancellation.request_hash !== hash
    ) {
      throw new HarnessJobStoreError('idempotency_conflict');
    }

    await tx.execute(sql`
      with changed as (
        update frank_domain.harness_job
        set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
            finished_at = coalesce(finished_at, now()), updated_at = now()
        where id = ${input.jobId}::uuid and cell_id = ${input.cellId}
          and owner_id = ${input.ownerId} and status in ('queued', 'running')
        returning id, cell_id
      )
      insert into frank_domain.harness_job_event (job_id, cell_id, cursor, kind, payload)
      select changed.id, changed.cell_id,
             coalesce((select max(e.cursor) + 1 from frank_domain.harness_job_event e
                       where e.job_id = changed.id), 0),
             'terminal', '{"status":"cancelled"}'::jsonb
      from changed
      on conflict (job_id, cursor) do nothing
    `);
    return {
      job: await this.#get(tx, input.cellId, input.ownerId, input.jobId),
      replayed: inserted.rows.length === 0,
    };
    });
  }
}

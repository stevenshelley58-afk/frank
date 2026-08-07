/**
 * WB-05 — delegation front door against real PostgreSQL.
 *
 * Verify gate (master plan §8D WB-05): "Delegate from Central, create exactly
 * one workbench, and observe the expected work-item and audit entries." The
 * double-submit case is the idempotency proof: the same delegation command key
 * must yield exactly ONE workbench + ONE work item, and the replay must be
 * indistinguishable except `created: false`.
 *
 * Requires `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB).
 * Self-skips with a visible reason when unset (repo convention).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';
import {
  SKIP_REASON,
  apiDatabaseUrl,
  ensureApiDatabase,
  openApiTestDatabase,
  resetApiDatabase,
  requiresDatabase,
} from './db-harness.js';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

const TASK_DEF = {
  instruction: 'Summarize the latest standup notes into five bullets.',
  mounts: [{ source: '/srv/frank/rooms/r1/notes', path: '/workspace/notes', mode: 'ro' }],
  harness: { adapter: 'goose' },
  leash: { wall_clock_sec: 600 },
};

function createBody(commandId: string) {
  return {
    command_id: commandId,
    room_id: 'room:ops',
    task_def: TASK_DEF,
  };
}

describe.skipIf(requiresDatabase)(`WB-05 front door against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await handle?.close();
  });

  beforeEach(async () => {
    if (handle === undefined) return;
    await resetApiDatabase(handle.db);
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-wb05-test',
      }),
      db: handle.db,
    });
  });

  async function post(commandId: string) {
    const target = server as TestServer;
    const response = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: {
        authorization: target.auth(['owner']),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: createBody(commandId),
    });
    return { status: response.statusCode, body: response.json() as Record<string, unknown> };
  }

  it('creates one workbench + one work item, idempotent on the command key', async () => {
    const key = 'delegation-command-1';

    const first = await post(key);
    expect(first.status).toBe(200);
    const wb = first.body.workbench as Record<string, unknown>;
    expect(wb.state).toBe('queued');
    expect(wb.work_item_id).toBeTruthy();
    expect(first.body.created).toBe(true);

    // Replay: same key → same workbench, created=false, nothing new.
    const second = await post(key);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect((second.body.workbench as Record<string, unknown>).id).toBe(wb.id);

    // Exactly ONE workbench and ONE work item in the database.
    const db = (handle as FrankDatabaseHandle).db;
    const wbCount = await db.execute<{ n: string }>(
      sql`select count(*) as n from "frank_domain"."workbench"`,
    );
    const itemCount = await db.execute<{ n: string }>(
      sql`select count(*) as n from "frank_domain"."work_item" where kind = 'agent_job'`,
    );
    expect(Number(wbCount.rows[0]?.n)).toBe(1);
    expect(Number(itemCount.rows[0]?.n)).toBe(1);

    // The work item reached `ready` (runner claims it next) and is linked.
    const item = await db.execute<{ state: string; id: string }>(
      sql`select state, id from "frank_domain"."work_item" where kind = 'agent_job'`,
    );
    expect(item.rows[0]?.state).toBe('ready');
    expect(item.rows[0]?.id).toBe(wb.work_item_id);

    // Audit trail present: work.created (from the item) + workbench.created.
    const audits = await db.execute<{ action: string }>(
      sql`select action from "frank_domain"."audit_entry" order by occurred_at`,
    );
    const actions = audits.rows.map((r) => r.action);
    expect(actions).toContain('work.created');
    expect(actions).toContain('workbench.created');

    // Outbox event emitted for the workbench creation.
    const outbox = await db.execute<{ n: string }>(
      sql`select count(*) as n from "frank_domain"."outbox_event"`,
    );
    expect(Number(outbox.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/workbenches/:id returns record + plan + receipt', async () => {
    const key = 'delegation-command-get';
    const created = await post(key);
    expect(created.status).toBe(200);
    const id = (created.body.workbench as Record<string, unknown>).id as string;

    const target = server as TestServer;
    const got = await target.app.inject({
      method: 'GET',
      url: `/v1/workbenches/${id}`,
      headers: { authorization: target.auth(['owner']) },
    });
    expect(got.statusCode).toBe(200);
    const body = got.json() as Record<string, unknown>;
    expect((body.workbench as Record<string, unknown>).id).toBe(id);
    expect(body.plan).toEqual([]);
    expect(body.receipt).toBeNull();
  });

  it('GET /v1/workbenches/:id is 404 for an unknown id', async () => {
    const target = server as TestServer;
    // A well-formed UUID that does not exist (workbench.id is a uuid column).
    const got = await target.app.inject({
      method: 'GET',
      url: '/v1/workbenches/00000000-0000-0000-0000-000000000000',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(got.statusCode).toBe(404);
  });

  it('GET /v1/workbenches/:id is 404 for a malformed id (never 500)', async () => {
    const target = server as TestServer;
    const got = await target.app.inject({
      method: 'GET',
      url: '/v1/workbenches/01JNOT-A-REAL-UUID',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(got.statusCode).toBe(404);
  });

  /* ------------------------------------------------------------- WB-07 --- */

  async function stopWorkbench(id: string, commandId: string) {
    const target = server as TestServer;
    return target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${id}/stop`,
      headers: {
        authorization: target.auth(['owner']),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: { command_id: commandId, reason: 'test stop' },
    });
  }

  it('WB-07: POST stop cancels a queued workbench durably + cancels the work item + honest receipt', async () => {
    const key = 'wb07-stop-key';
    const created = await post(key);
    expect(created.status).toBe(200);
    const id = (created.body.workbench as Record<string, unknown>).id as string;
    const workItemId = (created.body.workbench as Record<string, unknown>).work_item_id as string;

    const res = await stopWorkbench(id, 'stop-command-1');
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.via).toBe('durable');
    expect(body.workbench_id).toBe(id);
    expect(body.work_item_id).toBe(workItemId);
    expect(body.state).toBe('cancelled');

    // Workbench is now cancelled with an honest receipt.
    const target = server as TestServer;
    const got = await target.app.inject({
      method: 'GET',
      url: `/v1/workbenches/${id}`,
      headers: { authorization: target.auth(['owner']) },
    });
    expect(got.statusCode).toBe(200);
    const detail = got.json() as Record<string, unknown>;
    expect((detail.workbench as Record<string, unknown>).state).toBe('cancelled');
    const receipt = detail.receipt as Record<string, unknown> | null;
    expect(receipt).not.toBeNull();
    expect(String(receipt?.summary)).toMatch(/stopped/i);

    // Work item is cancelled too (canonical side, §3.1).
    const item = await target.app.inject({
      method: 'GET',
      url: `/v1/work/${workItemId}`,
      headers: { authorization: target.auth(['owner']) },
    });
    expect(item.statusCode).toBe(200);
    expect((item.json() as Record<string, unknown>).state).toBe('cancelled');
  });

  it('WB-07: stopping an already-terminal workbench is refused (409, not replayed)', async () => {
    const key = 'wb07-stop-terminal';
    const created = await post(key);
    const id = (created.body.workbench as Record<string, unknown>).id as string;

    const first = await stopWorkbench(id, 'stop-terminal-1');
    expect(first.statusCode).toBe(200);

    const second = await stopWorkbench(id, 'stop-terminal-2');
    expect(second.statusCode).toBe(409);
  });

  it('WB-07: stop requires an idempotency key (422/400 validation)', async () => {
    const key = 'wb07-stop-nokey';
    const created = await post(key);
    const id = (created.body.workbench as Record<string, unknown>).id as string;

    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${id}/stop`,
      headers: {
        authorization: target.auth(['owner']),
        'content-type': 'application/json',
      },
      payload: { reason: 'no key' },
    });
    expect([400, 409, 422]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
  });
});

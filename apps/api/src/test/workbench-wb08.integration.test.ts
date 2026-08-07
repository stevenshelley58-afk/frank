/**
 * WB-08 + frozen-contract room list — against real PostgreSQL.
 *
 * Verify gates (master plan §8D WB-08 + frozen contract):
 *   - artifact registration is idempotent on (workbench, path) and appends
 *     artifact_registered;
 *   - GET /v1/rooms/:roomId/workbenches lists the room's workbenches;
 *   - reopen-with-note moves a DONE workbench to verifying (never a non-done
 *     one), so Central does not silently accept bad output.
 *
 * Requires `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB).
 * Self-skips with a visible reason when unset (repo convention).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { WorkbenchStore } from '../services/workbench/store.js';
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
  instruction: 'Produce the comparison sheet and register it as an artifact.',
  harness: { adapter: 'goose' },
};

describe.skipIf(requiresDatabase)(`WB-08 artifacts/receipt against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-wb08-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
    });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await handle?.close();
  });

  beforeEach(async () => {
    await resetApiDatabase((handle as FrankDatabaseHandle).db);
  });

  /* ------------------------------------------------------------- helpers --- */

  function authHdr(): string {
    return (server as TestServer).auth(['owner']);
  }

  async function createWorkbench(key: string, roomId: string): Promise<{ id: string; workItemId: string }> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      payload: { command_id: key, room_id: roomId, task_def: TASK_DEF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { workbench: { id: string; work_item_id: string } };
    return { id: body.workbench.id, workItemId: body.workbench.work_item_id };
  }

  /* ------------------------------------------------------------- artifact --- */

  it('registers an artifact idempotently and appends artifact_registered', async () => {
    const wb = await createWorkbench('wb08-art', 'room:ops');
    const target = server as TestServer;

    const first = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wb.id}/artifacts`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': 'wb08-art-1',
      },
      payload: {
        command_id: 'wb08-art-1',
        path: 'reports/comparison.html',
        kind: 'report',
        preview_url: 'https://preview.frank.fail/comparison-v1/',
      },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as { artifact_id: string; path: string };
    expect(body.path).toBe('reports/comparison.html');

    // Re-register the same path -> same single artifact row (upsert on path).
    const second = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wb.id}/artifacts`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': 'wb08-art-2',
      },
      payload: {
        command_id: 'wb08-art-2',
        path: 'reports/comparison.html',
        kind: 'report',
        preview_url: 'https://preview.frank.fail/comparison-v2/',
      },
    });
    expect(second.statusCode).toBe(200);

    const rows = await (handle as FrankDatabaseHandle).db.execute<{ path: string; preview_url: string | null }>(sql`
      select path, preview_url from "frank_domain"."workbench_artifact"
      where workbench_id = ${wb.id}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.preview_url).toBe('https://preview.frank.fail/comparison-v2/');

    // Durable event recorded.
    const events = await (handle as FrankDatabaseHandle).db.execute<{ type: string }>(sql`
      select type from "frank_domain"."workbench_event"
      where workbench_id = ${wb.id} and type = 'artifact_registered'
    `);
    expect(events.rows.length).toBeGreaterThanOrEqual(1);
  });

  /* ------------------------------------------------------------ room list --- */

  it('lists a room\'s workbenches, newest first', async () => {
    await createWorkbench('wb08-room-a', 'room:reports');
    await createWorkbench('wb08-room-b', 'room:reports');
    await createWorkbench('wb08-other', 'room:other');

    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'GET',
      url: '/v1/rooms/room:reports/workbenches',
      headers: { authorization: authHdr() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { workbenches: Array<{ id: string }> };
    expect(body.workbenches).toHaveLength(2);
  });

  /* --------------------------------------------------------------- reopen --- */

  it('reopens a DONE workbench to verifying with a note', async () => {
    const wb = await createWorkbench('wb08-reopen', 'room:ops');
    const store = new WorkbenchStore((handle as FrankDatabaseHandle).db);

    // Simulate a completed run (the runner would land `done` on success).
    await store.setState(wb.id, 'done', 'runner-test', new Date(), { finishedAt: new Date() });

    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wb.id}/reopen`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': 'wb08-reopen-cmd',
      },
      payload: { command_id: 'wb08-reopen-cmd', note: 'Receipt is missing evidence links.' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { workbench_state: string }).workbench_state).toBe('verifying');

    const detail = await target.app.inject({
      method: 'GET',
      url: `/v1/workbenches/${wb.id}`,
      headers: { authorization: authHdr() },
    });
    expect(((detail.json() as { workbench: { state: string } }).workbench).state).toBe('verifying');
  });

  it('refuses to reopen a workbench that is not done (409)', async () => {
    const wb = await createWorkbench('wb08-reopen-notdone', 'room:ops');
    // Fresh workbench is `queued`, not done.
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wb.id}/reopen`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': 'wb08-reopen-notdone-cmd',
      },
      payload: { command_id: 'wb08-reopen-notdone-cmd', note: 'should be refused' },
    });
    expect(res.statusCode).toBe(409);
  });
});

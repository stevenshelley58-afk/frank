/**
 * Living Frame route against the canonical Postgres records. It proves the
 * frame is a read model: queued workbench + persisted receipts are visible,
 * and the ETag derives from those facts rather than generation time.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';

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

const TASK_DEF = { instruction: 'Publish a truthful receipt for the living frame.', harness: { adapter: 'goose' } };

describe.skipIf(requiresDatabase)(`Living Frame feed against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-frame-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
      // The feed's "today" boundary must align with database `now()` below.
      now: () => new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await handle?.close();
  });

  beforeEach(async () => {
    await resetApiDatabase((handle as FrankDatabaseHandle).db);
  });

  it('returns only persisted running work and today receipts with a stable fact ETag', async () => {
    const target = server as TestServer;
    const auth = target.auth(['owner']);
    const openApi = await target.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect((openApi.json() as { paths: Record<string, unknown> }).paths).toHaveProperty('/v1/frame');
    const createWorkbench = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: { authorization: auth, 'content-type': 'application/json', 'idempotency-key': 'frame-workbench' },
      payload: { command_id: 'frame-workbench', room_id: 'room:frame', task_def: TASK_DEF },
    });
    expect(createWorkbench.statusCode).toBe(200);
    const workbench = createWorkbench.json() as { workbench: { id: string; work_item_id: string } };

    await (handle as FrankDatabaseHandle).db.execute(sql`
      insert into frank_domain.workbench_receipt
        (workbench_id, summary, assumptions, evidence, published_at, published_by)
      values (${workbench.workbench.id}, 'Published from the durable workbench receipt.', '[]'::jsonb, '[]'::jsonb, now(), 'test/runner')
    `);

    const chat = await target.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: { authorization: auth, 'content-type': 'application/json', 'idempotency-key': 'frame-chat' },
      payload: { project_id: 'room:frame', agent: 'frank', title: 'Frame receipt chat' },
    });
    expect(chat.statusCode).toBe(201);
    const conversation = chat.json() as { conversation: { id: string } };
    const appendReceipt = await target.app.inject({
      method: 'POST',
      url: `/v1/chats/${conversation.conversation.id}/messages`,
      headers: { authorization: auth, 'content-type': 'application/json', 'idempotency-key': 'frame-chat-receipt' },
      payload: { kind: 'receipt', body: 'Published from the persisted chat receipt.', meta: {} },
    });
    expect(appendReceipt.statusCode).toBe(201);

    const first = await target.app.inject({ method: 'GET', url: '/v1/frame', headers: { authorization: auth } });
    expect(first.statusCode).toBe(200);
    const frame = first.json() as {
      waiting: unknown[];
      running: Array<{ kind: string; id?: string }>;
      receipts: Array<{ kind: string; room_id?: string | null; summary?: string; body?: string }>;
      generated_at: string;
    };
    expect(frame.waiting).toEqual([]);
    expect(frame.running).toContainEqual(expect.objectContaining({ kind: 'workbench', id: workbench.workbench.id }));
    expect(frame.receipts).toContainEqual(expect.objectContaining({ kind: 'workbench', room_id: 'room:frame', summary: 'Published from the durable workbench receipt.' }));
    expect(frame.receipts).toContainEqual(expect.objectContaining({ kind: 'chat', body: 'Published from the persisted chat receipt.' }));
    expect(frame.generated_at).toMatch(/Z$/);
    expect(first.headers.etag).toMatch(/^W\//);

    const second = await target.app.inject({ method: 'GET', url: '/v1/frame', headers: { authorization: auth } });
    expect(second.headers.etag).toBe(first.headers.etag);

    const notModified = await target.app.inject({
      method: 'GET',
      url: '/v1/frame',
      headers: { authorization: auth, 'if-none-match': first.headers.etag as string },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.body).toBe('');
    expect(notModified.headers.etag).toBe(first.headers.etag);

    const commaSeparated = await target.app.inject({
      method: 'GET',
      url: '/v1/frame',
      headers: { authorization: auth, 'if-none-match': `"different", ${first.headers.etag as string}` },
    });
    expect(commaSeparated.statusCode).toBe(304);

    const wildcard = await target.app.inject({
      method: 'GET',
      url: '/v1/frame',
      headers: { authorization: auth, 'if-none-match': '*' },
    });
    expect(wildcard.statusCode).toBe(304);
  });

  it('does not expose a cell\'s frame records to another cell', async () => {
    const target = server as TestServer;
    const auth = target.auth(['owner']);
    const created = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: { authorization: auth, 'content-type': 'application/json', 'idempotency-key': 'frame-cell-a' },
      payload: { command_id: 'frame-cell-a', room_id: 'room:frame', task_def: TASK_DEF },
    });
    expect(created.statusCode).toBe(200);

    const other = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-frame-other-cell-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
      config: { cellId: 'cell-other' },
      now: () => new Date(),
    });
    try {
      const response = await other.app.inject({
        method: 'GET',
        url: '/v1/frame',
        headers: { authorization: other.auth(['owner']) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ waiting: [], running: [], receipts: [] });
    } finally {
      await other.close();
    }
  });
});

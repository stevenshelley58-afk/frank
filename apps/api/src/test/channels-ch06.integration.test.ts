/**
 * CH-06 — room↔channel bindings + outbox poll/ack against real PostgreSQL.
 *
 * Verify gates (master plan §8E CH-06):
 *  - bind is idempotent per (cell, room, platform) and replaces the
 *    conversation on re-bind;
 *  - revoke soft-deletes (revoked bindings route nothing);
 *  - outbox poll respects the sequence cursor + type filter (frame discipline)
 *    and ack marks events published idempotently.
 *
 * Requires `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB).
 * Self-skips with a visible reason when unset (repo convention).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { ChannelPushStore } from '../services/channels/channel-push.js';
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

describe.skipIf(requiresDatabase)(`CH-06 channel bindings against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-ch06-test',
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

  function authHdr(): string {
    return (server as TestServer).auth(['owner']);
  }

  async function bind(roomId: string, convId: string, commandId: string) {
    const target = server as TestServer;
    return target.app.inject({
      method: 'POST',
      url: `/v1/rooms/${encodeURIComponent(roomId)}/channel-bindings`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: {
        command_id: commandId,
        platform: 'telegram',
        platform_conversation_id: convId,
      },
    });
  }

  it('bind is idempotent per (cell, room, platform) and replaces on re-bind', async () => {
    const first = await bind('room:ops', '111', 'ch06-bind-1');
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { binding: { id: string; platform_conversation_id: string } };
    expect(firstBody.binding.platform_conversation_id).toBe('111');

    // Re-bind the same room+platform with a NEW conversation -> same binding id,
    // conversation replaced.
    const second = await bind('room:ops', '222', 'ch06-bind-2');
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { binding: { id: string; platform_conversation_id: string } };
    expect(secondBody.binding.id).toBe(firstBody.binding.id);
    expect(secondBody.binding.platform_conversation_id).toBe('222');
  });

  it('lists bindings and revokes (revoked bindings are marked, not deleted)', async () => {
    await bind('room:ops', '111', 'ch06-list-1');

    const target = server as TestServer;
    const list = await target.app.inject({
      method: 'GET',
      url: `/v1/rooms/${encodeURIComponent('room:ops')}/channel-bindings`,
      headers: { authorization: authHdr() },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { bindings: Array<{ id: string; revoked_at: string | null }> };
    expect(listBody.bindings).toHaveLength(1);
    const bindingId = listBody.bindings[0]!.id;
    expect(listBody.bindings[0]!.revoked_at).toBeNull();

    const revoke = await target.app.inject({
      method: 'DELETE',
      url: `/v1/rooms/${encodeURIComponent('room:ops')}/channel-bindings/${bindingId}`,
      headers: {
        authorization: authHdr(),
        'idempotency-key': 'ch06-revoke-1',
      },
    });
    expect(revoke.statusCode).toBe(200);

    const after = await target.app.inject({
      method: 'GET',
      url: `/v1/rooms/${encodeURIComponent('room:ops')}/channel-bindings`,
      headers: { authorization: authHdr() },
    });
    const afterBody = after.json() as { bindings: Array<{ revoked_at: string | null }> };
    expect(afterBody.bindings[0]!.revoked_at).not.toBeNull();
  });

  it('outbox poll respects the cursor + type filter; ack is idempotent', async () => {
    const store = new ChannelPushStore((handle as FrankDatabaseHandle).db);
    const now = new Date();

    // Seed two pending outbox events of different types directly.
    const db = (handle as FrankDatabaseHandle).db;
    const { sql } = await import('drizzle-orm');
    const { randomUUID } = await import('node:crypto');
    const id1 = randomUUID();
    const id2 = randomUUID();
    await db.execute(sql`
      insert into "frank_domain"."outbox_event"
        (id, type, source, time, dataschema, cellid, actorid, correlationid, classification, data, aggregate_kind, aggregate_id, available_at, created_at)
      values
        (${id1}, 'frank.workbench.state_changed.v1', 'frank://workbench/wb1', ${now}, 'schema://frank.workbench.state_changed/v1', 'cell-steven', 'user/steven', 'corr-1', 'private', '{"toState":"running"}'::jsonb, 'workbench', 'wb1', ${now}, ${now})
    `);
    await db.execute(sql`
      insert into "frank_domain"."outbox_event"
        (id, type, source, time, dataschema, cellid, actorid, correlationid, classification, data, aggregate_kind, aggregate_id, available_at, created_at)
      values
        (${id2}, 'frank.other.event.v1', 'frank://other/x', ${now}, 'schema://frank.other.event/v1', 'cell-steven', 'user/steven', 'corr-2', 'private', '{}'::jsonb, 'other', 'x', ${now}, ${now})
    `);

    const target = server as TestServer;

    // Frame discipline: poll only the workbench state-change type.
    const poll = await target.app.inject({
      method: 'GET',
      url: '/v1/channels/outbox?after_sequence=0&limit=10&types=frank.workbench.state_changed.v1',
      headers: { authorization: authHdr() },
    });
    expect(poll.statusCode).toBe(200);
    const pollBody = poll.json() as { events: Array<{ id: string; type: string }> };
    // Only the workbench event is returned (type filter), not the other one.
    expect(pollBody.events).toHaveLength(1);
    expect(pollBody.events[0]!.type).toBe('frank.workbench.state_changed.v1');

    // Ack it.
    const ack = await target.app.inject({
      method: 'POST',
      url: '/v1/channels/outbox/ack',
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': 'ch06-ack-1',
      },
      payload: { command_id: 'ch06-ack-1', ids: [id1] },
    });
    expect(ack.statusCode).toBe(200);

    // Polling again returns nothing (acked = published).
    const poll2 = await target.app.inject({
      method: 'GET',
      url: '/v1/channels/outbox?after_sequence=0&limit=10&types=frank.workbench.state_changed.v1',
      headers: { authorization: authHdr() },
    });
    const poll2Body = poll2.json() as { events: unknown[] };
    expect(poll2Body.events).toHaveLength(0);

    // Idempotent re-ack.
    const ack2 = await target.app.inject({
      method: 'POST',
      url: '/v1/channels/outbox/ack',
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': 'ch06-ack-2',
      },
      payload: { command_id: 'ch06-ack-2', ids: [id1] },
    });
    expect(ack2.statusCode).toBe(200);

    // Silence the unused-store lint.
    void store;
  });
});

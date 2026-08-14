/**
 * FS-02 against real PostgreSQL — room folder bindings: create/upsert,
 * list-by-room, revoke round-trip, idempotent re-bind, and the
 * `(cell_id, room_id, folder_source)` unique constraint (migration 0006).
 *
 * Mount enforcement is FS-03 and deliberately out of scope here.
 *
 * Requires `FRANK_TEST_DATABASE_URL` (the test harness derives the sibling
 * `_api` database). Self-skips with a visible reason when unset, exactly like
 * `workbench.integration.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@frank/adapter-postgres';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { RoomFolderBindingStore } from '../services/folder-binding/folder-binding-store.js';
import { buildTestServer, TEST_CELL } from './harness.js';
import type { TestServer } from './harness.js';
import {
  SKIP_REASON,
  apiDatabaseUrl,
  ensureApiDatabase,
  openApiTestDatabase,
  requiresDatabase,
  resetApiDatabase,
} from './db-harness.js';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const ROOM = 'room-fs02-test';

/**
 * Drizzle wraps driver errors as `Failed query: ...` and hides the real
 * PostgreSQL message on `error.cause.message` (same convention as
 * `workbench.integration.test.ts`).
 */
function expectPgError(promise: Promise<unknown>, pattern: RegExp) {
  return expect(promise).rejects.toSatisfy((error: unknown) => {
    const cause = (error as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (error as Error).message;
    return pattern.test(message);
  });
}

describe.skipIf(requiresDatabase)(`FS-02 room folder bindings (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;
  let nonce = 0;

  /** Unique per-test idempotency key (FRANK-§12.1). */
  function key(label: string): string {
    nonce += 1;
    return `fs02-${label}-${Date.now()}-${nonce}-0000000000`;
  }

  function authHdr(): string {
    return (server as TestServer).auth(['owner']);
  }

  async function bind(
    roomId: string,
    body: Record<string, unknown>,
    commandId: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/rooms/${roomId}/folder-bindings`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: { command_id: commandId, ...body },
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function list(roomId: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'GET',
      url: `/v1/rooms/${roomId}/folder-bindings`,
      headers: { authorization: authHdr() },
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function revoke(roomId: string, bindingId: string, commandId: string) {
    const target = server as TestServer;
    return target.app.inject({
      method: 'DELETE',
      url: `/v1/rooms/${roomId}/folder-bindings/${bindingId}`,
      headers: {
        authorization: authHdr(),
        'idempotency-key': commandId,
      },
    });
  }

  const BINDING_BODY = {
    folder_source: 'sync-laptop-notes',
    server_path: `/frank/deployed/sync/${ROOM}/notes`,
    sync_direction: 'send-only',
    mount_mode: 'ro',
    write_back: false,
  };

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-fs02-test',
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

  /* ------------------------------------------ create + list + revoke ------ */

  it('create + list + revoke round-trip', async () => {
    const created = await bind(ROOM, BINDING_BODY, key('create'));
    expect(created.status).toBe(200);
    const createdBinding = created.body['binding'] as Record<string, unknown>;
    expect(created.body['created']).toBe(true);
    expect(createdBinding['room_id']).toBe(ROOM);
    expect(createdBinding['folder_source']).toBe(BINDING_BODY.folder_source);
    expect(createdBinding['server_path']).toBe(BINDING_BODY.server_path);
    expect(createdBinding['sync_direction']).toBe('send-only');
    expect(createdBinding['mount_mode']).toBe('ro');
    expect(createdBinding['write_back']).toBe(false);
    expect(createdBinding['cell_id']).toBe(TEST_CELL);
    const bindingId = createdBinding['id'] as string;
    expect(bindingId).toMatch(/^[0-9a-f-]{36}$/);

    // The binding appears in the room list.
    const listed = await list(ROOM);
    expect(listed.status).toBe(200);
    const bindings = listed.body['bindings'] as Array<Record<string, unknown>>;
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.['id']).toBe(bindingId);

    // A different room sees nothing (cell+room scoping).
    const other = await list('room-other');
    expect((other.body['bindings'] as unknown[]).length).toBe(0);

    // Revoke removes it.
    const revoked = await revoke(ROOM, bindingId, key('revoke'));
    expect(revoked.statusCode).toBe(200);
    const revokedBody = revoked.json() as Record<string, unknown>;
    expect(revokedBody['binding_id']).toBe(bindingId);
    expect(revokedBody['revoked']).toBe(true);

    // Gone from the list, and a second revoke of the same id is a 404.
    const after = await list(ROOM);
    expect((after.body['bindings'] as unknown[]).length).toBe(0);
    const again = await revoke(ROOM, bindingId, key('revoke-again'));
    expect(again.statusCode).toBe(404);
    expect((again.json() as Record<string, unknown>)['type']).toBe(
      'https://frank.fail/problems/not-found',
    );
  });

  /* ------------------------------------------------ idempotent re-bind ---- */

  it('re-binding the same folder source updates the existing declaration', async () => {
    const bindKey = key('bind-1');
    const first = await bind(ROOM, BINDING_BODY, bindKey);
    expect(first.status).toBe(200);
    expect(first.body['created']).toBe(true);
    const firstId = (first.body['binding'] as Record<string, unknown>)['id'] as string;

    // Same room + folder_source, changed declaration, fresh key: the natural
    // key wins — one row, updated fields, created=false.
    const second = await bind(
      ROOM,
      {
        ...BINDING_BODY,
        mount_mode: 'staged',
        write_back: true,
        sync_direction: 'bidirectional',
      },
      key('bind-2'),
    );
    expect(second.status).toBe(200);
    expect(second.body['created']).toBe(false);
    const secondBinding = second.body['binding'] as Record<string, unknown>;
    expect(secondBinding['id']).toBe(firstId);
    expect(secondBinding['mount_mode']).toBe('staged');
    expect(secondBinding['write_back']).toBe(true);
    expect(secondBinding['sync_direction']).toBe('bidirectional');

    // Still exactly one binding for the room.
    const listed = await list(ROOM);
    const bindings = listed.body['bindings'] as Array<Record<string, unknown>>;
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.['mount_mode']).toBe('staged');

    // Replaying the ORIGINAL request (same key, same body) is a replay of the
    // same action and must not produce a second row.
    const replay = await bind(ROOM, BINDING_BODY, bindKey);
    expect(replay.status).toBe(200);
    const afterReplay = await list(ROOM);
    expect((afterReplay.body['bindings'] as unknown[]).length).toBe(1);
  });

  /* -------------------------------------------- unique constraint (DB) ---- */

  it('enforces the (cell, room, folder_source) unique constraint at the database', async () => {
    const store = new RoomFolderBindingStore((handle as FrankDatabaseHandle).db);
    const first = await store.upsertBinding({
      id: newId(),
      cellId: TEST_CELL,
      roomId: ROOM,
      folderSource: 'shared-docs',
      serverPath: `/frank/deployed/sync/${ROOM}/docs`,
      syncDirection: 'receive-only',
      mountMode: 'rw',
      writeBack: false,
      actor: 'user/steven',
      now: NOW,
    });
    expect(first.created).toBe(true);

    // A raw second INSERT with a DIFFERENT id but the same natural key must
    // fail at the database — the API upsert is not the only writer, so the
    // constraint itself is the property under test.
    await expectPgError(
      (handle as FrankDatabaseHandle).db.execute(sql`
        insert into "frank_domain"."room_folder_binding"
          (id, cell_id, room_id, folder_source, server_path,
           created_at, updated_at, created_by, updated_by,
           sync_direction, mount_mode, write_back)
        values (${newId()}, ${TEST_CELL}, ${ROOM}, 'shared-docs', '/frank/deployed/sync/other/docs',
                ${NOW}, ${NOW}, 'user/steven', 'user/steven',
                'send-only', 'ro', false)
      `),
      /room_folder_binding_cell_room_source_uidx|unique constraint/i,
    );

    // The store-level upsert on the same natural key is the supported path:
    // it updates rather than throws, keeping one row.
    const rebind = await store.upsertBinding({
      id: newId(),
      cellId: TEST_CELL,
      roomId: ROOM,
      folderSource: 'shared-docs',
      serverPath: `/frank/deployed/sync/${ROOM}/docs-v2`,
      syncDirection: 'bidirectional',
      mountMode: 'staged',
      writeBack: true,
      actor: 'user/steven',
      now: NOW,
    });
    expect(rebind.created).toBe(false);
    expect(rebind.record.id).toBe(first.record.id);
    expect(rebind.record.serverPath).toBe(`/frank/deployed/sync/${ROOM}/docs-v2`);
    expect(rebind.record.writeBack).toBe(true);

    const all = await store.listByRoom(TEST_CELL, ROOM);
    expect(all).toHaveLength(1);
  });

  /* -------------------------------------------------- contract details ---- */

  it('refuses a revoke without an Idempotency-Key header (FRANK-§12.1)', async () => {
    const created = await bind(ROOM, BINDING_BODY, key('needs-key'));
    expect(created.status).toBe(200);
    const bindingId = (created.body['binding'] as Record<string, unknown>)['id'] as string;

    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'DELETE',
      url: `/v1/rooms/${ROOM}/folder-bindings/${bindingId}`,
      headers: { authorization: authHdr() },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as Record<string, unknown>)['type']).toBe(
      'https://frank.fail/problems/validation-failed',
    );
  });

  it('validates the binding vocabulary at the boundary', async () => {
    const badDirection = await bind(
      ROOM,
      { ...BINDING_BODY, sync_direction: 'sideways' },
      key('bad-direction'),
    );
    expect(badDirection.status).toBe(400);
    expect((badDirection.body['errors'] as Array<{ path: string }> | undefined)?.some(
      (issue) => issue.path === 'sync_direction',
    )).toBe(true);

    const badMode = await bind(ROOM, { ...BINDING_BODY, mount_mode: 'exotic' }, key('bad-mode'));
    expect(badMode.status).toBe(400);
    expect((badMode.body['errors'] as Array<{ path: string }> | undefined)?.some(
      (issue) => issue.path === 'mount_mode',
    )).toBe(true);
  });
});

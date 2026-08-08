/**
 * FS-04 — write-back and offline behavior against real PostgreSQL.
 *
 * Verify gate (master plan §8G FS-04): "A workbench can continue with the
 * server copy while the laptop is closed. Results sync back when the PC
 * reconnects. The plan must not claim live write-back to an offline device."
 *
 * Asserted here, against the live DB:
 *
 *   1. An approved staged write landing into a write-back folder whose PC is
 *      OFFLINE records a `pending_sync` row (state pending, reason
 *      device-offline) — and the workbench does NOT fail: it resumes and the
 *      landing bytes are on the server copy.
 *   2. A write-back that would overwrite a CHANGED device copy is recorded
 *      honestly as a conflict — never auto-synced, never overridden
 *      ({@link WriteBackService.markSynced} refuses it).
 *   3. Write-back is opt-in: a binding with write_back=false, or a
 *      receive-only binding, records NO queue entry even when the landing
 *      succeeds.
 *   4. The default seam (no probe wired — the production state until FS-01)
 *      never claims delivery: landings queue as device-offline.
 *   5. markSynced drains a pending entry (the PC-reconnected seam), refuses
 *      conflict rows, is idempotent on synced rows, and 404s unknown ids.
 *
 * Device presence belongs to FS-01/Syncthing; the suite drives it through
 * the injected {@link DeviceSyncProbe} seam and never shells out. Requires
 * `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB);
 * self-skips with a visible reason when unset (repo convention).
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';
import { newId } from '@frank/adapter-postgres';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { WorkbenchStore } from '../services/workbench/store.js';
import {
  PendingSyncConflictError,
  PendingSyncNotFoundError,
  WriteBackService,
  isWriteBackAllowed,
} from '../services/workbench/write-back.js';
import type { DeviceSyncStatus } from '../services/workbench/write-back.js';
import { buildTestServer, TEST_CELL } from './harness.js';
import type { TestServer } from './harness.js';
import {
  SKIP_REASON,
  apiDatabaseUrl,
  ensureApiDatabase,
  openApiTestDatabase,
  resetApiDatabase,
  requiresDatabase,
} from './db-harness.js';

const ROOM = 'room-fs04-test';

const TASK_INSTRUCTION = 'Finish the summary and write it back to the laptop folder.';

describe.skipIf(requiresDatabase)(`FS-04 write-back + offline behavior against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;
  /** A second server WITHOUT an injected probe: exercises the FS-04 default. */
  let defaultProbeServer: TestServer | undefined;
  let writeBack: WriteBackService | undefined;
  let nonce = 0;
  /** Temp dirs cleaned up after the suite. */
  const tempDirs: string[] = [];

  /** Per-test device presence (FS-01's job in production). */
  let probeStatus: DeviceSyncStatus = { kind: 'offline' };
  const probe = {
    async probe(): Promise<DeviceSyncStatus> {
      return probeStatus;
    },
  };

  function key(label: string): string {
    nonce += 1;
    return `fs04-${label}-${Date.now()}-${nonce}-0000000000`;
  }

  function authHdr(target: TestServer): string {
    return target.auth(['owner']);
  }

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  /** Bind a folder to the test room through the FS-02 API. */
  async function bindFolder(
    target: TestServer,
    body: Record<string, unknown>,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/rooms/${ROOM}/folder-bindings`,
      headers: {
        authorization: authHdr(target),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: { command_id: commandId, ...body },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as Record<string, unknown>).binding as Record<string, unknown>;
  }

  /** Create a workbench for the room with a task def, then make it running. */
  async function createRunningWorkbench(
    target: TestServer,
    workbenchKey: string,
    taskDef: Record<string, unknown>,
  ): Promise<{ id: string; workItemId: string }> {
    const res = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: {
        authorization: authHdr(target),
        'content-type': 'application/json',
        'idempotency-key': workbenchKey,
      },
      payload: { command_id: workbenchKey, room_id: ROOM, task_def: taskDef },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { workbench: { id: string; work_item_id: string } };
    // The runner would move queued -> running on claim; the test does it
    // directly so a decision (HITL-01) can be requested.
    const store = new WorkbenchStore((handle as FrankDatabaseHandle).db);
    await store.setState(body.workbench.id, 'running', 'test-harness', new Date(), {
      startedAt: new Date(),
    });
    return { id: body.workbench.id, workItemId: body.workbench.work_item_id };
  }

  async function proposeStagedWrite(
    target: TestServer,
    wbId: string,
    commandId: string,
    body: Record<string, unknown>,
  ) {
    return target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wbId}/staged-writes`,
      headers: {
        authorization: authHdr(target),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: { command_id: commandId, ...body },
    });
  }

  async function getWorkItem(target: TestServer, itemId: string) {
    const res = await target.app.inject({
      method: 'GET',
      url: `/v1/work/${itemId}`,
      headers: { authorization: authHdr(target) },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { state: string; kind: string; version: number };
  }

  async function approveDecision(target: TestServer, decisionId: string): Promise<void> {
    const item = await getWorkItem(target, decisionId);
    const commandId = key('approve');
    const ready = await target.app.inject({
      method: 'POST',
      url: `/v1/work/${decisionId}/commands/ready`,
      headers: {
        authorization: authHdr(target),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: {
        command_id: commandId,
        expected_version: item.version,
        reason: 'approved by steven',
      },
    });
    expect(ready.statusCode).toBe(200);
  }

  async function getWorkbenchState(target: TestServer, wbId: string): Promise<string> {
    const res = await target.app.inject({
      method: 'GET',
      url: `/v1/workbenches/${wbId}`,
      headers: { authorization: authHdr(target) },
    });
    expect(res.statusCode).toBe(200);
    return ((res.json() as Record<string, unknown>).workbench as Record<string, unknown>)
      .state as string;
  }

  type PendingSyncRow = {
    id: string;
    state: string;
    reason: string;
    detail: string | null;
    folder_source: string;
    workbench_id: string;
    staged_write_id: string;
    target_path: string;
    synced_at: string | null;
    synced_by: string | null;
  };

  async function pendingSyncRows(decisionWorkItemId: string): Promise<PendingSyncRow[]> {
    const rows = await (handle as FrankDatabaseHandle).db.execute<PendingSyncRow>(sql`
      select ps.id, ps.state, ps.reason, ps.detail, ps.folder_source,
             ps.workbench_id, ps.staged_write_id, ps.target_path,
             ps.synced_at, ps.synced_by
      from "frank_domain"."pending_sync" ps
      join "frank_domain"."staged_write" sw on sw.id = ps.staged_write_id
      where sw.decision_work_item_id = ${decisionWorkItemId}
    `);
    return rows.rows;
  }

  async function auditActions(): Promise<string[]> {
    const rows = await (handle as FrankDatabaseHandle).db.execute<{ action: string }>(sql`
      select action from "frank_domain"."audit_entry" order by seq
    `);
    return rows.rows.map((r) => r.action);
  }

  /** Propose a staged write on the scenario binding and approve it. */
  async function proposeAndApprove(
    target: TestServer,
    wbId: string,
    stagedCopy: string,
  ): Promise<string> {
    const res = await proposeStagedWrite(target, wbId, key('propose'), {
      room_id: ROOM,
      folder_source: 'notes',
      staged_copy_path: stagedCopy,
      note: 'The finished summary should land back on the laptop.',
    });
    expect(res.statusCode).toBe(200);
    const decisionId = (res.json() as { decision_work_item_id: string }).decision_work_item_id;
    await approveDecision(target, decisionId);
    return decisionId;
  }

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-fs04-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
      deviceSyncProbe: probe,
    });
    // No probe injected: this server exercises the honest FS-04 default
    // (AssumeOfflineDeviceProbe) — the production posture until FS-01 wires
    // real device presence.
    defaultProbeServer = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-fs04-default-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
    });
    writeBack = new WriteBackService((handle as FrankDatabaseHandle).db);
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await defaultProbeServer?.close();
    await handle?.close();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  beforeEach(async () => {
    await resetApiDatabase((handle as FrankDatabaseHandle).db);
    probeStatus = { kind: 'offline' };
  });

  /** Write-back binding + running workbench holding its staged mount. */
  async function setupWriteBackScenario(
    target: TestServer,
    overrides: Record<string, unknown> = {},
  ): Promise<{ wbId: string; sharedSource: string; stagedCopy: string }> {
    const sharedSource = await makeTempDir('fs04-shared-');
    const stagedCopy = await makeTempDir('fs04-staged-');
    await bindFolder(
      target,
      {
        folder_source: 'notes',
        server_path: sharedSource,
        sync_direction: 'bidirectional',
        mount_mode: 'staged',
        write_back: true,
        ...overrides,
      },
      key('bind'),
    );
    const wb = await createRunningWorkbench(target, key('wb'), {
      instruction: TASK_INSTRUCTION,
      harness: { adapter: 'goose' },
      mounts: [{ source: 'notes', path: '/mnt/notes', mode: 'staged' }],
    });
    return { wbId: wb.id, sharedSource, stagedCopy };
  }

  /* ------------------------------------------- the FS-04 headline case ---- */

  // The propose→approve round trips below each run several sequential
  // injections against the VPS-hosted test DB; 90s headroom keeps wall-clock
  // contention from masking the logic under test (same posture as the FS-03
  // suite).
  it('approved write-back to an OFFLINE PC records pending_sync and the workbench does NOT fail', async () => {
    const target = server as TestServer;
    probeStatus = { kind: 'offline', detail: 'laptop-lid-closed' };
    const scenario = await setupWriteBackScenario(target);
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'fs04-approved', 'utf8');

    const decisionId = await proposeAndApprove(target, scenario.wbId, scenario.stagedCopy);

    // The controlled copy landed on the SERVER copy (FS-03 is untouched) ...
    const landed = await readFile(join(scenario.sharedSource, 'summary.txt'), 'utf8');
    expect(landed).toBe('fs04-approved');

    // ... the workbench resumed normally — an offline device NEVER fails it.
    expect(await getWorkbenchState(target, scenario.wbId)).toBe('running');

    // The result is waiting to sync: one pending_sync row, honestly reasoned.
    const rows = await pendingSyncRows(decisionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('pending');
    expect(rows[0]?.reason).toBe('device-offline');
    expect(rows[0]?.detail).toBe('laptop-lid-closed');
    expect(rows[0]?.target_path).toBe(scenario.sharedSource);
    expect(rows[0]?.synced_at).toBeNull();

    // Fully audited on the cell's chain.
    const actions = await auditActions();
    expect(actions).toContain('staged_write.landed');
    expect(actions).toContain('write_back.queued');

    // And visible through the room queue surface.
    const list = await target.app.inject({
      method: 'GET',
      url: `/v1/rooms/${ROOM}/pending-syncs`,
      headers: { authorization: authHdr(target) },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { pending_syncs: Array<Record<string, unknown>> };
    expect(body.pending_syncs).toHaveLength(1);
    expect(body.pending_syncs[0]?.state).toBe('pending');
    expect(body.pending_syncs[0]?.reason).toBe('device-offline');
  }, 90_000);

  /* ------------------------------------------------------ conflict honesty */

  it('a write-back that would overwrite a CHANGED device copy is recorded as a conflict, never auto-overridden', async () => {
    const target = server as TestServer;
    probeStatus = {
      kind: 'conflict',
      detail: 'summary.txt changed on the device after the run copied it',
    };
    const scenario = await setupWriteBackScenario(target);
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'run-version', 'utf8');

    const decisionId = await proposeAndApprove(target, scenario.wbId, scenario.stagedCopy);

    // The workbench STILL does not fail — the conflict is a record, not a crash.
    expect(await getWorkbenchState(target, scenario.wbId)).toBe('running');

    const rows = await pendingSyncRows(decisionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('conflict');
    expect(rows[0]?.reason).toBe('target-changed-on-device');
    expect(rows[0]?.detail).toBe('summary.txt changed on the device after the run copied it');

    // The queue surface reports it honestly.
    const list = await target.app.inject({
      method: 'GET',
      url: `/v1/rooms/${ROOM}/pending-syncs`,
      headers: { authorization: authHdr(target) },
    });
    const body = list.json() as { pending_syncs: Array<Record<string, unknown>> };
    expect(body.pending_syncs[0]?.state).toBe('conflict');

    // markSynced REFUSES a conflict row: no destructive auto-override.
    const service = writeBack as WriteBackService;
    await expect(
      service.markSynced(TEST_CELL, rows[0]!.id, {
        cellId: TEST_CELL,
        actor: { kind: 'user', id: 'steven' },
        correlationId: 'fs04-conflict-sync',
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(PendingSyncConflictError);

    // Still conflict after the refused drain.
    const after = await pendingSyncRows(decisionId);
    expect(after[0]?.state).toBe('conflict');
    expect(after[0]?.synced_at).toBeNull();

    expect(await auditActions()).toContain('write_back.conflict');
  }, 90_000);

  /* ------------------------------------------------------- the opt-in gate */

  it('write-back is opt-in: write_back=false records no queue entry even when the landing succeeds', async () => {
    const target = server as TestServer;
    probeStatus = { kind: 'offline' };
    const scenario = await setupWriteBackScenario(target, { write_back: false });
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'not-opted-in', 'utf8');

    const decisionId = await proposeAndApprove(target, scenario.wbId, scenario.stagedCopy);

    // Landing succeeded (FS-03), workbench resumed, but NOTHING queued.
    await expect(readFile(join(scenario.sharedSource, 'summary.txt'), 'utf8')).resolves.toBe(
      'not-opted-in',
    );
    expect(await getWorkbenchState(target, scenario.wbId)).toBe('running');
    expect(await pendingSyncRows(decisionId)).toHaveLength(0);
    expect((await auditActions()).filter((a) => a.startsWith('write_back.'))).toHaveLength(0);
  }, 90_000);

  it('write-back is opt-in: a receive-only binding records no queue entry', async () => {
    const target = server as TestServer;
    probeStatus = { kind: 'offline' };
    const scenario = await setupWriteBackScenario(target, { sync_direction: 'receive-only' });
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'receive-only', 'utf8');

    const decisionId = await proposeAndApprove(target, scenario.wbId, scenario.stagedCopy);

    expect(await getWorkbenchState(target, scenario.wbId)).toBe('running');
    expect(await pendingSyncRows(decisionId)).toHaveLength(0);
  }, 90_000);

  it('isWriteBackAllowed is true only for write_back=true with a non-receive-only direction', () => {
    const base = {
      id: 'b',
      cellId: TEST_CELL,
      roomId: ROOM,
      folderSource: 'notes',
      serverPath: '/srv/frank/sync/room/notes',
      mountMode: 'staged' as const,
      writeBack: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(isWriteBackAllowed({ ...base, syncDirection: 'bidirectional' })).toBe(true);
    expect(isWriteBackAllowed({ ...base, syncDirection: 'send-only' })).toBe(true);
    expect(isWriteBackAllowed({ ...base, syncDirection: 'receive-only' })).toBe(false);
    expect(isWriteBackAllowed({ ...base, writeBack: false, syncDirection: 'bidirectional' })).toBe(
      false,
    );
  });

  /* ------------------------------------------------ the honest default ---- */

  it('without a wired probe (production until FS-01) landings queue as device-offline, never claimed delivered', async () => {
    const target = defaultProbeServer as TestServer;
    const scenario = await setupWriteBackScenario(target);
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'default-probe', 'utf8');

    const decisionId = await proposeAndApprove(target, scenario.wbId, scenario.stagedCopy);

    expect(await getWorkbenchState(target, scenario.wbId)).toBe('running');
    const rows = await pendingSyncRows(decisionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('pending');
    expect(rows[0]?.reason).toBe('device-offline');
  }, 90_000);

  /* ----------------------------------------------- markSynced drain seam --- */

  it('markSynced drains a pending entry when the PC reconnects, is idempotent, and 404s unknown ids', async () => {
    const target = server as TestServer;
    probeStatus = { kind: 'offline' };
    const scenario = await setupWriteBackScenario(target);
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'to-sync', 'utf8');
    const decisionId = await proposeAndApprove(target, scenario.wbId, scenario.stagedCopy);
    const [row] = await pendingSyncRows(decisionId);

    const service = writeBack as WriteBackService;
    const command = {
      cellId: TEST_CELL,
      actor: { kind: 'user' as const, id: 'steven' },
      correlationId: 'fs04-reconnect',
      now: new Date(),
    };

    const synced = await service.markSynced(TEST_CELL, row!.id, command);
    expect(synced.state).toBe('synced');
    expect(synced.syncedAt).not.toBeNull();
    expect(synced.syncedBy).toMatch(/^user\/.*steven$/);

    // Idempotent replay: the PC reconnecting twice is not an error.
    const replay = await service.markSynced(TEST_CELL, row!.id, command);
    expect(replay.state).toBe('synced');

    // Unknown id is an honest not-found.
    await expect(
      service.markSynced(TEST_CELL, newId(), command),
    ).rejects.toBeInstanceOf(PendingSyncNotFoundError);

    expect(await auditActions()).toContain('write_back.synced');
  }, 90_000);
});

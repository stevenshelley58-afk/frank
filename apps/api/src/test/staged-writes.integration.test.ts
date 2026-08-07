/**
 * FS-03 — mount plumbing + staged shared writes against real PostgreSQL.
 *
 * Verify gate (master plan §8G FS-03): "Direct shared write fails. Approved
 * staged write succeeds and is fully audited." Plus the FS-02 gate FS-03
 * implements: "A workbench receives only the folders bound to its room and
 * task definition."
 *
 * The copies here are REAL: the binding's server_path and the staged copy
 * path are temp directories on the test host, and the service's default
 * {@link FsStagedCopyLand} performs an actual recursive copy — so "landed"
 * is asserted on bytes, not on a flag.
 *
 * Requires `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB).
 * Self-skips with a visible reason when unset (repo convention).
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { WorkbenchStore } from '../services/workbench/store.js';
import { WorkbenchDecisionService } from '../services/workbench/decision.js';
import {
  FsStagedCopyLand,
  StagedWriteNotApprovedError,
  StagedWriteRejectedError,
  StagedWriteService,
} from '../services/workbench/staged-write.js';
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

const ROOM = 'room-fs03-test';

const TASK_INSTRUCTION = 'Update the shared notes folder with the new summary.';

describe.skipIf(requiresDatabase)(`FS-03 mounts + staged writes against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;
  let service: StagedWriteService | undefined;
  let nonce = 0;
  /** Temp dirs cleaned up after the suite. */
  const tempDirs: string[] = [];

  function key(label: string): string {
    nonce += 1;
    return `fs03-${label}-${Date.now()}-${nonce}-0000000000`;
  }

  function authHdr(): string {
    return (server as TestServer).auth(['owner']);
  }

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  /** Bind a folder to the test room through the FS-02 API. */
  async function bindFolder(
    body: Record<string, unknown>,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: `/v1/rooms/${ROOM}/folder-bindings`,
      headers: {
        authorization: authHdr(),
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
    workbenchKey: string,
    taskDef: Record<string, unknown>,
  ): Promise<{ id: string; workItemId: string }> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: {
        authorization: authHdr(),
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
    wbId: string,
    commandId: string,
    body: Record<string, unknown>,
  ) {
    const target = server as TestServer;
    return target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wbId}/staged-writes`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: { command_id: commandId, ...body },
    });
  }

  async function getWorkItem(itemId: string) {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'GET',
      url: `/v1/work/${itemId}`,
      headers: { authorization: authHdr() },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { state: string; kind: string; version: number };
  }

  async function sendCommand(
    itemId: string,
    command: 'ready' | 'cancel',
    commandId: string,
    expectedVersion: number,
  ) {
    const target = server as TestServer;
    return target.app.inject({
      method: 'POST',
      url: `/v1/work/${itemId}/commands/${command}`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: {
        command_id: commandId,
        expected_version: expectedVersion,
        reason: command === 'ready' ? 'approved by steven' : 'denied by steven',
      },
    });
  }

  async function getWorkbenchState(wbId: string): Promise<string> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'GET',
      url: `/v1/workbenches/${wbId}`,
      headers: { authorization: authHdr() },
    });
    expect(res.statusCode).toBe(200);
    return ((res.json() as Record<string, unknown>).workbench as Record<string, unknown>)
      .state as string;
  }

  async function stagedWriteRow(decisionWorkItemId: string) {
    const rows = await (handle as FrankDatabaseHandle).db.execute<{
      state: string;
      target_path: string;
      staged_copy_path: string;
      landed_by: string | null;
    }>(sql`
      select state, target_path, staged_copy_path, landed_by
      from "frank_domain"."staged_write"
      where decision_work_item_id = ${decisionWorkItemId}
    `);
    return rows.rows[0];
  }

  async function auditActions(): Promise<string[]> {
    const rows = await (handle as FrankDatabaseHandle).db.execute<{ action: string }>(sql`
      select action from "frank_domain"."audit_entry" order by seq
    `);
    return rows.rows.map((r) => r.action);
  }

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-fs03-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
    });
    // A second service handle for the control-plane-direct assertions (the
    // "direct shared write fails" case calls the service itself, bypassing
    // the approval flow — exactly what a compromised caller would do).
    service = new StagedWriteService(
      (handle as FrankDatabaseHandle).db,
      new WorkbenchDecisionService((handle as FrankDatabaseHandle).db),
      new FsStagedCopyLand(),
    );
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await handle?.close();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  beforeEach(async () => {
    await resetApiDatabase((handle as FrankDatabaseHandle).db);
  });

  /* ------------------------------------------------- mount composition ---- */

  it('a room workbench receives ONLY folders bound to its room AND named in the task def', async () => {
    const notesPath = await makeTempDir('fs03-notes-');
    const docsPath = await makeTempDir('fs03-docs-');
    await bindFolder(
      {
        folder_source: 'notes',
        server_path: notesPath,
        sync_direction: 'bidirectional',
        mount_mode: 'staged',
        write_back: true,
      },
      key('bind-notes'),
    );
    await bindFolder(
      {
        folder_source: 'docs',
        server_path: docsPath,
        sync_direction: 'receive-only',
        mount_mode: 'ro',
        write_back: false,
      },
      key('bind-docs'),
    );

    const target = server as TestServer;
    const composeKey = key('compose');
    const res = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': composeKey,
      },
      payload: {
        command_id: composeKey,
        room_id: ROOM,
        task_def: {
          instruction: TASK_INSTRUCTION,
          harness: { adapter: 'goose' },
          mounts: [
            // Bound: lands at the BINDING's server path in the BINDING's mode.
            { source: 'notes', path: '/mnt/notes', mode: 'staged' },
            // Bound ro: the task asks rw, the binding ceiling wins.
            { source: 'docs', path: '/mnt/docs', mode: 'rw' },
            // NOT bound to the room: must not enter the container.
            { source: 'secrets', path: '/mnt/secrets', mode: 'rw' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const wb = (res.json() as Record<string, unknown>).workbench as Record<string, unknown>;
    const mounts = (wb.task_def as Record<string, unknown>).mounts as Array<
      Record<string, unknown>
    >;

    // Exactly the bound-and-named folders, with binding-supplied sources and
    // modes — never the task def's raw requests.
    expect(mounts).toEqual([
      { source: notesPath, path: '/mnt/notes', mode: 'staged' },
      { source: docsPath, path: '/mnt/docs', mode: 'ro' },
    ]);
    expect(mounts.some((m) => m.path === '/mnt/secrets')).toBe(false);
  });

  /* ---------------------------------------------- propose + decision ------ */

  async function setupStagedScenario(): Promise<{
    wbId: string;
    sharedSource: string;
    stagedCopy: string;
  }> {
    const sharedSource = await makeTempDir('fs03-shared-');
    const stagedCopy = await makeTempDir('fs03-staged-');
    await bindFolder(
      {
        folder_source: 'notes',
        server_path: sharedSource,
        sync_direction: 'bidirectional',
        mount_mode: 'staged',
        write_back: true,
      },
      key('bind-shared'),
    );
    const wb = await createRunningWorkbench(key('wb-staged'), {
      instruction: TASK_INSTRUCTION,
      harness: { adapter: 'goose' },
      mounts: [{ source: 'notes', path: '/mnt/notes', mode: 'staged' }],
    });
    return { wbId: wb.id, sharedSource, stagedCopy };
  }

  it('proposing a staged write files a normal waiting decision and pauses the run', async () => {
    const scenario = await setupStagedScenario();

    const res = await proposeStagedWrite(scenario.wbId, key('propose'), {
      room_id: ROOM,
      folder_source: 'notes',
      staged_copy_path: scenario.stagedCopy,
      note: 'The summary is ready to land in the shared notes folder.',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      staged_write_id: string;
      decision_work_item_id: string;
      workbench_state: string;
    };
    expect(body.workbench_state).toBe('waiting');

    // The run paused.
    expect(await getWorkbenchState(scenario.wbId)).toBe('waiting');

    // The approval is a NORMAL decision work item in `waiting` (ADR-022).
    const item = await getWorkItem(body.decision_work_item_id);
    expect(item.kind).toBe('decision');
    expect(item.state).toBe('waiting');

    // The filesystem fact is recorded against the binding's server path.
    const row = await stagedWriteRow(body.decision_work_item_id);
    expect(row?.state).toBe('pending');
    expect(row?.target_path).toBe(scenario.sharedSource);
    expect(row?.staged_copy_path).toBe(scenario.stagedCopy);
  });

  it('direct shared write FAILS: landing without a ready decision is refused and copies nothing', async () => {
    const scenario = await setupStagedScenario();
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'landed-by-approval', 'utf8');
    const canary = join(scenario.sharedSource, 'summary.txt');

    const res = await proposeStagedWrite(scenario.wbId, key('propose-direct'), {
      room_id: ROOM,
      folder_source: 'notes',
      staged_copy_path: scenario.stagedCopy,
    });
    expect(res.statusCode).toBe(200);
    const decisionId = (res.json() as { decision_work_item_id: string }).decision_work_item_id;

    // A caller that skips approval and calls landStagedWrite directly must
    // fail: the decision is still `waiting`, not `ready`.
    await expect(
      (service as StagedWriteService).landStagedWrite(decisionId, {
        cellId: TEST_CELL,
        actor: { kind: 'user', id: 'steven' },
        correlationId: 'fs03-direct',
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(StagedWriteNotApprovedError);

    // Nothing landed: the shared source is untouched.
    await expect(readFile(canary, 'utf8')).rejects.toThrow();
    const row = await stagedWriteRow(decisionId);
    expect(row?.state).toBe('pending');
    expect((await auditActions()).filter((a) => a === 'staged_write.landed')).toHaveLength(0);
  });

  it('approved staged write lands the copy into the shared source, fully audited', async () => {
    const scenario = await setupStagedScenario();
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'approved-content', 'utf8');

    const res = await proposeStagedWrite(scenario.wbId, key('propose-approve'), {
      room_id: ROOM,
      folder_source: 'notes',
      staged_copy_path: scenario.stagedCopy,
      note: 'Quarterly summary finished.',
    });
    expect(res.statusCode).toBe(200);
    const decisionId = (res.json() as { decision_work_item_id: string }).decision_work_item_id;
    const item = await getWorkItem(decisionId);

    // Approve through the NORMAL command envelope on the decision item.
    const ready = await sendCommand(decisionId, 'ready', key('approve'), item.version);
    expect(ready.statusCode).toBe(200);

    // The copy landed — real bytes in the shared source.
    const landed = await readFile(join(scenario.sharedSource, 'summary.txt'), 'utf8');
    expect(landed).toBe('approved-content');

    // The staged_write row records the landing. `landed_by` follows the
    // repo-wide actorRef convention `${kind}/${principalId}` (the test
    // harness's principalId is itself `user/steven`).
    const row = await stagedWriteRow(decisionId);
    expect(row?.state).toBe('landed');
    expect(row?.landed_by).toMatch(/^user\/.*steven$/);

    // The run resumed (HITL-02) — approval both lands and unblocks.
    expect(await getWorkbenchState(scenario.wbId)).toBe('running');
    expect((await getWorkItem(decisionId)).state).toBe('ready');

    // Fully audited: proposal + landing on the cell's chain.
    const actions = await auditActions();
    expect(actions).toContain('staged_write.proposed');
    expect(actions).toContain('staged_write.landed');
    expect(actions).toContain('workbench.decision_requested');
    expect(actions).toContain('workbench.resumed');
  });

  it('denied staged write copies nothing and marks the proposal denied', async () => {
    const scenario = await setupStagedScenario();
    await writeFile(join(scenario.stagedCopy, 'summary.txt'), 'should-never-land', 'utf8');

    const res = await proposeStagedWrite(scenario.wbId, key('propose-deny'), {
      room_id: ROOM,
      folder_source: 'notes',
      staged_copy_path: scenario.stagedCopy,
    });
    expect(res.statusCode).toBe(200);
    const decisionId = (res.json() as { decision_work_item_id: string }).decision_work_item_id;
    const item = await getWorkItem(decisionId);

    const cancel = await sendCommand(decisionId, 'cancel', key('deny'), item.version);
    expect(cancel.statusCode).toBe(200);

    // Nothing landed; the proposal is honestly recorded as denied; the run
    // safe-fails per HITL-02.
    await expect(
      readFile(join(scenario.sharedSource, 'summary.txt'), 'utf8'),
    ).rejects.toThrow();
    const row = await stagedWriteRow(decisionId);
    expect(row?.state).toBe('denied');
    expect(await getWorkbenchState(scenario.wbId)).toBe('failed');
    expect((await auditActions()).filter((a) => a === 'staged_write.denied')).toHaveLength(1);
  });

  /* --------------------------------------------------- proposal guards ---- */

  it('refuses proposals for folders not bound staged to the room', async () => {
    // Bound rw, not staged — write-back through approval is not its mode.
    const rwPath = await makeTempDir('fs03-rw-');
    await bindFolder(
      {
        folder_source: 'scratch',
        server_path: rwPath,
        sync_direction: 'bidirectional',
        mount_mode: 'rw',
        write_back: true,
      },
      key('bind-rw'),
    );
    const wb = await createRunningWorkbench(key('wb-rw'), {
      instruction: TASK_INSTRUCTION,
      harness: { adapter: 'goose' },
      mounts: [{ source: 'scratch', path: '/mnt/scratch', mode: 'rw' }],
    });

    const res = await proposeStagedWrite(wb.id, key('propose-rw'), {
      room_id: ROOM,
      folder_source: 'scratch',
      staged_copy_path: rwPath,
    });
    expect(res.statusCode).toBe(409);

    // And a folder with no binding at all fails at the service level too.
    await expect(
      (service as StagedWriteService).proposeStagedWrite({
        cellId: TEST_CELL,
        workbenchId: wb.id,
        roomId: ROOM,
        folderSource: 'never-bound',
        stagedCopyPath: rwPath,
        actor: { kind: 'user', id: 'steven' },
        correlationId: 'fs03-unbound',
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(StagedWriteRejectedError);
  });

  it('refuses a proposal for a workbench that does not hold the staged mount', async () => {
    // Room has a staged binding, but the workbench's task def did not name
    // it — §3.2 requires BOTH sides. Proposing must fail.
    const sharedSource = await makeTempDir('fs03-nohold-');
    await bindFolder(
      {
        folder_source: 'notes',
        server_path: sharedSource,
        sync_direction: 'bidirectional',
        mount_mode: 'staged',
        write_back: true,
      },
      key('bind-nohold'),
    );
    const wb = await createRunningWorkbench(key('wb-nohold'), {
      instruction: TASK_INSTRUCTION,
      harness: { adapter: 'goose' },
      // No mounts at all — the task def never named the bound folder.
    });

    const res = await proposeStagedWrite(wb.id, key('propose-nohold'), {
      room_id: ROOM,
      folder_source: 'notes',
      staged_copy_path: sharedSource,
    });
    expect(res.statusCode).toBe(409);
  });
});

/**
 * WB-01 against real PostgreSQL — verify gate: "Create, read, append events,
 * and reconstruct a run snapshot from Postgres."
 *
 * Requires `FRANK_TEST_DATABASE_URL` (the test harness derives the sibling
 * `_api` database). Self-skips with a visible reason when unset, exactly like
 * `schema.test.ts` / `slice1.integration.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';

import { WorkbenchStore } from '../services/workbench/store.js';
import type { WorkbenchTaskDef } from '../services/workbench/types.js';

import {
  SKIP_REASON,
  ensureApiDatabase,
  openApiTestDatabase,
  requiresDatabase,
  resetApiDatabase,
} from './db-harness.js';

const CELL = 'cell-steven';
const NOW = new Date('2026-08-06T10:00:00.000Z');

/**
 * Drizzle wraps driver errors as `Failed query: ...` and hides the real
 * PostgreSQL message on `error.cause.message`. DB-level assertions must
 * match the cause, not the wrapper.
 */
function expectPgError(promise: Promise<unknown>, pattern: RegExp) {
  return expect(promise).rejects.toSatisfy((error: unknown) => {
    const cause = (error as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (error as Error).message;
    return pattern.test(message);
  });
}

const TASK_DEF: WorkbenchTaskDef = {
  instruction: 'Summarize the latest standup notes into five bullets.',
  mounts: [{ source: '/srv/frank/rooms/r1/notes', path: '/workspace/notes', mode: 'ro' }],
  harness: { adapter: 'goose' },
  skills: [],
  leash: { wallClockSec: 600 },
  network: { egressAllowlist: [] },
};

/** Minimal work_item so the workbench FK has a target (0000 conventions). */
async function seedWorkItem(db: FrankDatabaseHandle['db']): Promise<string> {
  const id = newId();
  await db.execute(sql`
    insert into "frank_domain"."work_item"
      (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
       kind, title, owner_kind, owner_id, policy_ref)
    values (${id}, ${CELL}, ${NOW}, ${NOW}, 'steven', 'steven',
            '{"method":"capture","producer":"test/wb01"}'::jsonb,
            'task', 'workbench test item', 'user', 'steven',
            '{"ref":"autonomous-internal-work","version":"3.2.0"}'::jsonb)
  `);
  return id;
}

describe.skipIf(requiresDatabase)(SKIP_REASON, () => {
  let handle: FrankDatabaseHandle;
  let store: WorkbenchStore;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    store = new WorkbenchStore(handle.db);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  beforeEach(async () => {
    await resetApiDatabase(handle.db);
  });

  it('creates a workbench, reads it back, and reports created=true', async () => {
    const workItemId = await seedWorkItem(handle.db);
    const id = newId();

    const result = await store.createWorkbench({
      id,
      cellId: CELL,
      workItemId,
      roomId: 'room-alpha',
      idempotencyKey: 'cmd-delegate-1',
      taskDef: TASK_DEF,
      createdBy: 'steven',
      now: NOW,
      schedule: { cron: '0 9 * * 1', tz: 'Europe/Berlin' },
    });

    expect(result.created).toBe(true);
    expect(result.record.id).toBe(id);
    expect(result.record.state).toBe('queued');
    expect(result.record.roomId).toBe('room-alpha');
    expect(result.record.taskDef.instruction).toBe(TASK_DEF.instruction);
    expect(result.record.scheduleCron).toBe('0 9 * * 1');
    expect(result.record.scheduleTimezone).toBe('Europe/Berlin');

    const read = await store.getWorkbench(CELL, id);
    expect(read).not.toBeNull();
    expect(read?.workItemId).toBe(workItemId);
  });

  it('is idempotent against the delegation command key: replay returns the first row', async () => {
    const workItemId = await seedWorkItem(handle.db);
    const input = {
      cellId: CELL,
      workItemId,
      roomId: 'room-alpha',
      idempotencyKey: 'cmd-delegate-replay',
      taskDef: TASK_DEF,
      createdBy: 'steven',
      now: NOW,
    };

    const first = await store.createWorkbench({ ...input, id: newId() });
    // Replay with a DIFFERENT freshly-minted id — the unique index must win
    // and hand back the original row, not insert a second workbench.
    const second = await store.createWorkbench({ ...input, id: newId() });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.version).toBe(first.record.version);

    const count = await handle.db.execute<{ n: string }>(sql`
      select count(*) as n from "frank_domain"."workbench"
      where cell_id = ${CELL} and idempotency_key = 'cmd-delegate-replay'
    `);
    expect(count.rows[0]?.n).toBe('1');
  });

  it('rejects a workbench whose work item does not exist (FK integrity)', async () => {
    await expectPgError(
      store.createWorkbench({
        id: newId(),
        cellId: CELL,
        workItemId: newId(),
        idempotencyKey: 'cmd-delegate-dangling',
        taskDef: TASK_DEF,
        createdBy: 'steven',
        now: NOW,
      }),
      /workbench_work_item_id_work_item_id_fk|violates foreign key/,
    );
  });

  it('appends events in durable order and reconstructs a full run snapshot', async () => {
    const workItemId = await seedWorkItem(handle.db);
    const id = newId();
    await store.createWorkbench({
      id,
      cellId: CELL,
      workItemId,
      idempotencyKey: 'cmd-delegate-snapshot',
      taskDef: TASK_DEF,
      createdBy: 'steven',
      now: NOW,
    });

    await store.appendEvent(id, 'workbench_created', { by: 'steven' }, NOW);
    await store.appendEvent(id, 'provisioning_started', {}, new Date(NOW.getTime() + 1000));
    await store.publishPlan(
      id,
      [{ step: 'read notes' }, { step: 'draft bullets' }, { step: 'verify bullets' }],
      NOW,
    );
    await store.appendEvent(id, 'plan_published', { steps: 3 }, NOW);
    await store.updatePlanStep(id, 1, 'done', 'read all notes', NOW);
    await store.appendEvent(id, 'step_updated', { seq: 1, state: 'done' }, NOW);
    await store.registerArtifact(
      id,
      { id: newId(), path: '/workspace/out/bullets.md', kind: 'document' },
      NOW,
    );
    await store.appendEvent(id, 'artifact_registered', { path: '/workspace/out/bullets.md' }, NOW);
    await store.publishReceipt(
      id,
      { summary: 'Five bullets written.', assumptions: ['notes were complete'], evidence: [] },
      'goose',
      NOW,
    );
    await store.appendEvent(id, 'receipt_published', {}, NOW);
    await store.setState(id, 'done', 'runner', NOW, { finishedAt: NOW });
    await store.appendEvent(id, 'completed', {}, NOW);

    const snapshot = await store.getSnapshot(CELL, id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.workbench.state).toBe('done');

    // Durable event order: seq is gap-free and monotonic.
    expect(snapshot?.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(snapshot?.events.map((e) => e.type)).toEqual([
      'workbench_created',
      'provisioning_started',
      'plan_published',
      'step_updated',
      'artifact_registered',
      'receipt_published',
      'completed',
    ]);

    expect(snapshot?.plan).toHaveLength(3);
    expect(snapshot?.plan[0]).toMatchObject({ seq: 1, state: 'done', note: 'read all notes' });
    expect(snapshot?.artifacts).toHaveLength(1);
    expect(snapshot?.receipt?.summary).toBe('Five bullets written.');
  });

  it('enforces the append-only event log at the database level', async () => {
    const workItemId = await seedWorkItem(handle.db);
    const id = newId();
    await store.createWorkbench({
      id,
      cellId: CELL,
      workItemId,
      idempotencyKey: 'cmd-delegate-appendonly',
      taskDef: TASK_DEF,
      createdBy: 'steven',
      now: NOW,
    });
    await store.appendEvent(id, 'workbench_created', {}, NOW);

    await expectPgError(
      handle.db.execute(sql`
        update "frank_domain"."workbench_event"
        set type = 'completed' where workbench_id = ${id}
      `),
      /append[-_ ]only/i,
    );

    await expectPgError(
      handle.db.execute(sql`
        delete from "frank_domain"."workbench_event" where workbench_id = ${id}
      `),
      /append[-_ ]only/i,
    );
  });

  it('rejects plans outside the 3-to-10 step rule (master plan §3.4)', async () => {
    const workItemId = await seedWorkItem(handle.db);
    const id = newId();
    await store.createWorkbench({
      id,
      cellId: CELL,
      workItemId,
      idempotencyKey: 'cmd-delegate-plan-rule',
      taskDef: TASK_DEF,
      createdBy: 'steven',
      now: NOW,
    });

    await expect(
      store.publishPlan(id, [{ step: 'one' }, { step: 'two' }], NOW),
    ).rejects.toThrow(/3 to 10 steps/);
  });

  it('rejects event types outside the fixed §4.2 list at the database level', async () => {
    const workItemId = await seedWorkItem(handle.db);
    const id = newId();
    await store.createWorkbench({
      id,
      cellId: CELL,
      workItemId,
      idempotencyKey: 'cmd-delegate-event-type',
      taskDef: TASK_DEF,
      createdBy: 'steven',
      now: NOW,
    });

    await expectPgError(
      handle.db.execute(sql`
        insert into "frank_domain"."workbench_event" (workbench_id, seq, type, occurred_at)
        values (${id}, 1, 'not_a_real_event', ${NOW})
      `),
      /invalid input value for enum|workbench_event_type/,
    );
  });
});

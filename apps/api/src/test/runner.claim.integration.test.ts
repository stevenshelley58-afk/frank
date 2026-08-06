/**
 * WB-02 claim safety against real PostgreSQL — the test that proves two
 * runners cannot double-execute one workbench.
 *
 * The race under test: N concurrent `claimNext` calls against a single
 * queued row. Exactly one must win; the rest must get null (SKIP LOCKED
 * makes them skip the locked row rather than block, and the
 * `state='queued'` guard on the UPDATE makes even a stale read a no-op).
 *
 * Self-skips with a visible reason when FRANK_TEST_DATABASE_URL is unset
 * (FRANK-§18.1: "no database" must never look like "everything is fine").
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
const NOW = new Date('2026-08-07T08:00:00.000Z');

const TASK_DEF: WorkbenchTaskDef = {
  instruction: 'WB-02 claim test task.',
  mounts: [],
  harness: { adapter: 'goose' },
  skills: [],
  leash: { wallClockSec: 60 },
  network: { egressAllowlist: [] },
};

async function seedWorkbench(
  store: WorkbenchStore,
  db: FrankDatabaseHandle['db'],
  idempotencyKey: string,
): Promise<string> {
  const workItemId = newId();
  await db.execute(sql`
    insert into "frank_domain"."work_item"
      (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
       kind, title, owner_kind, owner_id, policy_ref)
    values (${workItemId}, ${CELL}, ${NOW}, ${NOW}, 'steven', 'steven',
            '{"method":"capture","producer":"test/wb02"}'::jsonb,
            'task', 'runner claim test', 'user', 'steven',
            '{"ref":"autonomous-internal-work","version":"3.2.0"}'::jsonb)
  `);
  const id = newId();
  await store.createWorkbench({
    id,
    cellId: CELL,
    workItemId,
    idempotencyKey,
    taskDef: TASK_DEF,
    createdBy: 'steven',
    now: NOW,
  });
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

  it('exactly one of N concurrent claims wins a single queued workbench', async () => {
    const id = await seedWorkbench(store, handle.db, 'claim-race-1');

    // Five runners race for the same row — the classic double-execute setup.
    const results = await Promise.all([
      store.claimNext(CELL, 'runner-A', NOW),
      store.claimNext(CELL, 'runner-B', NOW),
      store.claimNext(CELL, 'runner-C', NOW),
      store.claimNext(CELL, 'runner-D', NOW),
      store.claimNext(CELL, 'runner-E', NOW),
    ]);

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(id);
    expect(winners[0]?.state).toBe('provisioning');
    expect(winners[0]?.attempts).toBe(1);
    expect(winners[0]?.claimedBy).toMatch(/^runner-[A-E]$/);

    // The row moved exactly once.
    const row = await store.getWorkbench(CELL, id);
    expect(row?.state).toBe('provisioning');
    expect(row?.attempts).toBe(1);
    expect(row?.version).toBe(2);
  });

  it('claims are idempotent across rounds: a claimed row is never claimed again', async () => {
    const id = await seedWorkbench(store, handle.db, 'claim-rounds-1');

    const first = await store.claimNext(CELL, 'runner-A', NOW);
    expect(first?.id).toBe(id);

    // Second round: nothing queued anymore — every runner gets null.
    const secondRound = await Promise.all([
      store.claimNext(CELL, 'runner-A', NOW),
      store.claimNext(CELL, 'runner-B', NOW),
    ]);
    expect(secondRound).toEqual([null, null]);

    // attempts bumped exactly once across all attempts.
    const row = await store.getWorkbench(CELL, id);
    expect(row?.attempts).toBe(1);
  });

  it('claims the oldest queued workbench first (FIFO per cell)', async () => {
    const older = await seedWorkbench(store, handle.db, 'claim-fifo-older');
    const newer = await seedWorkbench(store, handle.db, 'claim-fifo-newer');

    // Backdate the first row so created_at order is unambiguous.
    await handle.db.execute(sql`
      update "frank_domain"."workbench"
      set created_at = ${new Date(NOW.getTime() - 60_000)} where id = ${older}
    `);

    const claimed = await store.claimNext(CELL, 'runner-A', NOW);
    expect(claimed?.id).toBe(older);

    // Next claim takes the newer row — FIFO order holds across rounds.
    const second = await store.claimNext(CELL, 'runner-A', NOW);
    expect(second?.id).toBe(newer);
  });

  it('recovery scan re-queues stale claims and leaves fresh claims alone', async () => {
    const staleId = await seedWorkbench(store, handle.db, 'recover-stale');
    const freshId = await seedWorkbench(store, handle.db, 'recover-fresh');

    await store.claimNext(CELL, 'runner-dead', NOW); // claims staleId (oldest)
    await store.claimNext(CELL, 'runner-alive', NOW); // claims freshId

    // Backdate the first claim so it is stale (11 minutes old).
    await handle.db.execute(sql`
      update "frank_domain"."workbench"
      set claimed_at = ${new Date(NOW.getTime() - 11 * 60_000)} where id = ${staleId}
    `);

    const recovered = await store.recoverStale('runner-recovery', NOW, 10 * 60_000);

    expect(recovered.map((r) => r.id)).toEqual([staleId]);
    const staleRow = await store.getWorkbench(CELL, staleId);
    expect(staleRow?.state).toBe('queued');
    expect(staleRow?.claimedBy).toBeNull();
    expect(staleRow?.lastError).toContain('stale');

    // The fresh claim is untouched.
    const freshRow = await store.getWorkbench(CELL, freshId);
    expect(freshRow?.state).toBe('provisioning');
    expect(freshRow?.claimedBy).toBe('runner-alive');

    // Recovered workbenches are claimable again; attempts survives.
    const reclaimed = await store.claimNext(CELL, 'runner-B', NOW);
    expect(reclaimed?.id).toBe(staleId);
    expect(reclaimed?.attempts).toBe(2);
  });

  it('never claims or recovers terminal workbenches', async () => {
    const id = await seedWorkbench(store, handle.db, 'terminal-never');
    await store.claimNext(CELL, 'runner-A', NOW);
    await store.setState(id, 'done', 'runner-A', NOW, { finishedAt: NOW });

    expect(await store.claimNext(CELL, 'runner-B', NOW)).toBeNull();
    expect(await store.recoverStale('runner-B', new Date(NOW.getTime() + 3600_000), 1000)).toEqual([]);
  });

  it('countByState reports queue depth per cell', async () => {
    await seedWorkbench(store, handle.db, 'count-1');
    await seedWorkbench(store, handle.db, 'count-2');

    expect(await store.countByState(CELL, 'queued')).toBe(2);
    await store.claimNext(CELL, 'runner-A', NOW);
    expect(await store.countByState(CELL, 'queued')).toBe(1);
    expect(await store.countByState(CELL, 'provisioning')).toBe(1);
  });
});

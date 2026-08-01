/**
 * FRANK-§7.3, in the database.
 *
 * REQUIRES A LIVE POSTGRESQL. `src/run-state.test.ts` covers the same rule in
 * pure TypeScript; this file covers the half that only PostgreSQL can enforce,
 * and it deliberately bypasses `RunRepository` for the trigger tests — issuing
 * raw `UPDATE`s exactly as a psql session or a data-fix script would. If the
 * only enforcement were in the repository, every test here would fail.
 *
 * Because `run.work_item_id` is a NOT NULL foreign key onto `work_item`, every
 * fixture needs a work item first. That is a genuine domain constraint (a run
 * is an execution *of* something), not a test artefact.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FrankDatabase } from '../db.js';
import { newId } from '../ids.js';
import { RunRepository } from '../repositories/run.js';
import { IllegalRunTransitionError, legalRunTransitionPairs, RUN_STATES } from '../run-state.js';
import type { RunState } from '../run-state.js';
import {
  CELL,
  OWNER,
  POLICY_REF,
  PROVENANCE,
  SKIP_REASON,
  closeTestDatabase,
  expectDatabaseError,
  openTestDatabase,
  requiresDatabase,
  resetDatabase,
} from './harness.js';

describe.skipIf(requiresDatabase)(`run state machine in PostgreSQL (${SKIP_REASON})`, () => {
  let db: FrankDatabase;
  const runs = new RunRepository();

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  /** Insert a work item, returning its id. Runs reference one via FK. */
  async function seedWorkItem(): Promise<string> {
    const id = newId();
    await db.execute(sql`
      insert into frank_domain.work_item
        (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
         kind, title, state, priority, owner_kind, owner_id, policy_ref, version)
      values
        (${id}::uuid, ${CELL}, now(), now(), 'user/steven', 'user/steven',
         ${JSON.stringify(PROVENANCE)}::jsonb,
         'task', 'seeded', 'active', 'normal', 'user', 'steven',
         ${JSON.stringify(POLICY_REF)}::jsonb, 1)
    `);
    return id;
  }

  /** Insert a run directly in `state`, bypassing the repository. */
  async function seedRun(state: RunState): Promise<string> {
    const workItemId = await seedWorkItem();
    const id = newId();
    await db.execute(sql`
      insert into frank_domain.run
        (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
         state, work_item_id, executor_kind, executor_id, harness, policy_ref, version,
         finished_at)
      values
        (${id}::uuid, ${CELL}, now(), now(), 'user/steven', 'user/steven',
         ${JSON.stringify(PROVENANCE)}::jsonb,
         ${state}::frank_domain.run_state, ${workItemId}::uuid,
         'agent', 'goose-1', 'goose', ${JSON.stringify(POLICY_REF)}::jsonb, 1,
         ${state === 'completed' || state === 'completed_with_recovery' ||
         state === 'partially_completed' || state === 'cancelled'
           ? sql`now()` : sql`null`})
    `);
    return id;
  }

  async function rawTransition(id: string, to: RunState): Promise<void> {
    await db.execute(sql`
      update frank_domain.run
      set state = ${to}::frank_domain.run_state,
          version = version + 1,
          updated_at = now(),
          finished_at = case
            when ${to} in ('completed', 'completed_with_recovery', 'partially_completed', 'cancelled')
            then now() else finished_at end
      where id = ${id}::uuid
    `);
  }

  describe('the seeded transition table', () => {
    it('contains exactly the pairs legalRunTransitionPairs() returns', async () => {
      const rows = await db.execute<{ from_state: string; to_state: string }>(
        sql`select from_state, to_state from frank_domain.run_state_transition order by from_state, to_state`,
      );
      const inDatabase = rows.rows.map((r) => `${r.from_state}->${r.to_state}`).sort();
      const inCode = legalRunTransitionPairs().map(([f, t]) => `${f}->${t}`).sort();
      expect(inDatabase).toEqual(inCode);
    });

    it('rejects a self-transition row, so the table cannot describe a no-op', async () => {
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.run_state_transition (from_state, to_state, label)
          values ('running', 'running', 'nonsense')
        `),
        /run_state_transition_no_self/,
      );
    });
  });

  describe('the trigger rejects illegal transitions issued as raw SQL', () => {
    it('rejects every illegal pair from a non-terminal state', async () => {
      // One representative per source state keeps this fast while still going
      // through the real trigger for each.
      const cases: Array<[RunState, RunState]> = [
        ['received', 'running'],
        ['received', 'completed'],
        ['planned', 'running'],
        ['queued', 'completed'],
        ['running', 'received'],
        ['blocked', 'cancelled'],
        ['reviewing', 'completed'],
        ['ready', 'running'],
        ['promoting', 'completed'],
        ['deployment_failed', 'cancelled'],
        ['failed', 'completed'],
        ['released', 'running'],
      ];

      for (const [from, to] of cases) {
        const id = await seedRun(from);
        await expectDatabaseError(rawTransition(id, to), /illegal run state transition/);
      }
    });

    it('rejects re-opening a terminal run', async () => {
      for (const terminal of ['completed', 'completed_with_recovery', 'partially_completed', 'cancelled'] as const) {
        const id = await seedRun(terminal);
        for (const to of ['running', 'queued', 'received'] as const) {
          await expectDatabaseError(rawTransition(id, to), /illegal run state transition/);
        }
      }
    });

    it('names the offending pair and the run in the error', async () => {
      const id = await seedRun('received');
      await expectDatabaseError(
        rawTransition(id, 'completed'),
        new RegExp(`illegal run state transition received -> completed on run ${id}`),
      );
    });

    it('accepts every legal pair', async () => {
      for (const [from, to] of legalRunTransitionPairs()) {
        const id = await seedRun(from);
        await expect(rawTransition(id, to), `${from} -> ${to}`).resolves.toBeUndefined();

        const after = await db.execute<{ state: string }>(
          sql`select state from frank_domain.run where id = ${id}::uuid`,
        );
        expect(after.rows[0]?.state).toBe(to);
      }
    });

    it('allows an update that does not touch state', async () => {
      const id = await seedRun('running');
      await expect(
        db.execute(sql`update frank_domain.run set harness = 'hermes' where id = ${id}::uuid`),
      ).resolves.toBeDefined();
    });

    it('rejects a state change that does not increment the version (FRANK-§11.1)', async () => {
      const id = await seedRun('running');
      await expectDatabaseError(
        db.execute(sql`
          update frank_domain.run
          set state = 'reviewing'::frank_domain.run_state
          where id = ${id}::uuid
        `),
        /without incrementing version/,
      );
    });
  });

  describe('the history table refuses an illegal pair via its composite foreign key', () => {
    it('rejects an illegal transition row even with the trigger out of the picture', async () => {
      const id = await seedRun('running');
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.run_transition
            (id, cell_id, run_id, seq, from_state, to_state, actor_kind, actor_id,
             occurred_at, correlation_id, resulting_version)
          values
            (${newId()}::uuid, ${CELL}, ${id}::uuid, 1,
             'received'::frank_domain.run_state, 'completed'::frank_domain.run_state,
             'user', 'steven', now(), 'c-1', 2)
        `),
        /run_transition_legal_fk/,
      );
    });

    it('accepts a legal transition row', async () => {
      const id = await seedRun('running');
      await expect(
        db.execute(sql`
          insert into frank_domain.run_transition
            (id, cell_id, run_id, seq, from_state, to_state, actor_kind, actor_id,
             occurred_at, correlation_id, resulting_version)
          values
            (${newId()}::uuid, ${CELL}, ${id}::uuid, 1,
             'running'::frank_domain.run_state, 'reviewing'::frank_domain.run_state,
             'user', 'steven', now(), 'c-1', 2)
        `),
      ).resolves.toBeDefined();
    });

    it('refuses to rewrite or delete history', async () => {
      const id = await seedRun('running');
      const transitionId = newId();
      await db.execute(sql`
        insert into frank_domain.run_transition
          (id, cell_id, run_id, seq, from_state, to_state, actor_kind, actor_id,
           occurred_at, correlation_id, resulting_version)
        values
          (${transitionId}::uuid, ${CELL}, ${id}::uuid, 1,
           'running'::frank_domain.run_state, 'reviewing'::frank_domain.run_state,
           'user', 'steven', now(), 'c-1', 2)
      `);

      await expectDatabaseError(
        db.execute(sql`update frank_domain.run_transition set reason = 'edited' where id = ${transitionId}::uuid`),
        /append-only/,
      );
      await expectDatabaseError(
        db.execute(sql`delete from frank_domain.run_transition where id = ${transitionId}::uuid`),
        /append-only/,
      );
    });
  });

  describe('the repository path', () => {
    async function createRun(state: RunState = 'received'): Promise<string> {
      const workItemId = await seedWorkItem();
      return db.transaction(async (tx) => {
        const row = await runs.create(tx, {
          cellId: CELL,
          workItemId,
          state,
          executorKind: 'agent',
          executorId: 'goose-1',
          harness: 'goose',
          policyRef: POLICY_REF,
          provenance: PROVENANCE,
          actor: OWNER,
          correlationId: 'run-1',
          now: new Date(),
        });
        return row.id;
      });
    }

    it('walks a full lifecycle and records every step', async () => {
      const id = await createRun();
      const path: RunState[] = ['planned', 'queued', 'running', 'reviewing', 'ready', 'completed'];

      for (const to of path) {
        await db.transaction(async (tx) => {
          await runs.transition(tx, {
            runId: id,
            cellId: CELL,
            toState: to,
            actor: OWNER,
            correlationId: 'run-1',
            now: new Date(),
            reason: `moving to ${to}`,
          });
        });
      }

      const history = await runs.history(db, id);
      expect(history.map((h) => `${h.fromState}->${h.toState}`)).toEqual([
        'received->planned',
        'planned->queued',
        'queued->running',
        'running->reviewing',
        'reviewing->ready',
        'ready->completed',
      ]);
      expect(history.map((h) => h.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(history.every((h) => h.auditEntryId !== null)).toBe(true);

      const run = await runs.findById(db, CELL, id);
      expect(run?.state).toBe('completed');
      expect(run?.version).toBe(7);
      expect(run?.finishedAt).not.toBeNull();
      expect(run?.startedAt).not.toBeNull();
    });

    it('records started_at on entering running and finished_at on reaching a terminal state', async () => {
      const id = await createRun();
      await db.transaction((tx) =>
        runs.transition(tx, { runId: id, cellId: CELL, toState: 'planned', actor: OWNER, correlationId: 'r', now: new Date() }),
      );
      await db.transaction((tx) =>
        runs.transition(tx, { runId: id, cellId: CELL, toState: 'queued', actor: OWNER, correlationId: 'r', now: new Date() }),
      );
      await db.transaction((tx) =>
        runs.transition(tx, { runId: id, cellId: CELL, toState: 'running', actor: OWNER, correlationId: 'r', now: new Date() }),
      );

      const running = await runs.findById(db, CELL, id);
      expect(running?.startedAt).not.toBeNull();
      expect(running?.finishedAt).toBeNull();

      await db.transaction((tx) =>
        runs.transition(tx, { runId: id, cellId: CELL, toState: 'reviewing', actor: OWNER, correlationId: 'r', now: new Date() }),
      );
      await db.transaction((tx) =>
        runs.transition(tx, { runId: id, cellId: CELL, toState: 'ready', actor: OWNER, correlationId: 'r', now: new Date() }),
      );
      await db.transaction((tx) =>
        runs.transition(tx, { runId: id, cellId: CELL, toState: 'completed', actor: OWNER, correlationId: 'r', now: new Date() }),
      );

      const done = await runs.findById(db, CELL, id);
      expect(done?.startedAt).not.toBeNull();
      expect(done?.finishedAt).not.toBeNull();
    });

    it('rejects an illegal transition before it reaches the database', async () => {
      const id = await createRun();
      await expect(
        db.transaction((tx) =>
          runs.transition(tx, {
            runId: id,
            cellId: CELL,
            toState: 'completed',
            actor: OWNER,
            correlationId: 'r',
            now: new Date(),
          }),
        ),
      ).rejects.toThrow(IllegalRunTransitionError);

      // And nothing was written.
      expect(await runs.history(db, id)).toHaveLength(0);
      expect((await runs.findById(db, CELL, id))?.state).toBe('received');
    });

    it('enforces optimistic concurrency (FRANK-§12.3 expected_version)', async () => {
      const id = await createRun();
      await db.transaction((tx) =>
        runs.transition(tx, {
          runId: id,
          cellId: CELL,
          expectedVersion: 1,
          toState: 'planned',
          actor: OWNER,
          correlationId: 'r',
          now: new Date(),
        }),
      );

      await expectDatabaseError(
        db.transaction((tx) =>
          runs.transition(tx, {
            runId: id,
            cellId: CELL,
            expectedVersion: 1, // stale
            toState: 'queued',
            actor: OWNER,
            correlationId: 'r',
            now: new Date(),
          }),
        ),
        /modified concurrently: expected version 1, found 2/,
      );
    });

    it('refuses to create a run directly in a terminal state', async () => {
      for (const terminal of ['completed', 'completed_with_recovery', 'partially_completed', 'cancelled'] as const) {
        await expect(createRun(terminal)).rejects.toThrow(/terminal state/);
      }
    });

    it('serializes two concurrent transitions rather than losing one', async () => {
      const id = await createRun();

      // Both transactions target the same row; the `FOR UPDATE` in `transition`
      // makes the second wait, re-read, and fail the state check rather than
      // overwriting the first.
      const first = db.transaction((tx) =>
        runs.transition(tx, {
          runId: id,
          cellId: CELL,
          toState: 'planned',
          actor: OWNER,
          correlationId: 'a',
          now: new Date(),
        }),
      );
      const second = db.transaction((tx) =>
        runs.transition(tx, {
          runId: id,
          cellId: CELL,
          toState: 'clarifying',
          actor: OWNER,
          correlationId: 'b',
          now: new Date(),
        }),
      );

      const outcomes = await Promise.allSettled([first, second]);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      // `received -> planned` and `received -> clarifying` are both legal, but
      // only one can start from `received`; the loser sees the winner's state
      // and rejects.
      expect(fulfilled).toHaveLength(1);

      const history = await runs.history(db, id);
      expect(history).toHaveLength(1);
      expect((await runs.findById(db, CELL, id))?.version).toBe(2);
    });

    it('links a retry run to its predecessor (FRANK-§7.3)', async () => {
      const workItemId = await seedWorkItem();

      const failedRunId = await db.transaction(async (tx) => {
        const row = await runs.create(tx, {
          cellId: CELL,
          workItemId,
          executorKind: 'agent',
          executorId: 'goose-1',
          harness: 'goose',
          policyRef: POLICY_REF,
          provenance: PROVENANCE,
          actor: OWNER,
          correlationId: 'r',
          now: new Date(),
        });
        return row.id;
      });

      // Walk to failed: received -> planned -> queued -> running -> failed
      for (const to of ['planned', 'queued', 'running', 'failed'] as const) {
        await db.transaction((tx) =>
          runs.transition(tx, { runId: failedRunId, cellId: CELL, toState: to, actor: OWNER, correlationId: 'r', now: new Date() }),
        );
      }

      const retryRunId = await db.transaction(async (tx) => {
        const row = await runs.create(tx, {
          cellId: CELL,
          workItemId,
          predecessorRunId: failedRunId,
          state: 'queued',
          executorKind: 'agent',
          executorId: 'goose-2',
          harness: 'goose',
          policyRef: POLICY_REF,
          provenance: PROVENANCE,
          actor: OWNER,
          correlationId: 'r-retry',
          now: new Date(),
        });
        return row.id;
      });

      const retry = await runs.findById(db, CELL, retryRunId);
      expect(retry?.predecessorRunId).toBe(failedRunId);
      expect(retry?.state).toBe('queued');
      expect(retry?.workItemId).toBe(workItemId);
    });
  });

  it('has a PostgreSQL enum containing exactly RUN_STATES, in order', async () => {
    const rows = await db.execute<{ value: string }>(sql`
      select e.enumlabel as value
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where t.typname = 'run_state' and n.nspname = 'frank_domain'
      order by e.enumsortorder
    `);
    expect(rows.rows.map((r) => r.value)).toEqual([...RUN_STATES]);
  });
});

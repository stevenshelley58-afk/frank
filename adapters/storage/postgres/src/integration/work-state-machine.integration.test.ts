/**
 * WORK-004, in the database.
 *
 * REQUIRES A LIVE POSTGRESQL. `src/work-state.test.ts` covers the same rule in
 * pure TypeScript; this file covers the half that only PostgreSQL can enforce,
 * and it deliberately bypasses `WorkItemRepository` for the trigger tests —
 * issuing raw `UPDATE`s exactly as a psql session or a data-fix script would.
 * If the only enforcement were in the repository, every test here would fail.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FrankDatabase } from '../db.js';
import { newId } from '../ids.js';
import { WorkItemRepository } from '../repositories/work.js';
import { IllegalWorkTransitionError } from '../work-state.js';
import { legalTransitionPairs, WORK_STATES } from '../work-state.js';
import type { WorkState } from '../work-state.js';
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

describe.skipIf(requiresDatabase)(`work state machine in PostgreSQL (${SKIP_REASON})`, () => {
  let db: FrankDatabase;
  const work = new WorkItemRepository();

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  /** Insert a work item directly in `state`, bypassing the repository. */
  async function seedItem(state: WorkState): Promise<string> {
    const id = newId();
    await db.execute(sql`
      insert into frank_domain.work_item
        (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
         kind, title, state, priority, owner_kind, owner_id, policy_ref, version, completed_at)
      values
        (${id}::uuid, ${CELL}, now(), now(), 'user/steven', 'user/steven', ${JSON.stringify(PROVENANCE)}::jsonb,
         'task', 'seeded', ${state}::frank_domain.work_state, 'normal', 'user', 'steven',
         ${JSON.stringify(POLICY_REF)}::jsonb, 1, ${state === 'done' ? sql`now()` : sql`null`})
    `);
    return id;
  }

  async function rawTransition(id: string, to: WorkState): Promise<void> {
    await db.execute(sql`
      update frank_domain.work_item
      set state = ${to}::frank_domain.work_state,
          version = version + 1,
          updated_at = now(),
          completed_at = case when ${to} = 'done' then now() else completed_at end
      where id = ${id}::uuid
    `);
  }

  describe('the seeded transition table', () => {
    it('contains exactly the pairs legalTransitionPairs() returns', async () => {
      const rows = await db.execute<{ from_state: string; to_state: string }>(
        sql`select from_state, to_state from frank_domain.work_state_transition order by from_state, to_state`,
      );
      const inDatabase = rows.rows.map((r) => `${r.from_state}->${r.to_state}`).sort();
      const inCode = legalTransitionPairs().map(([f, t]) => `${f}->${t}`).sort();
      expect(inDatabase).toEqual(inCode);
    });

    it('rejects a self-transition row, so the table cannot describe a no-op', async () => {
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.work_state_transition (from_state, to_state, label)
          values ('active', 'active', 'nonsense')
        `),
      /work_state_transition_no_self/,
    );
    });
  });

  describe('the trigger rejects illegal transitions issued as raw SQL', () => {
    it('rejects every illegal pair from a non-terminal state', async () => {
      // One representative per source state keeps this fast while still going
      // through the real trigger for each.
      const cases: Array<[WorkState, WorkState]> = [
        ['inbox', 'done'],
        ['inbox', 'active'],
        ['inbox', 'failed'],
        ['planned', 'done'],
        ['ready', 'done'],
        ['scheduled', 'failed'],
        ['waiting', 'done'],
        ['blocked', 'done'],
        ['active', 'planned'],
        ['reviewing', 'ready'],
        ['failed', 'done'],
        ['failed', 'reviewing'],
      ];

      for (const [from, to] of cases) {
        const id = await seedItem(from);
        await expectDatabaseError(rawTransition(id, to), /illegal work item state transition/);
      }
    });

    it('rejects re-opening a terminal item', async () => {
      for (const terminal of ['done', 'cancelled'] as const) {
        const id = await seedItem(terminal);
        for (const to of ['active', 'ready', 'inbox'] as const) {
          await expectDatabaseError(rawTransition(id, to), /illegal work item state transition/);
        }
      }
    });

    it('names the offending pair and the item in the error', async () => {
      const id = await seedItem('inbox');
      await expectDatabaseError(
        rawTransition(id, 'done'),
        new RegExp(`illegal work item state transition inbox -> done on work_item ${id}`),
      );
    });

    it('accepts every legal pair', async () => {
      for (const [from, to] of legalTransitionPairs()) {
        const id = await seedItem(from);
        await expect(rawTransition(id, to), `${from} -> ${to}`).resolves.toBeUndefined();

        const after = await db.execute<{ state: string }>(
          sql`select state from frank_domain.work_item where id = ${id}::uuid`,
        );
        expect(after.rows[0]?.state).toBe(to);
      }
    });

    it('allows an update that does not touch state', async () => {
      const id = await seedItem('active');
      await expect(
        db.execute(sql`update frank_domain.work_item set title = 'renamed' where id = ${id}::uuid`),
      ).resolves.toBeDefined();
    });

    it('rejects a state change that does not increment the version (FRANK-§11.1)', async () => {
      const id = await seedItem('active');
      await expectDatabaseError(
        db.execute(sql`
          update frank_domain.work_item
          set state = 'reviewing'::frank_domain.work_state
          where id = ${id}::uuid
        `),
      /without incrementing version/,
    );
    });
  });

  describe('the history table refuses an illegal pair via its composite foreign key', () => {
    it('rejects an illegal transition row even with the trigger out of the picture', async () => {
      const id = await seedItem('active');
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.work_item_transition
            (id, cell_id, work_item_id, seq, from_state, to_state, actor_kind, actor_id,
             occurred_at, correlation_id, resulting_version)
          values
            (${newId()}::uuid, ${CELL}, ${id}::uuid, 1,
             'inbox'::frank_domain.work_state, 'done'::frank_domain.work_state,
             'user', 'steven', now(), 'c-1', 2)
        `),
      /work_item_transition_legal_fk/,
    );
    });

    it('accepts a legal transition row', async () => {
      const id = await seedItem('active');
      await expect(
        db.execute(sql`
          insert into frank_domain.work_item_transition
            (id, cell_id, work_item_id, seq, from_state, to_state, actor_kind, actor_id,
             occurred_at, correlation_id, resulting_version)
          values
            (${newId()}::uuid, ${CELL}, ${id}::uuid, 1,
             'active'::frank_domain.work_state, 'done'::frank_domain.work_state,
             'user', 'steven', now(), 'c-1', 2)
        `),
      ).resolves.toBeDefined();
    });

    it('refuses to rewrite or delete history', async () => {
      const id = await seedItem('active');
      const transitionId = newId();
      await db.execute(sql`
        insert into frank_domain.work_item_transition
          (id, cell_id, work_item_id, seq, from_state, to_state, actor_kind, actor_id,
           occurred_at, correlation_id, resulting_version)
        values
          (${transitionId}::uuid, ${CELL}, ${id}::uuid, 1,
           'active'::frank_domain.work_state, 'reviewing'::frank_domain.work_state,
           'user', 'steven', now(), 'c-1', 2)
      `);

      await expectDatabaseError(
        db.execute(sql`update frank_domain.work_item_transition set reason = 'edited' where id = ${transitionId}::uuid`),
      /append-only/,
    );
      await expectDatabaseError(
        db.execute(sql`delete from frank_domain.work_item_transition where id = ${transitionId}::uuid`),
      /append-only/,
    );
    });
  });

  describe('the repository path', () => {
    async function createItem(state: WorkState = 'inbox'): Promise<string> {
      return db.transaction(async (tx) => {
        const row = await work.create(tx, {
          cellId: CELL,
          kind: 'task',
          title: 'Ship the canonical data model',
          state,
          ownerKind: OWNER.kind,
          ownerId: OWNER.id,
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
      const id = await createItem();
      const path: WorkState[] = ['ready', 'active', 'reviewing', 'done'];

      for (const to of path) {
        await db.transaction(async (tx) => {
          await work.transition(tx, {
            workItemId: id,
            cellId: CELL,
            toState: to,
            actor: OWNER,
            correlationId: 'run-1',
            now: new Date(),
            reason: `moving to ${to}`,
          });
        });
      }

      const history = await work.history(db, id);
      expect(history.map((h) => `${h.fromState}->${h.toState}`)).toEqual([
        'inbox->ready',
        'ready->active',
        'active->reviewing',
        'reviewing->done',
      ]);
      expect(history.map((h) => h.seq)).toEqual([1, 2, 3, 4]);
      expect(history.every((h) => h.auditEntryId !== null)).toBe(true);

      const item = await work.findById(db, CELL, id);
      expect(item?.state).toBe('done');
      expect(item?.version).toBe(5);
      expect(item?.completedAt).not.toBeNull();
      expect(item?.startedAt).not.toBeNull();
    });

    it('accepts WORK-004 spelling and stores the FRANK-§11.3 value', async () => {
      const id = await createItem();
      await db.transaction((tx) =>
        work.transition(tx, {
          workItemId: id,
          cellId: CELL,
          toState: 'ready',
          actor: OWNER,
          correlationId: 'r',
          now: new Date(),
        }),
      );
      await db.transaction((tx) =>
        work.transition(tx, {
          workItemId: id,
          cellId: CELL,
          toState: 'active',
          actor: OWNER,
          correlationId: 'r',
          now: new Date(),
        }),
      );
      const result = await db.transaction((tx) =>
        work.transition(tx, {
          workItemId: id,
          cellId: CELL,
          toState: 'completed', // WORK-004 spelling
          actor: OWNER,
          correlationId: 'r',
          now: new Date(),
        }),
      );

      expect(result.toState).toBe('done');
      expect((await work.findById(db, CELL, id))?.state).toBe('done');
    });

    it('rejects an illegal transition before it reaches the database', async () => {
      const id = await createItem();
      await expect(
        db.transaction((tx) =>
          work.transition(tx, {
            workItemId: id,
            cellId: CELL,
            toState: 'done',
            actor: OWNER,
            correlationId: 'r',
            now: new Date(),
          }),
        ),
      ).rejects.toThrow(IllegalWorkTransitionError);

      // And nothing was written.
      expect(await work.history(db, id)).toHaveLength(0);
      expect((await work.findById(db, CELL, id))?.state).toBe('inbox');
    });

    it('enforces optimistic concurrency (FRANK-§12.3 expected_version)', async () => {
      const id = await createItem();
      await db.transaction((tx) =>
        work.transition(tx, {
          workItemId: id,
          cellId: CELL,
          expectedVersion: 1,
          toState: 'ready',
          actor: OWNER,
          correlationId: 'r',
          now: new Date(),
        }),
      );

      await expectDatabaseError(
        db.transaction((tx) =>
          work.transition(tx, {
            workItemId: id,
            cellId: CELL,
            expectedVersion: 1, // stale
            toState: 'active',
            actor: OWNER,
            correlationId: 'r',
            now: new Date(),
          }),
        ),
      /modified concurrently: expected version 1, found 2/,
    );
    });

    it('refuses to create an item directly in a terminal state', async () => {
      await expectDatabaseError(createItem('done'), /terminal state/);
      await expectDatabaseError(createItem('cancelled'), /terminal state/);
    });

    it('serializes two concurrent transitions rather than losing one', async () => {
      const id = await createItem();

      // Both transactions target the same row; the `FOR UPDATE` in `transition`
      // makes the second wait, re-read `ready`, and fail the state check rather
      // than overwriting the first.
      const first = db.transaction((tx) =>
        work.transition(tx, {
          workItemId: id,
          cellId: CELL,
          toState: 'ready',
          actor: OWNER,
          correlationId: 'a',
          now: new Date(),
        }),
      );
      const second = db.transaction((tx) =>
        work.transition(tx, {
          workItemId: id,
          cellId: CELL,
          toState: 'planned',
          actor: OWNER,
          correlationId: 'b',
          now: new Date(),
        }),
      );

      const outcomes = await Promise.allSettled([first, second]);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      // `inbox -> ready` and `inbox -> planned` are both legal, but only one can
      // start from `inbox`; the loser sees `ready` (or `planned`) and rejects.
      expect(fulfilled).toHaveLength(1);

      const history = await work.history(db, id);
      expect(history).toHaveLength(1);
      expect((await work.findById(db, CELL, id))?.version).toBe(2);
    });

    it('delegates without changing the item identity (WORK-003)', async () => {
      const id = await createItem();
      const before = await work.findById(db, CELL, id);

      await db.transaction((tx) =>
        work.assign(tx, {
          workItemId: id,
          cellId: CELL,
          assignee: { kind: 'agent_team', id: 'team/builders' },
          actor: OWNER,
          correlationId: 'r',
          now: new Date(),
        }),
      );

      const after = await work.findById(db, CELL, id);
      expect(after?.id).toBe(before?.id);
      expect(after?.version).toBe(before?.version);
      expect(after?.state).toBe(before?.state);
    });
  });

  it('has a PostgreSQL enum containing exactly WORK_STATES, in order', async () => {
    const rows = await db.execute<{ value: string }>(sql`
      select e.enumlabel as value
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where t.typname = 'work_state' and n.nspname = 'frank_domain'
      order by e.enumsortorder
    `);
    expect(rows.rows.map((r) => r.value)).toEqual([...WORK_STATES]);
  });
});

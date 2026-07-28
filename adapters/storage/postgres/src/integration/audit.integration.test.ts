/**
 * FRANK-§11.5 in the database: append-only, hash-linked, serialized per cell.
 *
 * REQUIRES A LIVE POSTGRESQL. `src/audit-chain.test.ts` attacks the hash
 * construction without one; what is here can only be shown against a real
 * server — that `UPDATE` and `DELETE` raise, that `TRUNCATE` raises, that
 * concurrent appends do not collide, and that a tampered row fails verification
 * read back from disk.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GENESIS_CHAIN_HASH } from '../audit-chain.js';
import type { FrankDatabase } from '../db.js';
import { AuditRepository } from '../repositories/audit.js';
import { auditEntry } from '../schema/audit.js';
import {
  CELL,
  SKIP_REASON,
  closeTestDatabase,
  expectDatabaseError,
  openTestDatabase,
  requiresDatabase,
  resetDatabase,
} from './harness.js';

describe.skipIf(requiresDatabase)(`audit log in PostgreSQL (${SKIP_REASON})`, () => {
  let db: FrankDatabase;
  const audit = new AuditRepository();

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  const now = new Date('2026-07-28T12:00:00.000Z');

  async function append(action: string, cellId = CELL) {
    return db.transaction((tx) =>
      audit.append(tx, {
        cellId,
        occurredAt: now,
        actorKind: 'user',
        actorId: 'steven',
        action,
        targetKind: 'work_item',
        targetId: '01920000-0000-7000-8000-000000000001',
        correlationId: 'run-1',
        policyVersion: 'autonomous-internal-work@3.2.0',
        policyDecision: 'allow',
      }),
    );
  }

  describe('the chain', () => {
    it('starts from genesis and links every entry', async () => {
      const first = await append('work.created');
      expect(first.seq).toBe(1n);

      const rows = await db.select().from(auditEntry).where(eq(auditEntry.cellId, CELL));
      expect(rows[0]?.prevChainHash).toBe(GENESIS_CHAIN_HASH);

      const second = await append('work.state_changed');
      expect(second.seq).toBe(2n);

      expect((await audit.verify(db, { cellId: CELL })).ok).toBe(true);
    });

    it('is gapless across many appends', async () => {
      for (let i = 0; i < 25; i += 1) await append(`action.${i}`);

      const rows = await audit.read(db, { cellId: CELL });
      expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 25 }, (_, i) => BigInt(i + 1)));
      expect(await audit.count(db, CELL)).toBe(25);
      expect((await audit.head(db, CELL))?.seq).toBe(25n);
    });

    it('leaves no gap when a transaction rolls back', async () => {
      await append('first');

      await expect(
        db.transaction(async (tx) => {
          await audit.append(tx, {
            cellId: CELL,
            occurredAt: now,
            actorKind: 'user',
            actorId: 'steven',
            action: 'will.roll.back',
            targetKind: 'work_item',
            targetId: 'x',
            correlationId: 'run-1',
          });
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');

      const next = await append('second');
      // A sequence generator would have burned number 2 here, leaving a gap a
      // verifier could not distinguish from a deleted entry.
      expect(next.seq).toBe(2n);
      expect((await audit.verify(db, { cellId: CELL })).ok).toBe(true);
    });

    it('keeps a separate chain per cell (FRANK-§2.4)', async () => {
      await append('a', CELL);
      await append('b', CELL);
      const other = await append('a', 'cell-customer-a');

      expect(other.seq).toBe(1n);
      expect((await audit.head(db, CELL))?.seq).toBe(2n);
      expect((await audit.verify(db, { cellId: CELL })).ok).toBe(true);
      expect((await audit.verify(db, { cellId: 'cell-customer-a' })).ok).toBe(true);
    });

    it('serializes concurrent appends into one linear chain', async () => {
      const appends = Array.from({ length: 12 }, (_, i) => append(`concurrent.${i}`));
      const results = await Promise.all(appends);

      const sequences = results.map((r) => r.seq).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(sequences).toEqual(Array.from({ length: 12 }, (_, i) => BigInt(i + 1)));
      expect(new Set(results.map((r) => r.chainHash)).size).toBe(12);
      expect((await audit.verify(db, { cellId: CELL })).ok).toBe(true);
    });

    it('verifies a suffix against the preceding chain hash', async () => {
      for (let i = 0; i < 10; i += 1) await append(`a.${i}`);
      const rows = await audit.read(db, { cellId: CELL });

      const result = await audit.verify(db, {
        cellId: CELL,
        fromSeq: 6n,
        startingChainHash: rows[4]!.chainHash,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('append-only enforcement', () => {
    it('refuses UPDATE', async () => {
      await append('work.created');
      await expectDatabaseError(
        db.execute(sql`update frank_domain.audit_entry set action = 'rewritten'`),
      /append-only/,
    );
    });

    it('refuses DELETE', async () => {
      await append('work.created');
      await expectDatabaseError(db.execute(sql`delete from frank_domain.audit_entry`), /append-only/);
    });

    it('refuses TRUNCATE, which would bypass a row-level trigger', async () => {
      await append('work.created');
      await expectDatabaseError(db.execute(sql`truncate table frank_domain.audit_entry`), /append-only/);
    });

    it('refuses to move the chain head backwards', async () => {
      await append('a');
      await append('b');
      await expectDatabaseError(
        db.execute(sql`update frank_domain.audit_chain_head set seq = 1 where cell_id = ${CELL}`),
      /may not move backwards/,
    );
    });

    it('refuses a duplicate sequence number in a cell', async () => {
      const first = await append('a');
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.audit_entry
            (id, cell_id, seq, occurred_at, recorded_at, actor_kind, actor_id, action,
             target_kind, target_id, correlation_id, data_class, entry_hash, prev_chain_hash, chain_hash)
          values
            (gen_random_uuid(), ${CELL}, ${first.seq.toString()}::bigint, now(), now(), 'user', 'steven',
             'forged', 'work_item', 'x', 'c', 'internal', 'sha256:00', 'sha256:00', 'sha256:01')
        `),
      /audit_entry_seq_uidx/,
    );
    });
  });

  describe('tamper detection reading back from disk', () => {
    /**
     * The append-only trigger makes an in-place edit impossible for an ordinary
     * caller, which is the point of it. To prove the *chain* also detects
     * tampering, the trigger has to be stepped around the way a compromised
     * superuser would — that is the threat FRANK-§11.5's hash link and signed
     * external root exist for.
     */
    async function tamper(statement: ReturnType<typeof sql>): Promise<void> {
      await db.execute(sql`set session_replication_role = 'replica'`);
      try {
        await db.execute(statement);
      } finally {
        await db.execute(sql`set session_replication_role = 'origin'`);
      }
    }

    it('detects an edited action', async () => {
      for (let i = 0; i < 5; i += 1) await append(`a.${i}`);
      await tamper(sql`update frank_domain.audit_entry set action = 'rewritten' where seq = 3`);

      const result = await audit.verify(db, { cellId: CELL });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure).toBe('entry_hash_mismatch');
        expect(result.atSeq).toBe(3n);
      }
    });

    it('detects an edited policy decision, which is what an attacker would change', async () => {
      for (let i = 0; i < 3; i += 1) await append(`a.${i}`);
      await tamper(sql`update frank_domain.audit_entry set policy_decision = 'deny' where seq = 2`);

      const result = await audit.verify(db, { cellId: CELL });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure).toBe('entry_hash_mismatch');
    });

    it('detects a deleted entry', async () => {
      for (let i = 0; i < 5; i += 1) await append(`a.${i}`);
      await tamper(sql`delete from frank_domain.audit_entry where seq = 3`);

      const result = await audit.verify(db, { cellId: CELL });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure).toBe('sequence_gap');
    });

    it('detects a rewritten chain hash', async () => {
      for (let i = 0; i < 5; i += 1) await append(`a.${i}`);
      await tamper(
        sql`update frank_domain.audit_entry set chain_hash = ${`sha256:${'ee'.repeat(32)}`} where seq = 4`,
      );

      const result = await audit.verify(db, { cellId: CELL });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure).toBe('chain_hash_mismatch');
    });

    it('reports the head hash of a clean chain, which is what gets signed and exported', async () => {
      for (let i = 0; i < 5; i += 1) await append(`a.${i}`);
      const result = await audit.verify(db, { cellId: CELL });
      const head = await audit.head(db, CELL);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.headChainHash).toBe(head?.chainHash);
    });
  });

  describe('what the audit log does not hold (FRANK-§11.5)', () => {
    it('has no column that could carry a payload copy', async () => {
      const columns = await db.execute<{ column_name: string }>(sql`
        select column_name from information_schema.columns
        where table_schema = 'frank_domain' and table_name = 'audit_entry'
      `);
      const names = columns.rows.map((r) => r.column_name);
      for (const forbidden of ['payload', 'body', 'content', 'plaintext', 'raw']) {
        expect(names).not.toContain(forbidden);
      }
    });

    it('records a bounded redacted change rather than values', async () => {
      const appended = await db.transaction((tx) =>
        audit.append(tx, {
          cellId: CELL,
          occurredAt: now,
          actorKind: 'agent',
          actorId: 'agent/builder',
          delegatedActorKind: 'user',
          delegatedActorId: 'steven',
          action: 'work.state_changed',
          targetKind: 'work_item',
          targetId: 'x',
          correlationId: 'run-1',
          changeRedacted: { field: 'state', from: 'active', to: 'done' },
          dataClass: 'internal',
        }),
      );

      const rows = await db.select().from(auditEntry).where(eq(auditEntry.id, appended.id));
      expect(rows[0]?.changeRedacted).toEqual({ field: 'state', from: 'active', to: 'done' });
      expect(rows[0]?.delegatedActorId).toBe('steven');
      expect(rows[0]?.actorId).toBe('agent/builder');
    });
  });
});

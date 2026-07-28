/**
 * ADR-004: "Domain mutations and outbox entries commit in one PostgreSQL
 * transaction." FRANK-§11.5: "The domain mutation, invocation intent, canonical
 * audit entry, and outbox event commit in one PostgreSQL transaction or none of
 * them do."
 *
 * REQUIRES A LIVE POSTGRESQL. Atomicity is the database's property; a fake that
 * "rolls back" an in-memory array proves nothing about it.
 *
 * The type system already prevents the most common way to break this — every
 * write method takes a `FrankTransaction`, and a `FrankDatabase` is not
 * assignable to one, so `outbox.enqueue(db, …)` does not compile. What is tested
 * here is the runtime half: that a failure anywhere in the unit of work leaves
 * *nothing* behind.
 */

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FrankDatabase } from '../db.js';
import { EVENT_TYPES, buildEventEnvelope, eventSource } from '../events.js';
import { newId } from '../ids.js';
import { CaptureService } from '../repositories/capture.js';
import { OutboxRepository } from '../repositories/outbox.js';
import { WorkItemRepository } from '../repositories/work.js';
import { auditEntry } from '../schema/audit.js';
import { outboxEvent } from '../schema/outbox.js';
import { workItem, workItemTransition } from '../schema/work.js';
import {
  CELL,
  OWNER,
  POLICY_REF,
  PROVENANCE,
  RETENTION_POLICY,
  RIGHTS_POLICY,
  SKIP_REASON,
  closeTestDatabase,
  expectDatabaseError,
  openTestDatabase,
  requiresDatabase,
  resetDatabase,
} from './harness.js';

describe.skipIf(requiresDatabase)(`transactional outbox (${SKIP_REASON})`, () => {
  let db: FrankDatabase;
  const outbox = new OutboxRepository();
  const work = new WorkItemRepository();
  const capture = new CaptureService();

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

  async function count(table: 'work_item' | 'outbox_event' | 'audit_entry' | 'source'): Promise<number> {
    const rows = await db.execute<{ n: string }>(
      sql.raw(`select count(*)::text as n from frank_domain.${table}`),
    );
    return Number(rows.rows[0]?.n ?? 0);
  }

  function envelope(aggregateId: string) {
    return buildEventEnvelope({
      type: EVENT_TYPES.workStateChanged,
      source: eventSource('work', aggregateId),
      cellId: CELL,
      actorId: 'user/steven',
      correlationId: 'run-1',
      classification: 'internal',
      occurredAt: now,
      data: { workItemId: aggregateId },
    });
  }

  describe('a rolled-back domain change leaves no outbox row', () => {
    it('rolls back the event when the domain write fails afterwards', async () => {
      const id = newId();

      await expect(
        db.transaction(async (tx) => {
          await work.create(tx, {
            id,
            cellId: CELL,
            kind: 'task',
            title: 'will not survive',
            ownerKind: OWNER.kind,
            ownerId: OWNER.id,
            policyRef: POLICY_REF,
            provenance: PROVENANCE,
            actor: OWNER,
            correlationId: 'run-1',
            now,
          });

          // Anything at all going wrong after the outbox write.
          throw new Error('downstream validation failed');
        }),
      ).rejects.toThrow('downstream validation failed');

      expect(await count('work_item')).toBe(0);
      expect(await count('outbox_event')).toBe(0);
      expect(await count('audit_entry')).toBe(0);
    });

    it('rolls back the domain change when the outbox write fails', async () => {
      const id = newId();
      const duplicated = envelope(id);

      await expect(
        db.transaction(async (tx) => {
          await work.create(tx, {
            id,
            cellId: CELL,
            kind: 'task',
            title: 'will not survive either',
            ownerKind: OWNER.kind,
            ownerId: OWNER.id,
            policyRef: POLICY_REF,
            provenance: PROVENANCE,
            actor: OWNER,
            correlationId: 'run-1',
            now,
          });

          // Same envelope id twice: a primary key violation inside the unit of work.
          await outbox.enqueue(tx, duplicated, {
            aggregateKind: 'work_item',
            aggregateId: id,
            createdAt: now,
          });
          await outbox.enqueue(tx, duplicated, {
            aggregateKind: 'work_item',
            aggregateId: id,
            createdAt: now,
          });
        }),
      ).rejects.toThrow();

      expect(await count('work_item')).toBe(0);
      expect(await count('outbox_event')).toBe(0);
      expect(await count('audit_entry')).toBe(0);
    });

    it('rolls back everything when a database constraint rejects the mutation', async () => {
      const id = newId();

      await expectDatabaseError(
        db.transaction(async (tx) => {
          await work.create(tx, {
            id,
            cellId: CELL,
            kind: 'task',
            title: 'constraint violator',
            ownerKind: OWNER.kind,
            ownerId: OWNER.id,
            policyRef: POLICY_REF,
            provenance: PROVENANCE,
            actor: OWNER,
            correlationId: 'run-1',
            now,
          });
          // FRANK-§11.1: a zoned timestamp needs its zone; the check constraint
          // fires inside the transaction.
          await tx
            .update(workItem)
            .set({ dueAt: now, dueTimezone: null })
            .where(eq(workItem.id, id));
        }),
      /work_item_due_zone_paired/,
    );

      expect(await count('work_item')).toBe(0);
      expect(await count('outbox_event')).toBe(0);
    });

    it('rolls back a whole capture, leaving no source, item, audit entry, or event', async () => {
      await expect(
        db.transaction(async (tx) => {
          await capture.captureInTransaction(tx, {
            cellId: CELL,
            requestIdempotencyKey: 'req-rollback',
            kind: 'url',
            contentHash: `sha256:${'cd'.repeat(32)}`,
            rawArtifactUri: 's3://frank/cd.bin',
            rawArtifactSha256: `sha256:${'cd'.repeat(32)}`,
            capturedBy: OWNER,
            capturedAt: now,
            dataClass: 'private',
            trust: 'external-untrusted',
            rightsPolicy: RIGHTS_POLICY,
            retentionPolicy: RETENTION_POLICY,
            provenance: PROVENANCE,
            channel: 'api',
            correlationId: 'run-1',
            policyRef: POLICY_REF,
            now,
          });
          throw new Error('object store write failed after the database work');
        }),
      ).rejects.toThrow('object store write failed');

      expect(await count('source')).toBe(0);
      expect(await count('work_item')).toBe(0);
      expect(await count('audit_entry')).toBe(0);
      expect(await count('outbox_event')).toBe(0);

      // And the idempotency key is free again, so the retry is a first capture.
      const retry = await capture.capture(db, {
        cellId: CELL,
        requestIdempotencyKey: 'req-rollback',
        kind: 'url',
        contentHash: `sha256:${'cd'.repeat(32)}`,
        rawArtifactUri: 's3://frank/cd.bin',
        rawArtifactSha256: `sha256:${'cd'.repeat(32)}`,
        capturedBy: OWNER,
        capturedAt: now,
        dataClass: 'private',
        trust: 'external-untrusted',
        rightsPolicy: RIGHTS_POLICY,
        retentionPolicy: RETENTION_POLICY,
        provenance: PROVENANCE,
        channel: 'api',
        correlationId: 'run-1',
        policyRef: POLICY_REF,
        now,
      });
      expect(retry.replayed).toBe(false);
    });

    it('rolls back a failed transition, leaving no history row and no event', async () => {
      const created = await db.transaction((tx) =>
        work.create(tx, {
          cellId: CELL,
          kind: 'task',
          title: 'transition rollback',
          ownerKind: OWNER.kind,
          ownerId: OWNER.id,
          policyRef: POLICY_REF,
          provenance: PROVENANCE,
          actor: OWNER,
          correlationId: 'run-1',
          now,
        }),
      );

      const outboxBefore = await count('outbox_event');
      const auditBefore = await count('audit_entry');

      await expect(
        db.transaction(async (tx) => {
          await work.transition(tx, {
            workItemId: created.id,
            cellId: CELL,
            toState: 'ready',
            actor: OWNER,
            correlationId: 'run-1',
            now,
          });
          throw new Error('notification dispatch failed');
        }),
      ).rejects.toThrow('notification dispatch failed');

      expect(await count('outbox_event')).toBe(outboxBefore);
      expect(await count('audit_entry')).toBe(auditBefore);
      expect(
        await db.select().from(workItemTransition).where(eq(workItemTransition.workItemId, created.id)),
      ).toHaveLength(0);
      expect((await work.findById(db, CELL, created.id))?.state).toBe('inbox');
    });
  });

  describe('a committed domain change always has its outbox row', () => {
    it('commits the mutation, the audit entry, and the event together', async () => {
      const created = await db.transaction((tx) =>
        work.create(tx, {
          cellId: CELL,
          kind: 'task',
          title: 'survives',
          ownerKind: OWNER.kind,
          ownerId: OWNER.id,
          policyRef: POLICY_REF,
          provenance: PROVENANCE,
          actor: OWNER,
          correlationId: 'run-1',
          now,
        }),
      );

      expect(await count('work_item')).toBe(1);
      expect(await count('outbox_event')).toBe(1);
      expect(await count('audit_entry')).toBe(1);

      const events = await db
        .select()
        .from(outboxEvent)
        .where(eq(outboxEvent.aggregateId, created.id));
      expect(events[0]?.type).toBe('frank.work.created.v1');

      const entries = await db.select().from(auditEntry).where(eq(auditEntry.targetId, created.id));
      expect(entries[0]?.action).toBe('work.created');
    });

    it('emits a distinct type for blocked and completed, per FRANK-§12.5', async () => {
      const created = await db.transaction((tx) =>
        work.create(tx, {
          cellId: CELL,
          kind: 'task',
          title: 'families',
          ownerKind: OWNER.kind,
          ownerId: OWNER.id,
          policyRef: POLICY_REF,
          provenance: PROVENANCE,
          actor: OWNER,
          correlationId: 'run-1',
          now,
        }),
      );

      for (const to of ['ready', 'blocked', 'active', 'reviewing', 'done'] as const) {
        await db.transaction((tx) =>
          work.transition(tx, {
            workItemId: created.id,
            cellId: CELL,
            toState: to,
            actor: OWNER,
            correlationId: 'run-1',
            now: new Date(),
          }),
        );
      }

      const types = (
        await db.select().from(outboxEvent).where(eq(outboxEvent.aggregateId, created.id))
      ).map((row) => row.type);

      expect(types).toContain('frank.work.created.v1');
      expect(types).toContain('frank.work.blocked.v1');
      expect(types).toContain('frank.work.completed.v1');
      expect(types.filter((t) => t === 'frank.work.state_changed.v1')).toHaveLength(3);
    });
  });

  describe('publisher protocol (FRANK-§12.4)', () => {
    async function seedEvents(n: number): Promise<void> {
      await db.transaction(async (tx) => {
        for (let i = 0; i < n; i += 1) {
          await outbox.enqueue(tx, envelope(newId()), {
            aggregateKind: 'work_item',
            aggregateId: newId(),
            createdAt: now,
          });
        }
      });
    }

    it('claims a batch, marks it published, and does not re-claim it', async () => {
      await seedEvents(5);

      const claimed = await outbox.claimBatch(db, { cellId: CELL, limit: 3, now: new Date() });
      expect(claimed).toHaveLength(3);
      expect(claimed.every((row) => row.status === 'publishing')).toBe(true);
      expect(claimed.every((row) => row.attempts === 1)).toBe(true);

      const again = await outbox.claimBatch(db, { cellId: CELL, limit: 10, now: new Date() });
      expect(again).toHaveLength(2);

      await outbox.markPublished(db, claimed.map((r) => r.id), new Date());
      expect(await outbox.counts(db, CELL)).toMatchObject({ published: 3, publishing: 2, pending: 0 });
    });

    it('claims in sequence order, so per-aggregate ordering is preservable', async () => {
      await seedEvents(6);
      const claimed = await outbox.claimBatch(db, { cellId: CELL, limit: 6, now: new Date() });
      const sequences = claimed.map((r) => r.sequence);
      expect([...sequences].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(sequences);
    });

    it('does not claim an event that is not yet available', async () => {
      const future = new Date(now.getTime() + 60_000);
      await db.transaction((tx) =>
        outbox.enqueue(tx, envelope(newId()), {
          aggregateKind: 'work_item',
          aggregateId: newId(),
          createdAt: now,
          availableAt: future,
        }),
      );

      expect(await outbox.claimBatch(db, { cellId: CELL, limit: 10, now })).toHaveLength(0);
      expect(
        await outbox.claimBatch(db, { cellId: CELL, limit: 10, now: new Date(future.getTime() + 1) }),
      ).toHaveLength(1);
    });

    it('quarantines a failing event and replays it on demand', async () => {
      await seedEvents(1);
      const [claimed] = await outbox.claimBatch(db, { cellId: CELL, limit: 1, now: new Date() });

      await outbox.quarantine(db, { id: claimed!.id, error: 'transport refused', at: new Date() });
      expect(await outbox.counts(db, CELL)).toMatchObject({ quarantined: 1 });
      expect(await outbox.claimBatch(db, { cellId: CELL, limit: 10, now: new Date() })).toHaveLength(0);

      const replayed = await outbox.replayQuarantined(db, { cellId: CELL, availableAt: new Date() });
      expect(replayed).toEqual([claimed!.id]);
      expect(await outbox.counts(db, CELL)).toMatchObject({ quarantined: 0, pending: 1 });
    });

    it('does not deliver another cell an event (FRANK-§2.4)', async () => {
      await seedEvents(3);
      expect(await outbox.claimBatch(db, { cellId: 'cell-other', limit: 10, now: new Date() })).toHaveLength(0);
    });

    it('rejects a second event with the same idempotency key in a cell', async () => {
      const shared = { ...envelope(newId()), idempotencykey: 'side-effect-1' };
      await db.transaction((tx) =>
        outbox.enqueue(tx, shared, { aggregateKind: 'work_item', aggregateId: 'a', createdAt: now }),
      );

      await expectDatabaseError(
        db.transaction((tx) =>
          outbox.enqueue(
            tx,
            { ...shared, id: newId() },
            { aggregateKind: 'work_item', aggregateId: 'b', createdAt: now },
          ),
        ),
      /outbox_event_idempotency_uidx/,
    );
    });

    it('can be asked to ignore a duplicate idempotency key instead', async () => {
      const shared = { ...envelope(newId()), idempotencykey: 'side-effect-2' };
      await db.transaction((tx) =>
        outbox.enqueue(tx, shared, { aggregateKind: 'work_item', aggregateId: 'a', createdAt: now }),
      );

      await expect(
        db.transaction((tx) =>
          outbox.enqueue(
            tx,
            { ...shared, id: newId() },
            {
              aggregateKind: 'work_item',
              aggregateId: 'b',
              createdAt: now,
              ignoreDuplicateIdempotencyKey: true,
            },
          ),
        ),
      ).resolves.toBeDefined();

      expect(await count('outbox_event')).toBe(1);
      expect(await outbox.findByIdempotencyKey(db, CELL, 'side-effect-2')).toBeDefined();
    });

    it('re-hydrates stored rows into FRANK-§6.7 envelopes', async () => {
      await seedEvents(2);
      const rows = await outbox.claimBatch(db, { cellId: CELL, limit: 2, now: new Date() });
      const envelopes = outbox.toEnvelopes(rows);

      expect(envelopes).toHaveLength(2);
      for (const e of envelopes) {
        expect(e.specversion).toBe('1.0');
        expect(e.datacontenttype).toBe('application/json');
        expect(e.cellid).toBe(CELL);
        expect(e.dataschema).toMatch(/^schema:\/\/frank\..+\/v1$/);
      }
    });
  });
});

/**
 * The Slice 1 exit gate: **replaying the same capture produces one source and
 * one work item.**
 *
 * REQUIRES A LIVE POSTGRESQL. The key derivation is covered without a database
 * in `src/capture-key.test.ts`; the guarantee itself is a property of two unique
 * indexes and `ON CONFLICT DO NOTHING` under concurrency, which is not something
 * a fake can demonstrate.
 */

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FrankDatabase } from '../db.js';
import { CaptureService } from '../repositories/capture.js';
import type { CaptureInput } from '../repositories/capture.js';
import { captureEvent, source, sourceVersion } from '../schema/source.js';
import { outboxEvent } from '../schema/outbox.js';
import { workItem, workItemSourceRef } from '../schema/work.js';
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

describe.skipIf(requiresDatabase)(`idempotent capture (${SKIP_REASON})`, () => {
  let db: FrankDatabase;
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

  function input(overrides: Partial<CaptureInput> = {}): CaptureInput {
    return {
      cellId: CELL,
      requestIdempotencyKey: 'req-001',
      kind: 'url',
      contentHash: `sha256:${'ab'.repeat(32)}`,
      rawArtifactUri: 's3://frank-cell-steven/sources/ab.bin',
      rawArtifactSha256: `sha256:${'ab'.repeat(32)}`,
      originUri: 'https://example.com/article',
      capturedBy: OWNER,
      capturedAt: now,
      dataClass: 'private',
      trust: 'external-untrusted',
      rightsPolicy: RIGHTS_POLICY,
      retentionPolicy: RETENTION_POLICY,
      provenance: PROVENANCE,
      channel: 'extension',
      correlationId: 'run-capture-1',
      policyRef: POLICY_REF,
      triageTitle: 'Triage captured article',
      now,
      ...overrides,
    };
  }

  async function counts() {
    const [sources, items, versions, events, outbox] = await Promise.all([
      db.select({ n: sql<string>`count(*)` }).from(source),
      db.select({ n: sql<string>`count(*)` }).from(workItem),
      db.select({ n: sql<string>`count(*)` }).from(sourceVersion),
      db.select({ n: sql<string>`count(*)` }).from(captureEvent),
      db.select({ n: sql<string>`count(*)` }).from(outboxEvent),
    ]);
    return {
      sources: Number(sources[0]?.n ?? 0),
      workItems: Number(items[0]?.n ?? 0),
      sourceVersions: Number(versions[0]?.n ?? 0),
      captureEvents: Number(events[0]?.n ?? 0),
      outboxEvents: Number(outbox[0]?.n ?? 0),
    };
  }

  describe('first capture', () => {
    it('creates one source, one version, one triage item, and its events', async () => {
      const result = await capture.capture(db, input());

      expect(result.replayed).toBe(false);
      expect(result.sourceId).toBeTruthy();
      expect(result.workItemId).toBeTruthy();
      expect(result.eventIds).toHaveLength(2);

      expect(await counts()).toEqual({
        sources: 1,
        workItems: 1,
        sourceVersions: 1,
        captureEvents: 1,
        // source.captured + capture.accepted + work.created
        outboxEvents: 3,
      });
    });

    it('links the work item back to the source as its origin', async () => {
      const result = await capture.capture(db, input());
      const links = await db
        .select()
        .from(workItemSourceRef)
        .where(eq(workItemSourceRef.sourceId, result.sourceId));

      expect(links).toHaveLength(1);
      expect(links[0]?.workItemId).toBe(result.workItemId);
      expect(links[0]?.relation).toBe('origin');
    });

    it('records classification and trust as separate axes (FRANK-§2.3)', async () => {
      const result = await capture.capture(db, input({ dataClass: 'sensitive' }));
      const rows = await db.select().from(source).where(eq(source.id, result.sourceId));
      expect(rows[0]?.dataClass).toBe('sensitive');
      expect(rows[0]?.trust).toBe('external-untrusted');
    });

    it('stores the payload by reference, never inline (ADR-003)', async () => {
      const result = await capture.capture(db, input());
      const rows = await db.select().from(source).where(eq(source.id, result.sourceId));
      expect(rows[0]?.rawArtifactUri).toBe('s3://frank-cell-steven/sources/ab.bin');
      expect(Object.keys(rows[0] ?? {})).not.toContain('content');
      expect(Object.keys(rows[0] ?? {})).not.toContain('body');
    });
  });

  describe('replay of the same request', () => {
    it('returns the original ids and creates nothing new', async () => {
      const first = await capture.capture(db, input());
      const before = await counts();

      const second = await capture.capture(db, input());

      expect(second.replayed).toBe(true);
      expect(second.replayReason).toBe('request');
      expect(second.sourceId).toBe(first.sourceId);
      expect(second.workItemId).toBe(first.workItemId);
      expect(await counts()).toEqual(before);
    });

    it('emits no events on replay, so consumers do not act twice', async () => {
      await capture.capture(db, input());
      const before = await counts();

      for (let i = 0; i < 5; i += 1) {
        const replay = await capture.capture(db, input());
        expect(replay.eventIds).toEqual([]);
      }

      expect((await counts()).outboxEvents).toBe(before.outboxEvents);
    });

    it('still records that a retry happened', async () => {
      await capture.capture(db, input());
      await capture.capture(db, input());
      await capture.capture(db, input());

      const rows = await db
        .select()
        .from(captureEvent)
        .where(eq(captureEvent.requestIdempotencyKey, 'req-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.replayCount).toBe(2);
    });

    it('is stable over ten replays', async () => {
      const first = await capture.capture(db, input());
      for (let i = 0; i < 10; i += 1) {
        const replay = await capture.capture(db, input());
        expect(replay.sourceId).toBe(first.sourceId);
        expect(replay.workItemId).toBe(first.workItemId);
      }
      expect(await counts()).toMatchObject({ sources: 1, workItems: 1, outboxEvents: 3 });
    });
  });

  describe('replay of the same content under a different request', () => {
    it('reuses the source and the work item and creates neither again', async () => {
      const first = await capture.capture(db, input({ requestIdempotencyKey: 'req-001' }));
      const second = await capture.capture(db, input({ requestIdempotencyKey: 'req-002' }));

      expect(second.replayed).toBe(true);
      expect(second.replayReason).toBe('content');
      expect(second.sourceId).toBe(first.sourceId);
      expect(second.workItemId).toBe(first.workItemId);

      expect(await counts()).toMatchObject({
        sources: 1,
        workItems: 1,
        sourceVersions: 1,
        // Both requests are in the capture ledger; only one produced a source.
        captureEvents: 2,
        outboxEvents: 3,
      });
    });

    it('treats the same bytes from a different origin as a different source', async () => {
      await capture.capture(db, input({ requestIdempotencyKey: 'req-001' }));
      const other = await capture.capture(
        db,
        input({ requestIdempotencyKey: 'req-002', originUri: 'https://elsewhere.example/x' }),
      );

      expect(other.replayed).toBe(false);
      expect(await counts()).toMatchObject({ sources: 2, workItems: 2 });
    });

    it('never merges captures across cells (FRANK-§2.4)', async () => {
      await capture.capture(db, input({ cellId: CELL }));
      const otherCell = await capture.capture(
        db,
        input({ cellId: 'cell-customer-a', requestIdempotencyKey: 'req-001' }),
      );

      expect(otherCell.replayed).toBe(false);
      expect(await counts()).toMatchObject({ sources: 2 });
    });
  });

  describe('concurrent replay', () => {
    it('produces exactly one source and one work item when eight captures race', async () => {
      // The read-then-write version of this passes when run serially and fails
      // here. `ON CONFLICT DO NOTHING RETURNING` is what makes it hold.
      const attempts = Array.from({ length: 8 }, (_, i) =>
        capture.capture(db, input({ requestIdempotencyKey: `req-race-${i}` })),
      );

      const results = await Promise.all(attempts);
      const sourceIds = new Set(results.map((r) => r.sourceId));
      const workItemIds = new Set(results.map((r) => r.workItemId));

      expect(sourceIds.size).toBe(1);
      expect(workItemIds.size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);

      expect(await counts()).toMatchObject({
        sources: 1,
        workItems: 1,
        sourceVersions: 1,
        captureEvents: 8,
        outboxEvents: 3,
      });
    });

    it('produces one source when the same request races with itself', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => capture.capture(db, input())),
      );

      // A concurrent duplicate of the *same* request key may lose the unique
      // index race and be rejected; what must never happen is two sources.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(await counts()).toMatchObject({ sources: 1, workItems: 1 });
    });
  });

  describe('the database backstop', () => {
    it('has a unique index on (cell_id, capture_idempotency_key)', async () => {
      const first = await capture.capture(db, input());
      const rows = await db.select().from(source).where(eq(source.id, first.sourceId));
      const existing = rows[0]!;

      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.source
            (id, cell_id, created_at, updated_at, created_by, updated_by, provenance, kind,
             captured_by_kind, captured_by_id, captured_at, observed_at, data_class, trust,
             rights_policy, retention_policy, content_hash, capture_idempotency_key,
             raw_artifact_uri, raw_artifact_sha256)
          values
            (gen_random_uuid(), ${CELL}, now(), now(), 'user/steven', 'user/steven',
             '{}'::jsonb, 'url', 'user', 'steven', now(), now(), 'private', 'external-untrusted',
             '{}'::jsonb, '{}'::jsonb, ${existing.contentHash}, ${existing.captureIdempotencyKey},
             's3://x', 'sha256:00')
        `),
      /source_capture_idem_uidx/,
    );
    });

    it('has a unique index on (cell_id, request_idempotency_key)', async () => {
      const first = await capture.capture(db, input());
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.capture_event
            (id, cell_id, request_idempotency_key, source_id, channel, accepted_at,
             captured_by_kind, captured_by_id, correlation_id)
          values
            (gen_random_uuid(), ${CELL}, 'req-001', ${first.sourceId}::uuid, 'api', now(),
             'user', 'steven', 'c')
        `),
      /capture_event_request_uidx/,
    );
    });

    it('refuses to rewrite an immutable capture fact (FRANK-§11.3)', async () => {
      const first = await capture.capture(db, input());
      await expectDatabaseError(
        db
          .update(source)
          .set({ capturedAt: new Date('2020-01-01T00:00:00Z') })
          .where(eq(source.id, first.sourceId)),
      /capture facts are immutable/,
    );
    });

    it('refuses to change the content hash outside the deletion workflow', async () => {
      const first = await capture.capture(db, input());
      await expectDatabaseError(
        db
          .update(source)
          .set({ contentHash: `sha256:${'ff'.repeat(32)}` })
          .where(eq(source.id, first.sourceId)),
      /only change through the deletion workflow/,
    );
    });

    it('allows the content hash to change when the source is being erased', async () => {
      const first = await capture.capture(db, input());
      await expect(
        db
          .update(source)
          .set({ lifecycle: 'tombstoned', contentHash: 'sha256:erased' })
          .where(eq(source.id, first.sourceId)),
      ).resolves.toBeDefined();
    });

    it('refuses to edit or delete a source version', async () => {
      const first = await capture.capture(db, input());
      await expectDatabaseError(
        db.execute(sql`update frank_domain.source_version set reason = 'edited' where source_id = ${first.sourceId}::uuid`),
      /append-only/,
    );
      await expectDatabaseError(
        db.execute(sql`delete from frank_domain.source_version where source_id = ${first.sourceId}::uuid`),
      /append-only/,
    );
    });
  });

  describe('backfill mode', () => {
    it('creates a source without a triage item when asked', async () => {
      const result = await capture.capture(db, input({ createTriageItem: false }));
      expect(result.workItemId).toBeNull();
      expect(await counts()).toMatchObject({ sources: 1, workItems: 0, outboxEvents: 2 });
    });

    it('is still idempotent in that mode', async () => {
      await capture.capture(db, input({ createTriageItem: false }));
      const replay = await capture.capture(
        db,
        input({ createTriageItem: false, requestIdempotencyKey: 'req-002' }),
      );
      expect(replay.replayed).toBe(true);
      expect(await counts()).toMatchObject({ sources: 1, workItems: 0 });
    });
  });

  it('carries a §6.7-shaped envelope into the outbox for the capture', async () => {
    const result = await capture.capture(db, input());
    const rows = await db
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.cellId, CELL), eq(outboxEvent.type, 'frank.source.captured.v1')));

    expect(rows).toHaveLength(1);
    const event = rows[0]!;
    expect(event.source).toBe(`frank://source/${result.sourceId}`);
    expect(event.dataschema).toBe('schema://frank.source.captured/v1');
    expect(event.classification).toBe('private');
    expect(event.correlationId).toBe('run-capture-1');
    expect(event.status).toBe('pending');
    expect(event.data).toMatchObject({ sourceId: result.sourceId, kind: 'url' });
    // FRANK-§12.4: referenced by URI, not inlined.
    expect(JSON.stringify(event.data)).toContain('s3://');
  });
});

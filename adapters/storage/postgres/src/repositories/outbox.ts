/**
 * Transactional outbox repository — ADR-004, FRANK-§12.4.
 *
 * `enqueue` takes a {@link FrankTransaction}. That is the entire enforcement
 * mechanism for "the outbox row is written in the same transaction as the domain
 * change": there is no overload that accepts a pool handle, so the only way to
 * call it is from inside a transaction someone else opened for the domain
 * mutation.
 *
 * The publisher methods (`claimBatch`, `markPublished`, `quarantine`, `replay`)
 * take a database handle instead, because publication is a separate concern
 * running on its own schedule — that asymmetry is the point.
 */

import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { EventEnvelope } from '@frank/contracts';

import type { FrankDatabase, FrankTransaction } from '../db.js';
import { envelopeToOutboxRow, outboxRowToEnvelope } from '../events.js';
import type { OutboxRowOptions } from '../events.js';
import { outboxEvent } from '../schema/outbox.js';
import type { OutboxEventRow } from '../schema/outbox.js';

export interface EnqueueOptions extends OutboxRowOptions {
  /**
   * When true, an event whose `idempotencykey` already exists in the cell is
   * silently dropped instead of raising a unique violation. Off by default: a
   * duplicate side-effecting event is usually a bug worth surfacing, and
   * FRANK-§13.5 wants the *invocation* ledger to deduplicate, not the outbox.
   */
  readonly ignoreDuplicateIdempotencyKey?: boolean;
}

export class OutboxRepository {
  /**
   * Write one event into the outbox, inside the caller's transaction.
   *
   * @returns the envelope id, which is also the row's primary key.
   */
  async enqueue(
    tx: FrankTransaction,
    envelope: EventEnvelope,
    options: EnqueueOptions,
  ): Promise<string> {
    const row = envelopeToOutboxRow(envelope, options);

    if (options.ignoreDuplicateIdempotencyKey === true) {
      const inserted = await tx
        .insert(outboxEvent)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: outboxEvent.id });
      return inserted[0]?.id ?? envelope.id;
    }

    await tx.insert(outboxEvent).values(row);
    return envelope.id;
  }

  /** Write several events atomically with the caller's domain change. */
  async enqueueAll(
    tx: FrankTransaction,
    events: ReadonlyArray<{ envelope: EventEnvelope; options: EnqueueOptions }>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const event of events) {
      ids.push(await this.enqueue(tx, event.envelope, event.options));
    }
    return ids;
  }

  /**
   * Claim a batch for publication.
   *
   * `FOR UPDATE SKIP LOCKED` lets several publisher processes share the backlog
   * without coordination and without one slow event blocking the queue. The
   * claim moves rows to `publishing` in the same statement, so a publisher that
   * dies mid-batch leaves rows in a state a sweeper can identify by age rather
   * than in `pending` where a second publisher would re-claim them immediately.
   */
  async claimBatch(
    db: FrankDatabase,
    input: { cellId: string; limit: number; now: Date },
  ): Promise<OutboxEventRow[]> {
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.cellId, input.cellId),
            eq(outboxEvent.status, 'pending'),
            lte(outboxEvent.availableAt, input.now),
          ),
        )
        .orderBy(asc(outboxEvent.sequence))
        .limit(input.limit)
        .for('update', { skipLocked: true });

      const ids = candidates.map((row) => row.id);
      if (ids.length === 0) return [];

      return tx
        .update(outboxEvent)
        .set({ status: 'publishing', attempts: sql`${outboxEvent.attempts} + 1` })
        .where(inArray(outboxEvent.id, ids))
        .returning();
    });
  }

  async markPublished(db: FrankDatabase, ids: readonly string[], publishedAt: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const updated = await db
      .update(outboxEvent)
      .set({ status: 'published', publishedAt, lastError: null })
      .where(inArray(outboxEvent.id, [...ids]))
      .returning({ id: outboxEvent.id });
    return updated.length;
  }

  /**
   * FRANK-§12.4: "Failed events enter a visible quarantine with replay
   * controls." Quarantine is a terminal-until-a-human-acts state, not another
   * retry: an event that has failed its retry budget and keeps being retried is
   * an outage that looks like normal operation.
   */
  async quarantine(
    db: FrankDatabase,
    input: { id: string; error: string; at: Date },
  ): Promise<void> {
    await db
      .update(outboxEvent)
      .set({ status: 'quarantined', lastError: input.error, quarantinedAt: input.at })
      .where(eq(outboxEvent.id, input.id));
  }

  /** The replay control for the above. Returns the events moved back to `pending`. */
  async replayQuarantined(
    db: FrankDatabase,
    input: { cellId: string; ids?: readonly string[]; availableAt: Date },
  ): Promise<string[]> {
    const conditions = [eq(outboxEvent.cellId, input.cellId), eq(outboxEvent.status, 'quarantined')];
    if (input.ids !== undefined) conditions.push(inArray(outboxEvent.id, [...input.ids]));

    const updated = await db
      .update(outboxEvent)
      .set({
        status: 'pending',
        availableAt: input.availableAt,
        attempts: 0,
        lastError: null,
        quarantinedAt: null,
      })
      .where(and(...conditions))
      .returning({ id: outboxEvent.id });

    return updated.map((row) => row.id);
  }

  /** Re-hydrate stored rows into FRANK-§6.7 envelopes for the transport adapter. */
  toEnvelopes(rows: readonly OutboxEventRow[]): EventEnvelope[] {
    return rows.map(outboxRowToEnvelope);
  }

  /** Backlog counters for FRANK-§19.2 telemetry and the quarantine screen. */
  async counts(
    db: FrankDatabase,
    cellId: string,
  ): Promise<Record<'pending' | 'publishing' | 'published' | 'quarantined', number>> {
    const rows = await db
      .select({ status: outboxEvent.status, count: sql<string>`count(*)` })
      .from(outboxEvent)
      .where(eq(outboxEvent.cellId, cellId))
      .groupBy(outboxEvent.status);

    const counts = { pending: 0, publishing: 0, published: 0, quarantined: 0 };
    for (const row of rows) counts[row.status] = Number(row.count);
    return counts;
  }

  /** Events already emitted for an idempotency key — FRANK-§13.5 replay safety. */
  async findByIdempotencyKey(
    db: FrankDatabase,
    cellId: string,
    idempotencyKey: string,
  ): Promise<OutboxEventRow | undefined> {
    const rows = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.cellId, cellId),
          isNotNull(outboxEvent.idempotencyKey),
          eq(outboxEvent.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  }
}

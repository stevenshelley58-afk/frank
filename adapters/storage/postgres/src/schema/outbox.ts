/**
 * Transactional outbox and consumer inbox — ADR-004, FRANK-§12.4, FRANK-§6.7.
 *
 * ADR-004: "Domain mutations and outbox entries commit in one PostgreSQL
 * transaction." FRANK-§6.7: "A transaction writes domain state and the outbox
 * event together."
 *
 * ## Shape
 *
 * Every FRANK-§6.7 `EventEnvelope` context attribute is a real column, not a key
 * inside `data`. That costs a little width and buys three things a JSONB blob
 * cannot: the publisher can filter by `type` and `classification` without
 * deserializing, `classification` can be constrained to the FRANK-§2.3 enum so
 * an unclassified event is impossible to insert, and FRANK-§12.4's "Personal
 * payloads are minimized" becomes checkable — `data` is the only column that can
 * hold payload, so a reviewer has exactly one place to look.
 *
 * The envelope's `id` *is* the primary key. An outbox row and its event are the
 * same thing; giving the row a second identity would let a redelivery look like
 * a new event.
 *
 * ## Publisher protocol
 *
 * `status` moves `pending -> publishing -> published`, or into `quarantined`
 * (FRANK-§12.4: "Failed events enter a visible quarantine with replay
 * controls"). `available_at` supports backoff. `attempts` and `last_error` make
 * a stuck event legible without reading the publisher's logs.
 *
 * `published_at` is set by the publisher, never by the domain transaction: at
 * commit time, publication has not happened.
 *
 * ## Ordering
 *
 * `aggregate_kind` / `aggregate_id` exist so a publisher can preserve per-
 * aggregate order while publishing different aggregates concurrently.
 * FRANK-§12.4 requires each event family to declare an "ordering assumption";
 * global ordering is not one of them, and pretending otherwise would serialize
 * the whole publisher on the busiest aggregate.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { dataClassEnum, domain } from './shared.js';

export const OUTBOX_STATUSES = ['pending', 'publishing', 'published', 'quarantined'] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const outboxStatusEnum = domain.enum('outbox_status', OUTBOX_STATUSES);

export const outboxEvent = domain.table(
  'outbox_event',
  {
    /** FRANK-§6.7 `id`. The envelope id and the row id are one value. */
    id: uuid('id').primaryKey(),

    /**
     * Monotonic insertion order within the cell, assigned by a sequence. Unlike
     * `audit_entry.seq`, gaps here are harmless: this number is not hashed and
     * the publisher only needs it to sweep forward.
     */
    sequence: bigint('sequence', { mode: 'bigint' })
      .notNull()
      .generatedAlwaysAsIdentity(),

    /* ---- FRANK-§6.7 envelope, attribute for attribute --------------------- */
    specversion: text('specversion').notNull().default('1.0'),
    type: text('type').notNull(),
    source: text('source').notNull(),
    time: timestamp('time', { withTimezone: true, mode: 'date' }).notNull(),
    subject: text('subject'),
    dataschema: text('dataschema').notNull(),
    datacontenttype: text('datacontenttype').notNull().default('application/json'),
    /** FRANK-§2.4: an event belongs to exactly one cell. */
    cellId: text('cellid').notNull(),
    actorId: text('actorid').notNull(),
    correlationId: text('correlationid').notNull(),
    causationId: text('causationid'),
    classification: dataClassEnum('classification').notNull(),
    /** FRANK-§13.5: required for events that drive an external side effect. */
    idempotencyKey: text('idempotencykey'),
    /** FRANK-§12.4: minimized. Large or sensitive data is referenced by URI. */
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),

    /* ---- publisher bookkeeping -------------------------------------------- */
    aggregateKind: text('aggregate_kind').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastError: text('last_error'),
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true, mode: 'date' }),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    // The publisher's sweep. Partial so the index stays the size of the backlog
    // rather than the size of history.
    index('outbox_event_pending_idx')
      .on(t.cellId, t.availableAt, t.sequence)
      .where(sql`${t.status} in ('pending', 'publishing')`),
    index('outbox_event_aggregate_idx').on(t.cellId, t.aggregateKind, t.aggregateId, t.sequence),
    index('outbox_event_type_idx').on(t.cellId, t.type, t.time),
    index('outbox_event_quarantine_idx')
      .on(t.cellId, t.quarantinedAt)
      .where(sql`${t.status} = 'quarantined'`),
    // FRANK-§13.5: a side-effecting event is emitted once per idempotency key.
    uniqueIndex('outbox_event_idempotency_uidx')
      .on(t.cellId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

/**
 * FRANK-§12.4: "Consumers use inbox tables and idempotency keys."
 *
 * One row per (consumer, event). The primary key *is* the deduplication: a
 * consumer inserts before handling and a duplicate delivery hits a unique
 * violation, which is the whole mechanism. Handlers must therefore insert inside
 * the same transaction as their effect, exactly as producers do for the outbox.
 */
export const inboxEvent = domain.table(
  'inbox_event',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    cellId: text('cell_id').notNull(),
    eventType: text('event_type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    /** `received` | `processed` | `failed` | `quarantined`. */
    status: text('status').notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('inbox_event_pk').on(t.consumer, t.eventId),
    index('inbox_event_unprocessed_idx')
      .on(t.cellId, t.consumer, t.receivedAt)
      .where(sql`${t.processedAt} is null`),
  ],
);

export type OutboxEventRow = typeof outboxEvent.$inferSelect;
export type NewOutboxEventRow = typeof outboxEvent.$inferInsert;

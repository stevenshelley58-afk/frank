/**
 * Source context — FRANK-§11.2 ("Source, SourceVersion, Segment, CaptureEvent,
 * RightsPolicy, RetentionPolicy"), FRANK-§11.3 (`SourceEnvelope`), FRANK-§10.2
 * (canonical source and assertion model), ADR-003, ADR-019.
 *
 * This is the **source side only**. FRANK-§10.2's `Assertion`, `Entity`,
 * `Relationship`, `Contradiction` and the embedding/graph projections are Slice 3
 * and are deliberately absent — a half-built assertion table would be a schema
 * that Slice 3 has to migrate rather than fill.
 *
 * ## Immutability
 *
 * FRANK-§11.3: "`SourceEnvelope` content is logically immutable while retained;
 * privacy deletion may physically erase content and leave a non-content
 * tombstone stating what policy was applied."
 *
 * So: `source_version` rows are append-only (enforced by a trigger in migration
 * `0001`), the payload itself never lives in PostgreSQL (ADR-003 — object
 * storage owns blobs, referenced by hash), and erasure is modelled as a
 * `source_tombstone` row plus a lifecycle change rather than a `DELETE`.
 *
 * ## Content addressing
 *
 * `content_hash` is the SHA-256 of the raw captured bytes. It is what makes
 * capture replay-safe: two captures of the same bytes from the same origin
 * produce the same `capture_idempotency_key`, and the unique index on that key
 * is what turns "the client retried" into "one source, one work item" rather
 * than two. See `src/capture-key.ts` for the key derivation and
 * `src/repositories/capture.ts` for the insert.
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

import type { VersionedRef } from './shared.js';
import {
  actorKindEnum,
  dataClassEnum,
  domain,
  durableRecordColumns,
  externalRecordColumns,
  trustLabelEnum,
} from './shared.js';

/**
 * FRANK-§4.1 UX-003: "Universal capture must accept text, voice, images,
 * documents, URLs, and forwarded content", plus the connector-fed kinds from
 * FRANK-§4.7/§4.8.
 */
export const SOURCE_KINDS = [
  'text',
  'voice',
  'image',
  'document',
  'url',
  'email',
  'calendar_event',
  'message',
  'x_bookmark',
  'youtube_video',
  'transcript',
  'code',
  'receipt',
  'statement',
  'forwarded',
  'other',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const sourceKindEnum = domain.enum('source_kind', SOURCE_KINDS);

/** FRANK-§11.3 `SourceEnvelope.lifecycle`, verbatim. */
export const SOURCE_LIFECYCLES = [
  'active',
  'unavailable',
  'tombstoned',
  'deletion_pending',
  'deleted',
] as const;

export type SourceLifecycle = (typeof SOURCE_LIFECYCLES)[number];

export const sourceLifecycleEnum = domain.enum('source_lifecycle', SOURCE_LIFECYCLES);

/**
 * The immutable capture envelope. One row per logical source; content lives in
 * `source_version` and, in bytes, in object storage.
 */
export const source = domain.table(
  'source',
  {
    /** UUIDv7 minted at the domain boundary (FRANK-§11.1). No column default. */
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    kind: sourceKindEnum('kind').notNull(),

    /** FRANK-§11.3 `originUri`. Where the bytes came from, when there is a URI. */
    originUri: text('origin_uri'),

    /**
     * Who wrote the content, as opposed to who captured it. JSONB rather than a
     * child table because authors are read with the source in every query and
     * are never queried independently in Slice 1.
     */
    authorRefs: jsonb('author_refs').$type<Array<{ kind: string; id: string }>>().notNull().default(sql`'[]'::jsonb`),

    capturedByKind: actorKindEnum('captured_by_kind').notNull(),
    capturedById: text('captured_by_id').notNull(),

    /**
     * FRANK-§11.3 distinguishes three times and so does this table:
     *   `captured_at`        — when FRANK took custody;
     *   `source_created_at`  — when the origin says the content was created;
     *   `observed_at`        — when FRANK last saw the origin in this state.
     * Collapsing them is how "this email is from 2019" becomes "this email
     * arrived in 2026".
     */
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull(),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true, mode: 'date' }),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** FRANK-§2.3. Two independent axes; both mandatory, neither defaulted. */
    dataClass: dataClassEnum('data_class').notNull(),
    trust: trustLabelEnum('trust').notNull(),

    /** FRANK-§11.3 `rightsPolicyRef` / `retentionPolicyRef` (FRANK-§16.8). */
    rightsPolicy: jsonb('rights_policy').$type<VersionedRef>().notNull(),
    retentionPolicy: jsonb('retention_policy').$type<VersionedRef>().notNull(),

    /** SHA-256 of the raw captured bytes, `sha256:`-prefixed (FRANK-§6.8). */
    contentHash: text('content_hash').notNull(),

    /**
     * Deterministic function of the capture inputs; the unique index below is
     * the Slice 1 exit gate "replaying the same capture produces one source and
     * one work item".
     */
    captureIdempotencyKey: text('capture_idempotency_key').notNull(),

    /** ADR-003: blobs live in object storage and are referenced, never inlined. */
    rawArtifactUri: text('raw_artifact_uri').notNull(),
    rawArtifactSha256: text('raw_artifact_sha256').notNull(),
    rawArtifactBytes: bigint('raw_artifact_bytes', { mode: 'bigint' }),
    mediaType: text('media_type'),

    currentVersionId: uuid('current_version_id'),

    lifecycle: sourceLifecycleEnum('lifecycle').notNull().default('active'),

    /** FRANK-§11.1 optimistic concurrency. */
    version: integer('version').notNull().default(1),

    ...externalRecordColumns(),
  },
  (t) => [
    uniqueIndex('source_capture_idem_uidx').on(t.cellId, t.captureIdempotencyKey),
    index('source_content_hash_idx').on(t.cellId, t.contentHash),
    index('source_kind_captured_idx').on(t.cellId, t.kind, t.capturedAt),
    index('source_lifecycle_idx').on(t.cellId, t.lifecycle),
    // An external record is unique per (provider, account, external id) when it
    // has one; partial so locally-captured sources are not forced to invent ids.
    uniqueIndex('source_external_uidx')
      .on(t.cellId, t.externalProviderId, t.externalAccountId, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

/**
 * FRANK-§10.2 `Source -> Source Version`. Append-only; a correction is a new
 * version, never an update.
 */
export const sourceVersion = domain.table(
  'source_version',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'restrict' }),
    /** Monotonic per source, starting at 1. */
    versionNo: integer('version_no').notNull(),
    contentHash: text('content_hash').notNull(),
    rawArtifactUri: text('raw_artifact_uri').notNull(),
    rawArtifactSha256: text('raw_artifact_sha256').notNull(),
    rawArtifactBytes: bigint('raw_artifact_bytes', { mode: 'bigint' }),
    mediaType: text('media_type'),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull(),
    recordedBy: text('recorded_by').notNull(),
    /** Why this version exists: `initial`, `origin_changed`, `re_fetch`, `correction`. */
    reason: text('reason').notNull(),
  },
  (t) => [
    uniqueIndex('source_version_no_uidx').on(t.sourceId, t.versionNo),
    index('source_version_hash_idx').on(t.cellId, t.contentHash),
  ],
);

/**
 * FRANK-§11.2 `CaptureEvent`. The capture ledger: one row per accepted capture
 * attempt, carrying the request-supplied idempotency key (FRANK-§12.1:
 * "Idempotency keys on all action endpoints").
 *
 * Distinct from `source.capture_idempotency_key`, which is derived from the
 * *content*. Both exist because they answer different questions:
 *
 *   * the client sent the same request twice  -> `request_idempotency_key`;
 *   * two different requests carried the same bytes from the same origin
 *     -> `source.capture_idempotency_key`.
 *
 * A replay must be idempotent under either.
 */
export const captureEvent = domain.table(
  'capture_event',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    /** Client-supplied (FRANK-§12.3 `command_id`); unique per cell. */
    requestIdempotencyKey: text('request_idempotency_key').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'restrict' }),
    /** The triage item created by this capture, if any (UX-003). */
    workItemId: uuid('work_item_id'),
    channel: text('channel').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }).notNull(),
    capturedByKind: actorKindEnum('captured_by_kind').notNull(),
    capturedById: text('captured_by_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    /** True when this row was returned to a replay rather than created by it. */
    replayCount: integer('replay_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('capture_event_request_uidx').on(t.cellId, t.requestIdempotencyKey),
    index('capture_event_source_idx').on(t.sourceId),
  ],
);

/**
 * FRANK-§11.3: "privacy deletion may physically erase content and leave a
 * non-content tombstone stating what policy was applied."
 *
 * The tombstone records *what was applied*, never *what was erased*. There is no
 * content column here and there must never be one, or deletion becomes a
 * relocation.
 */
export const sourceTombstone = domain.table(
  'source_tombstone',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'restrict' }),
    /** `retention_expiry` | `owner_erasure` | `rights_withdrawal` | `legal_hold_release`. */
    reason: text('reason').notNull(),
    policyRef: jsonb('policy_ref').$type<VersionedRef>().notNull(),
    /** Hash of what was erased, so a restore can be verified without keeping it. */
    erasedContentHash: text('erased_content_hash').notNull(),
    /** FRANK-§15.7: "Deletion produces a manifest of canonical deletion and projection retraction." */
    deletionManifestUri: text('deletion_manifest_uri'),
    erasedAt: timestamp('erased_at', { withTimezone: true, mode: 'date' }).notNull(),
    erasedBy: text('erased_by').notNull(),
  },
  (t) => [uniqueIndex('source_tombstone_source_uidx').on(t.sourceId)],
);

export type SourceRow = typeof source.$inferSelect;
export type NewSourceRow = typeof source.$inferInsert;
export type SourceVersionRow = typeof sourceVersion.$inferSelect;
export type CaptureEventRow = typeof captureEvent.$inferSelect;

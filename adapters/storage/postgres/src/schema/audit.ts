/**
 * Audit context — FRANK-§11.5, FRANK-§11.2 ("AuditEntry, ChainHead, Export,
 * Verification").
 *
 * FRANK-§11.5 is unusually specific, so the mapping is spelled out rather than
 * summarized. It says the canonical audit log is append-only and hash-linked and
 * records:
 *
 *   authenticated actor and delegated actor  -> `actor_*`, `delegated_actor_*`
 *   action, target, time, cell, correlation,
 *     and causation                          -> `action`, `target_*`, `occurred_at`,
 *                                               `cell_id`, `correlation_id`, `causation_id`
 *   policy version and decision              -> `policy_version`, `policy_decision`
 *   before/after hashes or bounded redacted
 *     change                                 -> `before_hash`, `after_hash`, `change_redacted`
 *   tool or connector receipt                -> `receipt_ref`
 *   evidence pointer                         -> `evidence_uri`, `evidence_sha256`
 *   integrity chain values                   -> `entry_hash`, `prev_chain_hash`, `chain_hash`
 *
 * ## Integrity mechanism, as specified
 *
 * "Append-only and hash-linked", "Concurrent audit records are serialized per
 * cell or committed into a deterministic Merkle batch", "Chain roots are
 * periodically signed and exported to immutable off-cell storage with a signing
 * key unavailable to the database runtime."
 *
 * Implemented as:
 *
 *   * `entry_hash = SHA-256(canonical JSON of the entry's content fields)`;
 *   * `chain_hash = SHA-256(prev_chain_hash ‖ entry_hash)` — the hash link;
 *   * `audit_chain_head` holds one row per cell and is locked `FOR UPDATE`
 *     before each append, which is the "serialized per cell" option. Serializing
 *     is chosen over Merkle batching because a hash chain that is written under
 *     a row lock is verifiable by a single sequential scan, whereas batching
 *     needs a second reconciliation process to be worth anything;
 *   * `audit_chain_root_export` records each signed root shipped off-cell. The
 *     signature is produced by the export job, not by PostgreSQL — FRANK-§11.5
 *     requires the signing key to be *unavailable to the database runtime*, so
 *     no function here ever sees it;
 *   * `UPDATE` and `DELETE` on `audit_entry` raise an exception from a trigger
 *     installed in migration `0001`. Append-only is a database property here,
 *     not a code convention.
 *
 * ## What must not be here
 *
 * "Sensitive payloads are referenced, redacted, or encrypted; the audit log is
 * not a second uncontrolled copy of personal content." There is no `payload`
 * column. `change_redacted` is bounded and is expected to hold field *names* and
 * classification, not values; when a value must be retained it is written as a
 * `frank.enc.v1` ciphertext into `change_encrypted`.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { actorKindEnum, dataClassEnum, domain, policyResultEnum } from './shared.js';

export const auditEntry = domain.table(
  'audit_entry',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),

    /**
     * Position in the per-cell chain, starting at 1. `bigint` rather than a
     * sequence: the value is part of the hashed payload, and a sequence would
     * hand out numbers that a rolled-back transaction leaves as permanent gaps —
     * a gap is indistinguishable from a deleted entry to a verifier.
     */
    seq: bigint('seq', { mode: 'bigint' }).notNull(),

    /** When the audited thing happened, and when the log learned about it. */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** FRANK-§11.5: "authenticated actor and delegated actor". Both, separately. */
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    delegatedActorKind: actorKindEnum('delegated_actor_kind'),
    delegatedActorId: text('delegated_actor_id'),

    action: text('action').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),

    /** FRANK-§19.1 correlation; FRANK-§6.7 causation. */
    correlationId: text('correlation_id').notNull(),
    causationId: text('causation_id'),

    /** FRANK-§11.5: "policy version and decision". */
    policyVersion: text('policy_version'),
    policyDecision: policyResultEnum('policy_decision'),

    /** FRANK-§11.5: "before/after hashes or bounded redacted change". */
    beforeHash: text('before_hash'),
    afterHash: text('after_hash'),
    changeRedacted: jsonb('change_redacted').$type<Record<string, unknown>>(),
    /** `frank.enc.v1` ciphertext when a value genuinely must be retained. */
    changeEncrypted: text('change_encrypted'),
    dataClass: dataClassEnum('data_class').notNull().default('internal'),

    /** FRANK-§11.5: "tool or connector receipt". Referenced, never inlined. */
    receiptRef: text('receipt_ref'),

    /** FRANK-§11.5: "evidence pointer" (FRANK-§6.8). */
    evidenceUri: text('evidence_uri'),
    evidenceSha256: text('evidence_sha256'),

    /** FRANK-§11.5: "integrity chain values". */
    entryHash: text('entry_hash').notNull(),
    prevChainHash: text('prev_chain_hash').notNull(),
    chainHash: text('chain_hash').notNull(),
  },
  (t) => [
    uniqueIndex('audit_entry_seq_uidx').on(t.cellId, t.seq),
    uniqueIndex('audit_entry_chain_uidx').on(t.cellId, t.chainHash),
    index('audit_entry_target_idx').on(t.cellId, t.targetKind, t.targetId, t.occurredAt),
    index('audit_entry_correlation_idx').on(t.cellId, t.correlationId),
    index('audit_entry_actor_idx').on(t.cellId, t.actorKind, t.actorId, t.occurredAt),
  ],
);

/**
 * FRANK-§11.2 `ChainHead`. One row per cell; locked `FOR UPDATE` for the
 * duration of an append, which is what "serialized per cell" buys.
 */
export const auditChainHead = domain.table('audit_chain_head', {
  cellId: text('cell_id').primaryKey(),
  seq: bigint('seq', { mode: 'bigint' }).notNull(),
  chainHash: text('chain_hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/**
 * FRANK-§11.2 `Export`; FRANK-§11.5 "Chain roots are periodically signed and
 * exported to immutable off-cell storage".
 *
 * The signature and `signer_id` are written by the export job. Nothing in this
 * package produces them, because the signing key must be unavailable to the
 * database runtime.
 */
export const auditChainRootExport = domain.table(
  'audit_chain_root_export',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    fromSeq: bigint('from_seq', { mode: 'bigint' }).notNull(),
    toSeq: bigint('to_seq', { mode: 'bigint' }).notNull(),
    /** `chain_hash` of entry `to_seq` — the root being attested. */
    chainHash: text('chain_hash').notNull(),
    signerId: text('signer_id').notNull(),
    signatureAlgorithm: text('signature_algorithm').notNull(),
    signature: text('signature').notNull(),
    /** Where the immutable off-cell copy lives (FRANK-§16.7). */
    externalUri: text('external_uri').notNull(),
    exportedAt: timestamp('exported_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    uniqueIndex('audit_chain_root_export_uidx').on(t.cellId, t.toSeq),
    index('audit_chain_root_export_range_idx').on(t.cellId, t.fromSeq),
  ],
);

/**
 * FRANK-§11.2 `Verification`; FRANK-§11.5 "tamper tests must fail external-root
 * verification".
 *
 * Every verification run is recorded whether it passed or failed. A verification
 * log that only records successes cannot demonstrate that verification ran.
 */
export const auditVerification = domain.table(
  'audit_verification',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    fromSeq: bigint('from_seq', { mode: 'bigint' }).notNull(),
    toSeq: bigint('to_seq', { mode: 'bigint' }).notNull(),
    /** `ok` | `broken_link` | `hash_mismatch` | `missing_entry` | `root_mismatch`. */
    result: text('result').notNull(),
    /** First `seq` at which verification failed, when it failed. */
    failedAtSeq: bigint('failed_at_seq', { mode: 'bigint' }),
    detail: text('detail'),
    /** The export this run was checked against, when checked against one. */
    checkedExportId: uuid('checked_export_id').references(() => auditChainRootExport.id, {
      onDelete: 'set null',
    }),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
    verifiedBy: text('verified_by').notNull(),
  },
  (t) => [
    index('audit_verification_cell_idx').on(t.cellId, t.verifiedAt),
    index('audit_verification_failed_idx')
      .on(t.cellId, t.verifiedAt)
      .where(sql`${t.result} <> 'ok'`),
  ],
);

export type AuditEntryRow = typeof auditEntry.$inferSelect;
export type NewAuditEntryRow = typeof auditEntry.$inferInsert;

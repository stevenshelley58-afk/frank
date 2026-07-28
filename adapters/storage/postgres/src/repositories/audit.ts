/**
 * Audit repository — FRANK-§11.5.
 *
 * "The domain mutation, invocation intent, canonical audit entry, and outbox
 * event commit in one PostgreSQL transaction or none of them do. Concurrent
 * audit records are serialized per cell..."
 *
 * `append` therefore takes a {@link FrankTransaction}, like the outbox, and
 * takes the cell's chain-head row lock before computing anything. Under
 * concurrency the second transaction blocks on that lock until the first
 * commits, which is what makes `seq` gapless and the chain linear. A sequence
 * generator would be faster and wrong: sequences do not roll back, so a failed
 * transaction would leave a permanent gap that a verifier cannot distinguish
 * from a deleted entry.
 */

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import { GENESIS_CHAIN_HASH, computeChainHash, computeEntryHash, verifyAuditChain } from '../audit-chain.js';
import type { AuditChainLink, AuditEntryContent, AuditVerificationResult } from '../audit-chain.js';
import type { CanonicalValue } from '../canonical-json.js';
import type { FrankExecutor, FrankTransaction } from '../db.js';
import { newId } from '../ids.js';
import { auditChainHead, auditEntry } from '../schema/audit.js';
import type { AuditEntryRow } from '../schema/audit.js';
import type { ActorKind } from '../schema/shared.js';

export interface AppendAuditInput {
  readonly cellId: string;
  readonly occurredAt: Date;
  readonly recordedAt?: Date | undefined;
  readonly actorKind: ActorKind;
  readonly actorId: string;
  readonly delegatedActorKind?: ActorKind | undefined;
  readonly delegatedActorId?: string | undefined;
  readonly action: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly policyVersion?: string | undefined;
  readonly policyDecision?: 'allow' | 'allow_with_limits' | 'hold_for_review' | 'deny' | undefined;
  readonly beforeHash?: string | undefined;
  readonly afterHash?: string | undefined;
  /** Bounded and redacted. Field names and classifications, not values. */
  readonly changeRedacted?: CanonicalValue | undefined;
  /** `frank.enc.v1` ciphertext, when a value genuinely must be retained. */
  readonly changeEncrypted?: string | undefined;
  readonly dataClass?: 'open' | 'internal' | 'private' | 'sensitive' | 'secret' | undefined;
  readonly receiptRef?: string | undefined;
  readonly evidenceUri?: string | undefined;
  readonly evidenceSha256?: string | undefined;
}

export interface AppendedAuditEntry {
  readonly id: string;
  readonly seq: bigint;
  readonly entryHash: string;
  readonly chainHash: string;
}

export class AuditRepository {
  /**
   * Append one entry to the cell's chain.
   *
   * Must be called inside the same transaction as the change it audits. Nothing
   * in this method commits, and that is deliberate: an audit entry that commits
   * separately from its mutation can outlive a rolled-back change or be lost
   * with a committed one, and FRANK-§11.5 rules out both.
   */
  async append(tx: FrankTransaction, input: AppendAuditInput): Promise<AppendedAuditEntry> {
    // Create the head on first use, then lock it. `ON CONFLICT DO NOTHING`
    // followed by a locking select is race-free: whichever transaction inserts
    // first wins, and the loser blocks on the lock rather than failing.
    await tx
      .insert(auditChainHead)
      .values({
        cellId: input.cellId,
        seq: 0n,
        chainHash: GENESIS_CHAIN_HASH,
        updatedAt: input.recordedAt ?? input.occurredAt,
      })
      .onConflictDoNothing();

    const heads = await tx
      .select()
      .from(auditChainHead)
      .where(eq(auditChainHead.cellId, input.cellId))
      .for('update');

    const head = heads[0];
    if (head === undefined) {
      throw new Error(
        `Audit chain head for cell ${input.cellId} disappeared between insert and lock; refusing to start a second chain (FRANK-§11.5).`,
      );
    }

    const seq = head.seq + 1n;
    const content: AuditEntryContent = {
      cellId: input.cellId,
      seq,
      occurredAt: input.occurredAt.toISOString(),
      actorKind: input.actorKind,
      actorId: input.actorId,
      delegatedActorKind: input.delegatedActorKind ?? null,
      delegatedActorId: input.delegatedActorId ?? null,
      action: input.action,
      targetKind: input.targetKind,
      targetId: input.targetId,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      policyVersion: input.policyVersion ?? null,
      policyDecision: input.policyDecision ?? null,
      beforeHash: input.beforeHash ?? null,
      afterHash: input.afterHash ?? null,
      changeRedacted: input.changeRedacted ?? null,
      changeEncrypted: input.changeEncrypted ?? null,
      dataClass: input.dataClass ?? 'internal',
      receiptRef: input.receiptRef ?? null,
      evidenceUri: input.evidenceUri ?? null,
      evidenceSha256: input.evidenceSha256 ?? null,
    };

    const entryHash = computeEntryHash(content);
    const chainHash = computeChainHash(head.chainHash, entryHash);
    const id = newId();
    const recordedAt = input.recordedAt ?? new Date();

    await tx.insert(auditEntry).values({
      id,
      cellId: input.cellId,
      seq,
      occurredAt: input.occurredAt,
      recordedAt,
      actorKind: input.actorKind,
      actorId: input.actorId,
      delegatedActorKind: input.delegatedActorKind ?? null,
      delegatedActorId: input.delegatedActorId ?? null,
      action: input.action,
      targetKind: input.targetKind,
      targetId: input.targetId,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      policyVersion: input.policyVersion ?? null,
      policyDecision: input.policyDecision ?? null,
      beforeHash: input.beforeHash ?? null,
      afterHash: input.afterHash ?? null,
      changeRedacted: (input.changeRedacted ?? null) as Record<string, unknown> | null,
      changeEncrypted: input.changeEncrypted ?? null,
      dataClass: input.dataClass ?? 'internal',
      receiptRef: input.receiptRef ?? null,
      evidenceUri: input.evidenceUri ?? null,
      evidenceSha256: input.evidenceSha256 ?? null,
      entryHash,
      prevChainHash: head.chainHash,
      chainHash,
    });

    await tx
      .update(auditChainHead)
      .set({ seq, chainHash, updatedAt: recordedAt })
      .where(eq(auditChainHead.cellId, input.cellId));

    return { id, seq, entryHash, chainHash };
  }

  /** Read a contiguous run of entries in chain order. */
  async read(
    db: FrankExecutor,
    input: { cellId: string; fromSeq?: bigint; toSeq?: bigint; limit?: number },
  ): Promise<AuditEntryRow[]> {
    const conditions = [eq(auditEntry.cellId, input.cellId)];
    if (input.fromSeq !== undefined) conditions.push(gte(auditEntry.seq, input.fromSeq));
    if (input.toSeq !== undefined) conditions.push(lte(auditEntry.seq, input.toSeq));

    return db
      .select()
      .from(auditEntry)
      .where(and(...conditions))
      .orderBy(asc(auditEntry.seq))
      .limit(input.limit ?? 1000);
  }

  /**
   * Recompute and check the chain — FRANK-§11.5's tamper test.
   *
   * When `fromSeq` is given, the caller must also supply the `chain_hash` of the
   * entry immediately before it; verifying a suffix against
   * {@link GENESIS_CHAIN_HASH} would report a broken link for a perfectly good
   * chain, and a verifier that cries wolf gets ignored.
   */
  async verify(
    db: FrankExecutor,
    input: { cellId: string; fromSeq?: bigint; toSeq?: bigint; startingChainHash?: string },
  ): Promise<AuditVerificationResult> {
    const rows = await this.read(db, {
      cellId: input.cellId,
      ...(input.fromSeq === undefined ? {} : { fromSeq: input.fromSeq }),
      ...(input.toSeq === undefined ? {} : { toSeq: input.toSeq }),
      limit: 1_000_000,
    });
    return verifyAuditChain(rows.map(toChainLink), input.startingChainHash ?? GENESIS_CHAIN_HASH);
  }

  async head(
    db: FrankExecutor,
    cellId: string,
  ): Promise<{ seq: bigint; chainHash: string } | undefined> {
    const rows = await db
      .select({ seq: auditChainHead.seq, chainHash: auditChainHead.chainHash })
      .from(auditChainHead)
      .where(eq(auditChainHead.cellId, cellId));
    return rows[0];
  }

  /** Count of entries, for reconciling against `head.seq`. */
  async count(db: FrankExecutor, cellId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<string>`count(*)` })
      .from(auditEntry)
      .where(eq(auditEntry.cellId, cellId));
    return Number(rows[0]?.count ?? 0);
  }
}

/** Project a stored row back into the exact shape that was hashed. */
export function toChainLink(row: AuditEntryRow): AuditChainLink {
  return {
    content: {
      cellId: row.cellId,
      seq: row.seq,
      occurredAt: row.occurredAt.toISOString(),
      actorKind: row.actorKind,
      actorId: row.actorId,
      delegatedActorKind: row.delegatedActorKind,
      delegatedActorId: row.delegatedActorId,
      action: row.action,
      targetKind: row.targetKind,
      targetId: row.targetId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      policyVersion: row.policyVersion,
      policyDecision: row.policyDecision,
      beforeHash: row.beforeHash,
      afterHash: row.afterHash,
      changeRedacted: (row.changeRedacted ?? null) as CanonicalValue | null,
      changeEncrypted: row.changeEncrypted,
      dataClass: row.dataClass,
      receiptRef: row.receiptRef,
      evidenceUri: row.evidenceUri,
      evidenceSha256: row.evidenceSha256,
    },
    entryHash: row.entryHash,
    prevChainHash: row.prevChainHash,
    chainHash: row.chainHash,
  };
}

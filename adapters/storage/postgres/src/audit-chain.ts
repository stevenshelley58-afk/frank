/**
 * Audit hash chain — FRANK-§11.5.
 *
 * "The canonical audit log is append-only and hash-linked... It records ...
 * integrity chain values... Chain roots are periodically signed and exported to
 * immutable off-cell storage with a signing key unavailable to the database
 * runtime. ... tamper tests must fail external-root verification."
 *
 * ## The chain
 *
 *     entry_hash_n  = SHA-256(canonicalJson(content_n))
 *     chain_hash_n  = SHA-256(chain_hash_{n-1} ‖ entry_hash_n)
 *     chain_hash_0  = GENESIS_CHAIN_HASH
 *
 * `seq` is part of `content_n`, so an entry cannot be moved to a different
 * position without changing its own hash. `cell_id` is part of `content_n`, so
 * an entry cannot be replayed into another cell's chain (FRANK-§2.4).
 *
 * Deliberately *not* an HMAC. A keyed chain would let anyone holding the key
 * forge a consistent history, and the key would have to live somewhere the
 * database runtime can reach it — which FRANK-§11.5 forbids for exactly this
 * reason. Unforgeability comes from the signature over the periodically exported
 * root, produced outside the database. The chain's job is to make any edit
 * detectable; the exported signed root is what makes the detection trustworthy.
 *
 * ## Everything here is pure
 *
 * No clock, no randomness, no I/O. `audit-chain.test.ts` covers the whole module
 * without a database, including the tamper cases.
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';
import type { CanonicalValue } from './canonical-json.js';

/** The chain hash preceding the first entry in a cell. */
export const GENESIS_CHAIN_HASH = `sha256:${'0'.repeat(64)}`;

/**
 * The hashed content of an audit entry.
 *
 * Every field FRANK-§11.5 requires an audit entry to record is here, and the
 * fields that are *not* here are as deliberate: `recorded_at` is excluded
 * because it is when the log learned about the event rather than a fact about
 * the event, and including it would make a replayed import produce a different
 * hash for the same history.
 */
export interface AuditEntryContent {
  readonly cellId: string;
  readonly seq: bigint;
  readonly occurredAt: string;
  readonly actorKind: string;
  readonly actorId: string;
  readonly delegatedActorKind: string | null;
  readonly delegatedActorId: string | null;
  readonly action: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly policyVersion: string | null;
  readonly policyDecision: string | null;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly changeRedacted: CanonicalValue | null;
  readonly changeEncrypted: string | null;
  readonly dataClass: string;
  readonly receiptRef: string | null;
  readonly evidenceUri: string | null;
  readonly evidenceSha256: string | null;
}

/**
 * SHA-256 over the canonical encoding of the entry content.
 *
 * `seq` is a `bigint` and is encoded as a decimal *string*, not a number: it can
 * exceed `Number.MAX_SAFE_INTEGER`, and `canonicalJson` refuses unsafe integers
 * rather than silently rounding one.
 */
export function computeEntryHash(content: AuditEntryContent): string {
  const canonical: CanonicalValue = {
    v: 1,
    cellId: content.cellId,
    seq: content.seq.toString(10),
    occurredAt: content.occurredAt,
    actorKind: content.actorKind,
    actorId: content.actorId,
    delegatedActorKind: content.delegatedActorKind,
    delegatedActorId: content.delegatedActorId,
    action: content.action,
    targetKind: content.targetKind,
    targetId: content.targetId,
    correlationId: content.correlationId,
    causationId: content.causationId,
    policyVersion: content.policyVersion,
    policyDecision: content.policyDecision,
    beforeHash: content.beforeHash,
    afterHash: content.afterHash,
    changeRedacted: content.changeRedacted,
    changeEncrypted: content.changeEncrypted,
    dataClass: content.dataClass,
    receiptRef: content.receiptRef,
    evidenceUri: content.evidenceUri,
    evidenceSha256: content.evidenceSha256,
  };
  return `sha256:${createHash('sha256').update(canonicalJson(canonical), 'utf8').digest('hex')}`;
}

/**
 * Link an entry to its predecessor.
 *
 * The two hashes are joined with `|`, and both are `sha256:`-prefixed
 * fixed-length strings, so no pair of different inputs can produce the same
 * concatenation. (A bare concatenation of variable-length values is the classic
 * way to build a chain that turns out to be forgeable.)
 */
export function computeChainHash(prevChainHash: string, entryHash: string): string {
  assertDigest(prevChainHash, 'prevChainHash');
  assertDigest(entryHash, 'entryHash');
  return `sha256:${createHash('sha256').update(`${prevChainHash}|${entryHash}`, 'utf8').digest('hex')}`;
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function assertDigest(value: string, field: string): void {
  if (!DIGEST_RE.test(value)) {
    throw new TypeError(`${field} must be a "sha256:"-prefixed lowercase digest; received ${JSON.stringify(value)}.`);
  }
}

/** One link of a chain as read back from `audit_entry`. */
export interface AuditChainLink {
  readonly content: AuditEntryContent;
  readonly entryHash: string;
  readonly prevChainHash: string;
  readonly chainHash: string;
}

export type AuditVerificationResult =
  | { readonly ok: true; readonly checked: number; readonly headChainHash: string }
  | {
      readonly ok: false;
      readonly checked: number;
      readonly failure: 'entry_hash_mismatch' | 'broken_link' | 'chain_hash_mismatch' | 'sequence_gap';
      readonly atSeq: bigint;
      readonly detail: string;
    };

/**
 * Verify a contiguous run of entries.
 *
 * Checks four distinct failure modes rather than one, because they mean
 * different things operationally: a recomputed `entry_hash` that no longer
 * matches means the row's content was edited; a `prev_chain_hash` that does not
 * match the previous row's `chain_hash` means a row was inserted or removed; a
 * `chain_hash` that does not match the recomputation means the link column
 * itself was rewritten; a `seq` gap means an entry is missing. FRANK-§11.5's
 * tamper tests need to distinguish them.
 *
 * @param startingChainHash the chain hash immediately before `links[0]` —
 *   {@link GENESIS_CHAIN_HASH} when verifying from the beginning.
 */
export function verifyAuditChain(
  links: readonly AuditChainLink[],
  startingChainHash: string = GENESIS_CHAIN_HASH,
): AuditVerificationResult {
  let previousChainHash = startingChainHash;
  let previousSeq: bigint | null = null;

  for (let i = 0; i < links.length; i += 1) {
    const link = links[i]!;
    const seq = link.content.seq;

    if (previousSeq !== null && seq !== previousSeq + 1n) {
      return {
        ok: false,
        checked: i,
        failure: 'sequence_gap',
        atSeq: seq,
        detail: `expected seq ${previousSeq + 1n} but found ${seq}`,
      };
    }

    const recomputedEntryHash = computeEntryHash(link.content);
    if (recomputedEntryHash !== link.entryHash) {
      return {
        ok: false,
        checked: i,
        failure: 'entry_hash_mismatch',
        atSeq: seq,
        detail: `stored entry_hash ${link.entryHash} but content hashes to ${recomputedEntryHash}`,
      };
    }

    if (link.prevChainHash !== previousChainHash) {
      return {
        ok: false,
        checked: i,
        failure: 'broken_link',
        atSeq: seq,
        detail: `stored prev_chain_hash ${link.prevChainHash} but predecessor's chain_hash is ${previousChainHash}`,
      };
    }

    const recomputedChainHash = computeChainHash(previousChainHash, link.entryHash);
    if (recomputedChainHash !== link.chainHash) {
      return {
        ok: false,
        checked: i,
        failure: 'chain_hash_mismatch',
        atSeq: seq,
        detail: `stored chain_hash ${link.chainHash} but link recomputes to ${recomputedChainHash}`,
      };
    }

    previousChainHash = link.chainHash;
    previousSeq = seq;
  }

  return { ok: true, checked: links.length, headChainHash: previousChainHash };
}

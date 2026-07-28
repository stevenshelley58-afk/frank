/**
 * Blind indexes for searchable `sensitive` fields — FRANK-§15.7.
 *
 * FRANK-§15.7: "Searchable sensitive fields use approved blind indexes or
 * separately authorized projections."
 *
 * ## Construction
 *
 * `HMAC-SHA256(k_index, normalize(value))`, truncated, hex-encoded, where
 * `k_index` comes from {@link CellKeyProvider.blindIndexKey} and is a *different*
 * key from the envelope-encryption KEK. Nothing bespoke: a keyed PRF over a
 * normalized input.
 *
 * ## Domain separation
 *
 * The HMAC message is `frank.bidx.v1|<cellId>|<index>|<normalized>` and the key
 * is itself scoped to `(cellId, index)`. Both layers are present on purpose. Key
 * scoping is the real control; prefixing the message means that even if an
 * operator misconfigures the provider to hand the same bytes to two indexes, the
 * digests still differ, so an attacker cannot use `person.email` digests as a
 * dictionary against `contact.email`.
 *
 * ## Truncation
 *
 * The default is 16 bytes (128 bits) of the digest. That is far past any
 * practical collision search while halving index size. Collisions are a
 * correctness question, not just a security one: a blind index lookup is a
 * *candidate* filter, and callers must verify the decrypted value. The helper
 * {@link isCandidateOnly} exists to make that obligation visible in code review.
 *
 * ## What a blind index does and does not buy
 *
 * It buys equality lookup on an encrypted column without a plaintext copy.
 * It does not buy range queries, prefix search, or ordering, and it leaks
 * equality: an observer with database access learns which rows share a value,
 * and can confirm a guessed value only if they also hold the index key. That
 * residual leak is inherent to the mechanism FRANK-§15.7 names, so it is stated
 * here rather than papered over.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { BlindIndexKeyRef, CellKeyProvider } from './key-provider.js';

const SCHEME = 'frank.bidx.v1';

/** Digest bytes retained. 16 bytes = 128 bits = 32 hex characters. */
export const DEFAULT_BLIND_INDEX_BYTES = 16;

export interface BlindIndexOptions {
  /** Truncation length in bytes. Must be in [8, 32]. */
  readonly bytes?: number;
  /**
   * Normalization applied before hashing. Defaults to
   * {@link normalizeForExactMatch}. Whatever is chosen must be applied
   * identically at write and at read, or the index silently stops matching.
   */
  readonly normalize?: (value: string) => string;
}

/**
 * Unicode NFKC, trimmed, lowercased.
 *
 * Case folding is a real decision, not a default: it means `Steven@Example.com`
 * and `steven@example.com` share an index entry, which is what an email or
 * handle lookup needs and what a case-sensitive identifier (an external
 * provider's opaque ID) must not have. Callers whose values are case-sensitive
 * pass {@link normalizeCaseSensitive}.
 */
export function normalizeForExactMatch(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** NFKC and trim only. For opaque, case-significant identifiers. */
export function normalizeCaseSensitive(value: string): string {
  return value.normalize('NFKC').trim();
}

/**
 * Compute a blind index for `value` under the current key for `(cellId, index)`.
 *
 * @returns lowercase hex, and the key reference used, so the caller can store
 *   the version alongside and re-index after rotation.
 */
export async function blindIndex(
  keys: CellKeyProvider,
  cellId: string,
  index: string,
  value: string,
  options: BlindIndexOptions = {},
): Promise<{ digest: string; keyRef: BlindIndexKeyRef }> {
  const keyRef = await keys.currentBlindIndexKeyRef(cellId, index);
  const digest = await blindIndexWithKeyRef(keys, keyRef, value, options);
  return { digest, keyRef };
}

/** Compute a blind index under an explicit key version. */
export async function blindIndexWithKeyRef(
  keys: CellKeyProvider,
  keyRef: BlindIndexKeyRef,
  value: string,
  options: BlindIndexOptions = {},
): Promise<string> {
  const bytes = options.bytes ?? DEFAULT_BLIND_INDEX_BYTES;
  if (!Number.isInteger(bytes) || bytes < 8 || bytes > 32) {
    throw new RangeError(`Blind index truncation must be an integer in [8, 32] bytes; got ${bytes}.`);
  }

  const key = await keys.blindIndexKey(keyRef);
  if (key.length !== 32) {
    throw new TypeError(`Blind index key must be 32 bytes; provider returned ${key.length}.`);
  }

  const normalize = options.normalize ?? normalizeForExactMatch;
  const message = [SCHEME, keyRef.cellId, keyRef.index, normalize(value)].join('|');

  return createHmac('sha256', key).update(message, 'utf8').digest().subarray(0, bytes).toString('hex');
}

/**
 * Constant-time comparison of two blind-index digests.
 *
 * Timing-safe comparison matters less here than for a MAC — the digests are
 * stored, not secret — but a lookup that short-circuits on the first differing
 * nibble gives an attacker with query access a way to walk the index, so this is
 * the comparison used everywhere in the package.
 */
export function blindIndexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Marker for the obligation described above: a blind index match is a candidate,
 * and the caller must confirm by decrypting and comparing the real value.
 *
 * It is a function rather than a comment so that a reviewer can grep for the
 * places that claim to have done the confirmation.
 */
export function isCandidateOnly(): true {
  return true;
}

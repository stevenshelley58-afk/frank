/**
 * FRANK-§15.7: "Searchable sensitive fields use approved blind indexes."
 *
 * The three properties a blind index has to have, and one it must not:
 *
 *   determinism        the same value under the same key always yields the same
 *                      digest — without it the index cannot be searched;
 *   non-reversibility  the digest does not disclose the value, and does not
 *                      allow a guess to be confirmed without the key;
 *   domain separation  digests from one index are useless against another;
 *   NOT ordering       the digest must not preserve any ordering of the inputs.
 */

import { createHash, randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_BLIND_INDEX_BYTES,
  InMemoryCellKeyProvider,
  KeyUnavailableError,
  blindIndex,
  blindIndexEquals,
  blindIndexWithKeyRef,
  normalizeCaseSensitive,
  normalizeForExactMatch,
} from './index.js';
import type { BlindIndexKeyRef } from './index.js';

const CELL = 'cell-steven';
const OTHER_CELL = 'cell-customer-a';
const INDEX = 'conversation_message.body';

let keys: InMemoryCellKeyProvider;
let ref: BlindIndexKeyRef;

beforeEach(() => {
  keys = new InMemoryCellKeyProvider();
  ref = { cellId: CELL, index: INDEX, version: 1 };
  keys.putBlindIndexKey(ref, randomBytes(32));
  keys.putBlindIndexKey({ cellId: CELL, index: 'source.external_id', version: 1 }, randomBytes(32));
  keys.putBlindIndexKey({ cellId: OTHER_CELL, index: INDEX, version: 1 }, randomBytes(32));
});

describe('determinism', () => {
  it('produces the same digest for the same value, every time', async () => {
    const first = await blindIndex(keys, CELL, INDEX, 'steven@example.com');
    for (let i = 0; i < 10; i += 1) {
      const again = await blindIndex(keys, CELL, INDEX, 'steven@example.com');
      expect(again.digest).toBe(first.digest);
    }
  });

  it('is stable across a fresh provider holding the same key bytes', async () => {
    const key = randomBytes(32);
    const a = new InMemoryCellKeyProvider().putBlindIndexKey(ref, key);
    const b = new InMemoryCellKeyProvider().putBlindIndexKey(ref, key);

    expect((await blindIndex(a, CELL, INDEX, 'value')).digest).toBe(
      (await blindIndex(b, CELL, INDEX, 'value')).digest,
    );
  });

  it('normalizes case and surrounding whitespace by default', async () => {
    const canonical = await blindIndex(keys, CELL, INDEX, 'steven@example.com');
    for (const variant of ['Steven@Example.com', '  steven@example.com  ', 'STEVEN@EXAMPLE.COM']) {
      expect((await blindIndex(keys, CELL, INDEX, variant)).digest).toBe(canonical.digest);
    }
  });

  it('normalizes Unicode so a composed and decomposed form match', async () => {
    // "é" as U+00E9 versus "e" + U+0301.
    const composed = await blindIndex(keys, CELL, INDEX, 'café');
    const decomposed = await blindIndex(keys, CELL, INDEX, 'café');
    expect(decomposed.digest).toBe(composed.digest);
  });

  it('keeps case significant when the caller asks for it', async () => {
    const lower = await blindIndexWithKeyRef(keys, ref, 'AbC', {
      normalize: normalizeCaseSensitive,
    });
    const upper = await blindIndexWithKeyRef(keys, ref, 'abc', {
      normalize: normalizeCaseSensitive,
    });
    expect(lower).not.toBe(upper);
  });

  it('distinguishes different values', async () => {
    const a = await blindIndex(keys, CELL, INDEX, 'steven@example.com');
    const b = await blindIndex(keys, CELL, INDEX, 'steve@example.com');
    expect(a.digest).not.toBe(b.digest);
  });

  it('returns the key version so a rotation can re-index', async () => {
    const result = await blindIndex(keys, CELL, INDEX, 'value');
    expect(result.keyRef).toEqual(ref);
  });
});

describe('non-reversibility', () => {
  it('emits a fixed-length hex digest that carries no length information', async () => {
    const short = await blindIndex(keys, CELL, INDEX, 'a');
    const long = await blindIndex(keys, CELL, INDEX, 'a'.repeat(50_000));
    expect(short.digest).toHaveLength(DEFAULT_BLIND_INDEX_BYTES * 2);
    expect(long.digest).toHaveLength(DEFAULT_BLIND_INDEX_BYTES * 2);
    expect(short.digest).not.toBe(long.digest);
  });

  it('does not contain the input in any encoding', async () => {
    const secret = 'deadbeef';
    const { digest } = await blindIndex(keys, CELL, INDEX, secret);
    expect(digest).not.toContain(secret);
    expect(digest).not.toContain(Buffer.from(secret).toString('hex'));
  });

  it('cannot be reproduced by an unkeyed hash of the value', async () => {
    // If the digest were a plain SHA-256, an attacker with the database could
    // confirm any guessed value offline. It must not be.
    const value = 'steven@example.com';
    const { digest } = await blindIndex(keys, CELL, INDEX, value);
    for (const guess of [
      createHash('sha256').update(value).digest('hex'),
      createHash('sha256').update(normalizeForExactMatch(value)).digest('hex'),
      createHash('sha256').update(`${CELL}|${INDEX}|${value}`).digest('hex'),
    ]) {
      expect(guess.startsWith(digest)).toBe(false);
      expect(guess).not.toContain(digest);
    }
  });

  it('cannot be reproduced without the key: the same value under a different key differs', async () => {
    const key = randomBytes(32);
    const holder = new InMemoryCellKeyProvider().putBlindIndexKey(ref, key);
    const attacker = new InMemoryCellKeyProvider().putBlindIndexKey(ref, randomBytes(32));

    const real = await blindIndex(holder, CELL, INDEX, 'steven@example.com');
    const forged = await blindIndex(attacker, CELL, INDEX, 'steven@example.com');
    expect(forged.digest).not.toBe(real.digest);
  });

  it('does not preserve ordering of the inputs', async () => {
    // Sorted plaintexts must not come back sorted, or the index leaks ranges.
    const values = ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh'];
    const digests: string[] = [];
    for (const value of values) digests.push((await blindIndex(keys, CELL, INDEX, value)).digest);
    expect(digests).not.toEqual([...digests].sort());
  });

  it('avalanches: a one-character change alters most of the digest', async () => {
    const a = (await blindIndex(keys, CELL, INDEX, 'steven@example.com')).digest;
    const b = (await blindIndex(keys, CELL, INDEX, 'stevem@example.com')).digest;
    let same = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
    expect(same).toBeLessThan(a.length / 2);
  });
});

describe('domain separation', () => {
  it('gives different digests for the same value in different indexes', async () => {
    const a = await blindIndex(keys, CELL, INDEX, 'steven@example.com');
    const b = await blindIndex(keys, CELL, 'source.external_id', 'steven@example.com');
    expect(a.digest).not.toBe(b.digest);
  });

  it('gives different digests for the same value in different cells (FRANK-§2.4)', async () => {
    const a = await blindIndex(keys, CELL, INDEX, 'steven@example.com');
    const b = await blindIndex(keys, OTHER_CELL, INDEX, 'steven@example.com');
    expect(a.digest).not.toBe(b.digest);
  });

  it('separates by index even when a provider hands out identical key bytes', async () => {
    // Belt and braces: the message prefix carries the index name, so a
    // misconfigured provider cannot collapse two indexes into one dictionary.
    const shared = randomBytes(32);
    const sloppy = new InMemoryCellKeyProvider()
      .putBlindIndexKey({ cellId: CELL, index: 'a', version: 1 }, shared)
      .putBlindIndexKey({ cellId: CELL, index: 'b', version: 1 }, shared);

    const a = await blindIndex(sloppy, CELL, 'a', 'value');
    const b = await blindIndex(sloppy, CELL, 'b', 'value');
    expect(a.digest).not.toBe(b.digest);
  });

  it('separates by cell even when a provider hands out identical key bytes', async () => {
    const shared = randomBytes(32);
    const sloppy = new InMemoryCellKeyProvider()
      .putBlindIndexKey({ cellId: CELL, index: INDEX, version: 1 }, shared)
      .putBlindIndexKey({ cellId: OTHER_CELL, index: INDEX, version: 1 }, shared);

    const a = await blindIndex(sloppy, CELL, INDEX, 'value');
    const b = await blindIndex(sloppy, OTHER_CELL, INDEX, 'value');
    expect(a.digest).not.toBe(b.digest);
  });

  it('changes the digest when the key version changes, so rotation is detectable', async () => {
    const v1 = await blindIndex(keys, CELL, INDEX, 'value');
    keys.putBlindIndexKey({ cellId: CELL, index: INDEX, version: 2 }, randomBytes(32));
    const v2 = await blindIndex(keys, CELL, INDEX, 'value');
    expect(v2.keyRef.version).toBe(2);
    expect(v2.digest).not.toBe(v1.digest);
  });
});

describe('failure behaviour', () => {
  it('fails closed when the key is unavailable', async () => {
    const empty = new InMemoryCellKeyProvider();
    await expect(blindIndex(empty, CELL, INDEX, 'value')).rejects.toThrow(KeyUnavailableError);
  });

  it('rejects a truncation length outside [8, 32] bytes', async () => {
    for (const bytes of [0, 4, 7, 33, 64, 1.5, Number.NaN]) {
      await expect(blindIndexWithKeyRef(keys, ref, 'value', { bytes })).rejects.toThrow(RangeError);
    }
  });

  it('accepts the boundary truncation lengths', async () => {
    expect(await blindIndexWithKeyRef(keys, ref, 'v', { bytes: 8 })).toHaveLength(16);
    expect(await blindIndexWithKeyRef(keys, ref, 'v', { bytes: 32 })).toHaveLength(64);
  });

  it('rejects key material that is not 32 bytes', () => {
    expect(() => keys.putBlindIndexKey(ref, randomBytes(31))).toThrow(/must be exactly 32 bytes/);
  });
});

describe('blindIndexEquals', () => {
  it('matches identical digests', async () => {
    const { digest } = await blindIndex(keys, CELL, INDEX, 'value');
    expect(blindIndexEquals(digest, digest)).toBe(true);
  });

  it('rejects different digests', async () => {
    const a = await blindIndex(keys, CELL, INDEX, 'a');
    const b = await blindIndex(keys, CELL, INDEX, 'b');
    expect(blindIndexEquals(a.digest, b.digest)).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', async () => {
    const a = await blindIndexWithKeyRef(keys, ref, 'v', { bytes: 8 });
    const b = await blindIndexWithKeyRef(keys, ref, 'v', { bytes: 16 });
    expect(blindIndexEquals(a, b)).toBe(false);
  });
});

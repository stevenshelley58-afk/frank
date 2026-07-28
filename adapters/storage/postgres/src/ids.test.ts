/**
 * FRANK-§11.1: "UUIDv7 or ULID identifiers, generated once at the domain
 * boundary."
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { __resetIdClockForTests, isUuid, isUuidV7, newId, timestampOf } from './ids.js';

beforeEach(() => {
  __resetIdClockForTests();
});

describe('newId', () => {
  it('produces a canonical lowercase UUID', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(isUuid(id)).toBe(true);
    }
  });

  it('sets version 7 and the RFC 4122 variant', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newId();
      expect(id[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
      expect(isUuidV7(id)).toBe(true);
    }
  });

  it('never collides across a burst', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) ids.add(newId());
    expect(ids.size).toBe(20_000);
  });

  it('sorts in generation order as plain strings, even within one millisecond', () => {
    // The property a UUIDv7 exists for. A burst inside a single millisecond is
    // where a naive implementation stops being ordered.
    const ids: string[] = [];
    for (let i = 0; i < 5000; i += 1) ids.push(newId({ nowMs: 1_785_000_000_000 }));

    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]! > ids[i - 1]!, `${ids[i - 1]} should sort before ${ids[i]}`).toBe(true);
    }
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays ordered across a millisecond boundary', () => {
    const early = newId({ nowMs: 1_785_000_000_000 });
    const late = newId({ nowMs: 1_785_000_000_001 });
    expect(late > early).toBe(true);
  });

  it('never moves backwards when the clock does', () => {
    // NTP correction, virtual machine migration, or a suspended container.
    const first = newId({ nowMs: 1_785_000_000_100 });
    const afterJumpBack = newId({ nowMs: 1_785_000_000_000 });
    expect(afterJumpBack > first).toBe(true);
  });

  it('embeds the generation time', () => {
    const when = 1_785_000_123_456;
    expect(timestampOf(newId({ nowMs: when })).getTime()).toBe(when);
  });

  it('has no fixed bits beyond version and variant, so ids are not guessable', () => {
    // If the random block were constant, every id from one millisecond would
    // share a suffix. Sample the last 12 hex characters (48 bits of rand_b).
    const suffixes = new Set<string>();
    for (let i = 0; i < 500; i += 1) suffixes.add(newId({ nowMs: 1_785_000_000_000 }).slice(-12));
    expect(suffixes.size).toBe(500);
  });
});

describe('isUuidV7', () => {
  it('rejects other UUID versions', () => {
    expect(isUuidV7('01920000-0000-4000-8000-000000000000')).toBe(false); // v4
    expect(isUuidV7('01920000-0000-1000-8000-000000000000')).toBe(false); // v1
  });

  it('rejects an invalid variant', () => {
    expect(isUuidV7('01920000-0000-7000-0000-000000000000')).toBe(false);
    expect(isUuidV7('01920000-0000-7000-c000-000000000000')).toBe(false);
  });

  it('rejects uppercase, braced, and unhyphenated forms', () => {
    expect(isUuidV7('01920000-0000-7000-8000-00000000000A')).toBe(false);
    expect(isUuidV7('{01920000-0000-7000-8000-000000000000}')).toBe(false);
    expect(isUuidV7('019200000000700080000000000000 00')).toBe(false);
  });
});

describe('timestampOf', () => {
  it('refuses a non-v7 identifier rather than returning a nonsense date', () => {
    expect(() => timestampOf('01920000-0000-4000-8000-000000000000')).toThrow(TypeError);
    expect(() => timestampOf('not-a-uuid')).toThrow(TypeError);
  });
});

/**
 * Deterministic serialization underpins the audit chain (FRANK-§11.5) and the
 * capture idempotency key. Every property asserted here is one that
 * `JSON.stringify` does not have.
 */

import { describe, expect, it } from 'vitest';

import { NonCanonicalValueError, canonicalJson } from './canonical-json.js';

describe('key ordering', () => {
  it('sorts object keys, so insertion order cannot change the hash', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
    // JSON.stringify does not have this property.
    expect(JSON.stringify({ b: 1, a: 2 })).not.toBe(JSON.stringify({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] })).toBe(
      '{"a":[{"x":2,"y":1}],"z":{"c":2,"d":1}}',
    );
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });
});

describe('absent versus null', () => {
  it('omits undefined properties', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('keeps null properties, which mean something different', () => {
    expect(canonicalJson({ a: 1, b: null })).toBe('{"a":1,"b":null}');
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1 }));
  });

  it('refuses undefined inside an array rather than coercing it to null', () => {
    expect(() => canonicalJson([1, undefined as never, 3])).toThrow(NonCanonicalValueError);
    // JSON.stringify silently makes these identical.
    expect(JSON.stringify([1, undefined, 3])).toBe(JSON.stringify([1, null, 3]));
  });
});

describe('numbers', () => {
  it('accepts safe integers', () => {
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(-1)).toBe('-1');
    expect(canonicalJson(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
  });

  it('normalizes negative zero, which is the same integer', () => {
    expect(canonicalJson(-0)).toBe('0');
  });

  it('refuses fractional values, which must be presented as strings (FIN-002)', () => {
    expect(() => canonicalJson(1.5)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(0.1)).toThrow(/not a safe integer/);
  });

  it('refuses values beyond the safe integer range', () => {
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 2)).toThrow(NonCanonicalValueError);
  });

  it('refuses NaN and infinities instead of writing null', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/no JSON representation/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(NonCanonicalValueError);
    // JSON.stringify turns all three into the same string.
    expect(JSON.stringify(Number.NaN)).toBe('null');
  });
});

describe('other values', () => {
  it('escapes strings the way JSON does', () => {
    expect(canonicalJson('a"b\\c\nd')).toBe(JSON.stringify('a"b\\c\nd'));
    expect(canonicalJson('🩺')).toBe(JSON.stringify('🩺'));
  });

  it('refuses a Date, which would be indistinguishable from its string form', () => {
    expect(() => canonicalJson(new Date() as never)).toThrow(/Date is ambiguous/);
  });

  it('names the path of the offending value', () => {
    expect(() => canonicalJson({ outer: { inner: [1, 2.5] } })).toThrow(/outer\.inner\[1\]/);
  });

  it('handles booleans and null at the root', () => {
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson(null)).toBe('null');
  });

  it('handles empty containers', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });
});

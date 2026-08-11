import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_MESSAGE_BYTES, MAX_MESSAGE_FILES } from './types.js';
import { objectKey, stagingKey } from './storage.js';

describe('attachment invariants', () => {
  it('uses literal private bucket key layouts without allocating payloads', () => { expect(stagingKey('cell', 'upload')).toBe('cell/upload/object'); expect(objectKey('a'.repeat(64))).toBe(`sha256/aa/${'a'.repeat(64)}`); });
  it('has exact integer boundaries', () => { expect(MAX_FILE_BYTES).toBe(2147483648n); expect(MAX_MESSAGE_BYTES).toBe(10737418240n); expect(MAX_MESSAGE_FILES).toBe(10_000); });
  it('rejects non-sha object addressing', () => { expect(() => objectKey('../x')).toThrow('invalid sha256'); });
});

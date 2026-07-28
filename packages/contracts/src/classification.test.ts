import { describe, expect, it } from 'vitest';

import {
  DATA_CLASS_ORDER,
  canLowerClass,
  strictestOf,
  type DataClass,
  type Redaction,
} from './classification.js';

const deterministicVerified = (id: string): Redaction => ({
  kind: 'pii-token-replacement',
  appliedBy: 'service/redaction',
  deterministic: true,
  verifiedArtifactId: id,
});

describe('DATA_CLASS_ORDER', () => {
  it('lists the FRANK-§2.3 vocabulary least to most restrictive', () => {
    expect(DATA_CLASS_ORDER).toEqual(['open', 'internal', 'private', 'sensitive', 'secret']);
  });
});

describe('strictestOf', () => {
  it('returns the strictest class regardless of input order (FRANK-§2.3)', () => {
    expect(strictestOf(['open', 'sensitive', 'internal'])).toBe('sensitive');
  });

  it('returns the only class when given a single element', () => {
    expect(strictestOf(['internal'])).toBe('internal');
    expect(strictestOf(['secret'])).toBe('secret');
  });

  it('throws on an empty array rather than defaulting', () => {
    // A silent default here is how data gets under-classified.
    expect(() => strictestOf([])).toThrow(RangeError);
  });

  it('is order-independent and idempotent across the whole vocabulary', () => {
    expect(strictestOf(DATA_CLASS_ORDER)).toBe('secret');
    expect(strictestOf([...DATA_CLASS_ORDER].reverse())).toBe('secret');
    expect(strictestOf(['private', 'private'])).toBe('private');
  });

  it('fails closed on a class outside the vocabulary', () => {
    expect(() => strictestOf(['open', 'confidential' as DataClass])).toThrow(RangeError);
  });
});

describe('canLowerClass', () => {
  it('allows one step down backed by a deterministic, verified redaction', () => {
    expect(canLowerClass('sensitive', 'private', [deterministicVerified('artifact-1')])).toBe(true);
  });

  it('rejects a model-generated (non-deterministic) redaction', () => {
    expect(
      canLowerClass('sensitive', 'private', [
        { ...deterministicVerified('artifact-1'), deterministic: false },
      ]),
    ).toBe(false);
  });

  it('rejects a deterministic redaction with no verified artifact', () => {
    expect(
      canLowerClass('sensitive', 'private', [
        { kind: 'pii-token-replacement', appliedBy: 'service/redaction', deterministic: true },
      ]),
    ).toBe(false);
  });

  it('rejects an empty verifiedArtifactId', () => {
    expect(canLowerClass('sensitive', 'private', [deterministicVerified('')])).toBe(false);
  });

  it('rejects lowering with zero redactions', () => {
    expect(canLowerClass('sensitive', 'private', [])).toBe(false);
    expect(canLowerClass('secret', 'open', [])).toBe(false);
  });

  it('requires one qualifying redaction per step down the vocabulary', () => {
    // sensitive -> internal is two steps: sensitive -> private -> internal.
    expect(canLowerClass('sensitive', 'internal', [deterministicVerified('artifact-1')])).toBe(
      false,
    );
    expect(
      canLowerClass('sensitive', 'internal', [
        deterministicVerified('artifact-1'),
        deterministicVerified('artifact-2'),
      ]),
    ).toBe(true);
  });

  it('ignores redactions that do not qualify when counting steps', () => {
    expect(
      canLowerClass('sensitive', 'internal', [
        deterministicVerified('artifact-1'),
        { kind: 'summarise', appliedBy: 'model/broker', deterministic: false },
        { kind: 'mask', appliedBy: 'service/redaction', deterministic: true },
      ]),
    ).toBe(false);
  });

  it('never allows raising a class, however many redactions are supplied', () => {
    expect(canLowerClass('internal', 'sensitive', [deterministicVerified('artifact-1')])).toBe(
      false,
    );
    expect(
      canLowerClass('open', 'secret', [
        deterministicVerified('artifact-1'),
        deterministicVerified('artifact-2'),
        deterministicVerified('artifact-3'),
        deterministicVerified('artifact-4'),
      ]),
    ).toBe(false);
  });

  it('returns false when from and to are equal: there is no lowering to permit', () => {
    expect(canLowerClass('private', 'private', [deterministicVerified('artifact-1')])).toBe(false);
    expect(canLowerClass('private', 'private', [])).toBe(false);
  });

  it('fails closed on a class outside the vocabulary', () => {
    expect(() => canLowerClass('sensitive', 'confidential' as DataClass, [])).toThrow(RangeError);
  });
});

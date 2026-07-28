/**
 * The derivation half of the Slice 1 exit gate ("replaying the same capture
 * produces one source and one work item"). The database half — the unique
 * indexes and the `ON CONFLICT` path — is in
 * `integration/capture-idempotency.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { captureIdempotencyKey, occurrenceIdempotencyKey } from './capture-key.js';
import type { CaptureIdentity } from './capture-key.js';

const base: CaptureIdentity = {
  cellId: 'cell-steven',
  kind: 'url',
  contentHash: `sha256:${'ab'.repeat(32)}`,
  originUri: 'https://example.com/article',
};

describe('captureIdempotencyKey', () => {
  it('is deterministic', () => {
    const first = captureIdempotencyKey(base);
    for (let i = 0; i < 50; i += 1) expect(captureIdempotencyKey(base)).toBe(first);
  });

  it('does not depend on property insertion order', () => {
    const reordered: CaptureIdentity = {
      originUri: base.originUri,
      contentHash: base.contentHash,
      kind: base.kind,
      cellId: base.cellId,
    };
    expect(captureIdempotencyKey(reordered)).toBe(captureIdempotencyKey(base));
  });

  it('is 64 lowercase hex characters', () => {
    expect(captureIdempotencyKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any contributing field changes', () => {
    const key = captureIdempotencyKey(base);
    expect(captureIdempotencyKey({ ...base, cellId: 'cell-other' })).not.toBe(key);
    expect(captureIdempotencyKey({ ...base, kind: 'document' })).not.toBe(key);
    expect(captureIdempotencyKey({ ...base, contentHash: `sha256:${'cd'.repeat(32)}` })).not.toBe(key);
    expect(captureIdempotencyKey({ ...base, originUri: 'https://example.com/other' })).not.toBe(key);
    expect(captureIdempotencyKey({ ...base, externalId: 'x' })).not.toBe(key);
    expect(captureIdempotencyKey({ ...base, externalProviderId: 'gmail' })).not.toBe(key);
    expect(captureIdempotencyKey({ ...base, externalAccountId: 'acct-1' })).not.toBe(key);
  });

  it('does not depend on when the capture happened, so a re-fetch is the same source', () => {
    // `capturedAt` is deliberately not part of the identity; there is no way to
    // pass it, and this test documents that as intentional.
    expect(Object.keys(base)).not.toContain('capturedAt');
  });

  it('distinguishes an absent field from an empty one', () => {
    const absent = captureIdempotencyKey({ ...base, externalId: undefined });
    const empty = captureIdempotencyKey({ ...base, externalId: '' });
    expect(absent).not.toBe(empty);
  });

  it('cannot be collided by shifting content between adjacent fields', () => {
    // Without length prefixes, "a" + "|" + "b" and "a|" + "" + "b" collide, and
    // a collision here silently merges two different sources into one row.
    const a = captureIdempotencyKey({
      ...base,
      externalProviderId: 'gmail',
      externalAccountId: 'steven',
    });
    const b = captureIdempotencyKey({
      ...base,
      externalProviderId: 'gmailsteven',
      externalAccountId: '',
    });
    const c = captureIdempotencyKey({
      ...base,
      externalProviderId: 'gmail|steven',
      externalAccountId: undefined,
    });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('cannot be collided by moving separator characters between fields', () => {
    const a = captureIdempotencyKey({ ...base, originUri: 'x:1', externalId: '2' });
    const b = captureIdempotencyKey({ ...base, originUri: 'x', externalId: '1:2' });
    expect(a).not.toBe(b);
  });

  it('treats the same bytes from two different origins as two sources', () => {
    const fromWeb = captureIdempotencyKey({ ...base, originUri: 'https://a.example/x' });
    const fromEmail = captureIdempotencyKey({ ...base, originUri: 'https://b.example/x' });
    expect(fromWeb).not.toBe(fromEmail);
  });

  it('never merges across cells (FRANK-§2.4)', () => {
    const cells = new Set(
      ['cell-steven', 'cell-a', 'cell-b'].map((cellId) => captureIdempotencyKey({ ...base, cellId })),
    );
    expect(cells.size).toBe(3);
  });
});

describe('occurrenceIdempotencyKey (WORK-005)', () => {
  const series = '01920000-0000-7000-8000-0000000000aa';

  it('is deterministic', () => {
    const key = occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'Australia/Melbourne');
    expect(occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'Australia/Melbourne')).toBe(key);
  });

  it('produces ONE key for a local time that occurs twice on a DST fall-back night', () => {
    // Australia/Melbourne leaves daylight saving on 2026-04-05: 03:00 becomes
    // 02:00, so local 02:30 happens at 15:30Z and again at 16:30Z. Keying on the
    // UTC instant would create two occurrences of a daily 02:30 routine; keying
    // on the local wall-clock time plus the zone creates one.
    const first = occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'Australia/Melbourne');
    const second = occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'Australia/Melbourne');
    expect(second).toBe(first);

    const asInstants = new Set([
      new Date('2026-04-04T15:30:00Z').toISOString(),
      new Date('2026-04-04T16:30:00Z').toISOString(),
    ]);
    expect(asInstants.size).toBe(2); // the trap this construction avoids
  });

  it('distinguishes two consecutive days of the same series', () => {
    const day1 = occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'Australia/Melbourne');
    const day2 = occurrenceIdempotencyKey(series, '2026-04-06T02:30:00', 'Australia/Melbourne');
    expect(day1).not.toBe(day2);
  });

  it('distinguishes the same local time in two zones', () => {
    const melbourne = occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'Australia/Melbourne');
    const london = occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'Europe/London');
    expect(melbourne).not.toBe(london);
  });

  it('distinguishes two series with the same schedule', () => {
    const other = '01920000-0000-7000-8000-0000000000bb';
    expect(occurrenceIdempotencyKey(series, '2026-04-05T02:30:00', 'UTC')).not.toBe(
      occurrenceIdempotencyKey(other, '2026-04-05T02:30:00', 'UTC'),
    );
  });

  it('rejects a UTC instant, which would reintroduce the daylight-saving bug', () => {
    for (const bogus of [
      '2026-04-05T02:30:00Z',
      '2026-04-05T02:30:00z',
      '2026-04-05T02:30:00+11:00',
      '2026-04-05T02:30:00-0500',
    ]) {
      expect(() => occurrenceIdempotencyKey(series, bogus, 'Australia/Melbourne'), bogus).toThrow(
        /local wall-clock time/,
      );
    }
  });
});

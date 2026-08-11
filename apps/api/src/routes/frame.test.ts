import { describe, expect, it } from 'vitest';

import { startOfDayInTimeZone } from './frame.js';

describe('startOfDayInTimeZone', () => {
  it('uses Perth local midnight before and after the UTC boundary', () => {
    expect(startOfDayInTimeZone(new Date('2026-08-10T15:59:59.000Z'), 'Australia/Perth').toISOString())
      .toBe('2026-08-09T16:00:00.000Z');
    expect(startOfDayInTimeZone(new Date('2026-08-10T16:00:00.000Z'), 'Australia/Perth').toISOString())
      .toBe('2026-08-10T16:00:00.000Z');
  });
});

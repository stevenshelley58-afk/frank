import { describe, expect, it } from 'vitest';

import {
  hasStrictBrowserMutationProvenance,
  isAllowedBrowserOperation,
} from './route';

describe('browser Domain API allowlist', () => {
  it('permits only the shell and Console operation surface', () => {
    expect(isAllowedBrowserOperation('GET', '/v1/frame')).toBe(true);
    expect(isAllowedBrowserOperation('GET', '/v1/missions')).toBe(true);
    expect(isAllowedBrowserOperation('GET', '/v1/missions/mission-1')).toBe(true);
    expect(isAllowedBrowserOperation('POST', '/v1/chats')).toBe(true);
    expect(isAllowedBrowserOperation('POST', '/v1/work/item-1/commands/approve')).toBe(true);
    expect(isAllowedBrowserOperation('POST', '/v1/work/item-1/commands/ready')).toBe(true);
    expect(isAllowedBrowserOperation('POST', '/v1/work/item-1/commands/cancel')).toBe(true);
    expect(isAllowedBrowserOperation('POST', '/v1/codegraph/project-1/refresh')).toBe(true);
    expect(isAllowedBrowserOperation('POST', '/v1/missions')).toBe(false);
    expect(isAllowedBrowserOperation('POST', '/v1/system/rebuild')).toBe(false);
  });

  it('requires matching Origin or same-origin Fetch Metadata for mutations', () => {
    const base = 'http://web:3001/api/v1/chats';
    const forwarded = { 'x-forwarded-host': 'frank.fail', 'x-forwarded-proto': 'https' };
    expect(hasStrictBrowserMutationProvenance(new Request(base, { headers: { ...forwarded, origin: 'https://frank.fail' }))).toBe(true);
    expect(hasStrictBrowserMutationProvenance(new Request(base, { headers: { ...forwarded, 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(hasStrictBrowserMutationProvenance(new Request(base, { headers: forwarded })).toBe(false);
    expect(hasStrictBrowserMutationProvenance(new Request(base, { headers: { ...forwarded, origin: 'https://attacker.example' } }))).toBe(false);
  });
});

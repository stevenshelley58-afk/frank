import { describe, expect, it } from 'vitest';

import {
  hasStrictBrowserMutationProvenance,
  isAllowedBrowserOperation,
} from './policy';

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

  it('exposes only bounded codegraph reads with validated identifiers', () => {
    const jobId = '0123456789abcdef0123456789abcdef';

    expect(isAllowedBrowserOperation('GET', '/v1/codegraph/frank/overview')).toBe(true);
    expect(isAllowedBrowserOperation('GET', `/v1/codegraph/frank/jobs/${jobId}`)).toBe(true);
    expect(isAllowedBrowserOperation('GET', '/v1/codegraph/frank/status')).toBe(true);

    expect(isAllowedBrowserOperation('GET', '/v1/codegraph/Frank/overview')).toBe(false);
    expect(isAllowedBrowserOperation('GET', '/v1/codegraph/1frank/overview')).toBe(false);
    expect(isAllowedBrowserOperation('GET', `/v1/codegraph/frank/jobs/${jobId.toUpperCase()}`)).toBe(false);
    expect(isAllowedBrowserOperation('GET', `/v1/codegraph/frank/jobs/${jobId.slice(1)}`)).toBe(false);
    expect(isAllowedBrowserOperation('GET', '/v1/codegraph/frank/jobs')).toBe(false);
    expect(isAllowedBrowserOperation('GET', '/v1/codegraph/frank/raw')).toBe(false);
    expect(isAllowedBrowserOperation('GET', '/v1/codegraph/frank/expand')).toBe(false);
  });

  it('requires matching Origin or same-origin Fetch Metadata for mutations', () => {
    const base = 'http://web:3001/api/v1/chats';
    const forwarded = { 'x-forwarded-host': 'frank.fail', 'x-forwarded-proto': 'https' };
    const matchingOrigin = new Request(base, {
      headers: { ...forwarded, origin: 'https://frank.fail' },
    });
    const sameOriginFetch = new Request(base, {
      headers: { ...forwarded, 'sec-fetch-site': 'same-origin' },
    });
    const missingProvenance = new Request(base, {
      headers: forwarded,
    });
    const attackerOrigin = new Request(base, {
      headers: { ...forwarded, origin: 'https://attacker.example' },
    });

    expect(hasStrictBrowserMutationProvenance(matchingOrigin)).toBe(true);
    expect(hasStrictBrowserMutationProvenance(sameOriginFetch)).toBe(true);
    expect(hasStrictBrowserMutationProvenance(missingProvenance)).toBe(false);
    expect(hasStrictBrowserMutationProvenance(attackerOrigin)).toBe(false);
  });
});

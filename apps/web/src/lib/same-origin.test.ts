import { describe, expect, it } from 'vitest';

import { isSameOriginMutation, requestPublicOrigin } from './same-origin';

describe('same-origin mutation guard', () => {
  it('accepts a public browser origin forwarded to a private container URL', () => {
    const request = new Request('http://web:3001/api/missions', {
      headers: {
        host: 'web:3001',
        origin: 'https://frank.fail',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'frank.fail',
        'x-forwarded-proto': 'https',
      },
    });

    expect(requestPublicOrigin(request)).toBe('https://frank.fail');
    expect(isSameOriginMutation(request)).toBe(true);
  });

  it('rejects a cross-site browser request even when its origin is forged', () => {
    const request = new Request('http://web:3001/api/missions', {
      headers: {
        origin: 'https://frank.fail',
        'sec-fetch-site': 'cross-site',
        'x-forwarded-host': 'frank.fail',
        'x-forwarded-proto': 'https',
      },
    });

    expect(isSameOriginMutation(request)).toBe(false);
  });

  it('rejects an origin that does not match the forwarded public origin', () => {
    const request = new Request('http://web:3001/api/missions', {
      headers: {
        origin: 'https://attacker.example',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'frank.fail',
        'x-forwarded-proto': 'https',
      },
    });

    expect(isSameOriginMutation(request)).toBe(false);
  });
});

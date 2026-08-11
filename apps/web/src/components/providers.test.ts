import { describe, expect, it } from 'vitest';

import { shouldMintBrowserDevSession } from './providers';

describe('browser dev-session policy', () => {
  it('permits browser bearer minting only for local Next development', () => {
    expect(shouldMintBrowserDevSession('development')).toBe(true);
    expect(shouldMintBrowserDevSession('production')).toBe(false);
    expect(shouldMintBrowserDevSession('test')).toBe(false);
  });
});

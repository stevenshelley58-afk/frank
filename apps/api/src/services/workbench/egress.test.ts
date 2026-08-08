/**
 * SS-03 egress policy builder tests. Pure functions — no Docker, no srt.
 * The invariants under test: allowlist -> policy, empty/absent -> deny-all
 * (never "everything"), and malformed entries fail loudly.
 */
import { describe, expect, it } from 'vitest';

import {
  buildEgressPolicy,
  isDenyAll,
  normalizeEgressDomain,
} from './egress.js';
import type { WorkbenchTaskDef } from './types.js';

describe('buildEgressPolicy', () => {
  it('allowlist -> allowlist policy with normalized domains in order', () => {
    const taskDef: WorkbenchTaskDef = {
      instruction: 'x',
      network: {
        egressAllowlist: ['registry.npmjs.org', 'GitHub.com', 'preview.frank.fail'],
      },
    };
    const policy = buildEgressPolicy(taskDef);
    expect(policy).toEqual({
      mode: 'allowlist',
      domains: ['registry.npmjs.org', 'github.com', 'preview.frank.fail'],
    });
  });

  it('empty allowlist -> deny-all (never "everything")', () => {
    const policy = buildEgressPolicy({
      instruction: 'x',
      network: { egressAllowlist: [] },
    });
    expect(policy).toEqual({ mode: 'deny-all', domains: [] });
    expect(isDenyAll(policy)).toBe(true);
  });

  it('absent network stanza -> deny-all', () => {
    expect(buildEgressPolicy({ instruction: 'x' })).toEqual({
      mode: 'deny-all',
      domains: [],
    });
  });

  it('absent egressAllowlist on a present network stanza -> deny-all', () => {
    expect(buildEgressPolicy({ instruction: 'x', network: {} })).toEqual({
      mode: 'deny-all',
      domains: [],
    });
  });

  it('normalizes case/whitespace and deduplicates', () => {
    const policy = buildEgressPolicy({
      instruction: 'x',
      network: {
        egressAllowlist: ['  Example.COM ', 'example.com', 'EXAMPLE.com:8443'],
      },
    });
    expect(policy.mode).toBe('allowlist');
    expect(policy.domains).toEqual(['example.com', 'example.com:8443']);
  });

  it('accepts wildcard subdomain entries', () => {
    const policy = buildEgressPolicy({
      instruction: 'x',
      network: { egressAllowlist: ['*.frank.fail'] },
    });
    expect(policy).toEqual({ mode: 'allowlist', domains: ['*.frank.fail'] });
  });

  it('rejects URLs, paths, and credentials with a loud error', () => {
    for (const bad of [
      'https://example.com',
      'example.com/path',
      'user:pass@example.com',
      'exam ple.com',
      '',
      '   ',
    ]) {
      expect(() =>
        buildEgressPolicy({ instruction: 'x', network: { egressAllowlist: [bad] } }),
      ).toThrow(/egress/i);
    }
  });
});

describe('normalizeEgressDomain', () => {
  it('trims and lowercases', () => {
    expect(normalizeEgressDomain('  Registry.NPMJS.org ')).toBe('registry.npmjs.org');
  });

  it('throws on empty or non-hostname input', () => {
    expect(() => normalizeEgressDomain('')).toThrow(/empty/);
    expect(() => normalizeEgressDomain('not a host')).toThrow(/hostname/);
  });
});

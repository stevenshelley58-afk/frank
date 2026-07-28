import { describe, expect, it } from 'vitest';

import {
  isTerminalDeny,
  requiresReview,
  type PolicyDecision,
  type PolicyResult,
} from './policy.js';

const decision = (result: PolicyResult): PolicyDecision => ({
  schema: 'frank.policy-decision/v1',
  result,
  policyVersion: 'action-policy/2026.07.1',
  reasons: ['fixture'],
  evaluatedEnvelopeHash: `sha256:${'0'.repeat(64)}`,
  limits: {
    budget: { currency: 'AUD', maximumSpend: 0.5, maximumWallClockSeconds: 120 },
    networkScope: { mode: 'none', allowedHosts: [] },
    maximumDataClass: 'private',
  },
  obligations: [],
});

const ALL_RESULTS: readonly PolicyResult[] = [
  'allow',
  'allow_with_limits',
  'hold_for_review',
  'deny',
];

describe('isTerminalDeny', () => {
  it('is true only for deny', () => {
    expect(isTerminalDeny(decision('deny'))).toBe(true);
    expect(isTerminalDeny(decision('allow'))).toBe(false);
    expect(isTerminalDeny(decision('allow_with_limits'))).toBe(false);
    expect(isTerminalDeny(decision('hold_for_review'))).toBe(false);
  });
});

describe('requiresReview', () => {
  it('is true only for hold_for_review', () => {
    expect(requiresReview(decision('hold_for_review'))).toBe(true);
    expect(requiresReview(decision('allow'))).toBe(false);
    expect(requiresReview(decision('allow_with_limits'))).toBe(false);
    expect(requiresReview(decision('deny'))).toBe(false);
  });
});

describe('policy helpers together', () => {
  it('never classify one decision as both denied and held', () => {
    for (const result of ALL_RESULTS) {
      const d = decision(result);
      expect(isTerminalDeny(d) && requiresReview(d)).toBe(false);
    }
  });

  it('leave exactly the two allow results as neither denied nor held', () => {
    const passthrough = ALL_RESULTS.filter((result) => {
      const d = decision(result);
      return !isTerminalDeny(d) && !requiresReview(d);
    });
    expect(passthrough).toEqual(['allow', 'allow_with_limits']);
  });
});

/**
 * The FRANK-§7.6 table, checked against the specification's own words.
 *
 * These are structural tests on data, which is only possible *because* §7.6 is
 * data. If the table were a chain of conditionals there would be nothing here to
 * assert except behaviour, and "every row of the spec is present" would be
 * untestable.
 */

import { describe, expect, it } from 'vitest';

import {
  CONDITION_KINDS,
  DEFAULT_OPERATING_POLICY,
  OPERATION_CATALOGUE,
  POLICY_VERSION,
  operationDefinition,
  ruleForCategory,
} from './operating-policy.js';
import type { ConditionId, OperationCategory } from './operating-policy.js';

/**
 * The "Action" column of FRANK-§7.6, verbatim and in order. Copied from the
 * specification, not from the implementation — that is the whole point of
 * having it here twice.
 */
const SPEC_ACTIONS: readonly string[] = [
  'Read, research, classify, summarise, plan',
  'Create internal records, branches, tests, docs, backups, and previews',
  'Install dependencies inside disposable build environments',
  'Commit and push to non-production branches',
  'Open and update review requests',
  'Apply non-production maintenance',
  "Promote FRANK's own autonomous self-update",
  'Promote another managed app to production',
  'Send routine external actions covered by a standing policy',
  'Publish broadly, move money, sign terms, delete irreplaceable data, or change trust roots',
];

describe('FRANK-§7.6 default operating policy, as data', () => {
  it('has exactly the ten rows of the specification table, in order', () => {
    expect(DEFAULT_OPERATING_POLICY.map((rule) => rule.action)).toEqual(SPEC_ACTIONS);
  });

  it('every row carries the specification\'s "Default" text', () => {
    for (const rule of DEFAULT_OPERATING_POLICY) {
      expect(rule.default.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_OPERATING_POLICY.find((r) => r.id === 'observe')?.default).toBe(
      'Run automatically',
    );
    expect(DEFAULT_OPERATING_POLICY.find((r) => r.id === 'frank_self_update')?.default).toBe(
      "Hold the completed evidence pack for Steven's review by default",
    );
    expect(DEFAULT_OPERATING_POLICY.find((r) => r.id === 'consequential')?.default).toBe(
      'Hold unless a narrow standing policy explicitly covers it',
    );
  });

  it('no row can produce an outright allow when its conditions are unmet', () => {
    for (const rule of DEFAULT_OPERATING_POLICY) {
      expect(rule.whenUnsatisfied).not.toBe('allow');
      expect(rule.whenUnsatisfied).not.toBe('allow_with_limits');
    }
  });

  it("the self-update row holds even when satisfied — 'by default' is unconditional", () => {
    const rule = DEFAULT_OPERATING_POLICY.find((r) => r.id === 'frank_self_update');
    expect(rule?.whenSatisfied).toBe('hold_for_review');
    expect(rule?.whenUnsatisfied).toBe('hold_for_review');
  });

  it('the non-production maintenance row encodes all five conditions of its sentence', () => {
    const rule = DEFAULT_OPERATING_POLICY.find((r) => r.id === 'non_production_maintenance');
    expect(rule?.requiredConditions).toEqual([
      'envelope_names_exact_target',
      'excludes_production_data_and_credentials',
      'supplies_tested_recovery_path',
      'passes_pre_and_post_health_checks',
      'within_resource_and_spend_limits',
    ]);
  });

  it('the consequential row requires a NARROW authorization, not merely any', () => {
    const rule = DEFAULT_OPERATING_POLICY.find((r) => r.id === 'consequential');
    expect(rule?.requiredConditions).toContain('covered_by_narrow_standing_authorization');
    expect(rule?.requiredConditions).not.toContain('covered_by_standing_authorization');
  });

  it('every operation category has exactly one rule', () => {
    const categories = new Set<OperationCategory>();
    for (const rule of DEFAULT_OPERATING_POLICY) {
      for (const category of rule.categories) {
        expect(categories.has(category)).toBe(false);
        categories.add(category);
      }
    }
    for (const category of categories) {
      expect(ruleForCategory(category)).toBeDefined();
    }
  });

  it('every condition a rule names has a declared kind', () => {
    const declared = new Set(Object.keys(CONDITION_KINDS) as ConditionId[]);
    for (const rule of DEFAULT_OPERATING_POLICY) {
      for (const condition of rule.requiredConditions) {
        expect(declared.has(condition)).toBe(true);
      }
    }
  });

  it('rule ceilings are finite, non-negative, and never permit unbounded retries', () => {
    for (const rule of DEFAULT_OPERATING_POLICY) {
      const spend = Number.parseFloat(rule.ceilings.maximumSpend);
      expect(Number.isFinite(spend)).toBe(true);
      expect(spend).toBeGreaterThanOrEqual(0);
      expect(rule.ceilings.maximumWallClockSeconds).toBeGreaterThan(0);
      expect(rule.ceilings.retryLimit).toBeGreaterThanOrEqual(0);
      expect(rule.ceilings.retryLimit).toBeLessThanOrEqual(3);
      // FRANK-§2.3: `secret` is never a processing class.
      expect(rule.ceilings.maximumDataClass).not.toBe('secret');
    }
  });

  it('the consequential row has the tightest ceilings in the table', () => {
    const consequential = DEFAULT_OPERATING_POLICY.find((r) => r.id === 'consequential');
    expect(consequential?.ceilings.retryLimit).toBe(0);
    for (const rule of DEFAULT_OPERATING_POLICY) {
      expect(rule.ceilings.retryLimit).toBeGreaterThanOrEqual(
        consequential?.ceilings.retryLimit ?? 0,
      );
    }
  });

  it('the policy version is a stable, versioned identifier', () => {
    expect(POLICY_VERSION).toMatch(/^frank\.operating-policy\//);
  });
});

describe('operation catalogue', () => {
  it('maps every operation to a category that has a rule', () => {
    for (const definition of Object.values(OPERATION_CATALOGUE)) {
      expect(ruleForCategory(definition.category)).toBeDefined();
    }
  });

  it('never permits an operation to touch `secret`-class data', () => {
    for (const definition of Object.values(OPERATION_CATALOGUE)) {
      // The type already forbids it; this proves the data agrees with the type
      // even if the catalogue is ever loaded from JSON.
      expect(definition.maximumDataClass).not.toBe('secret');
    }
  });

  it('defaults an unknown operation to undefined rather than to a permissive row', () => {
    expect(operationDefinition('definitely.not.an.operation')).toBeUndefined();
  });

  it('is not reachable through prototype pollution', () => {
    expect(operationDefinition('constructor')).toBeUndefined();
    expect(operationDefinition('toString')).toBeUndefined();
    expect(operationDefinition('__proto__')).toBeUndefined();
  });

  it('declares work.transition single-use and source.capture replay-safe', () => {
    expect(operationDefinition('work.transition')?.idempotency).toBe('single_use');
    expect(operationDefinition('source.capture')?.idempotency).toBe('idempotent_replayable');
  });
});

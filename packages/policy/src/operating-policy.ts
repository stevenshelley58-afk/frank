/**
 * FRANK-§7.6 — "Steven's default operating policy" — encoded as data.
 *
 * The task brief for this package is explicit: *encode §7.6's table as data, not
 * scattered conditionals*. So the ten rows of that table are ten entries in
 * {@link DEFAULT_OPERATING_POLICY}, each carrying the specification's own words
 * in `action` and `default` so a reviewer can diff the code against the spec by
 * reading one column, and each naming its conditions by id rather than by
 * closure.
 *
 * The engine (`engine.ts`) contains no `if (operation === …)` anywhere. It looks
 * a row up, evaluates the row's named conditions through
 * {@link CONDITION_EVALUATORS}, and intersects limits. Changing Steven's policy
 * is a change to this file and a bump of {@link POLICY_VERSION}; it is not a
 * change to the evaluator.
 *
 * ## Why conditions are ids and not functions
 *
 * A rule that carried a predicate could not be serialized, diffed, exported into
 * an evidence pack, or shown to Steven in the `/automations` screen. FRANK-§6.9
 * puts `policyVersion` inside every decision precisely so a decision can be
 * re-explained later against the exact rules that produced it, and that is only
 * possible if the rules are values.
 *
 * ## Computed conditions versus attested conditions
 *
 * Some of §7.6's conditions are facts about the envelope and the policy engine
 * can check them itself ("names the exact target", "stays inside resource and
 * spend limits"). Others are facts about the world that the engine cannot
 * observe ("passes pre/post health checks", "supplies a tested recovery path").
 *
 * That difference is recorded per condition in {@link CONDITION_KINDS} and it is
 * load-bearing:
 *
 *   * a **computed** condition ignores any attestation offered for it. Otherwise
 *     a caller could assert "yes, within spend limits" and widen its own budget,
 *     which is exactly the privilege-inheritance attack FRANK-§6.9 requires us to
 *     fail;
 *   * an **attested** condition is unmet unless an attestation exists *and* its
 *     attestor is in the evaluation's trusted-attestor set. A missing
 *     attestation is never "probably fine": FRANK-§2.3's fail-closed rule
 *     applies to conditions as much as to classifications.
 */

import type { ActionClass, DataClass, NetworkScopeMode, PolicyResult } from '@frank/contracts';

/**
 * The version stamped into every {@link PolicyDecision}. Bump on any change to
 * this file. FRANK-§11.5 stores it on the audit entry, so a decision made under
 * an older policy stays explainable after the policy changes.
 */
export const POLICY_VERSION = 'frank.operating-policy/2026.07.28+slice1';

/**
 * The ten "Action" rows of the FRANK-§7.6 table, as a closed vocabulary.
 *
 * An operation maps to exactly one category (see {@link OPERATION_CATALOGUE}).
 * An operation that maps to none is not "uncovered" — it is *unknown*, and
 * unknown fails closed with `deny` rather than `hold_for_review`. The difference
 * matters: `hold_for_review` tells Steven "decide this", which is only a useful
 * thing to say about an action the system can describe.
 */
export type OperationCategory =
  | 'read_research_classify_summarise_plan'
  | 'create_internal_record'
  | 'install_dependency_in_disposable_environment'
  | 'commit_push_non_production'
  | 'open_or_update_review_request'
  | 'apply_non_production_maintenance'
  | 'promote_frank_self_update'
  | 'promote_managed_app_to_production'
  | 'send_routine_external_action'
  | 'publish_move_money_sign_delete_or_change_trust_root';

/** The conditions §7.6 names, plus the two the standing-policy rows depend on. */
export type ConditionId =
  /** §7.6: "names the exact target". */
  | 'envelope_names_exact_target'
  /** §7.6: "excludes production data and credentials". */
  | 'excludes_production_data_and_credentials'
  /** §7.6: "supplies a tested recovery path". */
  | 'supplies_tested_recovery_path'
  /** §7.6: "passes pre/post health checks". */
  | 'passes_pre_and_post_health_checks'
  /** §7.6: "stays inside resource and spend limits". */
  | 'within_resource_and_spend_limits'
  /** §7.6: "covered by a standing policy". */
  | 'covered_by_standing_authorization'
  /** §7.6: "unless a narrow standing policy explicitly covers it". */
  | 'covered_by_narrow_standing_authorization'
  /** §7.6: "with provenance and scans" (dependency installation). */
  | 'provenance_recorded'
  | 'dependency_scan_passed';

export type ConditionKind = 'computed' | 'attested';

/**
 * Which conditions the engine decides for itself and which it will only accept
 * from a trusted attestor. See the module comment for why this split exists.
 */
export const CONDITION_KINDS: Readonly<Record<ConditionId, ConditionKind>> = {
  envelope_names_exact_target: 'computed',
  within_resource_and_spend_limits: 'computed',
  covered_by_standing_authorization: 'computed',
  covered_by_narrow_standing_authorization: 'computed',
  excludes_production_data_and_credentials: 'attested',
  supplies_tested_recovery_path: 'attested',
  passes_pre_and_post_health_checks: 'attested',
  provenance_recorded: 'attested',
  dependency_scan_passed: 'attested',
};

/**
 * Ceilings a rule imposes regardless of what the envelope asks for.
 *
 * FRANK-§7.6 gives no numbers, so these are FRANK-§7.6-shaped judgements rather
 * than quotations, and they are here — as data, versioned by
 * {@link POLICY_VERSION} — rather than as constants in the evaluator so that
 * tuning them is a policy change with an audit trail.
 *
 * They are ceilings, never grants: the effective limit is the *minimum* of the
 * rule, the envelope, and any matched standing authorization. A rule can only
 * ever narrow.
 */
export interface RuleCeilings {
  /** Decimal string, matching the `numeric` discipline in FIN-002. */
  readonly maximumSpend: string;
  readonly currency: string;
  readonly maximumWallClockSeconds: number;
  readonly maximumTokens: number;
  readonly maximumDataClass: DataClass;
  readonly networkScope: NetworkScopeMode;
  readonly retryLimit: number;
}

export interface OperatingPolicyRule {
  readonly id: string;
  /** The FRANK-§7.6 "Action" cell, verbatim. */
  readonly action: string;
  /** The FRANK-§7.6 "Default" cell, verbatim. */
  readonly default: string;
  readonly categories: readonly OperationCategory[];
  /**
   * The action classes this row covers. An envelope whose declared
   * `actionClass` is outside this set is denied rather than re-classified:
   * FRANK-§6.9 says models may propose envelopes but cannot widen them, and
   * silently accepting a mislabelled class is a widening.
   */
  readonly actionClasses: readonly ActionClass[];
  readonly requiredConditions: readonly ConditionId[];
  /** Outcome when every required condition holds. */
  readonly whenSatisfied: PolicyResult;
  /** Outcome when any required condition does not hold. Never `allow`. */
  readonly whenUnsatisfied: PolicyResult;
  /** FRANK-§6.9 `PolicyDecision.obligations`. */
  readonly obligations: readonly string[];
  readonly ceilings: RuleCeilings;
}

const OBSERVE_CEILINGS: RuleCeilings = {
  maximumSpend: '2.00',
  currency: 'USD',
  maximumWallClockSeconds: 300,
  maximumTokens: 200_000,
  maximumDataClass: 'sensitive',
  networkScope: 'proxied-allowlist',
  retryLimit: 3,
};

const INTERNAL_CEILINGS: RuleCeilings = {
  maximumSpend: '5.00',
  currency: 'USD',
  maximumWallClockSeconds: 900,
  maximumTokens: 400_000,
  maximumDataClass: 'sensitive',
  networkScope: 'none',
  retryLimit: 3,
};

const BUILD_CEILINGS: RuleCeilings = {
  maximumSpend: '10.00',
  currency: 'USD',
  maximumWallClockSeconds: 3_600,
  maximumTokens: 1_000_000,
  // A disposable build environment is explicitly not a place for personal data.
  maximumDataClass: 'internal',
  networkScope: 'proxied-allowlist',
  retryLimit: 2,
};

const MAINTENANCE_CEILINGS: RuleCeilings = {
  maximumSpend: '10.00',
  currency: 'USD',
  maximumWallClockSeconds: 1_800,
  maximumDataClass: 'internal',
  networkScope: 'allowlist',
  maximumTokens: 200_000,
  retryLimit: 1,
};

const EXTERNAL_CEILINGS: RuleCeilings = {
  maximumSpend: '5.00',
  currency: 'USD',
  maximumWallClockSeconds: 300,
  maximumDataClass: 'private',
  networkScope: 'allowlist',
  maximumTokens: 100_000,
  retryLimit: 1,
};

/**
 * The row of last resort for consequential actions. Its ceilings are deliberately
 * the tightest in the table: even when a narrow standing authorization exists,
 * the action executes inside a single-attempt, allowlisted, minute-scale budget.
 */
const CONSEQUENTIAL_CEILINGS: RuleCeilings = {
  maximumSpend: '1.00',
  currency: 'USD',
  maximumWallClockSeconds: 120,
  maximumDataClass: 'private',
  networkScope: 'allowlist',
  maximumTokens: 50_000,
  retryLimit: 0,
};

/**
 * FRANK-§7.6, in table order.
 *
 * Order is not significant to the evaluator — an operation belongs to exactly
 * one category, so at most one row matches — but it is preserved so the file
 * reads against the specification top to bottom.
 */
export const DEFAULT_OPERATING_POLICY: readonly OperatingPolicyRule[] = [
  {
    id: 'observe',
    action: 'Read, research, classify, summarise, plan',
    default: 'Run automatically',
    categories: ['read_research_classify_summarise_plan'],
    actionClasses: ['observe'],
    requiredConditions: [],
    whenSatisfied: 'allow',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['record_data_route_decision'],
    ceilings: OBSERVE_CEILINGS,
  },
  {
    id: 'internal_records',
    action:
      'Create internal records, branches, tests, docs, backups, and previews',
    default: 'Run automatically',
    categories: ['create_internal_record'],
    actionClasses: ['internal_reversible'],
    requiredConditions: [],
    whenSatisfied: 'allow',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['record_audit_entry'],
    ceilings: INTERNAL_CEILINGS,
  },
  {
    id: 'disposable_dependency_install',
    action: 'Install dependencies inside disposable build environments',
    default: 'Run automatically with provenance and scans',
    categories: ['install_dependency_in_disposable_environment'],
    actionClasses: ['internal_reversible'],
    requiredConditions: ['provenance_recorded', 'dependency_scan_passed'],
    // "with provenance and scans" is a condition on running automatically, so a
    // satisfied rule is `allow_with_limits` (the obligations ride along) and an
    // unsatisfied one is held rather than denied — the install is legitimate,
    // the evidence is missing.
    whenSatisfied: 'allow_with_limits',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['record_dependency_provenance', 'record_scan_result'],
    ceilings: BUILD_CEILINGS,
  },
  {
    id: 'commit_push_non_production',
    action: 'Commit and push to non-production branches',
    default: 'Run automatically',
    categories: ['commit_push_non_production'],
    actionClasses: ['internal_reversible'],
    requiredConditions: [],
    whenSatisfied: 'allow',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['record_audit_entry'],
    ceilings: INTERNAL_CEILINGS,
  },
  {
    id: 'review_requests',
    action: 'Open and update review requests',
    default: 'Run automatically',
    categories: ['open_or_update_review_request'],
    actionClasses: ['internal_reversible'],
    requiredConditions: [],
    whenSatisfied: 'allow',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['record_audit_entry'],
    ceilings: INTERNAL_CEILINGS,
  },
  {
    id: 'non_production_maintenance',
    action: 'Apply non-production maintenance',
    default:
      'Run automatically only when the signed Action Envelope names the exact target, excludes production data and credentials, supplies a tested recovery path, passes pre/post health checks, and stays inside resource and spend limits; otherwise hold for Review',
    categories: ['apply_non_production_maintenance'],
    actionClasses: ['external_reversible'],
    // The five conditions of the §7.6 cell, in the order the sentence lists them.
    requiredConditions: [
      'envelope_names_exact_target',
      'excludes_production_data_and_credentials',
      'supplies_tested_recovery_path',
      'passes_pre_and_post_health_checks',
      'within_resource_and_spend_limits',
    ],
    whenSatisfied: 'allow_with_limits',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['record_audit_entry', 'record_recovery_path', 'record_health_check_results'],
    ceilings: MAINTENANCE_CEILINGS,
  },
  {
    id: 'frank_self_update',
    action: "Promote FRANK's own autonomous self-update",
    default: "Hold the completed evidence pack for Steven's review by default",
    categories: ['promote_frank_self_update'],
    actionClasses: ['destructive_or_privileged'],
    // No condition can satisfy this row automatically. `requiredConditions` is
    // empty and `whenSatisfied` is still `hold_for_review`, which is the encoded
    // form of "by default": the row holds unconditionally, and the only way past
    // it is a human decision recorded elsewhere, not a condition the proposer
    // can arrange to be true.
    requiredConditions: [],
    whenSatisfied: 'hold_for_review',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['attach_evidence_pack', 'require_owner_review'],
    ceilings: CONSEQUENTIAL_CEILINGS,
  },
  {
    id: 'promote_managed_app',
    action: 'Promote another managed app to production',
    default:
      "Apply that project's standing release policy; it may auto-promote after gates if Steven configured it",
    categories: ['promote_managed_app_to_production'],
    actionClasses: ['financial_or_public', 'destructive_or_privileged'],
    requiredConditions: ['covered_by_standing_authorization', 'within_resource_and_spend_limits'],
    whenSatisfied: 'allow_with_limits',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['attach_evidence_pack', 'record_release_decision'],
    ceilings: CONSEQUENTIAL_CEILINGS,
  },
  {
    id: 'routine_external_action',
    action: 'Send routine external actions covered by a standing policy',
    default: 'Run automatically and record the exact action',
    categories: ['send_routine_external_action'],
    actionClasses: ['external_reversible'],
    requiredConditions: ['covered_by_standing_authorization', 'within_resource_and_spend_limits'],
    whenSatisfied: 'allow_with_limits',
    whenUnsatisfied: 'hold_for_review',
    // "record the exact action" — FRANK-§4.3 COMMS-008 says the same thing about
    // outbound communication, and it is an obligation on the decision, not a
    // hope about the executor.
    obligations: ['record_exact_action_content', 'record_audit_entry'],
    ceilings: EXTERNAL_CEILINGS,
  },
  {
    id: 'consequential',
    action:
      'Publish broadly, move money, sign terms, delete irreplaceable data, or change trust roots',
    default: 'Hold unless a narrow standing policy explicitly covers it',
    categories: ['publish_move_money_sign_delete_or_change_trust_root'],
    actionClasses: ['financial_or_public', 'destructive_or_privileged'],
    requiredConditions: [
      'covered_by_narrow_standing_authorization',
      'envelope_names_exact_target',
      'within_resource_and_spend_limits',
    ],
    whenSatisfied: 'allow_with_limits',
    whenUnsatisfied: 'hold_for_review',
    obligations: ['record_exact_action_content', 'attach_evidence_pack', 'record_audit_entry'],
    ceilings: CONSEQUENTIAL_CEILINGS,
  },
];

/**
 * Idempotency semantics for an operation.
 *
 * FRANK-§6.9: "Envelopes are single-use unless their declared idempotency
 * semantics say otherwise." The frozen `ActionEnvelope` contract has an
 * `idempotencyKey` and a `nonce` but no field that *declares* semantics, and the
 * contract is frozen. So the declaration lives here, per operation, where it is
 * versioned with the policy and cannot be chosen by the proposer — which is the
 * safer reading anyway: an attacker who could declare their own replay
 * semantics would have defeated the single-use rule by asserting it did not
 * apply.
 */
export type IdempotencySemantics =
  /** Default. A second evaluation of the same nonce is denied. */
  | 'single_use'
  /**
   * The operation is naturally idempotent, so replaying the *identical*
   * envelope returns the *original* decision rather than a new one. A replay
   * whose envelope hash differs is still denied — that is the mutation attack
   * wearing a replay costume.
   */
  | 'idempotent_replayable';

export interface OperationDefinition {
  readonly operation: string;
  readonly category: OperationCategory;
  readonly idempotency: IdempotencySemantics;
  /**
   * FRANK-§2.3: the strictest data class this operation may ever touch. `secret`
   * is not a legal value anywhere in this catalogue and the engine rejects an
   * envelope carrying it, because §2.3 says a `secret` is "never placed in model
   * context; opaque handle or brokered operation only".
   */
  readonly maximumDataClass: Exclude<DataClass, 'secret'>;
}

/**
 * The Slice 1 operation catalogue.
 *
 * Deliberately short. An operation absent from this table is denied, so listing
 * an operation nothing implements would create an authorization surface for a
 * capability that does not exist — the same mistake FRANK-§12.5 warns about with
 * unproduced event names.
 */
export const OPERATION_CATALOGUE: Readonly<Record<string, OperationDefinition>> = {
  'source.capture': {
    operation: 'source.capture',
    category: 'create_internal_record',
    // Capture is retried by clients constantly (UX-004 acknowledges in under
    // 500 ms, so a slow network produces retries) and the storage layer is
    // already idempotent on two keys. Denying the retry would turn a network
    // blip into a user-visible failure of a durable write that succeeded.
    idempotency: 'idempotent_replayable',
    maximumDataClass: 'sensitive',
  },
  'work.create': {
    operation: 'work.create',
    category: 'create_internal_record',
    idempotency: 'idempotent_replayable',
    maximumDataClass: 'sensitive',
  },
  'work.transition': {
    operation: 'work.transition',
    category: 'create_internal_record',
    // A state transition is not idempotent: `ready -> active` applied twice is
    // an illegal `active -> active` the second time. Single use.
    idempotency: 'single_use',
    maximumDataClass: 'sensitive',
  },
  'work.assign': {
    operation: 'work.assign',
    category: 'create_internal_record',
    idempotency: 'single_use',
    maximumDataClass: 'sensitive',
  },
  'work.read': {
    operation: 'work.read',
    category: 'read_research_classify_summarise_plan',
    idempotency: 'idempotent_replayable',
    maximumDataClass: 'sensitive',
  },
  'today.read': {
    operation: 'today.read',
    category: 'read_research_classify_summarise_plan',
    idempotency: 'idempotent_replayable',
    maximumDataClass: 'sensitive',
  },
  'provenance.read': {
    operation: 'provenance.read',
    category: 'read_research_classify_summarise_plan',
    idempotency: 'idempotent_replayable',
    maximumDataClass: 'sensitive',
  },
  'system.health.read': {
    operation: 'system.health.read',
    category: 'read_research_classify_summarise_plan',
    idempotency: 'idempotent_replayable',
    maximumDataClass: 'internal',
  },
};

/** The rule covering `category`, or `undefined` if the table has no row for it. */
export function ruleForCategory(category: OperationCategory): OperatingPolicyRule | undefined {
  return DEFAULT_OPERATING_POLICY.find((rule) => rule.categories.includes(category));
}

/** The catalogue entry for `operation`, or `undefined` if it is unknown. */
export function operationDefinition(operation: string): OperationDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(OPERATION_CATALOGUE, operation)
    ? OPERATION_CATALOGUE[operation]
    : undefined;
}

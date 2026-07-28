/**
 * `schema://frank.policy-decision/v1` — FRANK-§6.9.
 *
 * Policy is evaluated at the action boundary, not inferred from the model's
 * confidence. Models may propose envelopes but cannot sign, widen, or approve
 * them. The Policy Service evaluates an immutable envelope; only then may the
 * separate Execution Service exchange approved credential handles for
 * short-lived credentials. Envelopes are single-use unless their declared
 * idempotency semantics say otherwise.
 */

import type { DataClass } from './classification.js';
import type { CurrencyCode, IsoDateTime, PrefixedSha256 } from './common.js';

/** FRANK-§6.9. Maps to the §7.6 default operating policy. */
export type ActionClass =
  | 'observe'
  | 'internal_reversible'
  | 'external_reversible'
  | 'financial_or_public'
  | 'destructive_or_privileged';

export interface ResourceRef {
  kind: string;
  id: string;
  cellId?: string;
}

export interface ResourcePattern {
  kind: string;
  idPattern: string;
}

export type NetworkScopeMode = 'none' | 'allowlist' | 'proxied-allowlist';

/** FRANK-§15.6. Egress is allowlisted per action; "any" is not representable. */
export interface NetworkScope {
  mode: NetworkScopeMode;
  allowedHosts: string[];
}

export interface ActionBudget {
  currency: CurrencyCode;
  maximumSpend: number;
  maximumWallClockSeconds: number;
  maximumTokens?: number;
}

export interface ActionLimits {
  budget: ActionBudget;
  networkScope: NetworkScope;
  maximumDataClass: DataClass;
  retryLimit?: number;
}

export type CompensationKind =
  | 'pre-commit-cancellable'
  | 'atomic-pointer'
  | 'post-commit-compensating';

/**
 * FRANK-§6.9 / BUILD-013. Required when the action's transaction mode is
 * post-commit compensating recovery.
 */
export interface CompensationPlan {
  kind: CompensationKind;
  procedure: string;
  pointOfNoReturn?: string;
}

export type PolicyResult = 'allow' | 'allow_with_limits' | 'hold_for_review' | 'deny';

export interface PolicyDecision {
  schema: 'frank.policy-decision/v1';
  result: PolicyResult;
  policyVersion: string;
  /** Schema requires at least one reason. */
  reasons: string[];
  /**
   * Hash of the exact immutable envelope evaluated. A decision cannot be
   * replayed against a different envelope.
   */
  evaluatedEnvelopeHash: PrefixedSha256;
  matchedAuthorizationId?: string;
  limits: ActionLimits;
  expiresAt?: IsoDateTime;
  obligations: string[];
}

export interface ActionEnvelope {
  schema: 'frank.action/v1';
  actionId: string;
  idempotencyKey: string;
  /**
   * Single-use. Replay of a spent nonce is a mandatory conformance failure
   * (FRANK-§6.9).
   */
  nonce: string;
  cellId: string;
  principalId: string;
  delegatedActorId?: string;
  operation: string;
  actionClass: ActionClass;
  target: ResourceRef;
  recipient?: ResourceRef;
  requestHash: PrefixedSha256;
  artifactDigest?: PrefixedSha256;
  /** Schema requires at least one class. */
  dataClasses: DataClass[];
  /**
   * FRANK-§2.3: opaque handles only. A raw token in this array is a contract
   * violation, not a configuration mistake. Schema pattern:
   * `^handle:[A-Za-z0-9._:-]+$`.
   */
  credentialHandles: string[];
  networkScope: NetworkScope;
  budget: ActionBudget;
  validFrom: IsoDateTime;
  expiresAt: IsoDateTime;
  compensation?: CompensationPlan;
  signerId: string;
  signature: string;
}

export interface StandingAuthorization {
  schema: 'frank.authorization/v1';
  authorizationId: string;
  ownerId: string;
  /** Schema requires at least one actor. */
  allowedActors: string[];
  /** Schema requires at least one operation. */
  operations: string[];
  targetPattern: ResourcePattern;
  recipientPattern?: ResourcePattern;
  maximumDataClass: DataClass;
  credentialScopes: string[];
  networkScope: NetworkScope;
  perActionBudget: ActionBudget;
  aggregateBudget: ActionBudget;
  evidenceObligations: string[];
  retryLimit: number;
  validFrom: IsoDateTime;
  /**
   * No standing authorization is perpetual. FRANK-§7.6 holds anything
   * uncovered.
   */
  expiresAt: IsoDateTime;
  revocationCounter: number;
  signerId: string;
  signature: string;
}

/**
 * The schema's top-level `oneOf`: a document conforming to
 * `schema://frank.policy-decision/v1` is exactly one of these three.
 *
 * All three branches carry a `schema` const, so this union is discriminated
 * on that single key.
 */
export type PolicyDocument = PolicyDecision | ActionEnvelope | StandingAuthorization;

/**
 * The decision refused the action outright. There is nothing to escalate: a
 * denied envelope is spent, and a caller must build a new one.
 */
export function isTerminalDeny(d: PolicyDecision): boolean {
  return d.result === 'deny';
}

/**
 * The decision is withheld pending human review (FRANK-§7.6 holds anything
 * uncovered). This is not an allow and not a deny.
 */
export function requiresReview(d: PolicyDecision): boolean {
  return d.result === 'hold_for_review';
}

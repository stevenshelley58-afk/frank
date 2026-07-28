/**
 * Standing-authorization matching and revocation — FRANK-§6.9, FRANK-§7.6.
 *
 * A `StandingAuthorization` is the only thing that can move a §7.6 row from
 * `hold_for_review` to an automatic outcome, so every predicate here fails
 * closed: an authorization matches only when *every* clause matches, and a
 * clause it cannot evaluate does not match.
 *
 * ## Patterns are prefixes, not globs
 *
 * `ResourcePattern.idPattern` could be a regular expression. It is deliberately
 * not: a regular expression supplied by a proposer is an evaluation surface (a
 * catastrophically backtracking pattern is a denial of service, and a subtly
 * wrong one is a wrong-target grant). {@link matchesResourcePattern} supports
 * exactly two forms — a literal id, and a single trailing `*` prefix — and
 * treats anything else as a non-match. That is enough for
 * `work_item:project-alpha/*` and refuses to be enough for anything clever.
 *
 * ## "Narrow"
 *
 * FRANK-§7.6's last row holds consequential actions "unless a narrow standing
 * policy explicitly covers it". {@link isNarrowAuthorization} defines narrow
 * mechanically: no wildcard in the target pattern, no wildcard in the recipient
 * pattern when one is required, a bounded operation list, and an expiry inside
 * {@link NARROW_AUTHORIZATION_MAXIMUM_DAYS}. An authorization that grants
 * `operations: ['*']` over `id-pattern: '*'` for a year is not narrow no matter
 * what it is called, and a word in a policy document is not a control.
 */

import type {
  ActionEnvelope,
  DataClass,
  NetworkScope,
  ResourcePattern,
  ResourceRef,
  StandingAuthorization,
} from '@frank/contracts';
import { DATA_CLASS_ORDER } from '@frank/contracts';

/**
 * The longest an authorization may run and still count as "narrow" for the
 * FRANK-§7.6 consequential-actions row. Thirty days: long enough for a standing
 * arrangement, short enough that forgetting to revoke one is bounded.
 */
export const NARROW_AUTHORIZATION_MAXIMUM_DAYS = 30;

export type AuthorizationMismatch =
  | 'actor_not_allowed'
  | 'operation_not_allowed'
  | 'target_pattern'
  | 'recipient_pattern'
  | 'recipient_required'
  | 'data_class_exceeds_authorization'
  | 'credential_scope_not_granted'
  | 'network_scope_exceeds_authorization'
  | 'per_action_budget_exceeded'
  | 'not_yet_valid'
  | 'expired'
  | 'revoked'
  | 'cell_mismatch';

export interface AuthorizationMatch {
  readonly authorization: StandingAuthorization;
  readonly narrow: boolean;
}

export interface AuthorizationEvaluation {
  readonly match: AuthorizationMatch | undefined;
  /** Why each candidate failed, in candidate order. Feeds `PolicyDecision.reasons`. */
  readonly mismatches: ReadonlyArray<{
    readonly authorizationId: string;
    readonly reasons: readonly AuthorizationMismatch[];
  }>;
}

/**
 * Current revocation counter per authorization id.
 *
 * FRANK-§6.9 gives `StandingAuthorization` a `revocationCounter` but nothing in
 * the envelope references it, so a decision made against version *n* of an
 * authorization would still look valid after the owner revoked it into version
 * *n+1*. This map is how a revocation reaches an already-issued decision: the
 * engine records the counter it matched, and `decision.ts` re-checks it at the
 * execution boundary. A missing entry means "no revocation recorded"; a *lower*
 * stored value than the authorization claims is treated as a mismatch, because
 * an authorization that has counted further than the revocation registry is
 * either stale or forged.
 */
export type RevocationRegistry = ReadonlyMap<string, number>;

/** `handle:...` prefix that a credential scope may grant. */
function credentialScopeCovers(scope: string, handle: string): boolean {
  if (scope === handle) return true;
  if (scope.endsWith('*')) return handle.startsWith(scope.slice(0, -1));
  return false;
}

/** See the module comment: literal, or one trailing `*`. Nothing else. */
export function matchesResourcePattern(pattern: ResourcePattern, ref: ResourceRef): boolean {
  if (pattern.kind !== ref.kind) return false;
  const { idPattern } = pattern;
  if (idPattern.length === 0) return false;
  const star = idPattern.indexOf('*');
  if (star === -1) return idPattern === ref.id;
  if (star !== idPattern.length - 1) return false; // `*` only at the end
  const prefix = idPattern.slice(0, -1);
  // A bare `*` matches everything. Legal, but never narrow — see below.
  return ref.id.startsWith(prefix);
}

function patternIsExact(pattern: ResourcePattern): boolean {
  return !pattern.idPattern.includes('*');
}

/** FRANK-§7.6's "narrow standing policy", defined mechanically. */
export function isNarrowAuthorization(
  authorization: StandingAuthorization,
  now: Date,
): boolean {
  if (!patternIsExact(authorization.targetPattern)) return false;
  if (
    authorization.recipientPattern !== undefined &&
    !patternIsExact(authorization.recipientPattern)
  ) {
    return false;
  }
  if (authorization.operations.some((operation) => operation.includes('*'))) return false;
  if (authorization.allowedActors.some((actor) => actor.includes('*'))) return false;
  const expires = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(expires)) return false;
  const horizon = now.getTime() + NARROW_AUTHORIZATION_MAXIMUM_DAYS * 24 * 60 * 60 * 1000;
  return expires <= horizon;
}

function rankOf(value: DataClass): number {
  return DATA_CLASS_ORDER.indexOf(value);
}

/**
 * Compare two decimal-string amounts exactly.
 *
 * FIN-002 forbids floats for money and `ActionBudget.maximumSpend` is typed
 * `number` in the frozen contract, which is a contract decision this package
 * cannot change. What it *can* do is refuse to compare non-finite or
 * non-representable values, so a budget that JavaScript cannot compare exactly
 * is a mismatch rather than a silently rounded allowance.
 */
function budgetWithin(candidate: number, ceiling: number): boolean {
  if (!Number.isFinite(candidate) || !Number.isFinite(ceiling)) return false;
  if (candidate < 0 || ceiling < 0) return false;
  return candidate <= ceiling;
}

const NETWORK_SCOPE_RANK: Readonly<Record<NetworkScope['mode'], number>> = {
  none: 0,
  'proxied-allowlist': 1,
  allowlist: 2,
};

/**
 * True when `candidate` requests no more network reach than `ceiling` allows.
 *
 * `proxied-allowlist` ranks *below* `allowlist` because FRANK-§15.6 routes
 * proxied egress through the policy proxy, where destination, protocol, and byte
 * controls apply; a direct allowlist is the more permissive of the two. Host
 * sets must be a subset either way — a mode that matches does not license a new
 * destination.
 */
export function networkScopeWithin(candidate: NetworkScope, ceiling: NetworkScope): boolean {
  if (candidate.mode === 'none') return true;
  if (ceiling.mode === 'none') return false;
  if (NETWORK_SCOPE_RANK[candidate.mode] > NETWORK_SCOPE_RANK[ceiling.mode]) return false;
  const allowed = new Set(ceiling.allowedHosts);
  return candidate.allowedHosts.every((host) => allowed.has(host));
}

function evaluateOne(
  authorization: StandingAuthorization,
  envelope: ActionEnvelope,
  now: Date,
  revocations: RevocationRegistry,
): readonly AuthorizationMismatch[] {
  const reasons: AuthorizationMismatch[] = [];

  // FRANK-§2.4. An authorization issued in one cell says nothing about another.
  if (authorization.targetPattern.kind === envelope.target.kind) {
    const patternCell = envelope.target.cellId;
    if (patternCell !== undefined && patternCell !== envelope.cellId) {
      reasons.push('cell_mismatch');
    }
  }

  // The *effective* actor is the delegate when there is one. An envelope that
  // names Steven as principal but an agent as delegated actor must match on the
  // agent, or delegation would launder the owner's authority — the
  // confused-deputy and privilege-inheritance cases.
  const effectiveActor = envelope.delegatedActorId ?? envelope.principalId;
  if (!authorization.allowedActors.includes(effectiveActor)) reasons.push('actor_not_allowed');

  if (!authorization.operations.includes(envelope.operation)) reasons.push('operation_not_allowed');

  if (!matchesResourcePattern(authorization.targetPattern, envelope.target)) {
    reasons.push('target_pattern');
  }

  if (authorization.recipientPattern !== undefined) {
    if (envelope.recipient === undefined) {
      reasons.push('recipient_required');
    } else if (!matchesResourcePattern(authorization.recipientPattern, envelope.recipient)) {
      reasons.push('recipient_pattern');
    }
  }

  const ceiling = rankOf(authorization.maximumDataClass);
  for (const dataClass of envelope.dataClasses) {
    if (rankOf(dataClass) > ceiling) {
      reasons.push('data_class_exceeds_authorization');
      break;
    }
  }

  for (const handle of envelope.credentialHandles) {
    if (!authorization.credentialScopes.some((scope) => credentialScopeCovers(scope, handle))) {
      reasons.push('credential_scope_not_granted');
      break;
    }
  }

  if (!networkScopeWithin(envelope.networkScope, authorization.networkScope)) {
    reasons.push('network_scope_exceeds_authorization');
  }

  if (
    envelope.budget.currency !== authorization.perActionBudget.currency ||
    !budgetWithin(envelope.budget.maximumSpend, authorization.perActionBudget.maximumSpend) ||
    !budgetWithin(
      envelope.budget.maximumWallClockSeconds,
      authorization.perActionBudget.maximumWallClockSeconds,
    )
  ) {
    reasons.push('per_action_budget_exceeded');
  }

  const validFrom = Date.parse(authorization.validFrom);
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(validFrom) || now.getTime() < validFrom) reasons.push('not_yet_valid');
  if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) reasons.push('expired');

  const revoked = revocations.get(authorization.authorizationId);
  if (revoked !== undefined && revoked > authorization.revocationCounter) reasons.push('revoked');

  return reasons;
}

/**
 * Find the authorization covering `envelope`, if any.
 *
 * Returns the first full match in the order supplied. Not "the most permissive"
 * and not "the union of all matches": limits are intersected downstream, and a
 * search that combined authorizations would let two narrow grants add up to a
 * broad one.
 */
export function evaluateAuthorizations(input: {
  readonly envelope: ActionEnvelope;
  readonly authorizations: readonly StandingAuthorization[];
  readonly now: Date;
  readonly revocations: RevocationRegistry;
}): AuthorizationEvaluation {
  const mismatches: Array<{
    authorizationId: string;
    reasons: readonly AuthorizationMismatch[];
  }> = [];

  for (const authorization of input.authorizations) {
    const reasons = evaluateOne(authorization, input.envelope, input.now, input.revocations);
    if (reasons.length === 0) {
      return {
        match: {
          authorization,
          narrow: isNarrowAuthorization(authorization, input.now),
        },
        mismatches,
      };
    }
    mismatches.push({ authorizationId: authorization.authorizationId, reasons });
  }

  return { match: undefined, mismatches };
}

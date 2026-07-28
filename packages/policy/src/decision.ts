/**
 * The execution-side half of the action boundary — FRANK-§6.9.
 *
 * FRANK-§6.9 separates two services: "The Policy Service evaluates an immutable
 * envelope; **only then** may the separate Execution Service exchange approved
 * credential handles for short-lived credentials."
 *
 * `engine.ts` is the first half. This is the second: the check the executor runs
 * immediately before it acts, against the decision it was handed. Four of the
 * eight mandatory conformance attacks are caught here rather than in the engine,
 * because they are attacks on the *gap* between deciding and doing:
 *
 *   mutation          the envelope presented to the executor is not the envelope
 *                     the decision was made about
 *   wrong-target      the executor is asked to act on a resource the decision
 *                     did not name
 *   altered-artifact  the bytes changed between approval and execution
 *   revocation        the owner revoked the authorization after the decision was
 *                     issued but before it was used
 *
 * An engine-only implementation would pass every one of those tests and still be
 * wrong in production, because the engine never sees the moment of execution.
 *
 * ## It returns a verdict, and the verdict is not a boolean
 *
 * {@link assertDecisionAppliesTo} returns a discriminated result carrying the
 * reason, so a refusal at this boundary can be audited with the same detail as a
 * refusal at the policy boundary. A boolean would collapse "expired", "mutated",
 * and "revoked" into one indistinguishable `false`, and FRANK-§11.5 wants the
 * difference on the audit entry.
 */

import type { ActionEnvelope, PolicyDecision, ResourceRef } from '@frank/contracts';

import type { RevocationRegistry } from './authorization.js';
import { envelopeHash } from './envelope.js';

export type ExecutionRefusal =
  | 'decision_denied'
  | 'decision_holds_for_review'
  | 'envelope_mutated'
  | 'wrong_target'
  | 'wrong_recipient'
  | 'artifact_altered'
  | 'decision_expired'
  | 'authorization_revoked'
  | 'budget_exceeded'
  | 'network_destination_not_permitted'
  | 'obligations_unmet';

export type ExecutionVerdict =
  | { readonly permitted: true; readonly decision: PolicyDecision }
  | { readonly permitted: false; readonly refusal: ExecutionRefusal; readonly reason: string };

export interface ExecutionCheckInput {
  readonly decision: PolicyDecision;
  /** The envelope the executor is about to act on. */
  readonly envelope: ActionEnvelope;
  /** The resource the executor is actually about to touch. */
  readonly target: ResourceRef;
  readonly recipient?: ResourceRef | undefined;
  /**
   * Digest of the artifact as it exists *now*. Compared against the envelope's
   * `artifactDigest`, which is what the decision covered.
   */
  readonly artifactDigest?: string | undefined;
  /** Recorded at decision time so a later revocation is detectable. */
  readonly matchedAuthorization?:
    | { readonly authorizationId: string; readonly revocationCounter: number }
    | undefined;
  readonly revocations: RevocationRegistry;
  /** Obligations the executor has actually discharged. */
  readonly dischargedObligations?: readonly string[] | undefined;
  /** Hosts the executor is about to contact. */
  readonly intendedHosts?: readonly string[] | undefined;
  readonly now: Date;
}

function refuse(refusal: ExecutionRefusal, reason: string): ExecutionVerdict {
  return { permitted: false, refusal, reason };
}

function sameResource(a: ResourceRef, b: ResourceRef): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  // A resource that names a cell must name the same one. An `undefined` cellId
  // on one side is not "matches any": the two references disagree about scope,
  // and FRANK-§2.4 does not have a wildcard cell.
  return a.cellId === b.cellId;
}

/**
 * The gate an executor must pass before doing anything.
 *
 * Order matters: the mutation check comes first, because every later check reads
 * the envelope, and reading a mutated envelope to decide whether it was mutated
 * is circular.
 */
export function assertDecisionAppliesTo(input: ExecutionCheckInput): ExecutionVerdict {
  const { decision, envelope } = input;

  /* mutation ------------------------------------------------------------- */
  const actualHash = envelopeHash(envelope);
  if (actualHash !== decision.evaluatedEnvelopeHash) {
    return refuse(
      'envelope_mutated',
      `decision was made about envelope ${decision.evaluatedEnvelopeHash} but the executor holds ${actualHash}; ` +
        'a decision is bound to one exact immutable envelope (FRANK-§6.9 mutation)',
    );
  }

  /* outcome -------------------------------------------------------------- */
  if (decision.result === 'deny') {
    return refuse('decision_denied', `policy denied this action: ${decision.reasons.join('; ')}`);
  }
  if (decision.result === 'hold_for_review') {
    return refuse(
      'decision_holds_for_review',
      `policy held this action for review: ${decision.reasons.join('; ')}`,
    );
  }

  /* expiry --------------------------------------------------------------- */
  const envelopeExpiry = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(envelopeExpiry) || input.now.getTime() >= envelopeExpiry) {
    return refuse(
      'decision_expired',
      `envelope expired at ${envelope.expiresAt} (FRANK-§6.9 expired-envelope)`,
    );
  }
  if (decision.expiresAt !== undefined) {
    const decisionExpiry = Date.parse(decision.expiresAt);
    if (!Number.isFinite(decisionExpiry) || input.now.getTime() >= decisionExpiry) {
      return refuse('decision_expired', `policy decision expired at ${decision.expiresAt}`);
    }
  }

  /* wrong target / wrong recipient --------------------------------------- */
  if (!sameResource(envelope.target, input.target)) {
    return refuse(
      'wrong_target',
      `decision authorized ${envelope.target.kind}/${envelope.target.id} but the executor is about to act on ` +
        `${input.target.kind}/${input.target.id} (FRANK-§6.9 wrong-target)`,
    );
  }
  if (envelope.recipient === undefined) {
    if (input.recipient !== undefined) {
      return refuse(
        'wrong_recipient',
        `decision authorized no recipient but the executor is about to send to ${input.recipient.kind}/${input.recipient.id}`,
      );
    }
  } else if (input.recipient === undefined || !sameResource(envelope.recipient, input.recipient)) {
    return refuse(
      'wrong_recipient',
      `decision authorized recipient ${envelope.recipient.kind}/${envelope.recipient.id} but the executor is about to send to ` +
        `${input.recipient === undefined ? 'nobody' : `${input.recipient.kind}/${input.recipient.id}`}`,
    );
  }

  /* altered artifact ------------------------------------------------------ */
  if (envelope.artifactDigest !== undefined) {
    if (input.artifactDigest === undefined) {
      return refuse(
        'artifact_altered',
        `decision covered artifact ${envelope.artifactDigest} but the executor presented no digest (FRANK-§6.9 altered-artifact)`,
      );
    }
    if (input.artifactDigest !== envelope.artifactDigest) {
      return refuse(
        'artifact_altered',
        `artifact digest changed from ${envelope.artifactDigest} to ${input.artifactDigest} between approval and execution (FRANK-§6.9 altered-artifact)`,
      );
    }
  } else if (input.artifactDigest !== undefined) {
    // The executor has an artifact the decision never saw. That is the same
    // failure in the other direction: an unapproved payload.
    return refuse(
      'artifact_altered',
      `executor presented artifact ${input.artifactDigest} but the decision covered no artifact (FRANK-§6.9 altered-artifact)`,
    );
  }

  /* revocation ------------------------------------------------------------ */
  if (input.matchedAuthorization !== undefined) {
    const current = input.revocations.get(input.matchedAuthorization.authorizationId);
    if (current !== undefined && current > input.matchedAuthorization.revocationCounter) {
      return refuse(
        'authorization_revoked',
        `standing authorization ${input.matchedAuthorization.authorizationId} was revoked ` +
          `(counter ${input.matchedAuthorization.revocationCounter} -> ${current}) after this decision was issued (FRANK-§6.9 revocation)`,
      );
    }
  }
  if (decision.matchedAuthorizationId !== undefined && input.matchedAuthorization === undefined) {
    // The decision says an authorization carried it, but the executor cannot say
    // which version. Without that, revocation is unenforceable — refuse.
    return refuse(
      'authorization_revoked',
      `decision cites standing authorization ${decision.matchedAuthorizationId} but the executor carries no revocation counter for it; ` +
        'revocation cannot be checked and unknown fails closed (FRANK-§2.3)',
    );
  }

  /* limits at the moment of execution -------------------------------------- */
  if (envelope.budget.maximumSpend > decision.limits.budget.maximumSpend) {
    return refuse(
      'budget_exceeded',
      `envelope asks for ${envelope.budget.maximumSpend} ${envelope.budget.currency} but the decision limits it to ${decision.limits.budget.maximumSpend}`,
    );
  }
  if (input.intendedHosts !== undefined && input.intendedHosts.length > 0) {
    if (decision.limits.networkScope.mode === 'none') {
      return refuse(
        'network_destination_not_permitted',
        `decision permits no network egress but the executor intends to contact ${input.intendedHosts.join(', ')} (FRANK-§15.6)`,
      );
    }
    const allowed = new Set(decision.limits.networkScope.allowedHosts);
    const disallowed = input.intendedHosts.filter((host) => !allowed.has(host));
    if (disallowed.length > 0) {
      return refuse(
        'network_destination_not_permitted',
        `destinations not in the decision's allowlist: ${disallowed.join(', ')} (FRANK-§15.6)`,
      );
    }
  }

  /* obligations ------------------------------------------------------------ */
  if (decision.obligations.length > 0) {
    const discharged = new Set(input.dischargedObligations ?? []);
    const outstanding = decision.obligations.filter((obligation) => !discharged.has(obligation));
    if (outstanding.length > 0) {
      return refuse(
        'obligations_unmet',
        `decision obligations not discharged: ${outstanding.join(', ')}`,
      );
    }
  }

  return { permitted: true, decision };
}

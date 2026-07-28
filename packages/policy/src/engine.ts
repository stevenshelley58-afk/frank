/**
 * The action boundary — FRANK-§6.9.
 *
 * "Policy is evaluated at the action boundary, not inferred from the model's
 * confidence. Models may propose envelopes but cannot sign, widen, or approve
 * them. The Policy Service evaluates an immutable envelope; only then may the
 * separate Execution Service exchange approved credential handles for
 * short-lived credentials."
 *
 * ## There is no confidence input
 *
 * {@link EvaluationRequest} has no field for a model score, a confidence, a
 * likelihood, or a self-assessment, and it never will. That is the literal
 * implementation of "not inferred from the model's confidence": the information
 * is not available to this function, so no future change to it can start
 * depending on the information by accident.
 *
 * ## Order of checks, and why it is this order
 *
 * The checks run cheapest-and-most-fatal first, and each is a gate rather than a
 * score:
 *
 *   1. **shape**       the envelope is the contract's shape and its own cell
 *   2. **signature**   signed by a registered signer that `maySign`
 *   3. **ceiling**     the signer's `maximumActionClass` covers the class asked for
 *   4. **temporal**    `validFrom <= now < expiresAt`
 *   5. **catalogue**   the operation exists and the class matches its §7.6 row
 *   6. **secrets**     no `secret`-class payload; credential handles are handles
 *   7. **trust**       untrusted content did not select this action (COMMS-004)
 *   8. **single use**  the nonce is claimed, or the replay is declared safe
 *   9. **authorization** a standing authorization matches, if the row needs one
 *  10. **conditions**  the §7.6 row's computed and attested conditions
 *  11. **limits**      the intersection of rule, authorization, and envelope
 *
 * Signature verification sits above single-use claiming deliberately. A forged
 * envelope must not be able to burn a legitimate nonce: if claiming came first,
 * an attacker who guessed a nonce could deny a real action by spending it with
 * garbage.
 *
 * ## Every exit is a decision, not an exception
 *
 * Nothing here throws for a policy outcome. A malformed, forged, expired, or
 * replayed envelope produces a `PolicyDecision` with `result: "deny"` and a
 * reason. That matters because FRANK-§11.5 records the policy decision on the
 * audit entry: an exception would leave the most interesting refusals as the
 * only ones with no record. Exceptions are reserved for programming errors
 * (a missing key resolver, a registry that failed to build).
 */

import type {
  ActionBudget,
  ActionClass,
  ActionEnvelope,
  ActionLimits,
  DataClass,
  NetworkScope,
  PolicyDecision,
  PolicyResult,
  StandingAuthorization,
} from '@frank/contracts';
import { DATA_CLASS_ORDER, strictestOf } from '@frank/contracts';

import type { AuthorizationMismatch, RevocationRegistry } from './authorization.js';
import { evaluateAuthorizations } from './authorization.js';
import { envelopeBindingHash, envelopeHash, freezeEnvelope } from './envelope.js';
import type { ConditionId, OperatingPolicyRule, RuleCeilings } from './operating-policy.js';
import {
  CONDITION_KINDS,
  POLICY_VERSION,
  operationDefinition,
  ruleForCategory,
} from './operating-policy.js';
import type { SpentNonceLedger } from './nonce.js';
import type { EnvelopeSignatureVerifier, SignerRegistry } from './signing.js';
import type { InfluenceRecord } from './trust.js';
import {
  declaresSecretClassPayload,
  evaluateTrustGate,
  invalidCredentialHandles,
} from './trust.js';

/**
 * An assertion about a FRANK-§7.6 condition the engine cannot check itself.
 *
 * `attestedBy` is checked against {@link EvaluationRequest.trustedAttestors}. An
 * attestation from anybody else is discarded, which makes an attestation a
 * statement by a named principal rather than a flag in a request body.
 */
export interface ConditionAttestation {
  readonly condition: ConditionId;
  readonly satisfied: boolean;
  readonly attestedBy: string;
  /** FRANK-§6.8 pointer to the evidence, when there is any. */
  readonly evidenceRef?: string;
}

export interface EvaluationRequest {
  /** Evaluated as supplied; frozen before anything reads it (FRANK-§6.9). */
  readonly envelope: ActionEnvelope;
  /** The cell this evaluation is happening in. FRANK-§2.4. */
  readonly cellId: string;
  /**
   * COMMS-004 / FRANK-§15.5. **Required.** See `trust.ts` for why there is no
   * default: a call site that cannot say what influenced its action must not
   * compile.
   */
  readonly influences: readonly InfluenceRecord[];
  readonly authorizations: readonly StandingAuthorization[];
  readonly revocations: RevocationRegistry;
  readonly attestations: readonly ConditionAttestation[];
  /** Principals whose attestations count. Never includes a model or an agent. */
  readonly trustedAttestors: ReadonlySet<string>;
  readonly now: Date;
  /**
   * FRANK-§12.3 `dry_run`. A dry run evaluates everything and spends nothing:
   * no nonce is claimed, so the same envelope can still be executed for real
   * afterwards. It is the "what would happen" answer, and giving it a side
   * effect would make the preview destroy the thing it previewed.
   */
  readonly dryRun?: boolean;
}

export interface EvaluationResult {
  readonly decision: PolicyDecision;
  /** The frozen envelope the decision was made against. */
  readonly envelope: Readonly<ActionEnvelope>;
  readonly envelopeHash: string;
  /** Present when a standing authorization matched; recorded for revocation checks. */
  readonly matchedAuthorization:
    | { readonly authorizationId: string; readonly revocationCounter: number }
    | undefined;
  /** True when this result was returned from the ledger rather than computed now. */
  readonly replayed: boolean;
}

export interface PolicyEngineOptions {
  readonly signers: SignerRegistry;
  readonly verifier: EnvelopeSignatureVerifier;
  readonly nonces: SpentNonceLedger;
  /** Tolerance for clock skew between the signer and this process. Default 5 s. */
  readonly clockSkewToleranceMs?: number;
  /** How long a spent nonce is remembered. Default 24 h. */
  readonly nonceRetentionMs?: number;
}

const DEFAULT_CLOCK_SKEW_MS = 5_000;
const DEFAULT_NONCE_RETENTION_MS = 24 * 60 * 60 * 1000;

const ACTION_CLASS_RANK: Readonly<Record<ActionClass, number>> = {
  observe: 0,
  internal_reversible: 1,
  external_reversible: 2,
  financial_or_public: 3,
  destructive_or_privileged: 4,
};

/**
 * The limits a denial carries.
 *
 * `PolicyDecision.limits` is required by the frozen contract even for a deny, so
 * a denial declares the emptiest limits the contract can express: no spend, no
 * time, no network, and the least permissive data class. A denial that carried
 * the *requested* limits would be a document that reads like a grant if the
 * `result` field were ever dropped in transit.
 */
function deniedLimits(currency: string): ActionLimits {
  return {
    budget: { currency, maximumSpend: 0, maximumWallClockSeconds: 0, maximumTokens: 0 },
    networkScope: { mode: 'none', allowedHosts: [] },
    maximumDataClass: 'open',
    retryLimit: 0,
  };
}

function decision(input: {
  result: PolicyResult;
  reasons: readonly string[];
  evaluatedEnvelopeHash: string;
  limits: ActionLimits;
  obligations?: readonly string[];
  matchedAuthorizationId?: string | undefined;
  expiresAt?: string | undefined;
}): PolicyDecision {
  return {
    schema: 'frank.policy-decision/v1',
    result: input.result,
    policyVersion: POLICY_VERSION,
    reasons: [...input.reasons],
    evaluatedEnvelopeHash: input.evaluatedEnvelopeHash,
    limits: input.limits,
    obligations: [...(input.obligations ?? [])],
    ...(input.matchedAuthorizationId === undefined
      ? {}
      : { matchedAuthorizationId: input.matchedAuthorizationId }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  };
}

function rankOfClass(value: DataClass): number {
  return DATA_CLASS_ORDER.indexOf(value);
}

function minDataClass(a: DataClass, b: DataClass): DataClass {
  return rankOfClass(a) <= rankOfClass(b) ? a : b;
}

/**
 * Intersect two network scopes.
 *
 * `none` wins over everything, and the host set is the *intersection*, never the
 * union. A union would let a rule permitting `api.example.com` and an
 * authorization permitting `hooks.example.com` between them permit both, which
 * is how two safe grants become one unsafe one.
 */
function intersectNetworkScope(a: NetworkScope, b: NetworkScope): NetworkScope {
  if (a.mode === 'none' || b.mode === 'none') return { mode: 'none', allowedHosts: [] };
  const mode: NetworkScope['mode'] =
    a.mode === 'proxied-allowlist' || b.mode === 'proxied-allowlist'
      ? 'proxied-allowlist'
      : 'allowlist';
  const inB = new Set(b.allowedHosts);
  return { mode, allowedHosts: a.allowedHosts.filter((host) => inB.has(host)).sort() };
}

function intersectBudget(
  envelope: ActionBudget,
  ceilings: RuleCeilings,
  authorization: StandingAuthorization | undefined,
): ActionBudget {
  const ruleSpend = Number.parseFloat(ceilings.maximumSpend);
  const candidates = [envelope.maximumSpend, ruleSpend];
  const seconds = [envelope.maximumWallClockSeconds, ceilings.maximumWallClockSeconds];
  const tokens = [envelope.maximumTokens ?? ceilings.maximumTokens, ceilings.maximumTokens];

  if (authorization !== undefined) {
    candidates.push(authorization.perActionBudget.maximumSpend);
    seconds.push(authorization.perActionBudget.maximumWallClockSeconds);
    if (authorization.perActionBudget.maximumTokens !== undefined) {
      tokens.push(authorization.perActionBudget.maximumTokens);
    }
  }

  return {
    currency: envelope.currency,
    maximumSpend: Math.min(...candidates),
    maximumWallClockSeconds: Math.min(...seconds),
    maximumTokens: Math.min(...tokens),
  };
}

function intersectLimits(
  envelope: ActionEnvelope,
  rule: OperatingPolicyRule,
  authorization: StandingAuthorization | undefined,
  operationCeiling: DataClass,
): ActionLimits {
  // The rule's ceiling constrains the *mode*; the hosts a rule allows are
  // whatever the envelope asked for, since a §7.6 row cannot know a hostname.
  const ruleScope: NetworkScope = {
    mode: rule.ceilings.networkScope,
    allowedHosts: envelope.networkScope.allowedHosts,
  };
  let networkScope = intersectNetworkScope(envelope.networkScope, ruleScope);
  if (authorization !== undefined) {
    networkScope = intersectNetworkScope(networkScope, authorization.networkScope);
  }

  // The envelope's own declared classes are part of the intersection: an
  // envelope touching only `internal` data does not get a `sensitive` grant just
  // because the rule would have permitted one.
  const envelopeClass =
    envelope.dataClasses.length === 0 ? 'open' : strictestOf(envelope.dataClasses);
  let maximumDataClass = minDataClass(
    minDataClass(rule.ceilings.maximumDataClass, operationCeiling),
    envelopeClass,
  );
  if (authorization !== undefined) {
    maximumDataClass = minDataClass(maximumDataClass, authorization.maximumDataClass);
  }

  const retryCandidates = [rule.ceilings.retryLimit];
  if (authorization !== undefined) retryCandidates.push(authorization.retryLimit);

  return {
    budget: intersectBudget(envelope.budget, rule.ceilings, authorization),
    networkScope,
    maximumDataClass,
    retryLimit: Math.min(...retryCandidates),
  };
}

/** Conditions the engine decides for itself. See `operating-policy.ts`. */
function evaluateComputedCondition(
  condition: ConditionId,
  input: {
    envelope: ActionEnvelope;
    rule: OperatingPolicyRule;
    matched: { authorization: StandingAuthorization; narrow: boolean } | undefined;
  },
): boolean {
  switch (condition) {
    case 'envelope_names_exact_target':
      // "Names the exact target" — a concrete id, not a pattern, not empty.
      return (
        input.envelope.target.id.length > 0 &&
        !input.envelope.target.id.includes('*') &&
        input.envelope.target.kind.length > 0
      );
    case 'within_resource_and_spend_limits': {
      const ceilingSpend = Number.parseFloat(input.rule.ceilings.maximumSpend);
      return (
        Number.isFinite(input.envelope.budget.maximumSpend) &&
        input.envelope.budget.maximumSpend >= 0 &&
        input.envelope.budget.maximumSpend <= ceilingSpend &&
        input.envelope.budget.maximumWallClockSeconds > 0 &&
        input.envelope.budget.maximumWallClockSeconds <=
          input.rule.ceilings.maximumWallClockSeconds
      );
    }
    case 'covered_by_standing_authorization':
      return input.matched !== undefined;
    case 'covered_by_narrow_standing_authorization':
      return input.matched !== undefined && input.matched.narrow;
    default:
      // An attested condition reaching here is a programming error in the
      // condition tables, not a policy outcome. Fail closed.
      return false;
  }
}

export class PolicyEngine {
  readonly #signers: SignerRegistry;
  readonly #verifier: EnvelopeSignatureVerifier;
  readonly #nonces: SpentNonceLedger;
  readonly #skewMs: number;
  readonly #retentionMs: number;

  constructor(options: PolicyEngineOptions) {
    this.#signers = options.signers;
    this.#verifier = options.verifier;
    this.#nonces = options.nonces;
    this.#skewMs = options.clockSkewToleranceMs ?? DEFAULT_CLOCK_SKEW_MS;
    this.#retentionMs = options.nonceRetentionMs ?? DEFAULT_NONCE_RETENTION_MS;
  }

  /**
   * Evaluate one envelope. Never throws for a policy outcome.
   *
   * Synchronous. The whole path is in-memory table lookups and one HMAC, which
   * keeps the authorization cost of a capture at microseconds and leaves UX-004's
   * 500 ms budget to the transaction where it belongs.
   */
  evaluate(request: EvaluationRequest): EvaluationResult {
    const envelope = freezeEnvelope(request.envelope);
    const hash = envelopeHash(envelope);
    const currency = envelope.budget.currency;
    const deny = (...reasons: string[]): EvaluationResult => ({
      decision: decision({
        result: 'deny',
        reasons,
        evaluatedEnvelopeHash: hash,
        limits: deniedLimits(currency),
      }),
      envelope,
      envelopeHash: hash,
      matchedAuthorization: undefined,
      replayed: false,
    });

    /* 1 — shape ----------------------------------------------------------- */
    if (envelope.schema !== 'frank.action/v1') {
      return deny(`envelope declares schema ${JSON.stringify(envelope.schema)}, not "frank.action/v1"`);
    }
    if (envelope.cellId !== request.cellId) {
      return deny(
        `envelope is scoped to cell ${JSON.stringify(envelope.cellId)} but was presented to cell ${JSON.stringify(request.cellId)} (FRANK-§2.4)`,
      );
    }
    if (envelope.dataClasses.length === 0) {
      return deny('envelope declares no data classes; unknown classification fails closed (FRANK-§2.3)');
    }

    /* 2 — signature ------------------------------------------------------- */
    const signer = this.#signers.get(envelope.signerId);
    if (signer === undefined) {
      return deny(`signer ${JSON.stringify(envelope.signerId)} is not registered (FRANK-§6.9)`);
    }
    if (!signer.maySign) {
      return deny(
        `signer ${JSON.stringify(signer.signerId)} has kind "${signer.kind}" and may not sign; ` +
          'models may propose envelopes but cannot sign, widen, or approve them (FRANK-§6.9)',
      );
    }
    if (!this.#verifier.verify(envelope, signer)) {
      return deny('envelope signature does not verify against the registered signer (FRANK-§6.9)');
    }

    /* 3 — signer ceiling -------------------------------------------------- */
    if (ACTION_CLASS_RANK[envelope.actionClass] > ACTION_CLASS_RANK[signer.maximumActionClass]) {
      return deny(
        `signer ${JSON.stringify(signer.signerId)} may sign at most "${signer.maximumActionClass}" ` +
          `but this envelope declares "${envelope.actionClass}"; delegation intersects authority, it does not inherit it (FRANK-§6.9)`,
      );
    }

    /* 4 — temporal -------------------------------------------------------- */
    const validFrom = Date.parse(envelope.validFrom);
    const expiresAt = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(validFrom) || !Number.isFinite(expiresAt)) {
      return deny('envelope validity window is not parseable as RFC 3339 timestamps');
    }
    if (expiresAt <= validFrom) {
      return deny('envelope expiresAt is not after validFrom');
    }
    const nowMs = request.now.getTime();
    if (nowMs + this.#skewMs < validFrom) {
      return deny(`envelope is not yet valid (validFrom ${envelope.validFrom})`);
    }
    if (nowMs - this.#skewMs >= expiresAt) {
      return deny(`envelope expired at ${envelope.expiresAt} (FRANK-§6.9 expired-envelope)`);
    }

    /* 5 — catalogue and §7.6 row ------------------------------------------ */
    const definition = operationDefinition(envelope.operation);
    if (definition === undefined) {
      return deny(
        `operation ${JSON.stringify(envelope.operation)} is not in the operation catalogue; unknown operations fail closed (FRANK-§2.3)`,
      );
    }
    const rule = ruleForCategory(definition.category);
    if (rule === undefined) {
      return deny(
        `no FRANK-§7.6 rule covers operation category ${JSON.stringify(definition.category)}`,
      );
    }
    if (!rule.actionClasses.includes(envelope.actionClass)) {
      return deny(
        `operation ${JSON.stringify(envelope.operation)} belongs to FRANK-§7.6 row "${rule.id}", ` +
          `which covers [${rule.actionClasses.join(', ')}], but the envelope declares "${envelope.actionClass}"`,
      );
    }

    /* 6 — secrets and credential handles ---------------------------------- */
    if (declaresSecretClassPayload(envelope.dataClasses)) {
      return deny(
        'envelope declares a `secret`-class payload; secrets are never placed in context, only opaque handles or brokered operations (FRANK-§2.3)',
      );
    }
    const badHandles = invalidCredentialHandles(envelope.credentialHandles);
    if (badHandles.length > 0) {
      // Names the count, never the values: one of them might be a real token.
      return deny(
        `${badHandles.length} credential entr${badHandles.length === 1 ? 'y is' : 'ies are'} not an opaque handle (FRANK-§2.3, FRANK-§15.3)`,
      );
    }
    const operationCeiling: DataClass = definition.maximumDataClass;
    const envelopeClass = strictestOf(envelope.dataClasses);
    if (rankOfClass(envelopeClass) > rankOfClass(operationCeiling)) {
      return deny(
        `operation ${JSON.stringify(envelope.operation)} may touch at most "${operationCeiling}" data but the envelope declares "${envelopeClass}"`,
      );
    }

    /* 7 — trust gate (COMMS-004, FRANK-§15.5) ----------------------------- */
    const trustGate = evaluateTrustGate({
      actionClass: envelope.actionClass,
      influences: request.influences,
    });
    if (!trustGate.permitted) {
      return deny(
        trustGate.reason,
        `influencing sources: ${trustGate.offendingSourceIds.join(', ')} (FRANK-§15.5.10)`,
      );
    }

    /* 8 — single use ------------------------------------------------------ */
    if (request.dryRun !== true) {
      // The ledger compares the *binding* hash, not the full envelope hash: a
      // legitimate retry carries a later validity window and must still be
      // recognised as the same action. See `envelope.ts#envelopeBindingHash`.
      const claim = this.#nonces.claim({
        cellId: request.cellId,
        nonce: envelope.nonce,
        envelopeHash: envelopeBindingHash(envelope),
        retainUntil: new Date(Math.max(expiresAt, nowMs) + this.#retentionMs),
      });

      if (claim.outcome === 'conflict') {
        return deny(
          'nonce was already spent by a different envelope; an envelope is single-use and its nonce binds it (FRANK-§6.9 replay/mutation)',
        );
      }
      if (claim.outcome === 'replay') {
        if (definition.idempotency !== 'idempotent_replayable') {
          return deny(
            `envelope nonce was already spent and operation ${JSON.stringify(envelope.operation)} is single-use (FRANK-§6.9 replay)`,
          );
        }
        const previous = claim.previousDecision;
        if (previous === undefined) {
          // Claimed but never decided: the first evaluation crashed between the
          // claim and the record. Refuse rather than guess — an unknown outcome
          // must not become an allow.
          return deny(
            'envelope nonce was claimed but no decision was recorded for it; the original outcome is unknown and unknown fails closed (FRANK-§2.3)',
          );
        }
        return {
          decision: previous,
          envelope,
          envelopeHash: hash,
          matchedAuthorization: undefined,
          replayed: true,
        };
      }
    }

    /* 9 — standing authorization ------------------------------------------ */
    const authorizationResult = evaluateAuthorizations({
      envelope,
      authorizations: request.authorizations,
      now: request.now,
      revocations: request.revocations,
    });
    const matched = authorizationResult.match;

    /* 10 — conditions ------------------------------------------------------ */
    const unmet: ConditionId[] = [];
    const met: ConditionId[] = [];
    for (const condition of rule.requiredConditions) {
      const kind = CONDITION_KINDS[condition];
      const satisfied =
        kind === 'computed'
          ? evaluateComputedCondition(condition, { envelope, rule, matched })
          : request.attestations.some(
              (attestation) =>
                attestation.condition === condition &&
                attestation.satisfied &&
                request.trustedAttestors.has(attestation.attestedBy),
            );
      (satisfied ? met : unmet).push(condition);
    }

    const result: PolicyResult = unmet.length === 0 ? rule.whenSatisfied : rule.whenUnsatisfied;

    /* 11 — limits ---------------------------------------------------------- */
    const limits =
      result === 'allow' || result === 'allow_with_limits'
        ? intersectLimits(envelope, rule, matched?.authorization, operationCeiling)
        : deniedLimits(currency);

    const reasons: string[] = [
      `FRANK-§7.6 "${rule.action}" -> ${rule.default}`,
      `rule ${rule.id} evaluated to ${result}`,
    ];
    if (met.length > 0) reasons.push(`conditions met: ${met.join(', ')}`);
    if (unmet.length > 0) reasons.push(`conditions unmet: ${unmet.join(', ')}`);
    if (matched !== undefined) {
      reasons.push(
        `matched standing authorization ${matched.authorization.authorizationId}` +
          (matched.narrow ? ' (narrow)' : ' (broad)'),
      );
    } else if (authorizationResult.mismatches.length > 0) {
      reasons.push(
        `no standing authorization matched: ${summariseMismatches(authorizationResult.mismatches)}`,
      );
    }

    const produced = decision({
      result,
      reasons,
      evaluatedEnvelopeHash: hash,
      limits,
      obligations: result === 'deny' ? [] : rule.obligations,
      // FRANK-§6.9: a decision cannot outlive the envelope it was made about.
      expiresAt: new Date(Math.min(expiresAt, nowMs + this.#retentionMs)).toISOString(),
      ...(matched === undefined
        ? {}
        : { matchedAuthorizationId: matched.authorization.authorizationId }),
    });

    if (request.dryRun !== true) {
      this.#nonces.recordDecision(request.cellId, envelope.nonce, produced);
    }

    return {
      decision: produced,
      envelope,
      envelopeHash: hash,
      matchedAuthorization:
        matched === undefined
          ? undefined
          : {
              authorizationId: matched.authorization.authorizationId,
              revocationCounter: matched.authorization.revocationCounter,
            },
      replayed: false,
    };
  }
}

function summariseMismatches(
  mismatches: ReadonlyArray<{
    readonly authorizationId: string;
    readonly reasons: readonly AuthorizationMismatch[];
  }>,
): string {
  return mismatches
    .map((entry) => `${entry.authorizationId}[${entry.reasons.join('|')}]`)
    .join(', ');
}

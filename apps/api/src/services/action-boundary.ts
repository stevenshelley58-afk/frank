/**
 * Where an HTTP request becomes a FRANK-§6.9 action.
 *
 * This is the seam the whole policy design turns on, so it is worth being
 * precise about what happens in what order:
 *
 *     authenticate            (packages/identity)         — who is asking
 *     authorize               (packages/identity)         — may they ask this kind of thing
 *     build an ActionEnvelope (here)                      — the exact thing, immutable
 *     sign it                 (here, with the session key) — the owner's authority, not a model's
 *     evaluate                (packages/policy)           — FRANK-§6.9 decision
 *     execute                 (services/store.ts)         — one transaction
 *
 * ## Why the API signs
 *
 * FRANK-§6.9: "Models may propose envelopes but cannot sign, widen, or approve
 * them." In Slice 1 there is no model in the loop at all — the proposer is a
 * human with an authenticated session — so the signer is a session-scoped key
 * held by the API and registered as an `owner`/`member`/`service` kind in the
 * {@link SignerRegistry}. When the agent kernel arrives in Slice 2, the agent
 * builds the *proposal* and this code still does the signing, because the signer
 * registry will refuse to register the agent with `maySign: true`.
 *
 * The `requestHash` binds the envelope to the exact request body, so a decision
 * cannot be reused for a different payload even on the same target.
 *
 * ## Influence is passed, never inferred
 *
 * `influences` is a required argument of {@link buildAndEvaluate}, mirroring the
 * required field on the policy engine's request. A route handler must state what
 * chose the action. For Slice 1's routes the honest answer is always "the
 * owner's authenticated command", and saying so explicitly is what makes the
 * first route that is *not* owner-driven visible in review.
 */

import { createHash } from 'node:crypto';

import type { ActionClass, ActionEnvelope, PolicyDecision, ResourceRef } from '@frank/contracts';
import type { Principal } from '@frank/identity';
import type {
  EvaluationResult,
  InfluenceRecord,
  PolicyEngine,
  SignerRegistry,
} from '@frank/policy';
import { HmacEnvelopeSigner } from '@frank/policy';

export interface ActionBoundaryOptions {
  readonly engine: PolicyEngine;
  readonly signers: SignerRegistry;
  readonly signer: HmacEnvelopeSigner;
  readonly cellId: string;
  /** How long a request's envelope is valid. Short: it is used immediately. */
  readonly envelopeLifetimeMs?: number;
}

export interface ActionRequest {
  readonly principal: Principal;
  readonly operation: string;
  readonly actionClass: ActionClass;
  readonly target: ResourceRef;
  readonly recipient?: ResourceRef | undefined;
  /** `sha256:`-prefixed digest of the canonicalised request body. */
  readonly requestHash: string;
  /** FRANK-§12.1/§12.3 idempotency key. Becomes the envelope's. */
  readonly idempotencyKey: string;
  readonly dataClasses: readonly ('open' | 'internal' | 'private' | 'sensitive')[];
  /** COMMS-004 / FRANK-§15.5. Required; see the module comment. */
  readonly influences: readonly InfluenceRecord[];
  readonly correlationId: string;
  readonly now: Date;
  readonly dryRun?: boolean;
}

const DEFAULT_ENVELOPE_LIFETIME_MS = 120_000;

/**
 * The signer id for a principal.
 *
 * One signer per FRANK-§2.2 role kind rather than one per user: Slice 1 has one
 * user, and a per-user key would be a key management problem with no
 * corresponding security benefit while the API is the only thing that can sign.
 * The `principalId` is inside the envelope regardless, so the audit record
 * distinguishes people even when the signing key does not.
 */
export function signerIdFor(principal: Principal): string {
  if (principal.roles.includes('service_identity')) return 'frank.api/service';
  if (principal.roles.includes('owner')) return 'frank.api/owner';
  if (principal.roles.includes('operator')) return 'frank.api/operator';
  if (principal.roles.includes('builder')) return 'frank.api/builder';
  if (principal.roles.includes('reviewer')) return 'frank.api/reviewer';
  return 'frank.api/member';
}

export class ActionBoundary {
  readonly #options: ActionBoundaryOptions;
  readonly #lifetimeMs: number;

  constructor(options: ActionBoundaryOptions) {
    this.#options = options;
    this.#lifetimeMs = options.envelopeLifetimeMs ?? DEFAULT_ENVELOPE_LIFETIME_MS;
  }

  /**
   * Build, sign, and evaluate an envelope for one request.
   *
   * Returns the full {@link EvaluationResult}, not a boolean: the caller needs
   * the decision to put on the audit entry (FRANK-§11.5) and in the response
   * (FRANK-§12.3), and the envelope hash to bind them together.
   */
  evaluate(request: ActionRequest): EvaluationResult {
    const signerId = signerIdFor(request.principal);
    const signer = this.#options.signers.require(signerId);

    const unsigned: Omit<ActionEnvelope, 'signature'> = {
      schema: 'frank.action/v1',
      // Deterministic, not random. A retried request is the *same action*
      // (FRANK-§12.1 puts an idempotency key on every action endpoint), so its
      // action id must be the same too — a random one would make every retry a
      // different action that happened to share a key.
      actionId: `act-${createHash('sha256')
        .update(`${request.operation}${request.idempotencyKey}${request.principal.principalId}`, 'utf8')
        .digest('hex')
        .slice(0, 32)}`,
      idempotencyKey: request.idempotencyKey,
      // The nonce binds this envelope to one evaluation. It is derived from the
      // idempotency key rather than random, so a client retry produces the same
      // nonce and therefore reaches the ledger's replay path instead of looking
      // like a second, different action.
      nonce: `${request.operation}:${request.idempotencyKey}`,
      cellId: this.#options.cellId,
      principalId: request.principal.principalId,
      ...(request.principal.delegatedActorId === undefined
        ? {}
        : { delegatedActorId: request.principal.delegatedActorId }),
      operation: request.operation,
      actionClass: request.actionClass,
      target: request.target,
      ...(request.recipient === undefined ? {} : { recipient: request.recipient }),
      requestHash: request.requestHash,
      dataClasses: [...request.dataClasses],
      // FRANK-§2.3/§15.3: Slice 1 routes touch no credentials, so the list is
      // empty. An empty list is a claim the policy engine checks, not a default.
      credentialHandles: [],
      // FRANK-§15.6: a domain command contacts nothing. `none` is not "unset".
      networkScope: { mode: 'none', allowedHosts: [] },
      budget: {
        currency: 'USD',
        maximumSpend: 0,
        maximumWallClockSeconds: 30,
        maximumTokens: 0,
      },
      validFrom: new Date(request.now.getTime() - 1_000).toISOString(),
      expiresAt: new Date(request.now.getTime() + this.#lifetimeMs).toISOString(),
      signerId,
    };

    const envelope: ActionEnvelope = {
      ...unsigned,
      signature: this.#options.signer.sign(unsigned, signer),
    };

    return this.#options.engine.evaluate({
      envelope,
      cellId: this.#options.cellId,
      influences: request.influences,
      // Slice 1 issues no standing authorizations: every operation it exposes is
      // covered by a §7.6 row that runs automatically without one. An empty list
      // is therefore correct rather than a placeholder — see the §7.6 rows for
      // `create_internal_record` and `read_research_classify_summarise_plan`.
      authorizations: [],
      revocations: new Map(),
      attestations: [],
      trustedAttestors: new Set([request.principal.principalId]),
      now: request.now,
      ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
    });
  }
}

/**
 * The wire form of a FRANK-§6.9 decision.
 *
 * Snake_case, and lossless: everything the engine decided is in the response, so
 * a client (and a later audit reader) can see the reasons rather than only the
 * verdict. FRANK-§4.1 UX-006 wants recommendations "explainable"; a policy
 * refusal a user cannot see the reason for is the least explainable thing in the
 * product.
 */
export function policyDecisionToWire(decision: PolicyDecision): {
  result: PolicyDecision['result'];
  policy_version: string;
  reasons: string[];
  evaluated_envelope_hash: string;
  matched_authorization_id?: string;
  obligations: string[];
  limits: {
    budget: {
      currency: string;
      maximum_spend: number;
      maximum_wall_clock_seconds: number;
      maximum_tokens?: number;
    };
    network_scope: { mode: 'none' | 'allowlist' | 'proxied-allowlist'; allowed_hosts: string[] };
    maximum_data_class: 'open' | 'internal' | 'private' | 'sensitive' | 'secret';
    retry_limit?: number;
  };
  expires_at?: string;
} {
  return {
    result: decision.result,
    policy_version: decision.policyVersion,
    reasons: [...decision.reasons],
    evaluated_envelope_hash: decision.evaluatedEnvelopeHash,
    ...(decision.matchedAuthorizationId === undefined
      ? {}
      : { matched_authorization_id: decision.matchedAuthorizationId }),
    obligations: [...decision.obligations],
    limits: {
      budget: {
        currency: decision.limits.budget.currency,
        maximum_spend: decision.limits.budget.maximumSpend,
        maximum_wall_clock_seconds: decision.limits.budget.maximumWallClockSeconds,
        ...(decision.limits.budget.maximumTokens === undefined
          ? {}
          : { maximum_tokens: decision.limits.budget.maximumTokens }),
      },
      network_scope: {
        mode: decision.limits.networkScope.mode,
        allowed_hosts: [...decision.limits.networkScope.allowedHosts],
      },
      maximum_data_class: decision.limits.maximumDataClass,
      ...(decision.limits.retryLimit === undefined
        ? {}
        : { retry_limit: decision.limits.retryLimit }),
    },
    ...(decision.expiresAt === undefined ? {} : { expires_at: decision.expiresAt }),
  };
}

/**
 * The influence record for a request the owner made directly.
 *
 * A named constant rather than an inline literal at each call site, so that
 * `grep` for `OWNER_COMMAND_INFLUENCE` finds every route that claims its action
 * was chosen by a human — and so that the first route that cannot make that
 * claim has to write something different, visibly.
 */
export function ownerCommandInfluence(principal: Principal): readonly InfluenceRecord[] {
  return [
    {
      sourceId: `session/${principal.sessionId}`,
      trust: 'owner-authenticated',
      influenced: ['operation', 'target'],
    },
  ];
}

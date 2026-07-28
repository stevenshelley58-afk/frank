/**
 * Fixtures for the FRANK-§6.9 conformance suite.
 *
 * One place builds envelopes and one place builds engines, so an attack test
 * differs from the control case in exactly the field the attack changes. That is
 * the property that makes these tests evidence rather than decoration: if
 * `mutation.test.ts` had to construct its own envelope, a typo in an unrelated
 * field would produce a passing test for the wrong reason.
 *
 * Every builder takes an override object and applies it *after* the defaults, so
 * a test reads as "the baseline, except `expiresAt`".
 */

import type {
  ActionClass,
  ActionEnvelope,
  DataClass,
  StandingAuthorization,
} from '@frank/contracts';

import { PolicyEngine } from '../engine.js';
import type { ConditionAttestation, EvaluationRequest } from '../engine.js';
import { InMemorySpentNonceLedger } from '../nonce.js';
import type { SpentNonceLedger } from '../nonce.js';
import {
  HmacEnvelopeSigner,
  InMemoryKeyResolver,
  SignerRegistry,
} from '../signing.js';
import type { SignerRecord } from '../signing.js';
import type { InfluenceRecord } from '../trust.js';

export const CELL = 'cell-steven';
export const NOW = new Date('2026-07-28T09:00:00.000Z');

export const OWNER_SIGNER = 'user/steven';
export const AGENT_SIGNER = 'agent/planner';
export const MODEL_SIGNER = 'model/claude-opus';
export const SERVICE_SIGNER = 'service/capture-worker';

const OWNER_KEY = 'handle:frank/session/owner';
const AGENT_KEY = 'handle:frank/session/agent';
const MODEL_KEY = 'handle:frank/session/model';
const SERVICE_KEY = 'handle:frank/session/service';

/** 32 deterministic bytes per handle. Test-only; production keys come from OpenBao. */
function testKey(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed * 31 + index * 7) & 0xff);
}

export const SIGNER_RECORDS: readonly SignerRecord[] = [
  {
    signerId: OWNER_SIGNER,
    kind: 'owner',
    maySign: true,
    maximumActionClass: 'destructive_or_privileged',
    algorithm: 'hmac-sha256',
    keyHandle: OWNER_KEY,
  },
  {
    // FRANK-§6.9: an agent may propose. It may never sign.
    signerId: AGENT_SIGNER,
    kind: 'agent',
    maySign: false,
    maximumActionClass: 'observe',
    algorithm: 'hmac-sha256',
    keyHandle: AGENT_KEY,
  },
  {
    signerId: MODEL_SIGNER,
    kind: 'model',
    maySign: false,
    maximumActionClass: 'observe',
    algorithm: 'hmac-sha256',
    keyHandle: MODEL_KEY,
  },
  {
    /**
     * A FRANK-§2.2 "service identity: a non-human principal with explicit
     * capability and time limits". It may sign, but only up to
     * `internal_reversible` — this is the ceiling the privilege-inheritance
     * conformance test proves cannot be widened by delegation.
     */
    signerId: SERVICE_SIGNER,
    kind: 'service',
    maySign: true,
    maximumActionClass: 'internal_reversible',
    algorithm: 'hmac-sha256',
    keyHandle: SERVICE_KEY,
  },
];

export function buildKeyResolver(): InMemoryKeyResolver {
  return new InMemoryKeyResolver([
    [OWNER_KEY, testKey(1)],
    [AGENT_KEY, testKey(2)],
    [MODEL_KEY, testKey(3)],
    [SERVICE_KEY, testKey(4)],
  ]);
}

export interface Harness {
  readonly engine: PolicyEngine;
  readonly signers: SignerRegistry;
  readonly signer: HmacEnvelopeSigner;
  readonly nonces: SpentNonceLedger;
}

export function buildHarness(): Harness {
  const signers = new SignerRegistry(SIGNER_RECORDS);
  const signer = new HmacEnvelopeSigner(buildKeyResolver());
  const nonces = new InMemorySpentNonceLedger();
  const engine = new PolicyEngine({ signers, verifier: signer, nonces });
  return { engine, signers, signer, nonces };
}

let nonceCounter = 0;

export function freshNonce(): string {
  nonceCounter += 1;
  return `nonce-${nonceCounter.toString().padStart(6, '0')}`;
}

export interface EnvelopeOverrides {
  readonly actionId?: string;
  readonly idempotencyKey?: string;
  readonly nonce?: string;
  readonly cellId?: string;
  readonly principalId?: string;
  readonly delegatedActorId?: string;
  readonly operation?: string;
  readonly actionClass?: ActionClass;
  readonly target?: ActionEnvelope['target'];
  readonly recipient?: ActionEnvelope['recipient'];
  readonly requestHash?: string;
  readonly artifactDigest?: string;
  readonly dataClasses?: readonly DataClass[];
  readonly credentialHandles?: readonly string[];
  readonly networkScope?: ActionEnvelope['networkScope'];
  readonly budget?: ActionEnvelope['budget'];
  readonly validFrom?: string;
  readonly expiresAt?: string;
  readonly signerId?: string;
  /** Set to skip signing and use this literal signature. */
  readonly signature?: string;
}

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

/**
 * Build a signed envelope.
 *
 * Signed by `overrides.signerId ?? OWNER_SIGNER` unless `overrides.signature` is
 * given, in which case the signature is used verbatim — which is how a test
 * produces a forged envelope without the signer refusing to make one.
 */
export function buildEnvelope(
  harness: Harness,
  overrides: EnvelopeOverrides = {},
): ActionEnvelope {
  const signerId = overrides.signerId ?? OWNER_SIGNER;
  const unsigned: Omit<ActionEnvelope, 'signature'> = {
    schema: 'frank.action/v1',
    actionId: overrides.actionId ?? 'action-0001',
    idempotencyKey: overrides.idempotencyKey ?? 'idem-0001',
    nonce: overrides.nonce ?? freshNonce(),
    cellId: overrides.cellId ?? CELL,
    principalId: overrides.principalId ?? OWNER_SIGNER,
    ...(overrides.delegatedActorId === undefined
      ? {}
      : { delegatedActorId: overrides.delegatedActorId }),
    operation: overrides.operation ?? 'work.transition',
    actionClass: overrides.actionClass ?? 'internal_reversible',
    target: overrides.target ?? { kind: 'work_item', id: 'wi-0001', cellId: CELL },
    ...(overrides.recipient === undefined ? {} : { recipient: overrides.recipient }),
    requestHash: overrides.requestHash ?? ZERO_HASH,
    ...(overrides.artifactDigest === undefined
      ? {}
      : { artifactDigest: overrides.artifactDigest }),
    dataClasses: [...(overrides.dataClasses ?? ['internal'])],
    credentialHandles: [...(overrides.credentialHandles ?? [])],
    networkScope: overrides.networkScope ?? { mode: 'none', allowedHosts: [] },
    budget: overrides.budget ?? {
      currency: 'USD',
      maximumSpend: 1,
      maximumWallClockSeconds: 60,
      maximumTokens: 10_000,
    },
    validFrom: overrides.validFrom ?? '2026-07-28T08:00:00.000Z',
    expiresAt: overrides.expiresAt ?? '2026-07-28T10:00:00.000Z',
    signerId,
  };

  if (overrides.signature !== undefined) {
    return { ...unsigned, signature: overrides.signature };
  }

  const record = harness.signers.require(signerId);
  return { ...unsigned, signature: harness.signer.sign(unsigned, record) };
}

/** The owner acting on their own authenticated command. The benign baseline. */
export const OWNER_INFLUENCE: readonly InfluenceRecord[] = [
  { sourceId: 'session/steven', trust: 'owner-authenticated', influenced: ['operation', 'target'] },
];

/** A hostile email that chose the recipient. The COMMS-004 case. */
export const HOSTILE_EMAIL_INFLUENCE: readonly InfluenceRecord[] = [
  {
    sourceId: 'source/email-8842',
    trust: 'external-untrusted',
    influenced: ['recipient', 'operation'],
  },
];

export function buildRequest(
  envelope: ActionEnvelope,
  overrides: Partial<Omit<EvaluationRequest, 'envelope'>> = {},
): EvaluationRequest {
  return {
    envelope,
    cellId: overrides.cellId ?? CELL,
    influences: overrides.influences ?? OWNER_INFLUENCE,
    authorizations: overrides.authorizations ?? [],
    revocations: overrides.revocations ?? new Map<string, number>(),
    attestations: overrides.attestations ?? [],
    trustedAttestors: overrides.trustedAttestors ?? new Set([OWNER_SIGNER]),
    now: overrides.now ?? NOW,
    ...(overrides.dryRun === undefined ? {} : { dryRun: overrides.dryRun }),
  };
}

export function attest(
  condition: ConditionAttestation['condition'],
  attestedBy = OWNER_SIGNER,
): ConditionAttestation {
  return { condition, satisfied: true, attestedBy };
}

export interface AuthorizationOverrides {
  readonly authorizationId?: string;
  readonly allowedActors?: readonly string[];
  readonly operations?: readonly string[];
  readonly targetPattern?: StandingAuthorization['targetPattern'];
  readonly recipientPattern?: StandingAuthorization['recipientPattern'];
  readonly maximumDataClass?: DataClass;
  readonly credentialScopes?: readonly string[];
  readonly networkScope?: StandingAuthorization['networkScope'];
  readonly perActionBudget?: StandingAuthorization['perActionBudget'];
  readonly validFrom?: string;
  readonly expiresAt?: string;
  readonly revocationCounter?: number;
  readonly retryLimit?: number;
}

export function buildAuthorization(
  overrides: AuthorizationOverrides = {},
): StandingAuthorization {
  return {
    schema: 'frank.authorization/v1',
    authorizationId: overrides.authorizationId ?? 'auth-0001',
    ownerId: OWNER_SIGNER,
    allowedActors: [...(overrides.allowedActors ?? [OWNER_SIGNER])],
    operations: [...(overrides.operations ?? ['work.transition'])],
    targetPattern: overrides.targetPattern ?? { kind: 'work_item', idPattern: 'wi-0001' },
    ...(overrides.recipientPattern === undefined
      ? {}
      : { recipientPattern: overrides.recipientPattern }),
    maximumDataClass: overrides.maximumDataClass ?? 'internal',
    credentialScopes: [...(overrides.credentialScopes ?? [])],
    networkScope: overrides.networkScope ?? { mode: 'none', allowedHosts: [] },
    perActionBudget: overrides.perActionBudget ?? {
      currency: 'USD',
      maximumSpend: 5,
      maximumWallClockSeconds: 600,
    },
    aggregateBudget: { currency: 'USD', maximumSpend: 50, maximumWallClockSeconds: 6_000 },
    evidenceObligations: [],
    retryLimit: overrides.retryLimit ?? 1,
    validFrom: overrides.validFrom ?? '2026-07-01T00:00:00.000Z',
    expiresAt: overrides.expiresAt ?? '2026-08-15T00:00:00.000Z',
    revocationCounter: overrides.revocationCounter ?? 0,
    signerId: OWNER_SIGNER,
    signature: 'hmac-sha256:standing-authorization-fixture',
  };
}

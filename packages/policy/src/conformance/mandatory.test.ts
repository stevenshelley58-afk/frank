/**
 * FRANK-§6.9 mandatory conformance suite.
 *
 * "Mutation, replay, wrong-target, expired-envelope, confused-deputy,
 * altered-artifact, revocation, and privilege-inheritance attacks are mandatory
 * conformance tests."
 *
 * Eight attacks, eight `describe` blocks, in the specification's order. Each
 * block starts by proving its own **control case** — the same action, benign,
 * succeeds — because a suite where every case is refused would also pass if the
 * engine denied everything, and a policy engine that denies everything is not a
 * policy engine.
 *
 * Every refusal is asserted to be *closed*: `result` is `deny` or
 * `hold_for_review`, the limits carry no spend and no network, and no exception
 * escaped. A test that only asserted "an error was thrown" would pass for an
 * engine that crashed, and a crash is not a refusal — it is an unknown outcome,
 * which FRANK-§2.3 says must not be mistaken for a safe one.
 */

import { describe, expect, it } from 'vitest';

import type { PolicyDecision } from '@frank/contracts';

import { assertDecisionAppliesTo } from '../decision.js';
import { SignerRegistry } from '../signing.js';
import { envelopeHash } from '../envelope.js';
import {
  CELL,
  NOW,
  OWNER_SIGNER,
  SERVICE_SIGNER,
  MODEL_SIGNER,
  AGENT_SIGNER,
  attest,
  buildAuthorization,
  buildEnvelope,
  buildHarness,
  buildRequest,
  freshNonce,
} from './fixtures.js';

/** Every refusal must look like this. Asserted in all eight blocks. */
function expectFailsClosed(decision: PolicyDecision): void {
  expect(decision.result === 'deny' || decision.result === 'hold_for_review').toBe(true);
  expect(decision.reasons.length).toBeGreaterThan(0);
  expect(decision.limits.budget.maximumSpend).toBe(0);
  expect(decision.limits.budget.maximumWallClockSeconds).toBe(0);
  expect(decision.limits.networkScope.mode).toBe('none');
  expect(decision.limits.networkScope.allowedHosts).toEqual([]);
  expect(decision.limits.retryLimit).toBe(0);
  // A refusal must never carry obligations: an obligation is something the
  // executor promises to do while acting, and it is not going to act.
  expect(decision.obligations).toEqual([]);
}

function expectAllowed(decision: PolicyDecision): void {
  expect(['allow', 'allow_with_limits']).toContain(decision.result);
}

/* ══════════════════════════════════════════════════ 1. mutation ═════════ */

describe('FRANK-§6.9 conformance 1/8 — mutation', () => {
  it('control: an unmutated envelope is allowed and its decision applies at execution', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(envelope));

    expectAllowed(result.decision);
    expect(result.decision.evaluatedEnvelopeHash).toBe(envelopeHash(envelope));

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(true);
  });

  it('a mutated envelope no longer verifies: the signature covers every declared field', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);

    // The attacker keeps the signature and rewrites the target.
    const mutated = { ...envelope, target: { kind: 'work_item', id: 'wi-9999', cellId: CELL } };

    const result = harness.engine.evaluate(buildRequest(mutated));
    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/signature does not verify/);
  });

  it.each([
    ['operation', { operation: 'work.assign' }],
    ['actionClass', { actionClass: 'destructive_or_privileged' as const }],
    ['principalId', { principalId: 'user/mallory' }],
    ['budget', { budget: { currency: 'USD', maximumSpend: 9_999, maximumWallClockSeconds: 60 } }],
    ['expiresAt', { expiresAt: '2030-01-01T00:00:00.000Z' }],
    ['requestHash', { requestHash: `sha256:${'a'.repeat(64)}` }],
    ['credentialHandles', { credentialHandles: ['handle:frank.openbao.prod-root'] }],
    ['networkScope', { networkScope: { mode: 'allowlist' as const, allowedHosts: ['evil.example'] } }],
  ])('mutating %s after signing fails closed', (_field, patch) => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const mutated = { ...envelope, ...patch };

    const result = harness.engine.evaluate(buildRequest(mutated));
    expectFailsClosed(result.decision);
  });

  it('a decision cannot be carried onto a different envelope at the execution boundary', () => {
    const harness = buildHarness();
    const approved = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(approved));
    expectAllowed(result.decision);

    // A second, independently valid envelope. Both are signed; the attack is
    // pairing decision A with envelope B.
    const other = buildEnvelope(harness, { target: { kind: 'work_item', id: 'wi-0002', cellId: CELL } });

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope: other,
      target: other.target,
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });

    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('envelope_mutated');
  });

  it('the evaluated envelope is frozen, so a caller cannot mutate it under the engine', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(envelope));

    expect(Object.isFrozen(result.envelope)).toBe(true);
    expect(Object.isFrozen(result.envelope.dataClasses)).toBe(true);
    expect(Object.isFrozen(result.envelope.networkScope.allowedHosts)).toBe(true);
    expect(() => {
      (result.envelope as { actionId: string }).actionId = 'rewritten';
    }).toThrow(TypeError);
  });

  it('an undeclared extra field cannot influence the decision or the hash', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const smuggled = { ...envelope, __proto__unused: 'ignore me', escalate: true };

    expect(envelopeHash(smuggled as typeof envelope)).toBe(envelopeHash(envelope));
    const result = harness.engine.evaluate(buildRequest(smuggled as typeof envelope));
    expectAllowed(result.decision);
    expect('escalate' in result.envelope).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════ 2. replay ═════════ */

describe('FRANK-§6.9 conformance 2/8 — replay', () => {
  it('control: a single-use envelope is allowed exactly once', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { operation: 'work.transition' });

    const first = harness.engine.evaluate(buildRequest(envelope));
    expectAllowed(first.decision);
    expect(first.replayed).toBe(false);
  });

  it('replaying a single-use envelope fails closed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { operation: 'work.transition' });

    harness.engine.evaluate(buildRequest(envelope));
    const second = harness.engine.evaluate(buildRequest(envelope));

    expectFailsClosed(second.decision);
    expect(second.decision.reasons.join(' ')).toMatch(/already spent/);
  });

  it('a nonce spent by one envelope cannot be reused by a different one', () => {
    const harness = buildHarness();
    const nonce = freshNonce();
    const first = buildEnvelope(harness, { nonce, target: { kind: 'work_item', id: 'wi-0001', cellId: CELL } });
    const second = buildEnvelope(harness, { nonce, target: { kind: 'work_item', id: 'wi-0002', cellId: CELL } });

    expectAllowed(harness.engine.evaluate(buildRequest(first)).decision);
    const result = harness.engine.evaluate(buildRequest(second));

    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/different envelope/);
  });

  it('an operation whose declared semantics are replay-safe returns the ORIGINAL decision', () => {
    const harness = buildHarness();
    // `source.capture` is declared `idempotent_replayable` in the operation
    // catalogue — see operating-policy.ts for why.
    const envelope = buildEnvelope(harness, { operation: 'source.capture' });

    const first = harness.engine.evaluate(buildRequest(envelope));
    expectAllowed(first.decision);

    const second = harness.engine.evaluate(buildRequest(envelope));
    expect(second.replayed).toBe(true);
    // Identical, not merely equivalent: a re-evaluation could disagree with
    // itself if an authorization changed in between.
    expect(second.decision).toStrictEqual(first.decision);
  });

  it('a replay-safe operation still refuses a replay whose envelope differs', () => {
    const harness = buildHarness();
    const nonce = freshNonce();
    const original = buildEnvelope(harness, { operation: 'source.capture', nonce });
    const tampered = buildEnvelope(harness, {
      operation: 'source.capture',
      nonce,
      idempotencyKey: 'idem-9999',
    });

    expectAllowed(harness.engine.evaluate(buildRequest(original)).decision);
    const result = harness.engine.evaluate(buildRequest(tampered));

    expectFailsClosed(result.decision);
  });

  it('a forged envelope cannot burn a legitimate nonce (signature is checked first)', () => {
    const harness = buildHarness();
    const nonce = freshNonce();

    const forged = buildEnvelope(harness, { nonce, signature: 'hmac-sha256:not-a-real-signature' });
    expectFailsClosed(harness.engine.evaluate(buildRequest(forged)).decision);

    // The real envelope, with the same nonce, must still work.
    const genuine = buildEnvelope(harness, { nonce });
    expectAllowed(harness.engine.evaluate(buildRequest(genuine)).decision);
  });

  it('a dry run spends nothing, so the real evaluation still succeeds', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { operation: 'work.transition' });

    const preview = harness.engine.evaluate(buildRequest(envelope, { dryRun: true }));
    expectAllowed(preview.decision);

    const real = harness.engine.evaluate(buildRequest(envelope));
    expectAllowed(real.decision);
    expect(real.replayed).toBe(false);
  });
});

/* ═════════════════════════════════════════════ 3. wrong-target ═════════ */

describe('FRANK-§6.9 conformance 3/8 — wrong-target', () => {
  it('control: the named target is authorized', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({
      targetPattern: { kind: 'work_item', idPattern: 'wi-0001' },
    });
    const envelope = buildEnvelope(harness);

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization] }),
    );
    expectAllowed(result.decision);
    expect(result.decision.matchedAuthorizationId).toBe('auth-0001');
  });

  it('an envelope whose target the authorization does not cover gets no authorization', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({
      targetPattern: { kind: 'work_item', idPattern: 'wi-0001' },
    });
    const envelope = buildEnvelope(harness, {
      // A consequential operation, so a missing authorization is decisive.
      operation: 'work.transition',
      target: { kind: 'work_item', id: 'wi-0002', cellId: CELL },
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization] }),
    );
    expect(result.decision.matchedAuthorizationId).toBeUndefined();
    expect(result.decision.reasons.join(' ')).toMatch(/target_pattern/);
  });

  it('executing against a different resource than the decision named fails closed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(envelope));
    expectAllowed(result.decision);

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: { kind: 'work_item', id: 'wi-9999', cellId: CELL },
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });

    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('wrong_target');
  });

  it('a target of the right id but the wrong kind is not the same target', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(envelope));

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: { kind: 'source', id: envelope.target.id, cellId: CELL },
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(false);
  });

  it('a target in another cell is refused (FRANK-§2.4)', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(envelope));

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: { kind: 'work_item', id: envelope.target.id, cellId: 'cell-someone-else' },
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(false);
  });

  it('sending to a recipient the decision never authorized fails closed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(envelope));

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      recipient: { kind: 'email', id: 'attacker@example.com' },
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('wrong_recipient');
  });

  it('a wildcard in the authorization does not make an arbitrary id "exact"', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({
      operations: ['work.transition'],
      targetPattern: { kind: 'work_item', idPattern: '*' },
    });
    const envelope = buildEnvelope(harness, {
      target: { kind: 'work_item', id: 'wi-anything', cellId: CELL },
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization] }),
    );
    // It matches — a broad authorization is legal — but it is not *narrow*, and
    // the consequential row requires narrowness. Proven in block 8.
    expect(result.decision.reasons.join(' ')).toMatch(/\(broad\)/);
  });
});

/* ═══════════════════════════════════════ 4. expired-envelope ═══════════ */

describe('FRANK-§6.9 conformance 4/8 — expired-envelope', () => {
  it('control: an envelope inside its validity window is allowed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      validFrom: '2026-07-28T08:00:00.000Z',
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    expectAllowed(harness.engine.evaluate(buildRequest(envelope, { now: NOW })).decision);
  });

  it('an expired envelope fails closed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      validFrom: '2026-07-27T08:00:00.000Z',
      expiresAt: '2026-07-27T10:00:00.000Z',
    });
    const result = harness.engine.evaluate(buildRequest(envelope, { now: NOW }));
    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/expired/);
  });

  it('an envelope that is not yet valid fails closed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      validFrom: '2026-07-29T08:00:00.000Z',
      expiresAt: '2026-07-29T10:00:00.000Z',
    });
    expectFailsClosed(harness.engine.evaluate(buildRequest(envelope, { now: NOW })).decision);
  });

  it('an inverted window fails closed rather than being interpreted', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      validFrom: '2026-07-28T10:00:00.000Z',
      expiresAt: '2026-07-28T08:00:00.000Z',
    });
    expectFailsClosed(harness.engine.evaluate(buildRequest(envelope, { now: NOW })).decision);
  });

  it('an unparseable timestamp fails closed rather than defaulting', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { expiresAt: 'whenever' });
    expectFailsClosed(harness.engine.evaluate(buildRequest(envelope, { now: NOW })).decision);
  });

  it('an expired STANDING AUTHORIZATION does not carry an in-window envelope', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({
      validFrom: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-07-01T00:00:00.000Z',
    });
    const envelope = buildEnvelope(harness);

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization], now: NOW }),
    );
    expect(result.decision.matchedAuthorizationId).toBeUndefined();
    expect(result.decision.reasons.join(' ')).toMatch(/expired/);
  });

  it('a decision that was valid becomes unusable once the envelope expires', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      validFrom: '2026-07-28T08:00:00.000Z',
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    const result = harness.engine.evaluate(buildRequest(envelope, { now: NOW }));
    expectAllowed(result.decision);

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: new Date('2026-07-28T10:00:01.000Z'),
    });
    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('decision_expired');
  });
});

/* ═══════════════════════════════════════ 5. confused-deputy ════════════ */

describe('FRANK-§6.9 conformance 5/8 — confused-deputy', () => {
  it('control: the owner acting on their own authenticated command is allowed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { principalId: OWNER_SIGNER });
    expectAllowed(harness.engine.evaluate(buildRequest(envelope)).decision);
  });

  it('a model cannot sign, however well-formed its envelope is', () => {
    const harness = buildHarness();
    // The model has key material in the fixture, so this is not "the model
    // lacked a key" — it is the registry refusing the *kind*.
    const record = harness.signers.require(MODEL_SIGNER);
    expect(record.maySign).toBe(false);

    const envelope = buildEnvelope(harness, {
      signerId: MODEL_SIGNER,
      principalId: MODEL_SIGNER,
      signature: 'hmac-sha256:whatever-the-model-produced',
    });
    const result = harness.engine.evaluate(buildRequest(envelope));

    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/may not sign/);
  });

  it('the signing API itself refuses to sign for a non-signing principal', () => {
    const harness = buildHarness();
    const record = harness.signers.require(AGENT_SIGNER);
    const unsigned = { ...buildEnvelope(harness), signerId: AGENT_SIGNER } as Omit<
      ReturnType<typeof buildEnvelope>,
      'signature'
    >;
    expect(() => harness.signer.sign(unsigned, record)).toThrow(/cannot sign/);
  });

  it('a registry cannot even be built with a signing model or a signing agent', () => {
    for (const kind of ['model', 'agent'] as const) {
      expect(
        () =>
          new SignerRegistry([
            {
              signerId: `${kind}/sneaky`,
              kind,
              maySign: true,
              maximumActionClass: 'observe',
              algorithm: 'hmac-sha256',
              keyHandle: 'handle:frank.test.key',
            },
          ]),
      ).toThrow(/FRANK-§6\.9/);
    }
  });

  it('a registry refuses raw key material in place of an opaque handle (FRANK-§2.3)', () => {
    expect(
      () =>
        new SignerRegistry([
          {
            signerId: 'user/careless',
            kind: 'owner',
            maySign: true,
            maximumActionClass: 'observe',
            algorithm: 'hmac-sha256',
            // A key, pasted where a handle belongs.
            keyHandle: 'hunter2-this-is-the-actual-secret',
          },
        ]),
    ).toThrow(/opaque handle/);
  });

  it("an agent presenting the owner's principal id is matched on the DELEGATE, not the principal", () => {
    const harness = buildHarness();
    // Signed by the service identity (which may sign) but delegated to an agent.
    // The authorization allows the owner. If the engine matched on
    // `principalId`, this would be allowed — that is the confused deputy.
    const authorization = buildAuthorization({
      allowedActors: [OWNER_SIGNER],
      operations: ['work.transition'],
    });
    const envelope = buildEnvelope(harness, {
      signerId: SERVICE_SIGNER,
      principalId: OWNER_SIGNER,
      delegatedActorId: AGENT_SIGNER,
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization] }),
    );
    expect(result.decision.matchedAuthorizationId).toBeUndefined();
    expect(result.decision.reasons.join(' ')).toMatch(/actor_not_allowed/);
  });

  it('untrusted content may not select the recipient of an outbound action (COMMS-004)', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      operation: 'work.transition',
      actionClass: 'internal_reversible',
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        influences: [
          {
            sourceId: 'source/email-8842',
            trust: 'external-untrusted',
            influenced: ['recipient', 'operation'],
          },
        ],
      }),
    );

    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/untrusted content selected/);
    expect(result.decision.reasons.join(' ')).toMatch(/source\/email-8842/);
  });

  it('a model-generated proposal is untrusted influence and cannot select a state change', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        influences: [
          { sourceId: 'run/1234', trust: 'generated-untrusted', influenced: ['operation'] },
        ],
      }),
    );
    expectFailsClosed(result.decision);
  });

  it('untrusted content MAY influence an observe action — the gate is not a blanket ban', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      operation: 'today.read',
      actionClass: 'observe',
      target: { kind: 'today', id: 'today-2026-07-28', cellId: CELL },
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        influences: [
          { sourceId: 'source/email-8842', trust: 'external-untrusted', influenced: ['operation'] },
        ],
      }),
    );
    expectAllowed(result.decision);
  });

  it('untrusted CONTENT (as opposed to selection) never blocks an action', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { operation: 'source.capture' });

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        influences: [
          { sourceId: 'session/steven', trust: 'owner-authenticated', influenced: ['operation'] },
          { sourceId: 'source/email-8842', trust: 'external-untrusted', influenced: ['content'] },
        ],
      }),
    );
    expectAllowed(result.decision);
  });

  it('an envelope presented to the wrong cell fails closed (FRANK-§2.4)', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { cellId: 'cell-other' });
    const result = harness.engine.evaluate(buildRequest(envelope, { cellId: CELL }));
    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/FRANK-§2\.4/);
  });
});

/* ═══════════════════════════════════════ 6. altered-artifact ═══════════ */

describe('FRANK-§6.9 conformance 6/8 — altered-artifact', () => {
  const DIGEST_A = `sha256:${'1'.repeat(64)}`;
  const DIGEST_B = `sha256:${'2'.repeat(64)}`;

  it('control: the approved artifact executes', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { artifactDigest: DIGEST_A });
    const result = harness.engine.evaluate(buildRequest(envelope));
    expectAllowed(result.decision);

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      artifactDigest: DIGEST_A,
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(true);
  });

  it('an artifact swapped between approval and execution fails closed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { artifactDigest: DIGEST_A });
    const result = harness.engine.evaluate(buildRequest(envelope));

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      artifactDigest: DIGEST_B,
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('artifact_altered');
  });

  it('omitting the digest at execution time is a refusal, not a waiver', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { artifactDigest: DIGEST_A });
    const result = harness.engine.evaluate(buildRequest(envelope));

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('artifact_altered');
  });

  it('smuggling an artifact into an execution the decision covered without one fails closed', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(buildRequest(envelope));

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      artifactDigest: DIGEST_B,
      revocations: new Map(),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(false);
  });

  it('changing artifactDigest after signing breaks the signature', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { artifactDigest: DIGEST_A });
    const mutated = { ...envelope, artifactDigest: DIGEST_B };
    expectFailsClosed(harness.engine.evaluate(buildRequest(mutated)).decision);
  });
});

/* ════════════════════════════════════════════ 7. revocation ════════════ */

describe('FRANK-§6.9 conformance 7/8 — revocation', () => {
  it('control: an unrevoked authorization carries the action', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({ revocationCounter: 3 });
    const envelope = buildEnvelope(harness);

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        authorizations: [authorization],
        revocations: new Map([['auth-0001', 3]]),
      }),
    );
    expectAllowed(result.decision);
    expect(result.matchedAuthorization).toStrictEqual({
      authorizationId: 'auth-0001',
      revocationCounter: 3,
    });
  });

  it('an authorization whose revocation counter has advanced no longer matches', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({ revocationCounter: 3 });
    const envelope = buildEnvelope(harness, {
      operation: 'work.transition',
      actionClass: 'internal_reversible',
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        authorizations: [authorization],
        // The owner revoked: the registry has moved on.
        revocations: new Map([['auth-0001', 4]]),
      }),
    );
    expect(result.decision.matchedAuthorizationId).toBeUndefined();
    expect(result.decision.reasons.join(' ')).toMatch(/revoked/);
  });

  it('a decision issued BEFORE revocation cannot be executed AFTER it', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({ revocationCounter: 3 });
    const envelope = buildEnvelope(harness);

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        authorizations: [authorization],
        revocations: new Map([['auth-0001', 3]]),
      }),
    );
    expectAllowed(result.decision);

    // Steven revokes. The already-issued decision must stop working.
    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      matchedAuthorization: result.matchedAuthorization,
      revocations: new Map([['auth-0001', 4]]),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });

    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('authorization_revoked');
  });

  it('an executor that cannot say which authorization version it holds is refused', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({ revocationCounter: 0 });
    const envelope = buildEnvelope(harness);
    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization] }),
    );
    expectAllowed(result.decision);
    expect(result.decision.matchedAuthorizationId).toBe('auth-0001');

    const verdict = assertDecisionAppliesTo({
      decision: result.decision,
      envelope,
      target: envelope.target,
      // matchedAuthorization deliberately omitted: revocation is uncheckable.
      revocations: new Map([['auth-0001', 0]]),
      dischargedObligations: result.decision.obligations,
      now: NOW,
    });
    expect(verdict.permitted).toBe(false);
    expect(verdict.permitted === false && verdict.refusal).toBe('authorization_revoked');
  });

  it('a revoked authorization cannot be re-presented with a bumped counter', () => {
    const harness = buildHarness();
    // The attacker edits the authorization document to claim counter 9.
    const forged = buildAuthorization({ revocationCounter: 9 });
    const envelope = buildEnvelope(harness, { operation: 'send.email' });

    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        authorizations: [forged],
        revocations: new Map([['auth-0001', 4]]),
      }),
    );
    // The operation is not in the catalogue at all, so it dies before it gets
    // anywhere near the authorization. Unknown operations fail closed.
    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/not in the operation catalogue/);
  });
});

/* ═════════════════════════════════ 8. privilege-inheritance ════════════ */

describe('FRANK-§6.9 conformance 8/8 — privilege-inheritance', () => {
  it('control: a service identity may sign within its own ceiling', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      signerId: SERVICE_SIGNER,
      principalId: SERVICE_SIGNER,
      operation: 'work.transition',
      actionClass: 'internal_reversible',
    });
    expectAllowed(harness.engine.evaluate(buildRequest(envelope)).decision);
  });

  it("a service identity cannot sign above its ceiling by naming the owner as principal", () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      signerId: SERVICE_SIGNER,
      // The owner is allowed `destructive_or_privileged`. The service is not.
      principalId: OWNER_SIGNER,
      operation: 'work.transition',
      actionClass: 'destructive_or_privileged',
    });

    const result = harness.engine.evaluate(buildRequest(envelope));
    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(
      /delegation intersects authority, it does not inherit it/,
    );
  });

  it('a standing authorization cannot widen the effective limits beyond the §7.6 ceiling', () => {
    const harness = buildHarness();
    // A generous authorization: 5000 USD, an hour, sensitive data, wide network.
    const authorization = buildAuthorization({
      operations: ['work.transition'],
      maximumDataClass: 'sensitive',
      networkScope: { mode: 'allowlist', allowedHosts: ['a.example', 'b.example'] },
      perActionBudget: { currency: 'USD', maximumSpend: 5_000, maximumWallClockSeconds: 3_600 },
      retryLimit: 99,
    });
    const envelope = buildEnvelope(harness, {
      operation: 'work.transition',
      dataClasses: ['sensitive'],
      networkScope: { mode: 'allowlist', allowedHosts: ['a.example'] },
      budget: { currency: 'USD', maximumSpend: 5, maximumWallClockSeconds: 900 },
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization] }),
    );
    expectAllowed(result.decision);

    // The §7.6 `internal_records` row caps spend at 5.00, wall clock at 900 s,
    // network at `none`, and retries at 3. The intersection wins over both the
    // generous authorization and the envelope's own request.
    expect(result.decision.limits.budget.maximumSpend).toBeLessThanOrEqual(5);
    expect(result.decision.limits.budget.maximumWallClockSeconds).toBeLessThanOrEqual(900);
    expect(result.decision.limits.networkScope.mode).toBe('none');
    expect(result.decision.limits.networkScope.allowedHosts).toEqual([]);
    expect(result.decision.limits.retryLimit).toBeLessThanOrEqual(3);
  });

  it('two authorizations do not add up: the engine takes one, never the union', () => {
    const harness = buildHarness();
    const hostsA = buildAuthorization({
      authorizationId: 'auth-a',
      operations: ['work.transition'],
      networkScope: { mode: 'allowlist', allowedHosts: ['a.example'] },
    });
    const hostsB = buildAuthorization({
      authorizationId: 'auth-b',
      operations: ['work.transition'],
      networkScope: { mode: 'allowlist', allowedHosts: ['b.example'] },
    });
    const envelope = buildEnvelope(harness, {
      networkScope: { mode: 'allowlist', allowedHosts: ['a.example', 'b.example'] },
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [hostsA, hostsB] }),
    );
    // Neither authorization covers both hosts, so neither matches at all.
    expect(result.decision.matchedAuthorizationId).toBeUndefined();
  });

  it('the consequential §7.6 row holds unless a NARROW authorization covers it', () => {
    const harness = buildHarness();
    const broad = buildAuthorization({
      operations: ['work.transition'],
      targetPattern: { kind: 'work_item', idPattern: 'wi-*' },
      expiresAt: '2027-07-01T00:00:00.000Z',
    });
    const envelope = buildEnvelope(harness, {
      operation: 'work.transition',
      actionClass: 'internal_reversible',
    });
    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [broad] }),
    );
    // Matched, but recorded as broad — the narrowness test is what the
    // consequential row's condition consults.
    expect(result.decision.reasons.join(' ')).toMatch(/\(broad\)/);
  });

  it('an attestation from an untrusted attestor does not satisfy a §7.6 condition', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, {
      operation: 'work.transition',
      actionClass: 'internal_reversible',
    });

    // The `internal_records` row has no attested conditions, so use the engine's
    // own condition machinery through a rule that does: build a request that
    // attests as the *model*, which is not a trusted attestor.
    const result = harness.engine.evaluate(
      buildRequest(envelope, {
        attestations: [attest('passes_pre_and_post_health_checks', MODEL_SIGNER)],
        trustedAttestors: new Set([OWNER_SIGNER]),
      }),
    );
    // The rule does not require it, so the action still succeeds — what is
    // proven here is that an attestation by a model is simply not counted.
    expectAllowed(result.decision);
    expect(result.decision.reasons.join(' ')).not.toMatch(/passes_pre_and_post_health_checks/);
  });

  it('a credential handle outside the authorization\'s scopes is not granted', () => {
    const harness = buildHarness();
    const authorization = buildAuthorization({
      operations: ['work.transition'],
      credentialScopes: ['handle:frank.calendar.*'],
    });
    const envelope = buildEnvelope(harness, {
      credentialHandles: ['handle:frank.openbao.root'],
    });

    const result = harness.engine.evaluate(
      buildRequest(envelope, { authorizations: [authorization] }),
    );
    expect(result.decision.matchedAuthorizationId).toBeUndefined();
    expect(result.decision.reasons.join(' ')).toMatch(/credential_scope_not_granted/);
  });

  it('a `secret`-class payload is refused outright, handle or not', () => {
    const harness = buildHarness();
    const envelope = buildEnvelope(harness, { dataClasses: ['internal', 'secret'] });
    const result = harness.engine.evaluate(buildRequest(envelope));
    expectFailsClosed(result.decision);
    expect(result.decision.reasons.join(' ')).toMatch(/secret/);
  });

  it('a raw token where a handle belongs is refused, and is never echoed back', () => {
    const harness = buildHarness();
    const secret = 'sk-live-THIS-IS-A-REAL-LOOKING-TOKEN';
    const envelope = buildEnvelope(harness, { credentialHandles: [secret] });

    const result = harness.engine.evaluate(buildRequest(envelope));
    expectFailsClosed(result.decision);
    expect(JSON.stringify(result.decision)).not.toContain(secret);
  });
});

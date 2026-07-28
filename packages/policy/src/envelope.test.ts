/**
 * Canonicalisation and freezing — the mechanics FRANK-§6.9's "immutable
 * envelope" rests on.
 *
 * The conformance suite proves the *attacks* fail. This file proves the
 * *properties* the attacks rely on: that the canonical form is stable under key
 * reordering, that it is not stable under any declared-field change, and that
 * an absent optional field is not the same as a present null one.
 */

import { describe, expect, it } from 'vitest';

import type { ActionEnvelope } from '@frank/contracts';

import { canonicalEnvelopeBytes, envelopeHash, envelopesMatch, freezeEnvelope } from './envelope.js';

const BASE: ActionEnvelope = {
  schema: 'frank.action/v1',
  actionId: 'action-1',
  idempotencyKey: 'idem-1',
  nonce: 'nonce-1',
  cellId: 'cell-steven',
  principalId: 'user/steven',
  operation: 'work.transition',
  actionClass: 'internal_reversible',
  target: { kind: 'work_item', id: 'wi-1', cellId: 'cell-steven' },
  requestHash: `sha256:${'0'.repeat(64)}`,
  dataClasses: ['internal'],
  credentialHandles: [],
  networkScope: { mode: 'none', allowedHosts: [] },
  budget: { currency: 'USD', maximumSpend: 1, maximumWallClockSeconds: 60 },
  validFrom: '2026-07-28T08:00:00.000Z',
  expiresAt: '2026-07-28T10:00:00.000Z',
  signerId: 'user/steven',
  signature: 'hmac-sha256:deadbeef',
};

describe('canonical envelope bytes', () => {
  it('is independent of property insertion order', () => {
    const reordered: ActionEnvelope = {
      signature: BASE.signature,
      signerId: BASE.signerId,
      expiresAt: BASE.expiresAt,
      validFrom: BASE.validFrom,
      budget: BASE.budget,
      networkScope: BASE.networkScope,
      credentialHandles: BASE.credentialHandles,
      dataClasses: BASE.dataClasses,
      requestHash: BASE.requestHash,
      target: BASE.target,
      actionClass: BASE.actionClass,
      operation: BASE.operation,
      principalId: BASE.principalId,
      cellId: BASE.cellId,
      nonce: BASE.nonce,
      idempotencyKey: BASE.idempotencyKey,
      actionId: BASE.actionId,
      schema: BASE.schema,
    };
    expect(canonicalEnvelopeBytes(reordered)).toEqual(canonicalEnvelopeBytes(BASE));
    expect(envelopesMatch(reordered, BASE)).toBe(true);
  });

  it('is independent of nested key order', () => {
    const nested: ActionEnvelope = {
      ...BASE,
      target: { cellId: 'cell-steven', id: 'wi-1', kind: 'work_item' },
      budget: { maximumWallClockSeconds: 60, maximumSpend: 1, currency: 'USD' },
    };
    expect(canonicalEnvelopeBytes(nested)).toEqual(canonicalEnvelopeBytes(BASE));
  });

  it('excludes the signature, so signing is well defined', () => {
    const resigned: ActionEnvelope = { ...BASE, signature: 'hmac-sha256:something-else' };
    expect(canonicalEnvelopeBytes(resigned)).toEqual(canonicalEnvelopeBytes(BASE));
  });

  it('ignores fields the contract does not declare', () => {
    const smuggled = { ...BASE, escalate: true, __proto__unused: 1 };
    expect(canonicalEnvelopeBytes(smuggled as ActionEnvelope)).toEqual(
      canonicalEnvelopeBytes(BASE),
    );
  });

  it('distinguishes an absent optional field from a present one', () => {
    const withRecipient: ActionEnvelope = {
      ...BASE,
      recipient: { kind: 'email', id: 'someone@example.com' },
    };
    expect(canonicalEnvelopeBytes(withRecipient)).not.toEqual(canonicalEnvelopeBytes(BASE));
  });

  it.each([
    ['actionId', { actionId: 'action-2' }],
    ['nonce', { nonce: 'nonce-2' }],
    ['operation', { operation: 'work.assign' }],
    ['target', { target: { kind: 'work_item', id: 'wi-2', cellId: 'cell-steven' } }],
    ['dataClasses', { dataClasses: ['private' as const] }],
    ['budget', { budget: { currency: 'USD', maximumSpend: 2, maximumWallClockSeconds: 60 } }],
    ['expiresAt', { expiresAt: '2026-07-28T11:00:00.000Z' }],
  ])('changes when %s changes', (_name, patch) => {
    const changed: ActionEnvelope = { ...BASE, ...patch };
    expect(canonicalEnvelopeBytes(changed)).not.toEqual(canonicalEnvelopeBytes(BASE));
  });
});

describe('envelope hash', () => {
  it('is `sha256:`-prefixed as the frozen contract schema requires', () => {
    expect(envelopeHash(BASE)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when the signature changes, so a re-signed envelope is a new envelope', () => {
    const resigned: ActionEnvelope = { ...BASE, signature: 'hmac-sha256:different' };
    expect(envelopeHash(resigned)).not.toBe(envelopeHash(BASE));
  });
});

describe('freezeEnvelope', () => {
  it('freezes every nested structure', () => {
    const frozen = freezeEnvelope({
      ...BASE,
      recipient: { kind: 'email', id: 'a@example.com' },
      compensation: { kind: 'post-commit-compensating', procedure: 'undo' },
      networkScope: { mode: 'allowlist', allowedHosts: ['a.example'] },
    });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.target)).toBe(true);
    expect(Object.isFrozen(frozen.recipient)).toBe(true);
    expect(Object.isFrozen(frozen.compensation)).toBe(true);
    expect(Object.isFrozen(frozen.budget)).toBe(true);
    expect(Object.isFrozen(frozen.networkScope)).toBe(true);
    expect(Object.isFrozen(frozen.networkScope.allowedHosts)).toBe(true);
    expect(Object.isFrozen(frozen.dataClasses)).toBe(true);
    expect(Object.isFrozen(frozen.credentialHandles)).toBe(true);
  });

  it('copies arrays, so mutating the caller\'s array does not reach the frozen value', () => {
    const hosts = ['a.example'];
    const frozen = freezeEnvelope({
      ...BASE,
      networkScope: { mode: 'allowlist', allowedHosts: hosts },
    });
    hosts.push('evil.example');
    expect(frozen.networkScope.allowedHosts).toEqual(['a.example']);
  });

  it('drops undeclared fields entirely', () => {
    const frozen = freezeEnvelope({ ...BASE, escalate: true } as ActionEnvelope);
    expect('escalate' in frozen).toBe(false);
  });

  it('does not freeze the caller\'s object', () => {
    const original: ActionEnvelope = { ...BASE };
    freezeEnvelope(original);
    expect(Object.isFrozen(original)).toBe(false);
  });
});

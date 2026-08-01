/**
 * Buzz adapter tests — BUZZ-003, BUZZ-007 conformance.
 *
 * Tests the verification pipeline against the mandatory adversarial cases:
 * forged signature, revoked key, member removed after event, wrong room,
 * wrong cell, duplicate event, delayed replay, altered artifact digest.
 */

import { describe, it, expect } from 'vitest';
import type { BuzzIdentityBinding, SignedBuzzEvent } from '@frank/contracts';
import {
  verifyEvent,
  structuralSignatureVerifier,
  DEFAULT_VERIFICATION_CONFIG,
  type VerificationDeps,
} from '../src/verification.js';
import { InMemoryBindingStore, InMemoryReplayCache } from '../src/buzz-relay-adapter.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const CELL_ID = 'cell-test-001';
const ROOM_ID = 'room-abc';
const PUBKEY = 'a'.repeat(64);
const OTHER_PUBKEY = 'b'.repeat(64);
const EVENT_ID = 'c'.repeat(64);
const SIG = 'd'.repeat(128);

const now = 1_700_000_000;

function makeBinding(overrides: Partial<BuzzIdentityBinding> = {}): BuzzIdentityBinding {
  return {
    bindingId: 'bind-001',
    cellId: CELL_ID,
    frankPrincipalId: 'steven',
    nostrPublicKey: PUBKEY,
    keyCustodian: 'secret-broker-signer',
    signingPurposes: ['room-message', 'proposal'],
    membershipValidFrom: new Date((now - 86400) * 1000).toISOString(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<SignedBuzzEvent> = {}): SignedBuzzEvent {
  return {
    eventId: EVENT_ID,
    kind: 42,
    pubkey: PUBKEY,
    createdAt: now - 60,
    tags: [['e', ROOM_ID]],
    content: 'hello from buzz',
    sig: SIG,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    config: { ...DEFAULT_VERIFICATION_CONFIG, cellId: CELL_ID },
    signer: structuralSignatureVerifier,
    bindings: new InMemoryBindingStore(),
    replay: new InMemoryReplayCache(),
    now: () => now,
    ...overrides,
  };
}

async function depsWithBinding(binding = makeBinding()): Promise<VerificationDeps> {
  const store = new InMemoryBindingStore();
  store.add(binding);
  return { ...makeDeps(), bindings: store };
}

/* ------------------------------------------------------------------ */
/* Happy path                                                         */
/* ------------------------------------------------------------------ */

describe('verifyEvent — happy path', () => {
  it('accepts a valid event from a valid binding in the right room', async () => {
    const deps = await depsWithBinding();
    const result = await verifyEvent(makeEvent(), ROOM_ID, deps);
    expect(result.accepted).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.bindingFound).toBe(true);
    expect(result.membershipValidAtEventTime).toBe(true);
    expect(result.roomMatches).toBe(true);
    expect(result.cellMatches).toBe(true);
    expect(result.notReplayed).toBe(true);
    expect(result.timestampValid).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* BUZZ-007 adversarial cases                                         */
/* ------------------------------------------------------------------ */

describe('verifyEvent — forged signature', () => {
  it('rejects an event with an invalid signature', async () => {
    const deps = await depsWithBinding();
    const result = await verifyEvent(makeEvent({ sig: 'x'.repeat(128) }), ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('signature-invalid');
  });
});

describe('verifyEvent — revoked key', () => {
  it('rejects an event from a revoked binding', async () => {
    const revoked = makeBinding({ revokedAt: new Date((now - 3600) * 1000).toISOString() });
    const deps = await depsWithBinding(revoked);
    const result = await verifyEvent(makeEvent(), ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('no-binding-in-cell');
  });
});

describe('verifyEvent — member removed after event', () => {
  it('rejects an event whose binding expired before the event time', async () => {
    // Binding valid until 1 hour before the event
    const expired = makeBinding({
      membershipValidUntil: new Date((now - 3600) * 1000).toISOString(),
    });
    const deps = await depsWithBinding(expired);
    const result = await verifyEvent(makeEvent(), ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('membership-not-valid-at-event-time');
  });
});

describe('verifyEvent — wrong room', () => {
  it('rejects an event tagged for a different room', async () => {
    const deps = await depsWithBinding();
    const result = await verifyEvent(makeEvent({ tags: [['e', 'room-other']] }), ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('wrong-room');
  });
});

describe('verifyEvent — wrong cell', () => {
  it('rejects an event whose author binding belongs to a different cell', async () => {
    const otherCell = makeBinding({ cellId: 'cell-attacker-999' });
    const deps = await depsWithBinding(otherCell);
    const result = await verifyEvent(makeEvent(), ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('no-binding-in-cell');
  });
});

describe('verifyEvent — duplicate / replayed event', () => {
  it('rejects the same event id on second ingestion', async () => {
    const deps = await depsWithBinding();
    const event = makeEvent();
    const first = await verifyEvent(event, ROOM_ID, deps);
    expect(first.accepted).toBe(true);

    const second = await verifyEvent(event, ROOM_ID, deps);
    expect(second.accepted).toBe(false);
    expect(second.rejectionReason).toBe('event-replayed');
  });
});

describe('verifyEvent — delayed replay (stale event)', () => {
  it('rejects an event older than maxEventAgeSeconds', async () => {
    // Binding must predate the stale event so membership check passes first
    const oldBinding = makeBinding({
      membershipValidFrom: new Date((now - 30 * 86400) * 1000).toISOString(),
    });
    const deps = await depsWithBinding(oldBinding);
    const stale = makeEvent({ createdAt: now - (25 * 60 * 60) }); // 25 hours ago
    const result = await verifyEvent(stale, ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('event-too-old');
  });
});

describe('verifyEvent — future event (clock skew)', () => {
  it('rejects an event too far in the future', async () => {
    const deps = await depsWithBinding();
    const future = makeEvent({ createdAt: now + 600 }); // 10 minutes ahead
    const result = await verifyEvent(future, ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('event-in-future');
  });
});

describe('verifyEvent — altered artifact digest', () => {
  it('rejects an event with an empty artifact digest tag', async () => {
    const deps = await depsWithBinding();
    const event = makeEvent({ tags: [['e', ROOM_ID], ['artifact', 'file.txt', '']] });
    const result = await verifyEvent(event, ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('artifact-digest-invalid');
  });
});

/* ------------------------------------------------------------------ */
/* No binding at all                                                  */
/* ------------------------------------------------------------------ */

describe('verifyEvent — unknown author', () => {
  it('rejects an event from an author with no binding', async () => {
    const deps = makeDeps(); // empty binding store
    const result = await verifyEvent(makeEvent({ pubkey: OTHER_PUBKEY }), ROOM_ID, deps);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('no-binding-in-cell');
  });
});

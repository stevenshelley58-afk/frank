/**
 * FRANK Buzz event verification — BUZZ-003, BUZZ-007.
 *
 * A Buzz event is an untrusted collaboration proposal until FRANK resolves
 * actor, membership-at-event-time, schema, artifact digest, replay state,
 * and current policy. A Buzz event alone can never approve production or
 * another consequential action.
 *
 * This module is pure verification logic with no I/O. The adapter supplies
 * the binding store and replay cache; this module applies the rules.
 */

import type {
  BuzzEventVerification,
  BuzzIdentityBinding,
  SignedBuzzEvent,
} from '@frank/contracts';

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface VerificationConfig {
  /** Cell this FRANK instance serves. */
  cellId: string;
  /** Maximum age of an event in seconds before it is rejected as stale. */
  maxEventAgeSeconds: number;
  /** Maximum future skew in seconds before rejecting as clock-skewed. */
  maxFutureSkewSeconds: number;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  cellId: 'cell-steven-001',
  maxEventAgeSeconds: 24 * 60 * 60, // 24 hours
  maxFutureSkewSeconds: 300, // 5 minutes
};

/* ------------------------------------------------------------------ */
/* Signature verification port                                        */
/* ------------------------------------------------------------------ */

/**
 * Pluggable Schnorr/secp256k1 signature verifier.
 *
 * Production must inject a real implementation (e.g. @noble/secp256k1 or
 * nostr-tools). The structural-only default below validates hex shape but
 * cannot prove cryptographic authenticity — it exists so the verification
 * pipeline is testable without a native dependency.
 */
export interface SignatureVerifier {
  /**
   * Verify a Nostr event signature.
   * @param pubkey Hex-encoded 32-byte x-only public key.
   * @param eventId Hex-encoded 32-byte event id (sha256 of serialized event).
   * @param sig Hex-encoded 64-byte Schnorr signature.
   * @returns true if the signature is valid for this pubkey+eventId.
   */
  verify(pubkey: string, eventId: string, sig: string): boolean;
}

/**
 * Structural-only verifier: checks hex length and character set.
 * NOT cryptographically secure — inject a real verifier for production.
 */
export const structuralSignatureVerifier: SignatureVerifier = {
  verify(pubkey: string, eventId: string, sig: string): boolean {
    const hex64 = /^[0-9a-f]{64}$/;
    const hex128 = /^[0-9a-f]{128}$/;
    return hex64.test(pubkey) && hex64.test(eventId) && hex128.test(sig);
  },
};

/* ------------------------------------------------------------------ */
/* Binding and replay stores (injected)                               */
/* ------------------------------------------------------------------ */

/** Lookup bindings by Nostr public key. */
export interface BindingStore {
  /** Find all bindings for a public key, most recent first. */
  findByPubkey(pubkey: string): Promise<BuzzIdentityBinding[]>;
}

/** Replay detection: tracks seen event ids. */
export interface ReplayCache {
  /** Returns true if this event id has been seen before. */
  hasSeen(eventId: string): Promise<boolean>;
  /** Mark an event id as seen. */
  markSeen(eventId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Verification pipeline                                              */
/* ------------------------------------------------------------------ */

export interface VerificationDeps {
  config: VerificationConfig;
  signer: SignatureVerifier;
  bindings: BindingStore;
  replay: ReplayCache;
  /** Current unix timestamp in seconds (injected for testability). */
  now: () => number;
}

/**
 * Full BUZZ-007 verification of a signed Buzz event.
 *
 * Checks, in order:
 * 1. Signature cryptographically valid
 * 2. Author has a binding in this cell
 * 3. Binding was valid at event time (membership-at-event-time)
 * 4. Event's cell matches (via binding)
 * 5. Timestamp within acceptable window
 * 6. Event has not been replayed
 * 7. Artifact digest valid (if referenced)
 *
 * Room matching is checked separately by the caller (it requires knowing
 * the expected room for the subscription).
 */
export async function verifyEvent(
  event: SignedBuzzEvent,
  expectedRoomId: string,
  deps: VerificationDeps,
): Promise<BuzzEventVerification> {
  const result: BuzzEventVerification = {
    eventId: event.eventId,
    signatureValid: false,
    bindingFound: false,
    membershipValidAtEventTime: false,
    roomMatches: false,
    cellMatches: false,
    notReplayed: false,
    timestampValid: false,
    artifactDigestValid: true, // no artifact reference = vacuously valid
    accepted: false,
  };

  // 1. Signature
  result.signatureValid = deps.signer.verify(event.pubkey, event.eventId, event.sig);
  if (!result.signatureValid) {
    result.rejectionReason = 'signature-invalid';
    return result;
  }

  // 2. Binding lookup
  const bindings = await deps.bindings.findByPubkey(event.pubkey);
  const activeBinding = bindings.find(
    (b) => b.cellId === deps.config.cellId && !b.revokedAt,
  );
  result.bindingFound = activeBinding !== undefined;
  if (activeBinding === undefined) {
    result.rejectionReason = 'no-binding-in-cell';
    return result;
  }

  // 3. Membership at event time
  const eventTime = event.createdAt;
  const validFrom = Date.parse(activeBinding.membershipValidFrom) / 1000;
  const validUntil = activeBinding.membershipValidUntil
    ? Date.parse(activeBinding.membershipValidUntil) / 1000
    : Infinity;
  result.membershipValidAtEventTime = eventTime >= validFrom && eventTime < validUntil;
  if (!result.membershipValidAtEventTime) {
    result.rejectionReason = 'membership-not-valid-at-event-time';
    return result;
  }

  // 4. Cell matches (binding is in our cell — already checked above)
  result.cellMatches = true;

  // 5. Timestamp window
  const now = deps.now();
  const age = now - eventTime;
  const futureSkew = eventTime - now;
  result.timestampValid =
    age <= deps.config.maxEventAgeSeconds && futureSkew <= deps.config.maxFutureSkewSeconds;
  if (!result.timestampValid) {
    result.rejectionReason = age > deps.config.maxEventAgeSeconds
      ? 'event-too-old'
      : 'event-in-future';
    return result;
  }

  // 6. Replay check
  const seen = await deps.replay.hasSeen(event.eventId);
  result.notReplayed = !seen;
  if (!result.notReplayed) {
    result.rejectionReason = 'event-replayed';
    return result;
  }

  // 7. Room match (event must tag the expected room)
  const roomTag = event.tags.find((t) => t[0] === 'e' && t[1] === expectedRoomId);
  result.roomMatches = roomTag !== undefined;
  if (!result.roomMatches) {
    result.rejectionReason = 'wrong-room';
    return result;
  }

  // 8. Artifact digest — check if event references an artifact tag
  const artifactTag = event.tags.find((t) => t[0] === 'artifact');
  if (artifactTag && artifactTag.length > 2) {
    // artifactTag[2] would be the expected digest; validation delegated to
    // the artifact store in a full implementation. Structural pass here.
    const digest: string = artifactTag[2] ?? '';
    result.artifactDigestValid = digest.length > 0;
    if (!result.artifactDigestValid) {
      result.rejectionReason = 'artifact-digest-invalid';
      return result;
    }
  }

  // All checks passed
  result.accepted = true;
  await deps.replay.markSeen(event.eventId);
  return result;
}

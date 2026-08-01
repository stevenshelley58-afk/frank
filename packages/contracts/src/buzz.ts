/**
 * `schema://frank.buzz/v1` — FRANK-§4.13, ADR-011.
 *
 * Frozen contracts for the Buzz collaboration boundary. Buzz is a relay and
 * room provider; FRANK remains the durable authority. Every Buzz event is an
 * untrusted proposal until FRANK resolves actor, membership-at-event-time,
 * schema, artifact digest, replay state, and current policy (BUZZ-007).
 *
 * Nothing in this file may import from any other workspace package.
 */

import type { IsoDateTime, Sha256 } from './common.js';
import type { DataClass } from './classification.js';

/* ------------------------------------------------------------------ */
/* Identity binding (§4.13)                                           */
/* ------------------------------------------------------------------ */

/** Where the Nostr private key is held. Never in a harness. */
export type KeyCustodian = 'platform-keystore' | 'secret-broker-signer';

/** What a binding is permitted to sign. */
export type SigningPurpose = 'room-message' | 'proposal' | 'delivery-receipt';

/**
 * FRANK-§4.13 BuzzIdentityBinding.
 *
 * Maps a FRANK principal (human, device, or agent service) to a unique
 * cell-scoped Nostr public key with validity dates and revocation status.
 * Keys are never derived from passwords, passkeys, or identities in another
 * cell. Rotation, device loss, account recovery, agent removal, and cell
 * restore all produce new bindings and invalidate old ones.
 */
export interface BuzzIdentityBinding {
  bindingId: string;
  cellId: string;
  frankPrincipalId: string;
  agentProfileId?: string;
  deviceId?: string;
  /** Hex-encoded 32-byte Nostr public key (npub without bech32). */
  nostrPublicKey: string;
  keyCustodian: KeyCustodian;
  signingPurposes: SigningPurpose[];
  membershipValidFrom: IsoDateTime;
  membershipValidUntil?: IsoDateTime;
  revokedAt?: IsoDateTime;
  replacesBindingId?: string;
  recoveryEventId?: string;
}

/* ------------------------------------------------------------------ */
/* Room link (BUZZ-002)                                               */
/* ------------------------------------------------------------------ */

/** What a Buzz room is attached to. */
export type RoomLinkKind = 'project' | 'incident' | 'research' | 'topic' | 'branch';

/**
 * FRANK-§4.13 BuzzRoomLink.
 *
 * Idempotently links a FRANK object (project, incident, research topic,
 * branch) to a Buzz room. Creating a project provisions or links a room
 * idempotently (BUZZ-002).
 */
export interface BuzzRoomLink {
  linkId: string;
  cellId: string;
  /** FRANK object this room is attached to. */
  objectId: string;
  objectKind: RoomLinkKind;
  /** Nostr channel id (hex, kind-40 event id). */
  buzzRoomId: string;
  roomName: string;
  createdAt: IsoDateTime;
  /** Retention policy version applied to this room. */
  retentionPolicyVersion: string;
  /** Data class ceiling for this room. Buzz never receives `secret`. */
  dataClassCeiling: DataClass;
}

/** What FRANK wants a room to look like. Passed to `ensureRoom`. */
export interface DesiredRoomLink {
  cellId: string;
  objectId: string;
  objectKind: RoomLinkKind;
  roomName: string;
  retentionPolicyVersion: string;
  dataClassCeiling: DataClass;
}

/* ------------------------------------------------------------------ */
/* Signed events and verification (BUZZ-003, BUZZ-007)                */
/* ------------------------------------------------------------------ */

/**
 * A raw signed Nostr/Buzz event as received from the relay.
 * Immutable in the Buzz domain; FRANK stores only normalized references.
 */
export interface SignedBuzzEvent {
  /** Nostr event id (hex sha256 of serialized event). */
  eventId: string;
  /** Nostr event kind (e.g. 42 = channel message, 7 = reaction). */
  kind: number;
  /** Author public key (hex). */
  pubkey: string;
  /** Unix seconds. */
  createdAt: number;
  /** NIP-01 tags. */
  tags: string[][];
  /** Event content (plaintext; server-readable per §4.13). */
  content: string;
  /** Schnorr signature (hex, 128 chars). */
  sig: string;
}

/**
 * Result of verifying a signed Buzz event against FRANK policy.
 * A Buzz event alone can never approve production or another consequential
 * action (BUZZ-007).
 */
export interface BuzzEventVerification {
  eventId: string;
  /** Signature cryptographically valid. */
  signatureValid: boolean;
  /** Author has a binding in this cell. */
  bindingFound: boolean;
  /** Binding was valid at event time (membership-at-event-time). */
  membershipValidAtEventTime: boolean;
  /** Event's room matches the expected room. */
  roomMatches: boolean;
  /** Event's cell matches. */
  cellMatches: boolean;
  /** Event has not been seen before (replay check). */
  notReplayed: boolean;
  /** Timestamp within acceptable window. */
  timestampValid: boolean;
  /** Artifact digest matches, if the event references one. */
  artifactDigestValid: boolean;
  /** All checks passed — event may be converted to an ingress command. */
  accepted: boolean;
  /** Reason for rejection, if any. */
  rejectionReason?: string;
}

/* ------------------------------------------------------------------ */
/* Event reference (BUZZ-005)                                         */
/* ------------------------------------------------------------------ */

/**
 * FRANK-§4.13 BuzzEventReference.
 *
 * A normalized, immutable pointer to a Buzz event stored in FRANK's
 * projection store. Raw events stay in the Buzz domain; FRANK stores only
 * these references and derived projections.
 */
export interface BuzzEventReference {
  referenceId: string;
  cellId: string;
  /** Nostr event id. */
  buzzEventId: string;
  /** FRANK room link this event belongs to. */
  roomLinkId: string;
  /** Author's FRANK principal id (resolved from binding). */
  authorPrincipalId: string;
  /** Verification result at ingestion time. */
  verification: BuzzEventVerification;
  /** Projected FRANK event type, if this event mapped to one. */
  projectedEventType?: string;
  ingestedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Ingress command (BUZZ-005, BUZZ-007)                               */
/* ------------------------------------------------------------------ */

/**
 * FRANK-§4.13 BuzzIngressCommand.
 *
 * A verified Buzz proposal converted into a FRANK command. Only produced
 * after full verification (BUZZ-007). Carries provenance back to the
 * original signed event.
 */
export interface BuzzIngressCommand {
  commandId: string;
  cellId: string;
  /** The verified event reference this command derives from. */
  sourceEventReferenceId: string;
  /** FRANK command verb (e.g. 'plan', 'ready', 'start', 'complete'). */
  verb: string;
  /** Target FRANK object (work item, run, etc.). */
  targetObjectId: string;
  targetObjectType: string;
  /** Actor resolved from the binding. */
  actorPrincipalId: string;
  /** Policy revision at command time. */
  policyVersion: string;
  /** Idempotency key derived from the Buzz event id. */
  idempotencyKey: string;
  createdAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Projection cursor (BUZZ-005, BUZZ-006)                             */
/* ------------------------------------------------------------------ */

/**
 * FRANK-§4.13 BuzzProjectionCursor.
 *
 * Tracks how far FRANK has consumed Buzz events. Enables replay and
 * projection rebuild (BUZZ-005). During a Buzz outage the cursor holds;
 * on reconnect FRANK resumes from the last cursor (BUZZ-006).
 */
export interface BuzzProjectionCursor {
  cellId: string;
  roomLinkId: string;
  /** Last consumed Nostr event id. */
  lastEventId: string | null;
  /** Last consumed event timestamp (unix seconds). */
  lastEventTimestamp: number | null;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Assignments (BUZZ-010, BUZZ-011)                                   */
/* ------------------------------------------------------------------ */

/**
 * A bounded assignment dispatched to an agent through Buzz.
 * Agents execute only through FRANK-issued assignments, capability grants,
 * and receipts (BUZZ-010). Buzz workflow actions are allowed only for
 * room-local, reversible tasks (BUZZ-011).
 */
export interface BoundedAssignment {
  assignmentId: string;
  cellId: string;
  /** FRANK run this assignment belongs to. */
  runId: string;
  /** Target room. */
  roomLinkId: string;
  /** Agent binding id. */
  agentBindingId: string;
  /** What the agent is assigned to do. */
  taskDescription: string;
  /** Capability grant reference. */
  capabilityGrantId: string;
  /** Deadline. */
  expiresAt: IsoDateTime;
  /** Idempotency key. */
  idempotencyKey: string;
  createdAt: IsoDateTime;
}

/** Reference to a submitted assignment. */
export interface BuzzAssignmentRef {
  assignmentId: string;
  /** Buzz event id of the assignment message. */
  buzzEventId: string;
  state: 'pending' | 'active' | 'completed' | 'cancelled' | 'expired';
}

/** Steering input for an active assignment. */
export interface SteeringInput {
  assignmentId: string;
  /** Free-text steering message. */
  message: string;
  /** Actor sending the steering. */
  actorPrincipalId: string;
}

/* ------------------------------------------------------------------ */
/* Git event mirror (BUZZ-012)                                        */
/* ------------------------------------------------------------------ */

/**
 * A canonical Git event to mirror into a Buzz branch room.
 * The production forge remains authoritative (BUZZ-012).
 */
export interface CanonicalGitEvent {
  eventId: string;
  cellId: string;
  /** Authoritative forge: 'github', 'gitlab', etc. */
  forge: string;
  repository: string;
  branch: string;
  commitHash: Sha256;
  /** 'push', 'merge', 'pr_opened', 'pr_merged', 'ci_passed', etc. */
  eventType: string;
  /** Room to mirror into. */
  roomLinkId: string;
  occurredAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

/** Buzz relay health as seen by FRANK. */
export interface BuzzHealth {
  /** Relay reachable and ready. */
  healthy: boolean;
  /** Relay version string, if reported. */
  version?: string;
  /** Number of connected clients, if reported. */
  connectedClients?: number;
  /** Last successful health check. */
  checkedAt: IsoDateTime;
  /** Projection buffer depth (events queued during outage). */
  projectionBufferDepth?: number;
}

/* ------------------------------------------------------------------ */
/* The BuzzPort (ADR-011)                                             */
/* ------------------------------------------------------------------ */

/**
 * FRANK-§4.13 BuzzPort — the stable contract between FRANK and Buzz.
 *
 * ADR-011: if Buzz compatibility or security gates fail, disable the relay
 * and retain canonical FRANK work. Switch to another collaboration platform
 * by re-implementing this same contract.
 *
 * Implementation constraints (§7.2):
 * - verify event signature, kind, cell, room, actor binding, membership at
 *   event time, timestamp window, and replay state;
 * - convert accepted proposals into BuzzIngressCommand;
 * - publish through the transactional outbox;
 * - keep raw Buzz events immutable in the Buzz domain;
 * - buffer projection delivery during outage;
 * - never accept a Buzz event as a direct effect receipt.
 */
export interface BuzzPort {
  health(): Promise<BuzzHealth>;
  ensureRoom(link: DesiredRoomLink): Promise<BuzzRoomLink>;
  ensureMember(binding: BuzzIdentityBinding, roomId: string): Promise<void>;
  publishProjection(eventId: string, eventType: string, content: string): Promise<BuzzEventReference>;
  receiveEvents(cursor: BuzzProjectionCursor): AsyncIterable<SignedBuzzEvent>;
  submitAssignment(assignment: BoundedAssignment): Promise<BuzzAssignmentRef>;
  steerAssignment(ref: BuzzAssignmentRef, input: SteeringInput): Promise<void>;
  cancelAssignment(ref: BuzzAssignmentRef): Promise<void>;
  mirrorGitEvent(event: CanonicalGitEvent): Promise<BuzzEventReference>;
}

/** A signer port — the narrow signing service (§7.4). */
export interface BuzzSigner {
  /**
   * Sign a Nostr event. The signer holds the private key; the caller never
   * sees it. Input includes purpose, scope, payload digest, expiry, and
   * idempotency key. Output is the signed event; the signer cannot execute
   * a tool.
   */
  sign(input: {
    bindingId: string;
    purpose: SigningPurpose;
    roomScope: string;
    payloadDigest: Sha256;
    expiresAt: IsoDateTime;
    idempotencyKey: string;
    kind: number;
    tags: string[][];
    content: string;
  }): Promise<SignedBuzzEvent>;
}

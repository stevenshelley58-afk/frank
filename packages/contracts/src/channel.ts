/**
 * `schema://frank.channel-content/v1`, `schema://frank.channel-health/v1` —
 * CH-01 (FRANK-§8E), ADR-022, ADR-023, decisions M1–M4, M12, M13.
 *
 * Frozen contracts for the Channels boundary: the port through which Frank
 * posts content to, and receives interactions from, an external collaboration
 * surface (first platform: Telegram, M1).
 *
 * Posture, mirroring the Buzz boundary:
 *
 *   - Frank is the durable authority. A channel surface renders Frank-authored
 *     content and relays interactions back; it never decides, authorizes, or
 *     attests anything. No shape in this file grants a surface authority.
 *   - Every inbound interaction is an untrusted proposal until Frank resolves
 *     actor, work item, expected version, and policy through a normal FRANK
 *     command envelope (ADR-022).
 *   - `requestDecision()` registers and surfaces a waiting work item and then
 *     finishes (M13: post card → finish turn → resolve via inbound event +
 *     outbox). Durable resolution arrives later through an inbound event plus
 *     a command envelope. A ChannelPort implementation must NEVER keep a
 *     promise open awaiting the human's decision.
 *
 * Nothing in this file may import from any other workspace package, and no
 * channel SDK type (channels-ui or any pre-1.0 third-party type) may appear
 * here or in any contract (FRANK-§6, CH-01 hard rules).
 */

import type { IsoDateTime } from './common.js';

/* ------------------------------------------------------------------ */
/* Channel content (Frank-owned, surface-neutral)                     */
/* ------------------------------------------------------------------ */

/** Discriminator for the one content block kind Frank models in v1. */
export type ChannelContentBlockKind = 'text';

/**
 * One block of Frank-authored content. v1 defines plain text; the envelope
 * `schema` field pins the block set a consumer may rely on (ADR-017 posture).
 */
export interface ChannelContentBlock {
  kind: ChannelContentBlockKind;
  /** Block body. Plain text; rendering is the surface's concern. */
  text: string;
}

/**
 * An action Frank offers on a posted card. Tapping it decides nothing by
 * itself: the surface relays the interaction to Frank as an inbound event,
 * and only a FRANK command envelope validated against the work item's
 * expected version changes canonical state (ADR-022).
 */
export interface ChannelAction {
  actionId: string;
  /** Human-facing label. */
  label: string;
  /** FRANK command verb the interaction proposes (e.g. 'ready', 'cancel'). */
  verb: string;
  /** FRANK object the verb targets (e.g. a decision work item id). */
  targetObjectId: string;
  targetObjectType: string;
}

/**
 * Frank-authored content destined for a channel surface.
 *
 * This is what `notify()` posts and what `requestDecision()` registers and
 * surfaces. It carries enough context for a human to act — the work item,
 * the requested action, why now, the next safe action, material evidence —
 * but the card is a projection of Frank's state, never a source of truth.
 */
export interface ChannelContent {
  /** Always `frank.channel-content/v1` for this schema version. */
  schema: 'frank.channel-content/v1';
  /** Frank-side id for this content instance; doubles as the idempotency key for posting. */
  contentId: string;
  /** FRANK cell this content belongs to. */
  cellId: string;
  /** Frank room the content is associated with. */
  roomId: string;
  /** FRANK work item the content is about, when it is about one. */
  workItemId?: string;
  /** Short human-facing heading. */
  title: string;
  /** Content blocks, in display order. */
  blocks: ChannelContentBlock[];
  /** Actions offered on the card; empty when the content is informational. */
  actions: ChannelAction[];
  createdAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Decision registration (ADR-022, M13)                               */
/* ------------------------------------------------------------------ */

/**
 * A request to surface a waiting decision work item on a channel surface.
 *
 * The work item itself — kind `decision`, state `waiting` — already exists
 * in Frank's canonical state (ADR-022). This request only registers and
 * surfaces it. Resolution never flows back through the request's return
 * value; it arrives later as an inbound event converted into a command
 * envelope on the work item.
 */
export interface DecisionRequest {
  requestId: string;
  cellId: string;
  /** Frank room whose bound platform conversation receives the card. */
  roomId: string;
  /** The decision work item (ADR-022) in `waiting`. */
  workItemId: string;
  /**
   * Work item version at request time. A resolution carrying a stale
   * expected version is rejected as already-resolved, never executed twice
   * (CH-04 double-tap and web-then-phone races).
   */
  expectedVersion: number;
  /** The card to surface. */
  content: ChannelContent;
  /** When the offer lapses. An expired card renders expiry; it never acts (CH-07). */
  expiresAt?: IsoDateTime;
  createdAt: IsoDateTime;
}

/**
 * Acknowledgment that a decision was registered and surfaced.
 *
 * Deliberately terminal: `state` has exactly one value. This type cannot
 * represent a decision outcome, so an implementation cannot smuggle a
 * pending resolution into the return path. The durable resolution is an
 * inbound event plus a command envelope on the work item, handled elsewhere.
 */
export interface DecisionRegistration {
  registrationId: string;
  requestId: string;
  cellId: string;
  workItemId: string;
  /** Confirms the work item is surfaced. Never resolves to a decision. */
  state: 'registered';
  registeredAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Card update                                                        */
/* ------------------------------------------------------------------ */

/** Reference to a card Frank has posted on a surface. */
export interface ChannelCardRef {
  /** Frank-side card id. */
  cardId: string;
  cellId: string;
  roomId: string;
  /** The surface's own message id, known once the card is posted. */
  surfaceMessageId?: string;
}

/**
 * Rendered state a card can be moved into. State changes are projections of
 * canonical work state; updating a card never changes work state.
 */
export type ChannelCardState = 'posted' | 'resolved' | 'expired';

/** A change to a posted card's rendered state (update in place, no card spam). */
export interface ChannelCardUpdate {
  ref: ChannelCardRef;
  /** New rendered content; omitted when only the state label changes. */
  content?: ChannelContent;
  /** New card state. */
  state: ChannelCardState;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Room binding                                                       */
/* ------------------------------------------------------------------ */

/** What Frank wants a binding to look like. Passed to `bind`. */
export interface DesiredChannelBinding {
  cellId: string;
  /** Frank room to associate. */
  roomId: string;
  /** Adapter key of the platform, e.g. 'telegram'. */
  platform: string;
  /** The platform's conversation/chat identifier. */
  platformConversationId: string;
}

/**
 * An association between a Frank room and a platform conversation.
 * Created idempotently. Frank owns the binding; the surface only observes
 * that messages Frank sends to the conversation arrive in the room's name.
 */
export interface ChannelBinding {
  bindingId: string;
  cellId: string;
  roomId: string;
  platform: string;
  platformConversationId: string;
  createdAt: IsoDateTime;
  /** Set when the binding is revoked; a revoked binding routes nothing. */
  revokedAt?: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

/**
 * Channel adapter health as seen by Frank. Truthful posture (same as the
 * Buzz adapter): `healthy` is `false` whenever the adapter cannot reach the
 * platform or knows it cannot deliver, with the reason in `detail`. Health
 * is never reported `true` to be polite — an unhealthy adapter that claims
 * health is worse than an adapter that admits it is down.
 */
export interface ChannelHealth {
  /** Adapter reachable and able to post to the platform. */
  healthy: boolean;
  /** Adapter's live connection/polling state at check time. */
  connected: boolean;
  /** Adapter key of the platform, e.g. 'telegram'. */
  platform?: string;
  /** Last successful health check attempt. */
  checkedAt: IsoDateTime;
  /** Outbound items buffered for retry while the platform is unreachable. */
  pendingDeliveryDepth?: number;
  /** Truthful reason when unhealthy. */
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* The ChannelPort                                                    */
/* ------------------------------------------------------------------ */

/**
 * CH-01 ChannelPort — the stable contract between Frank and a channel
 * surface (M1 Telegram first; M6 one interactive decision surface per
 * binding; CH-08 later ntfy implements this same port as a notify-only
 * adapter).
 *
 * Authority rules (non-negotiable):
 * - The surface is never an authority. Every method here either projects
 *   Frank-owned state outward (`notify`, `requestDecision`, `update`,
 *   `bind`) or reports adapter condition (`health`).
 * - `requestDecision` must not keep a promise open awaiting the human's
 *   answer (M13). It registers the waiting work item, surfaces the card,
 *   and returns the registration. Durable resolution arrives later through
 *   an inbound event plus a FRANK command envelope on the work item
 *   (ADR-022); that path is not part of this port.
 * - A platform tap is an untrusted proposal: the adapter turns it into an
 *   inbound event; Frank verifies actor, work item, expected version, and
 *   policy before any state changes.
 *
 * Adapter coupling rule (M12): anything platform-SDK-shaped lives in the
 * adapter package implementing this port, never here.
 */
export interface ChannelPort {
  /**
   * Post Frank-authored content to the bound conversation for the content's
   * room. Idempotent on `content.contentId`: reposting the same content id
   * must not duplicate the card. Returns the card reference, including the
   * surface message id once known.
   */
  notify(content: ChannelContent): Promise<ChannelCardRef>;

  /**
   * Register and surface a waiting decision work item (ADR-022). Posts the
   * card, records the registration in durable state, finishes the turn, and
   * returns the registration. NEVER keeps a promise open awaiting the
   * decision: resolution arrives later through an inbound event plus a
   * command envelope on the work item.
   */
  requestDecision(request: DecisionRequest): Promise<DecisionRegistration>;

  /**
   * Change a posted card's rendered state in place (message update, not a
   * new card). Used to mark cards resolved or expired after canonical state
   * has already changed; the update itself changes no work state.
   */
  update(card: ChannelCardUpdate): Promise<ChannelCardRef>;

  /**
   * Idempotently associate a Frank room with a platform conversation.
   * Re-binding the same room and conversation returns the existing binding.
   */
  bind(binding: DesiredChannelBinding): Promise<ChannelBinding>;

  /** Truthful adapter state. */
  health(): Promise<ChannelHealth>;
}

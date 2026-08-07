/**
 * CH-03 — TelegramChannelAdapter: the ChannelPort implementation.
 *
 * Implements `@frank/contracts` `ChannelPort` over a {@link TelegramTransport}
 * (Bot API, long-polling — M1) and the durable {@link StateStore} from CH-02.
 *
 * ## Authority posture (ADR-022, non-negotiable)
 *
 * This adapter is a TRANSPORT + RENDERER. It never decides, authorizes, or
 * mutates canonical state:
 *   - `notify` / `requestDecision` / `update` project Frank-owned content
 *     outward and persist a durable *registration* (so a restart does not lose
 *     a pending decision card — §11.3).
 *   - A button tap produces an INBOUND event; the listener turns it into a
 *     FRANK command envelope on the decision work item (`ready`/`cancel` with
 *     `expected_version`). Frank verifies actor + work item + version + policy
 *     before any state changes. The adapter itself writes nothing to work items.
 *
 * ## Durability (M13 + §11.3)
 *
 * `requestDecision` posts the card, records the registration in the StateStore,
 * and returns immediately — it never holds a promise awaiting the human's
 * answer. Registrations and bindings live in the Postgres StateStore, so a
 * listener restart does not lose them. Callback data (`<registrationId>:<verb>`)
 * maps a tap back to the durable registration.
 */

import { randomUUID } from 'node:crypto';

import type {
  ChannelBinding,
  ChannelCardRef,
  ChannelCardUpdate,
  ChannelContent,
  ChannelHealth,
  ChannelPort,
  DecisionRegistration,
  DecisionRequest,
  DesiredChannelBinding,
} from '@frank/contracts';
import type { StateStore } from '@copilotkit/channels';

import { renderDecisionCard } from './render-html.js';
import type { TelegramTransport } from './transport.js';

export const PLATFORM = 'telegram';

/** StateStore key namespaces (durable across restart). */
const BINDING_KEY = (roomId: string): string => `wb:bind:${roomId}`;
const REGISTRATION_KEY = (registrationId: string): string => `wb:reg:${registrationId}`;
/** Reverse index: a pending decision per work item (one open decision at a time). */
const OPEN_BY_WORK_ITEM_KEY = (workItemId: string): string => `wb:open:${workItemId}`;
/** Durable index of ALL registration ids (CH-07 expiry sweep enumerates this). */
const REGISTRATION_INDEX_KEY = 'wb:reg:index';

/** Durable record of a surfaced decision card. */
export interface DecisionRegistrationRecord {
  registrationId: string;
  requestId: string;
  cellId: string;
  roomId: string;
  workItemId: string;
  expectedVersion: number;
  /** Surface conversation + message the card lives in. */
  chatId: number;
  messageId: number;
  /** Callback-data prefix; buttons append `:<verb>`. */
  callbackPrefix: string;
  expiresAt?: string;
  createdAt: string;
  /** Lifecycle of the card as last rendered. */
  state: 'pending' | 'resolved' | 'expired';
}

export interface TelegramChannelAdapterOptions {
  transport: TelegramTransport;
  store: StateStore;
  /** Cells this adapter serves (single-cell in Slice 1). */
  cellId: string;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable logger; defaults to console.error. */
  log?: (message: string) => void;
}

export class TelegramChannelAdapter implements ChannelPort {
  private readonly transport: TelegramTransport;
  private readonly store: StateStore;
  private readonly cellId: string;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private lastCheckedAt: string;

  constructor(options: TelegramChannelAdapterOptions) {
    this.transport = options.transport;
    this.store = options.store;
    this.cellId = options.cellId;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((m) => console.error(m));
    this.lastCheckedAt = this.now().toISOString();
  }

  /* ------------------------------------------------------------ lifecycle --- */

  /** Validate the token (Bot API getMe). Throws on transport failure. */
  async connect(): Promise<void> {
    await this.transport.getMe();
    this.lastCheckedAt = this.now().toISOString();
  }

  /* -------------------------------------------------------------- ChannelPort --- */

  async notify(content: ChannelContent): Promise<ChannelCardRef> {
    const binding = await this.bindingForRoom(content.roomId);
    if (binding === null) {
      throw new Error(`no Telegram binding for room ${content.roomId}`);
    }
    const cardId = content.contentId; // idempotent on contentId (contract)
    const html = content.blocks
      .map((b) => b.text)
      .join('\n');
    const messageId = await this.transport.sendMessage(
      Number(binding.platformConversationId),
      `<b>${escapeHtml(content.title)}</b>\n${escapeHtml(html)}`,
      { parse_mode: 'HTML' },
    );
    return { cardId, cellId: this.cellId, roomId: content.roomId, surfaceMessageId: String(messageId) };
  }

  async requestDecision(request: DecisionRequest): Promise<DecisionRegistration> {
    const binding = await this.bindingForRoom(request.roomId);
    if (binding === null) {
      throw new Error(`no Telegram binding for room ${request.roomId}`);
    }

    const registrationId = randomUUID();
    const callbackPrefix = registrationId;
    const chatId = Number(binding.platformConversationId);

    const { html, buttons } = renderDecisionCard(request, 'pending', callbackPrefix);
    const messageId = await this.transport.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons.map((b) => [
          { text: b.text, callback_data: b.callbackData },
        ]),
      },
    });

    // Durable registration (survives restart). M13: return immediately; the
    // resolution arrives later through the command envelope, not this promise.
    const record: DecisionRegistrationRecord = {
      registrationId,
      requestId: request.requestId,
      cellId: request.cellId,
      roomId: request.roomId,
      workItemId: request.workItemId,
      expectedVersion: request.expectedVersion,
      chatId,
      messageId,
      callbackPrefix,
      createdAt: this.now().toISOString(),
      state: 'pending',
      ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    };
    await this.store.kv.set(REGISTRATION_KEY(registrationId), record);
    await this.store.kv.set(OPEN_BY_WORK_ITEM_KEY(request.workItemId), registrationId);
    // Durable index so the CH-07 expiry sweep can enumerate registrations
    // after a restart (the sweep cannot guess registration ids).
    await this.store.list.append(REGISTRATION_INDEX_KEY, registrationId, { maxLen: 5000 });

    return {
      registrationId,
      requestId: request.requestId,
      cellId: request.cellId,
      workItemId: request.workItemId,
      state: 'registered',
      registeredAt: this.now().toISOString(),
    };
  }

  async update(card: ChannelCardUpdate): Promise<ChannelCardRef> {
    // Find the registration behind this card. cardId is the registrationId for
    // decision cards (set by requestDecision).
    const registrationId = card.ref.cardId;
    const record = await this.store.kv.get<DecisionRegistrationRecord>(
      REGISTRATION_KEY(registrationId),
    );
    if (record === undefined) {
      throw new Error(`no registration for card ${card.ref.cardId}`);
    }

    const html = card.content === undefined
      ? undefined
      : card.content.blocks.map((b) => b.text).join('\n');

    if (html !== undefined) {
      await this.transport.editMessageText(record.chatId, record.messageId, html, {
        parse_mode: 'HTML',
      });
    }
    record.state = card.state === 'posted' ? 'pending' : card.state;
    await this.store.kv.set(REGISTRATION_KEY(registrationId), record);

    return {
      cardId: card.ref.cardId,
      cellId: record.cellId,
      roomId: record.roomId,
      surfaceMessageId: String(record.messageId),
    };
  }

  async bind(binding: DesiredChannelBinding): Promise<ChannelBinding> {
    const key = BINDING_KEY(binding.roomId);
    const existing = await this.store.kv.get<ChannelBinding>(key);
    if (existing !== undefined && existing.platformConversationId === binding.platformConversationId) {
      return existing; // idempotent re-bind
    }
    const record: ChannelBinding = {
      bindingId: randomUUID(),
      cellId: binding.cellId,
      roomId: binding.roomId,
      platform: binding.platform,
      platformConversationId: binding.platformConversationId,
      createdAt: this.now().toISOString(),
    };
    await this.store.kv.set(key, record);
    return record;
  }

  async health(): Promise<ChannelHealth> {
    // Re-probe so health is truthful at check time, not cached politeness.
    try {
      await this.transport.getMe();
      this.lastCheckedAt = this.now().toISOString();
      return {
        healthy: true,
        connected: true,
        platform: PLATFORM,
        checkedAt: this.lastCheckedAt,
      };
    } catch (error) {
      this.lastCheckedAt = this.now().toISOString();
      return {
        healthy: false,
        connected: false,
        platform: PLATFORM,
        checkedAt: this.lastCheckedAt,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /* ------------------------------------------------- inbound tap handling --- */

  /**
   * Resolve a callback_data string to the durable registration + chosen verb.
   * Returns null for unknown/expired registrations (the listener replies
   * "already resolved" rather than acting).
   */
  async resolveCallback(callbackData: string): Promise<
    | { record: DecisionRegistrationRecord; verb: string }
    | { expired: true; reason: string }
    | null
  > {
    const sep = callbackData.lastIndexOf(':');
    if (sep <= 0) return null;
    const registrationId = callbackData.slice(0, sep);
    const verb = callbackData.slice(sep + 1);

    const record = await this.store.kv.get<DecisionRegistrationRecord>(
      REGISTRATION_KEY(registrationId),
    );
    if (record === undefined) {
      return { expired: true, reason: 'This decision has already been handled or expired.' };
    }
    if (record.state === 'expired') {
      return { expired: true, reason: 'This offer expired before you responded.' };
    }
    if (record.state !== 'pending') {
      return { expired: true, reason: 'This decision was already resolved.' };
    }
    if (record.expiresAt !== undefined && new Date(record.expiresAt) < this.now()) {
      record.state = 'expired';
      await this.store.kv.set(REGISTRATION_KEY(registrationId), record);
      return { expired: true, reason: 'This offer expired before you responded.' };
    }
    return { record, verb };
  }

  /**
   * Mark a registration resolved and update the card in place (no card spam).
   * Called by the listener AFTER the command envelope lands on Frank.
   */
  async markResolved(registrationId: string, footer: string): Promise<void> {
    const record = await this.store.kv.get<DecisionRegistrationRecord>(
      REGISTRATION_KEY(registrationId),
    );
    if (record === undefined) return;
    record.state = 'resolved';
    await this.store.kv.set(REGISTRATION_KEY(registrationId), record);
    await this.store.kv.delete(OPEN_BY_WORK_ITEM_KEY(record.workItemId));

    // Re-render the card body without buttons and a terminal footer.
    try {
      // We no longer hold the original DecisionRequest, so render a minimal
      // terminal message from the stored title-free record. The card body is
      // replaced with the footer the canonical resolution dictates.
      await this.transport.editMessageText(record.chatId, record.messageId, escapeHtml(footer), {
        parse_mode: 'HTML',
      });
    } catch (error) {
      // A failed card update must not mask the resolved work state.
      this.log(`card update failed for ${registrationId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * CH-07 — expiry sweep. Enumerates the durable registration index, marks any
   * PENDING registration past its `expiresAt` as expired, updates its card in
   * place (expiry footer, buttons gone), and clears the open-by-work-item
   * index so a late tap is refused. Returns the ids newly expired.
   *
   * Deliberate retention policy: expired records are NOT deleted — they stay
   * durable so a late tap can be answered "expired" rather than "unknown",
   * and so the audit trail is complete. The index is capped (maxLen) so it
   * cannot grow without bound.
   */
  async sweepExpired(): Promise<string[]> {
    const ids = await this.store.list.range<string>(REGISTRATION_INDEX_KEY);
    const expired: string[] = [];
    const nowIso = this.now().toISOString();
    for (const registrationId of ids) {
      const record = await this.store.kv.get<DecisionRegistrationRecord>(
        REGISTRATION_KEY(registrationId),
      );
      if (record === undefined) continue;
      if (record.state !== 'pending') continue;
      if (record.expiresAt === undefined) continue; // no expiry set -> never expires
      if (record.expiresAt >= nowIso) continue; // still within the window

      record.state = 'expired';
      await this.store.kv.set(REGISTRATION_KEY(registrationId), record);
      await this.store.kv.delete(OPEN_BY_WORK_ITEM_KEY(record.workItemId));
      expired.push(registrationId);

      try {
        await this.transport.editMessageText(
          record.chatId,
          record.messageId,
          escapeHtml('⏱ Offer expired — no action was taken'),
          { parse_mode: 'HTML' },
        );
      } catch (error) {
        // Card-update failure must not block the sweep; the state is already
        // durable. Log and continue.
        this.log(
          `expiry card update failed for ${registrationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return expired;
  }

  /* -------------------------------------------------------------- helpers --- */

  private async bindingForRoom(roomId: string): Promise<ChannelBinding | null> {
    const binding = await this.store.kv.get<ChannelBinding>(BINDING_KEY(roomId));
    if (binding === undefined) return null;
    if (binding.revokedAt !== undefined) return null;
    if (binding.platform !== PLATFORM) return null;
    return binding;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

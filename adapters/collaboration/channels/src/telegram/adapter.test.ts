/**
 * CH-03 — TelegramChannelAdapter unit tests (fake transport, no token).
 *
 * Verifies the authority posture + durability contract without a real bot:
 *  - requestDecision posts a card, persists a durable registration, and
 *    returns immediately (M13 — never holds a promise);
 *  - a tap resolves to the registration + verb; unknown/expired taps are
 *    refused, never acted on;
 *  - markResolved updates the card in place (no card spam);
 *  - health is truthful when the transport fails.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@copilotkit/channels';

import type { DecisionRequest } from '@frank/contracts';

import { TelegramChannelAdapter } from './adapter.js';
import type {
  TelegramSendMessageOptions,
  TelegramTransport,
  TelegramUpdate,
  TelegramUser,
} from './transport.js';

/** Recording fake transport. */
class FakeTransport implements TelegramTransport {
  sent: Array<{ chatId: number; text: string; opts?: TelegramSendMessageOptions; messageId: number }> = [];
  edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  acks: string[] = [];
  meFails = false;
  private nextMessageId = 100;

  async getMe(): Promise<TelegramUser> {
    if (this.meFails) throw new Error('bot unreachable');
    return { id: 1, username: 'frank_bot' };
  }
  async sendMessage(chatId: number, text: string, opts?: TelegramSendMessageOptions): Promise<number> {
    const messageId = this.nextMessageId++;
    this.sent.push({ chatId, text, ...(opts === undefined ? {} : { opts }), messageId });
    return messageId;
  }
  async editMessageText(chatId: number, messageId: number, text: string): Promise<void> {
    this.edits.push({ chatId, messageId, text });
  }
  async answerCallbackQuery(id: string): Promise<void> {
    this.acks.push(id);
  }
  async getUpdates(): Promise<TelegramUpdate[]> {
    return [];
  }
}

function decisionRequest(workItemId = 'wi-1'): DecisionRequest {
  return {
    requestId: 'req-1',
    cellId: 'cell-test',
    roomId: 'room:ops',
    workItemId,
    expectedVersion: 3,
    content: {
      schema: 'frank.channel-content/v1',
      contentId: 'content-1',
      cellId: 'cell-test',
      roomId: 'room:ops',
      workItemId,
      title: 'Promote schema change?',
      blocks: [
        { kind: 'text', text: 'why_now: window closes tonight' },
        { kind: 'text', text: 'next_safe_action: approve the staged write' },
        { kind: 'text', text: 'diff: schema.sql (+12 -3)' },
      ],
      actions: [
        { actionId: 'a1', label: 'Approve', verb: 'ready', targetObjectId: workItemId, targetObjectType: 'work_item' },
        { actionId: 'a2', label: 'Deny', verb: 'cancel', targetObjectId: workItemId, targetObjectType: 'work_item' },
      ],
      createdAt: '2026-08-07T00:00:00Z',
    },
    createdAt: '2026-08-07T00:00:00Z',
  };
}

async function boundAdapter() {
  const transport = new FakeTransport();
  const adapter = new TelegramChannelAdapter({
    transport,
    store: new MemoryStore(),
    cellId: 'cell-test',
  });
  await adapter.bind({
    cellId: 'cell-test',
    roomId: 'room:ops',
    platform: 'telegram',
    platformConversationId: '42',
  });
  return { transport, adapter };
}

describe('TelegramChannelAdapter (CH-03)', () => {
  it('requestDecision posts a card with buttons and returns a registration immediately', async () => {
    const { transport, adapter } = await boundAdapter();
    const registration = await adapter.requestDecision(decisionRequest());

    expect(registration.state).toBe('registered');
    expect(registration.workItemId).toBe('wi-1');
    // The card was posted with two inline buttons.
    expect(transport.sent).toHaveLength(1);
    const kb = transport.sent[0]?.opts?.reply_markup?.inline_keyboard;
    expect(kb).toHaveLength(2);
    expect(kb?.[0]?.[0]?.text).toBe('Approve');
    expect(kb?.[1]?.[0]?.text).toBe('Deny');
  });

  it('a tap resolves to the durable registration + verb', async () => {
    const { adapter } = await boundAdapter();
    const registration = await adapter.requestDecision(decisionRequest());
    // The Approve button's callback data is `<registrationId>:ready`.
    const resolved = await adapter.resolveCallback(`${registration.registrationId}:ready`);
    expect(resolved).not.toBeNull();
    if (resolved && 'record' in resolved) {
      expect(resolved.verb).toBe('ready');
      expect(resolved.record.workItemId).toBe('wi-1');
      expect(resolved.record.expectedVersion).toBe(3);
    }
  });

  it('an unknown callback is refused, never acted on', async () => {
    const { adapter } = await boundAdapter();
    const resolved = await adapter.resolveCallback('nonexistent-id:ready');
    expect(resolved).not.toBeNull();
    if (resolved) {
      expect('expired' in resolved && resolved.expired).toBe(true);
    }
  });

  it('markResolved updates the card in place and clears the open index', async () => {
    const { transport, adapter } = await boundAdapter();
    const registration = await adapter.requestDecision(decisionRequest());

    await adapter.markResolved(registration.registrationId, 'Approved by Steven');
    expect(transport.edits).toHaveLength(1);
    expect(transport.edits[0]?.text).toContain('Approved by Steven');

    // A second tap on the same registration is now refused (already resolved).
    const second = await adapter.resolveCallback(`${registration.registrationId}:ready`);
    expect(second).not.toBeNull();
    if (second) {
      expect('expired' in second && second.expired).toBe(true);
    }
  });

  it('bind is idempotent and routes only matching platform rooms', async () => {
    const { adapter } = await boundAdapter();
    const first = await adapter.bind({
      cellId: 'cell-test',
      roomId: 'room:ops',
      platform: 'telegram',
      platformConversationId: '42',
    });
    // Same bind returns the same binding.
    expect(first.platformConversationId).toBe('42');

    // An unbound room cannot be notified.
    await expect(
      adapter.notify({
        schema: 'frank.channel-content/v1',
        contentId: 'c-2',
        cellId: 'cell-test',
        roomId: 'room:unknown',
        title: 'hello',
        blocks: [{ kind: 'text', text: 'body' }],
        actions: [],
        createdAt: '2026-08-07T00:00:00Z',
      }),
    ).rejects.toThrow(/no Telegram binding/);
  });

  it('health is truthful when the transport fails', async () => {
    const { transport, adapter } = await boundAdapter();
    transport.meFails = true;
    const health = await adapter.health();
    expect(health.healthy).toBe(false);
    expect(health.connected).toBe(false);
    expect(health.detail).toContain('bot unreachable');
  });
});

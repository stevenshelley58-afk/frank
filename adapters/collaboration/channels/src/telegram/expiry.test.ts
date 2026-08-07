/**
 * CH-07 — TelegramChannelAdapter expiry sweep tests.
 *
 * Proves the expiry policy: a pending decision past its `expiresAt` is marked
 * expired, its card is updated in place (expiry footer), and a late tap is
 * refused with a clear "expired" answer rather than acting. Expired records
 * are retained (not deleted) so the audit trail is complete.
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

class FakeTransport implements TelegramTransport {
  sent: Array<{ chatId: number; messageId: number }> = [];
  edits: Array<{ chatId: number; messageId: number; text: string }> = [];
  private nextMessageId = 100;

  async getMe(): Promise<TelegramUser> {
    return { id: 1, username: 'frank_bot' };
  }
  async sendMessage(chatId: number, _text: string, _opts?: TelegramSendMessageOptions): Promise<number> {
    const messageId = this.nextMessageId++;
    this.sent.push({ chatId, messageId });
    return messageId;
  }
  async editMessageText(chatId: number, messageId: number, text: string): Promise<void> {
    this.edits.push({ chatId, messageId, text });
  }
  async answerCallbackQuery(_id: string, _text?: string): Promise<void> {}
  async getUpdates(): Promise<TelegramUpdate[]> {
    return [];
  }
}

function decisionRequest(expiresAt?: string): DecisionRequest {
  return {
    requestId: 'req-exp',
    cellId: 'cell-test',
    roomId: 'room:ops',
    workItemId: 'wi-exp',
    expectedVersion: 1,
    content: {
      schema: 'frank.channel-content/v1',
      contentId: 'content-exp',
      cellId: 'cell-test',
      roomId: 'room:ops',
      workItemId: 'wi-exp',
      title: 'Expiring decision',
      blocks: [{ kind: 'text', text: 'evidence line' }],
      actions: [
        { actionId: 'a1', label: 'Approve', verb: 'ready', targetObjectId: 'wi-exp', targetObjectType: 'work_item' },
      ],
      createdAt: '2026-08-07T00:00:00Z',
    },
    createdAt: '2026-08-07T00:00:00Z',
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

async function boundAdapter(nowIso: string) {
  const transport = new FakeTransport();
  const adapter = new TelegramChannelAdapter({
    transport,
    store: new MemoryStore(),
    cellId: 'cell-test',
    now: () => new Date(nowIso),
  });
  await adapter.bind({
    cellId: 'cell-test',
    roomId: 'room:ops',
    platform: 'telegram',
    platformConversationId: '42',
  });
  return { transport, adapter };
}

describe('TelegramChannelAdapter expiry sweep (CH-07)', () => {
  it('marks an expired pending decision and updates the card in place', async () => {
    // Decision expires at 00:10; the sweep runs at 00:20 (past expiry).
    const { transport, adapter } = await boundAdapter('2026-08-07T00:20:00Z');
    const registration = await adapter.requestDecision(decisionRequest('2026-08-07T00:10:00Z'));

    const expired = await adapter.sweepExpired();
    expect(expired).toEqual([registration.registrationId]);
    // The card was edited in place with the expiry footer (no new card).
    expect(transport.edits.length).toBe(1);
    expect(transport.edits[0]!.text).toContain('expired');
  });

  it('does not expire a decision still within its window', async () => {
    // Decision expires at 00:30; the sweep runs at 00:20 (before expiry).
    const { adapter } = await boundAdapter('2026-08-07T00:20:00Z');
    await adapter.requestDecision(decisionRequest('2026-08-07T00:30:00Z'));

    const expired = await adapter.sweepExpired();
    expect(expired).toEqual([]);
  });

  it('a decision with no expiresAt never expires', async () => {
    const { adapter } = await boundAdapter('2026-08-07T00:20:00Z');
    await adapter.requestDecision(decisionRequest(undefined));

    const expired = await adapter.sweepExpired();
    expect(expired).toEqual([]);
  });

  it('a late tap on an expired decision is refused with an expiry message', async () => {
    const { adapter } = await boundAdapter('2026-08-07T00:20:00Z');
    const registration = await adapter.requestDecision(decisionRequest('2026-08-07T00:10:00Z'));
    await adapter.sweepExpired();

    const resolved = await adapter.resolveCallback(`${registration.registrationId}:ready`);
    expect(resolved).not.toBeNull();
    if (resolved !== null && 'expired' in resolved) {
      expect(resolved.expired).toBe(true);
      expect(resolved.reason).toMatch(/expired/i);
    } else {
      throw new Error('expected an expired outcome');
    }
  });
});

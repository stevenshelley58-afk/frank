/**
 * CH-04/CH-05 — tap-handler unit tests.
 *
 * Proves the authority posture without a real bot or API:
 *  - unknown Telegram users are refused BEFORE any work lookup (CH-05);
 *  - an approved tap posts the command envelope with expected_version;
 *  - a double-tap (stale expected_version → API 409) resolves as
 *    already-resolved, never executed twice (CH-04);
 *  - an unreachable API is reported honestly and is retryable.
 */

import { describe, expect, it, vi } from 'vitest';

import { handleTap } from './tap-handler.js';
import type { FrankApiClient, FrankApiResult } from './frank-api.js';

/** Fake adapter seam. */
function fakeAdapter(registration?: {
  registrationId: string;
  workItemId: string;
  expectedVersion: number;
  verb: string;
}) {
  const markResolved = vi.fn(async (_id: string, _footer: string) => {});
  return {
    adapter: {
      resolveCallback: vi.fn(async (_data: string) => {
        if (registration === undefined) return null;
        return {
          record: {
            registrationId: registration.registrationId,
            workItemId: registration.workItemId,
            expectedVersion: registration.expectedVersion,
          },
          verb: registration.verb,
        };
      }),
      markResolved,
    },
    markResolved,
  };
}

function fakeTransport() {
  return {
    answerCallbackQuery: vi.fn(async (_id: string, _text?: string) => {}),
    sendMessage: vi.fn(async (_chatId: number, _text: string) => 1),
  };
}

function fakeFrankApi(result: Partial<FrankApiResult>): FrankApiClient {
  return {
    sendCommand: vi.fn(async () => ({
      status: result.status ?? 200,
      ok: result.ok ?? true,
      body: result.body ?? null,
      unreachable: result.unreachable ?? false,
    })),
  } as unknown as FrankApiClient;
}

const REG = { registrationId: 'reg-1', workItemId: 'wi-1', expectedVersion: 3, verb: 'ready' };
const ALLOWED = new Set([42]);

describe('handleTap (CH-04/CH-05)', () => {
  it('refuses unknown Telegram users before any work lookup', async () => {
    const { adapter, markResolved } = fakeAdapter(REG);
    const transport = fakeTransport();
    const frankApi = fakeFrankApi({});

    const outcome = await handleTap(
      { telegramUserId: 999, callbackData: 'reg-1:ready', callbackQueryId: 'cb-1' },
      { frankApi, adapter, transport, chatId: 7, allowedTelegramUserIds: ALLOWED },
    );

    expect(outcome).toEqual({ kind: 'not_authorized' });
    // No command was sent and no card was mutated.
    expect(frankApi.sendCommand).not.toHaveBeenCalled();
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('an approved tap posts the command envelope with expected_version', async () => {
    const { adapter, markResolved } = fakeAdapter(REG);
    const transport = fakeTransport();
    const frankApi = fakeFrankApi({ status: 200, ok: true });

    const outcome = await handleTap(
      { telegramUserId: 42, callbackData: 'reg-1:ready', callbackQueryId: 'cb-1' },
      { frankApi, adapter, transport, chatId: 7, allowedTelegramUserIds: ALLOWED },
    );

    expect(outcome).toEqual({ kind: 'approved', workItemId: 'wi-1' });
    expect(frankApi.sendCommand).toHaveBeenCalledTimes(1);
    const call = (frankApi.sendCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call).toBeDefined();
    const workItemId = call![0];
    const command = call![1];
    const envelope = call![2] as { expected_version?: number };
    expect(workItemId).toBe('wi-1');
    expect(command).toBe('ready');
    expect(envelope.expected_version).toBe(3);
    expect(markResolved).toHaveBeenCalledTimes(1);
  });

  it('a deny tap posts a cancel command', async () => {
    const { adapter } = fakeAdapter({ ...REG, verb: 'cancel' });
    const transport = fakeTransport();
    const frankApi = fakeFrankApi({ status: 200, ok: true });

    const outcome = await handleTap(
      { telegramUserId: 42, callbackData: 'reg-1:cancel', callbackQueryId: 'cb-1' },
      { frankApi, adapter, transport, chatId: 7, allowedTelegramUserIds: ALLOWED },
    );

    expect(outcome).toEqual({ kind: 'denied', workItemId: 'wi-1' });
    const denyCall = (frankApi.sendCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(denyCall![1]).toBe('cancel');
  });

  it('a double-tap (API 409) resolves as already-resolved, never executed twice', async () => {
    const { adapter, markResolved } = fakeAdapter(REG);
    const transport = fakeTransport();
    const frankApi = fakeFrankApi({ status: 409, ok: false });

    const outcome = await handleTap(
      { telegramUserId: 42, callbackData: 'reg-1:ready', callbackQueryId: 'cb-1' },
      { frankApi, adapter, transport, chatId: 7, allowedTelegramUserIds: ALLOWED },
    );

    expect(outcome).toEqual({ kind: 'already_resolved', message: 'Already resolved in Frank.' });
    // The card is marked resolved so a third tap is also refused.
    expect(markResolved).toHaveBeenCalledTimes(1);
  });

  it('an unreachable API is reported honestly and retryable', async () => {
    const { adapter } = fakeAdapter(REG);
    const transport = fakeTransport();
    const frankApi = fakeFrankApi({ unreachable: true });

    const outcome = await handleTap(
      { telegramUserId: 42, callbackData: 'reg-1:ready', callbackQueryId: 'cb-1' },
      { frankApi, adapter, transport, chatId: 7, allowedTelegramUserIds: ALLOWED },
    );

    expect(outcome).toEqual({ kind: 'api_failed', status: 0, retryable: true });
  });

  it('an unknown registration is refused without calling the API', async () => {
    const { adapter } = fakeAdapter(undefined); // resolveCallback -> null
    const transport = fakeTransport();
    const frankApi = fakeFrankApi({});

    const outcome = await handleTap(
      { telegramUserId: 42, callbackData: 'missing:ready', callbackQueryId: 'cb-1' },
      { frankApi, adapter, transport, chatId: 7, allowedTelegramUserIds: ALLOWED },
    );

    expect(outcome).toEqual({ kind: 'already_resolved', message: 'Unknown action.' });
    expect(frankApi.sendCommand).not.toHaveBeenCalled();
  });
});

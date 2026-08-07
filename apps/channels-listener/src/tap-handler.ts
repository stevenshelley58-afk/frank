/**
 * CH-04/CH-05 — resolve a Telegram tap into a Frank command envelope.
 *
 * Pure orchestration (no transport, no DB), so it is fully unit-testable.
 * This is the ONLY place a tap can influence Frank, and it does so strictly
 * by posting the normal command envelope (§3.1): the listener never decides,
 * never writes canonical state, and never treats a tap as approval by itself.
 *
 * Security (CH-05, §11.5): the tap's user must be in the bound-identity
 * allowlist BEFORE any work-item lookup is exposed. Unknown users are refused
 * with no information leak.
 */

import type { FrankApiClient } from './frank-api.js';

/** Outcome of handling one callback tap. */
export type TapOutcome =
  | { kind: 'approved'; workItemId: string }
  | { kind: 'denied'; workItemId: string }
  | { kind: 'already_resolved'; message: string }
  | { kind: 'not_authorized' }
  | { kind: 'api_failed'; status: number; retryable: boolean };

export interface TapContext {
  /** Telegram user id that tapped. */
  telegramUserId: number;
  /** Opaque callback data from the inline button. */
  callbackData: string;
  /** Callback query id to ack. */
  callbackQueryId: string;
}

export interface TapHandlerDeps {
  frankApi: FrankApiClient;
  /** Adapter seam (duck-typed to keep this module transport-free). */
  adapter: {
    resolveCallback(callbackData: string): Promise<
      | { record: { registrationId: string; workItemId: string; expectedVersion: number }; verb: string }
      | { expired: true; reason: string }
      | null
    >;
    markResolved(registrationId: string, footer: string): Promise<void>;
  };
  transport: {
    answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
    sendMessage(chatId: number, text: string): Promise<number>;
  };
  /** Chat the tap came from (for refusal/expiry replies). */
  chatId: number;
  /** CH-05: Telegram user ids allowed to act. Everyone else is refused. */
  allowedTelegramUserIds: ReadonlySet<number>;
  /** Injectable id source for the command_id. */
  newCommandId?: () => string;
}

const READY_VERBS = new Set(['ready', 'approve', 'yes']);
const CANCEL_VERBS = new Set(['cancel', 'deny', 'no']);

/**
 * Handle one tap end-to-end. Returns a discriminated outcome; callers log it.
 * Never throws for expected failure modes (auth refusal, stale taps, API 409).
 */
export async function handleTap(
  ctx: TapContext,
  deps: TapHandlerDeps,
): Promise<TapOutcome> {
  const newCommandId = deps.newCommandId ?? defaultCommandId;

  /* ---- CH-05: identity gate FIRST — before any work-item lookup --------- */
  if (!deps.allowedTelegramUserIds.has(ctx.telegramUserId)) {
    await safeAck(deps.transport, ctx.callbackQueryId, 'Not authorized.');
    // No card detail, no work-item info. Refuse and stop.
    return { kind: 'not_authorized' };
  }

  /* ---- resolve the tap to the durable registration ---------------------- */
  const resolved = await deps.adapter.resolveCallback(ctx.callbackData);
  if (resolved === null) {
    await safeAck(deps.transport, ctx.callbackQueryId, 'Unknown action.');
    return { kind: 'already_resolved', message: 'Unknown action.' };
  }
  if ('expired' in resolved) {
    await safeAck(deps.transport, ctx.callbackQueryId, resolved.reason);
    return { kind: 'already_resolved', message: resolved.reason };
  }

  const { record, verb } = resolved;
  const command: 'ready' | 'cancel' | null = READY_VERBS.has(verb)
    ? 'ready'
    : CANCEL_VERBS.has(verb)
      ? 'cancel'
      : null;
  if (command === null) {
    await safeAck(deps.transport, ctx.callbackQueryId, 'Unknown action.');
    return { kind: 'already_resolved', message: 'Unknown action.' };
  }

  /* ---- post the command envelope (the ONLY way work changes) ------------ */
  const result = await deps.frankApi.sendCommand(record.workItemId, command, {
    command_id: newCommandId(),
    // Optimistic concurrency: a stale/duplicate tap is rejected by Frank, so a
    // double-tap or a web-then-phone race cannot execute twice (CH-04).
    expected_version: record.expectedVersion,
    reason: command === 'ready' ? 'Approved via Telegram' : 'Denied via Telegram',
  });

  if (result.unreachable) {
    await safeAck(deps.transport, ctx.callbackQueryId, 'Frank is unreachable — try again.');
    return { kind: 'api_failed', status: 0, retryable: true };
  }

  if (!result.ok) {
    // 409 = stale expected_version or already-resolved. Tell the user clearly;
    // do NOT retry (a retry would be a second action, not a retry).
    if (result.status === 409) {
      await deps.adapter.markResolved(record.registrationId, 'Already resolved in Frank');
      await safeAck(deps.transport, ctx.callbackQueryId, 'Already resolved.');
      return { kind: 'already_resolved', message: 'Already resolved in Frank.' };
    }
    await safeAck(deps.transport, ctx.callbackQueryId, 'Action failed — check Frank.');
    return { kind: 'api_failed', status: result.status, retryable: result.status >= 500 };
  }

  /* ---- success: update the card in place, ack the tap ------------------- */
  const footer =
    command === 'ready' ? '✓ Approved — Frank is resuming the run' : '✗ Denied — the run was stopped';
  await deps.adapter.markResolved(record.registrationId, footer);
  await safeAck(deps.transport, ctx.callbackQueryId, command === 'ready' ? 'Approved.' : 'Denied.');

  return command === 'ready'
    ? { kind: 'approved', workItemId: record.workItemId }
    : { kind: 'denied', workItemId: record.workItemId };
}

async function safeAck(
  transport: { answerCallbackQuery(id: string, text?: string): Promise<void> },
  id: string,
  text: string,
): Promise<void> {
  try {
    await transport.answerCallbackQuery(id, text);
  } catch {
    // A failed ack must not break the tap flow.
  }
}

let counter = 0;
function defaultCommandId(): string {
  counter += 1;
  return `tg-${Date.now()}-${counter}`;
}

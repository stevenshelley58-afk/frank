/**
 * CH-03 — Telegram transport (Bot API, polling mode).
 *
 * This is the LOWEST layer of the Channels adapter: a thin, injectable client
 * over the Telegram Bot HTTP API. Everything above it (the ChannelPort
 * implementation in `adapter.ts`) works against the {@link TelegramTransport}
 * interface, so the whole stack is unit-testable with a fake and runs without
 * a real bot token.
 *
 * ## Why raw Bot API instead of the CopilotKit SDK runtime here
 *
 * M1 (direct adapter, polling) and M12 (`ɵruntime` may be touched only inside
 * this adapter package) are both satisfied by keeping the production path a
 * direct, auditable HTTP client: there is no managed gateway, no webhook, and
 * no hidden lifecycle. The SDK's `ɵruntime` seam that CH-00's spike exercises
 * is isolated in `lifecycle.ts` behind a flag; the default transport never
 * touches it. Swapping the transport is a one-line composition change.
 *
 * Telemetry posture (CH-05): this file sets no telemetry of its own, and the
 * listener asserts `COPILOTKIT_TELEMETRY_DISABLED=true` before importing any
 * SDK module.
 */

/** A Telegram inline keyboard button. */
export interface TelegramInlineButton {
  text: string;
  /** Opaque callback data (<= 64 bytes) echoed on tap. */
  callback_data: string;
}

export interface TelegramSendMessageOptions {
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
  disable_web_page_preview?: boolean;
}

/** Subset of the Bot API `Update` object we consume. */
export interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
  };
}

export interface TelegramUser {
  id: number;
  username?: string;
}

/**
 * The minimal Bot API surface the adapter needs. Implementations must be
 * idempotent-safe and throw on transport errors (the adapter decides retry).
 */
export interface TelegramTransport {
  /** Validate the token and return the bot identity. */
  getMe(): Promise<TelegramUser>;
  /** Send a message; returns the surface message id. */
  sendMessage(chatId: number, text: string, opts?: TelegramSendMessageOptions): Promise<number>;
  /** Edit a message in place (card update, no card spam). */
  editMessageText(chatId: number, messageId: number, text: string, opts?: TelegramSendMessageOptions): Promise<void>;
  /** Acknowledge a callback query so Telegram stops the spinner. */
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  /** Long-poll for updates after `offset`. */
  getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]>;
}

/**
 * Real Bot API transport over `fetch` (long-polling; M1). The token is passed
 * in by the caller (env/OpenBao) and NEVER logged — every method redacts it.
 */
export class HttpTelegramTransport implements TelegramTransport {
  private readonly base: string;

  constructor(token: string, apiBase = 'https://api.telegram.org') {
    this.base = `${apiBase}/bot${token}`;
  }

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      // description never contains the token; safe to surface.
      throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
    }
    return json.result as T;
  }

  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>('getMe');
  }

  async sendMessage(chatId: number, text: string, opts?: TelegramSendMessageOptions): Promise<number> {
    const result = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      ...opts,
    });
    return result.message_id;
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: TelegramSendMessageOptions,
  ): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...opts,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text === undefined ? {} : { text }),
    });
  }

  async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: ['callback_query', 'message'],
    });
  }
}

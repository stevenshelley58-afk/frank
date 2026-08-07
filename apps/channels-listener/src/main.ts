/**
 * CH-03 — channels-listener process entry point.
 *
 * A SEPARATE long-running process (§3.5): it is not a route in apps/api. It
 * long-polls Telegram, surfaces Frank decisions (via the adapter), and relays
 * taps to the Domain API as command envelopes. All canonical state stays in
 * Frank; a channel outage can never hide, delete, delay, or corrupt work-item
 * state (§3.5) — the listener only reads/writes its own durable registrations.
 *
 * Configuration (env):
 *   TELEGRAM_BOT_TOKEN          bot token (OpenBao/secret path; never committed)
 *   FRANK_API_URL               apps/api base URL (default http://127.0.0.1:8080)
 *   FRANK_API_TOKEN             bearer token for the Domain API
 *   CHANNELS_DB_URL             Postgres URL for the durable StateStore
 *   ALLOWED_TELEGRAM_USER_IDS   comma-separated Telegram user ids (CH-05)
 *   CHANNELS_CELL_ID            cell id (default from Frank config)
 *   COPILOTKIT_TELEMETRY_DISABLED  must be 'true' (CH-05; asserted at boot)
 */

import {
  HttpTelegramTransport,
  TelegramChannelAdapter,
  createPostgresStateStore,
  createRedactingConsole,
} from '@frank/adapter-collaboration-channels';

import { FrankApiClient } from './frank-api.js';
import { handleTap } from './tap-handler.js';

export interface ListenerConfig {
  telegramBotToken: string;
  frankApiUrl: string;
  frankApiToken: string;
  channelsDbUrl: string;
  allowedTelegramUserIds: number[];
  cellId: string;
  pollTimeoutSec: number;
}

export function readConfig(env: NodeJS.ProcessEnv): ListenerConfig {
  const token = env['TELEGRAM_BOT_TOKEN'];
  if (token === undefined || token === '') {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  const apiUrl = env['FRANK_API_URL'] ?? 'http://127.0.0.1:8080';
  const apiToken = env['FRANK_API_TOKEN'];
  if (apiToken === undefined || apiToken === '') {
    throw new Error('FRANK_API_TOKEN is required');
  }
  const dbUrl = env['CHANNELS_DB_URL'];
  if (dbUrl === undefined || dbUrl === '') {
    throw new Error('CHANNELS_DB_URL is required (durable StateStore)');
  }
  const allowed = (env['ALLOWED_TELEGRAM_USER_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n));
  return {
    telegramBotToken: token,
    frankApiUrl: apiUrl,
    frankApiToken: apiToken,
    channelsDbUrl: dbUrl,
    allowedTelegramUserIds: allowed,
    cellId: env['CHANNELS_CELL_ID'] ?? 'cell-steven',
    pollTimeoutSec: Number(env['CHANNELS_POLL_TIMEOUT_SEC'] ?? 30),
  };
}

/** CH-05: telemetry must be disabled before any SDK module is exercised. */
export function assertTelemetryDisabled(env: NodeJS.ProcessEnv): void {
  if (env['COPILOTKIT_TELEMETRY_DISABLED'] !== 'true') {
    throw new Error('COPILOTKIT_TELEMETRY_DISABLED must be "true" for the channels listener');
  }
}

export async function startListener(config: ListenerConfig): Promise<{ stop: () => Promise<void> }> {
  assertTelemetryDisabled(process.env);

  // Redacting console so the token can never reach logs (§11.5, CH-05).
  const log = createRedactingConsole(console);

  const store = await createPostgresStateStore({
    connectionString: config.channelsDbUrl,
    applicationName: 'frank-channels-listener',
  });
  const transport = new HttpTelegramTransport(config.telegramBotToken);
  const adapter = new TelegramChannelAdapter({
    transport,
    store,
    cellId: config.cellId,
    log: (m) => log.error(m),
  });
  await adapter.connect();

  const frankApi = new FrankApiClient({ baseUrl: config.frankApiUrl, token: config.frankApiToken });
  const allowed = new Set(config.allowedTelegramUserIds);

  let offset = 0;
  let running = true;
  // CH-07: run the expiry sweep periodically (not on every poll — it scans the
  // durable registration index). Every Nth poll cycle.
  let pollCount = 0;
  const sweepEvery = Math.max(1, Math.floor(60 / Math.max(1, config.pollTimeoutSec)));

  const pollOnce = async (): Promise<void> => {
    // Periodic expiry sweep (CH-07). A sweep failure must never block tapping.
    pollCount += 1;
    if (pollCount % sweepEvery === 0) {
      try {
        const expired = await adapter.sweepExpired();
        if (expired.length > 0) {
          log.info(`expiry sweep: marked ${expired.length} decision(s) expired`);
        }
      } catch (error) {
        log.error(`expiry sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let updates;
    try {
      updates = await transport.getUpdates(offset, config.pollTimeoutSec);
    } catch (error) {
      log.error(`getUpdates failed: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((r) => setTimeout(r, 2000));
      return;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const cb = update.callback_query;
      if (cb === undefined || cb.data === undefined) continue;
      const chatId = cb.message?.chat.id ?? 0;
      try {
        const outcome = await handleTap(
          { telegramUserId: cb.from.id, callbackData: cb.data, callbackQueryId: cb.id },
          {
            frankApi,
            adapter,
            transport,
            chatId,
            allowedTelegramUserIds: allowed,
          },
        );
        log.info(`tap outcome: ${JSON.stringify(outcome)}`);
      } catch (error) {
        log.error(`tap handling failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const loop = async (): Promise<void> => {
    while (running) {
      await pollOnce();
    }
  };
  void loop();

  return {
    stop: async () => {
      running = false;
    },
  };
}

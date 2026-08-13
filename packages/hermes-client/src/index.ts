/**
 * @frank/hermes-client — Frank's window into Hermes.
 *
 * Exactly one runtime export: `chat()`, an async generator that sends one
 * message to a Hermes profile and streams the reply back as
 * `{ type: 'text' | 'tool' | 'done' | 'error', content }` events. It does NOT
 * interpret, summarise, filter or store anything — the words live in Hermes.
 *
 * Transport (verified against the Hermes API server, 2026-08):
 *   - OpenAI-compatible `POST /v1/responses` with `stream: true` (Responses
 *     API). Tool-call events come through the same SSE stream, which is what
 *     W2-2 renders as tool-call cards.
 *   - Profile routing: `/p/<profile>/v1/...` for named profiles; unprefixed
 *     for the default profile (`hermes-agent` / `default`).
 *   - Session scoping: `X-Hermes-Session-Key: <sessionKey>` header scopes
 *     Hermes long-term memory to one conversation.
 *   - Conversation chaining: the `conversation` request param chains turns in
 *     one named conversation (same sessionKey ⇒ one chain).
 *   - Bearer auth from `HERMES_API_KEY` at call time — never hardcoded.
 *
 * Configuration (environment, read at call time):
 *   HERMES_API_URL                  default http://127.0.0.1:8642
 *   HERMES_API_KEY                  required; Bearer token for the API server
 *   HERMES_API_CONNECT_TIMEOUT_MS   default 15000 (no first event this long)
 *   HERMES_API_IDLE_TIMEOUT_MS      default 60000 (no event this long mid-stream)
 *
 * Timeouts: the generator never hangs. If Hermes is down or a stream stalls,
 * it yields an `error` event and returns.
 */

import OpenAI from 'openai';

export interface ChatOptions {
  /** Hermes profile name ("hub", "blockwise", ...). Routed via `/p/<profile>/`. */
  readonly profile: string;
  /** Scopes Hermes memory to one conversation and chains turns in it. */
  readonly sessionKey: string;
  /** The user's message. Passed through untouched. */
  readonly message: string;
}

export type ChatEvent =
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'tool'; readonly content: string }
  | { readonly type: 'done'; readonly content: string }
  | { readonly type: 'error'; readonly content: string };

const DEFAULT_API_URL = 'http://127.0.0.1:8642';
// First-event latency measured against the live gateway (2026-08-13): ~7s on
// the `hub` profile. 5s false-positived on a healthy server; 15s bounds a
// dead/stalled gateway without cutting a slow-but-alive one. A DOWN server
// still errors instantly (connection refused) — no timeout needed.
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/** Profiles served by the default listener; named profiles get `/p/<profile>/`. */
function isDefaultProfile(profile: string): boolean {
  return profile === 'hermes-agent' || profile === 'default';
}

/** Strip a trailing `/v1` (and trailing slashes) so the profile prefix lands first. */
function normalizeApiUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.replace(/\/v1$/i, '');
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function describeError(error: unknown, baseURL: string): string {
  if (error instanceof OpenAI.APIError) {
    return `Hermes returned HTTP ${error.status}: ${error.message}`;
  }
  if (error instanceof OpenAI.APIConnectionError) {
    const cause = error.cause instanceof Error ? ` — ${error.cause.message}` : '';
    return `Cannot reach Hermes at ${baseURL}${cause}. Is the Hermes gateway running?`;
  }
  if (error instanceof Error) {
    return `Hermes request failed: ${error.message}`;
  }
  return `Hermes request failed: ${String(error)}`;
}

export async function* chat(opts: ChatOptions): AsyncIterable<ChatEvent> {
  const { profile, sessionKey, message } = opts;

  if (typeof profile !== 'string' || profile.length === 0) {
    yield { type: 'error', content: 'chat(): profile must be a non-empty string.' };
    return;
  }
  if (typeof sessionKey !== 'string' || sessionKey.length === 0) {
    yield { type: 'error', content: 'chat(): sessionKey must be a non-empty string.' };
    return;
  }
  if (typeof message !== 'string' || message.length === 0) {
    yield { type: 'error', content: 'chat(): message must be a non-empty string.' };
    return;
  }

  const apiKey = process.env.HERMES_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    yield {
      type: 'error',
      content: 'HERMES_API_KEY is not set; cannot authenticate to the Hermes API server.',
    };
    return;
  }

  const connectTimeoutMs = envPositiveInt('HERMES_API_CONNECT_TIMEOUT_MS', DEFAULT_CONNECT_TIMEOUT_MS);
  const idleTimeoutMs = envPositiveInt('HERMES_API_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS);
  const apiUrl = process.env.HERMES_API_URL ?? DEFAULT_API_URL;
  const profilePrefix = isDefaultProfile(profile) ? '' : `/p/${encodeURIComponent(profile)}`;
  const baseURL = `${normalizeApiUrl(apiUrl)}${profilePrefix}/v1`;

  const client = new OpenAI({ apiKey, baseURL, maxRetries: 1 });

  // Connect timeout: no first event within `connectTimeoutMs`. Idle timeout:
  // no event within `idleTimeoutMs` after the stream is under way. Both abort
  // the underlying request, so a down or stalled Hermes can never hang us.
  // The abort reason message is remembered separately: the SDK wraps aborts
  // into its own "Request was aborted." error, which would otherwise hide
  // which timeout fired.
  const controller = new AbortController();
  let timeoutMessage = '';
  let timer: NodeJS.Timeout = setTimeout(() => {
    timeoutMessage = `Hermes did not respond within ${connectTimeoutMs}ms (connect timeout). Is the Hermes gateway at ${baseURL} running?`;
    controller.abort(new Error(timeoutMessage));
  }, connectTimeoutMs);
  const armIdleTimeout = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timeoutMessage = `Hermes stream stalled: no event for ${idleTimeoutMs}ms (idle timeout).`;
      controller.abort(new Error(timeoutMessage));
    }, idleTimeoutMs);
  };

  let sawTerminal = false;
  try {
    const stream = await client.responses.create(
      {
        model: profile,
        input: message,
        stream: true,
        conversation: sessionKey,
      },
      {
        headers: { 'X-Hermes-Session-Key': sessionKey },
        signal: controller.signal,
      },
    );

    for await (const event of stream) {
      armIdleTimeout();
      switch (event.type) {
        case 'response.output_text.delta':
          if (event.delta !== undefined && event.delta.length > 0) {
            yield { type: 'text', content: event.delta };
          }
          break;
        case 'response.output_item.done':
          if (event.item?.type === 'function_call') {
            yield {
              type: 'tool',
              content: JSON.stringify({
                name: event.item.name,
                call_id: event.item.call_id,
                arguments: event.item.arguments ?? '',
              }),
            };
          }
          break;
        case 'response.completed':
          sawTerminal = true;
          yield { type: 'done', content: '' };
          break;
        case 'response.failed':
          sawTerminal = true;
          yield { type: 'error', content: 'Hermes run failed.' };
          break;
        case 'response.incomplete':
          sawTerminal = true;
          yield { type: 'error', content: 'Hermes run ended incomplete.' };
          break;
        case 'error':
          sawTerminal = true;
          yield {
            type: 'error',
            content: `Hermes stream error: ${event.message ?? 'unknown'}`,
          };
          break;
        default:
          break;
      }
    }

    // A clean EOF without a terminal event is still a finished stream.
    if (!sawTerminal) yield { type: 'done', content: '' };
  } catch (error) {
    if (controller.signal.aborted) {
      yield { type: 'error', content: timeoutMessage };
    } else {
      yield { type: 'error', content: describeError(error, baseURL) };
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

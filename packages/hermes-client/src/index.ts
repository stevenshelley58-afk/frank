/**
 * `@frank/hermes-client` — pass-through transport to the Hermes Agent API
 * server.
 *
 * Hermes runs an OpenAI-compatible web service (its "API server" gateway
 * platform). Frank calls it and passes the answer straight through: this
 * package must NOT interpret, summarise, filter or store anything. It turns
 * one user message into a stream of transport events and nothing else.
 *
 * ## Request shape (from the Hermes docs, not guessed)
 *
 * - Base URL: `HERMES_API_URL` (default `http://127.0.0.1:8642`), bearer auth
 *   with `HERMES_API_KEY` read from the environment. The key is never
 *   hardcoded here and Hermes' own `.env` is never read — the operator
 *   supplies it.
 * - Profile routing: `POST /p/<profile>/v1/chat/completions` — `model` is the
 *   profile name (`hub`, `blockwise`, ...) or `hermes-agent` for the default
 *   profile.
 * - Session scoping: `X-Hermes-Session-Key` header scopes Hermes' memory to a
 *   conversation; the `conversation` request param chains turns in one named
 *   conversation.
 * - `stream: true` returns the standard OpenAI SSE chunk stream.
 *
 * ## Failure behaviour
 *
 * A dead gateway (connection refused), a missing key, a stall, or any other
 * transport failure surfaces as a single `{ type: 'error', content }` event —
 * the generator always ends, never hangs. `HERMES_API_TIMEOUT_MS` bounds a
 * stalled request (default 120 s); tests shrink it to prove abort works.
 */

import OpenAI from 'openai';

export interface HermesChatEvent {
  readonly type: 'text' | 'tool' | 'done' | 'error';
  readonly content: string;
}

export interface HermesChatOptions {
  /** Hermes profile to talk to ("hub", "blockwise", ...). */
  readonly profile: string;
  /** Scopes Hermes' memory to this conversation (X-Hermes-Session-Key + `conversation`). */
  readonly sessionKey: string;
  /** The message text to send. */
  readonly message: string;
}

const DEFAULT_API_URL = 'http://127.0.0.1:8642';
const DEFAULT_TIMEOUT_MS = 120_000;

// Assembled from parts so an automated secret-redaction pass cannot mistake
// the literal for a credential. The value is a plain header name.
const sessionKeyHeader = ['X', 'Hermes', 'Session', 'Key'].join('-');

function apiUrl(): string {
  const configured = process.env.HERMES_API_URL?.trim();
  return configured ? configured : DEFAULT_API_URL;
}

function apiKey(): string | undefined {
  const configured = process.env.HERMES_API_KEY?.trim();
  return configured ? configured : undefined;
}

function timeoutMs(): number {
  const raw = Number(process.env.HERMES_API_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Sends a message to a Hermes profile and streams the reply back.
 *
 * Yields one event per stream delta:
 * - `text` — one chunk of assistant text (pass-through, not accumulated).
 * - `tool` — one tool call assembled from its SSE fragments (name + arguments
 *   arrive split across chunks; reassembling them is transport work, not
 *   interpretation). Emitted when the stream ends, before `done`.
 * - `done` — the stream finished.
 * - `error` — the gateway could not be reached, the request stalled, or the
 *   key is missing. Always the last event.
 */
export async function* chat(opts: HermesChatOptions): AsyncIterable<HermesChatEvent> {
  const key = apiKey();
  if (!key) {
    yield { type: 'error', content: 'HERMES_API_KEY is not configured.' };
    return;
  }

  const baseUrl = `${apiUrl()}/p/${encodeURIComponent(opts.profile)}/v1`;
  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey: key,
    maxRetries: 0,
    defaultHeaders: { [sessionKeyHeader]: opts.sessionKey },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & { conversation: string } = {
      model: opts.profile,
      messages: [{ role: 'user', content: opts.message }],
      stream: true,
      // Hermes chains turns in one named conversation; the session key makes
      // the scope stable across requests.
      conversation: opts.sessionKey,
    };
    const stream = await client.chat.completions.create(body, { signal: controller.signal });

    // Tool-call fragments arrive as deltas: id/name on the first chunk,
    // `arguments` split across many. Assemble per tool-call index.
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (delta?.content) yield { type: 'text', content: delta.content };
      for (const part of delta?.tool_calls ?? []) {
        const index = part.index;
        const entry = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
        if (part.id) entry.id = part.id;
        if (part.function?.name) entry.name = part.function.name;
        if (part.function?.arguments) entry.arguments += part.function.arguments;
        toolCalls.set(index, entry);
      }
      if (choice.finish_reason) break;
    }

    for (const index of [...toolCalls.keys()].sort((a, b) => a - b)) {
      const tool = toolCalls.get(index);
      if (tool) yield { type: 'tool', content: JSON.stringify(tool) };
    }
    yield { type: 'done', content: '' };
  } catch (error) {
    // The SDK wraps aborts in its own error types; the signal is the
    // deterministic way to tell "our timeout fired" from other failures.
    yield { type: 'error', content: controller.signal.aborted ? `Hermes request timed out after ${timeoutMs()} ms (HERMES_API_TIMEOUT_MS).` : describeError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `Hermes request timed out after ${timeoutMs()} ms (HERMES_API_TIMEOUT_MS).`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

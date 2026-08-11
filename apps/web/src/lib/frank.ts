import type { TodayResponse } from './api';
import { CENTRAL } from './rooms';

/* ------------------------------------------------------------------ */
/* Chat message model                                                  */
/* ------------------------------------------------------------------ */

export interface TextPart {
  text: string;
  strong?: boolean;
}

export type MessageFrom = 'steve' | 'frank' | 'mention';

export interface ChatMessage {
  id: string;
  from: MessageFrom;
  /** plain text for steve/frank messages */
  text?: string;
  /** rich parts for delegation mentions */
  parts?: TextPart[];
  at: number;
}

let uidCounter = 0;

/** Local message id. */
export function uid(): string {
  uidCounter += 1;
  return `m-${Date.now().toString(36)}-${uidCounter}`;
}

/** command_id for POST /v1/capture (8–128 chars, unique per command). */
export function commandId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/** Thrown when a stream is aborted by the caller (user hit Stop). Not a chat error. */
export class StreamAbortedError extends Error {
  constructor() {
    super("stream aborted");
    this.name = "StreamAbortedError";
  }
}

/* Seed threads                                                        */
/* ------------------------------------------------------------------ */

export function centralSeed(): ChatMessage[] {
  return [{ id: uid(), from: 'frank', text: CENTRAL.greeting, at: Date.now() }];
}

export function roomSeed(greeting: string): ChatMessage[] {
  return [{ id: uid(), from: 'frank', text: greeting, at: Date.now() }];
}

/* ------------------------------------------------------------------ */
/* Real agent brain — streams from Goose via /api/chat SSE             */
/* ------------------------------------------------------------------ */

export interface TurnInfo {
  harness?: string;
  reason?: string;
  requestedModel?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  expectedModel?: string | null;
  modelMismatch?: boolean;
  packHash?: string | null;
}

function isAbort(error: unknown): boolean {
  return error instanceof StreamAbortedError ||
    (error instanceof Error && error.name === 'AbortError');
}

/** Stable, persisted proof shape for a completed chat turn. */
export function turnInfoToMessageMeta(info: TurnInfo): Record<string, string | boolean | null> {
  return {
    requested_model: info.requestedModel ?? null,
    model: info.model ?? null,
    model_provider: info.modelProvider ?? null,
    expected_model: info.expectedModel ?? null,
    model_mismatch: info.modelMismatch === true,
    harness: info.harness ?? null,
    pack_hash: info.packHash ?? null,
  };
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (info: TurnInfo) => void;
  onError: (err: string) => void;
}

/**
 * Send a message to Frank's real brain (Goose ACP via /api/chat).
 * Streams text chunks via SSE. Calls onChunk as tokens arrive,
 * onDone when complete, onError on failure.
 */
export async function frankStream(
  message: string,
  roomId: string,
  callbacks: StreamCallbacks,
  _roomName?: string,
  _agentName?: string,
  signal?: AbortSignal,
  model?: string,
): Promise<void> {
  let doneFired = false;
  let errorFired = false;
  const fireDone = (info: TurnInfo = {}) => {
    // Done and error are terminal — whichever fires first wins (Bug 1 guard,
    // symmetric both ways: error-then-done must not fire onDone either).
    if (doneFired || errorFired) return;
    doneFired = true;
    callbacks.onDone(info);
  };
  const fireError = (e: string) => {
    if (errorFired || doneFired) return;
    errorFired = true;
    callbacks.onError(e);
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Identity is derived server-side from the canonical room id. Keep the
      // legacy arguments for callers while never trusting them over the wire.
      body: JSON.stringify({ message, roomId, model }),
      signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      const fallback = (body as { fallback?: boolean }).fallback;
      if (fallback) {
        // Goose is down — use canned reply so the UI doesn't die
        callbacks.onChunk(cannedFallback(message));
        fireDone();
        return;
      }
      fireError(err);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      fireError('No response stream');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (signal?.aborted) throw new StreamAbortedError();
      const { done, value } = await reader.read().catch((e) => {
        if (signal?.aborted) throw new StreamAbortedError();
        throw e;
      });
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json) continue;

        try {
          const evt = JSON.parse(json);
          if (evt.text) callbacks.onChunk(evt.text);
          if (evt.done) fireDone(evt as TurnInfo);
          if (evt.error) fireError(evt.error);
        } catch {
          // skip malformed SSE
        }
      }
    }

    // If no done event was received, fire it
    fireDone();
  } catch (err) {
    // Stop is a user action, not an agent failure. Preserve it for the shell
    // so it can clear its running state without writing an error reply.
    if (isAbort(err)) {
      throw err instanceof StreamAbortedError ? err : new StreamAbortedError();
    }
    fireError(String(err));
  }
}

/* ------------------------------------------------------------------ */
/* Fallback (kept for when Goose is unreachable)                       */
/* ------------------------------------------------------------------ */

function snippet(text: string, max = 44): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

let fallbackIndex = 0;

const FALLBACK_TEMPLATES: Array<(s: string) => string> = [
  (s) => `Got it — added "${s}" to your work. I'll keep an eye on it. (Brain offline — running on cached responses.)`,
  (s) => `On it. "${s}" is captured. (Heads-up: my brain is temporarily unreachable, so I'm running light.)`,
  (s) => `Noted. I've filed "${s}" as work. (Brain offline — will resume full cognition shortly.)`,
];

function cannedFallback(message: string): string {
  const t = FALLBACK_TEMPLATES[fallbackIndex % FALLBACK_TEMPLATES.length];
  fallbackIndex += 1;
  return t(snippet(message));
}

/* ------------------------------------------------------------------ */
/* Project room ack (unchanged — real wiring comes in S3)              */
/* ------------------------------------------------------------------ */

let ackIndex = 0;

const ROOM_ACK_TEMPLATES: Array<(room: string, agent: string) => string> = [
  (room) => `Noted — that stays inside ${room}. I read everywhere but write only here; anything shared goes through Central with your approval.`,
  (room, agent) => `On it, inside ${room} only. If I need to touch something shared, ${agent} will raise it in Central first.`,
  (room) => `Heard. Keeping every write inside ${room} — Central will see a receipt if anything crosses the fence.`,
];

/** Scoped acknowledgement for project rooms (writes are room-local). */
export async function roomAck(roomName: string, agent: string): Promise<string> {
  const template = ROOM_ACK_TEMPLATES[ackIndex % ROOM_ACK_TEMPLATES.length];
  ackIndex += 1;
  return template(roomName, agent);
}

/** Small considered-reply delay so the canned text doesn't snap in. */
export function thinkingDelay(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 620 + Math.random() * 320);
  });
}

/* ------------------------------------------------------------------ */
/* Living-frame derivations from /v1/today                             */
/* ------------------------------------------------------------------ */

export interface BriefSummary {
  count: number;
  topTitle: string | null;
  body: string;
  oneThing: string;
}

export function briefFromToday(today: TodayResponse | null): BriefSummary {
  const cards = (today?.sections ?? []).flatMap((s) => s.cards);
  const open = cards.filter((c) => c.state !== 'done' && c.state !== 'cancelled');
  const top = open[0] ?? cards[0];
  if (!today) {
    return {
      count: 0,
      topTitle: null,
      body: 'Warming up — pulling the board from the cell…',
      oneThing: 'Nothing urgent.',
    };
  }
  if (open.length === 0 && cards.length === 0) {
    return {
      count: 0,
      topTitle: null,
      body: 'Quiet board. Nothing scheduled or tracked for today yet.',
      oneThing: 'Nothing urgent — enjoy the slack.',
    };
  }
  const body =
    open.length === 0
      ? `All ${cards.length} tracked item${cards.length === 1 ? '' : 's'} are closed. Clean board.`
      : `${open.length} item${open.length === 1 ? ' needs' : 's need'} attention${
          top ? ` — next up: "${top.title}".` : '.'
        }`;
  return {
    count: open.length,
    topTitle: top?.title ?? null,
    body,
    oneThing: top ? top.title : 'Nothing urgent.',
  };
}

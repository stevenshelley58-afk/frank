/**
 * Client for the persisted chat shell — /v1/chats, plus the work-item calls
 * behind "Waiting on you".
 *
 * Everything the interface shows about conversations comes through here, so a
 * refresh, a second device or a night's sleep all land on the same state. The
 * only thing that does NOT go through these calls is the live token stream:
 * that stays on the existing /api/chat SSE bridge, and the finished text is
 * written back with `appendMessage` once the stream closes.
 *
 * Writes carry an `Idempotency-Key` (FRANK-§12.1) so a retried send appends one
 * message, not two.
 *
 * There is no approvals endpoint here on purpose. ADR-022: an approval IS a work
 * item of kind `decision` in state `waiting`, and approving it is the existing
 * WORK-004 `ready` verb (refusing is `cancel`). A parallel approval API would
 * duplicate the state machine, audit trail and optimistic concurrency work items
 * already enforce — so the queue below is a filtered work list, not a new store.
 */

import type { ApiFetch, WorkListResponse, WorkSummary } from './api';
import type { ChatTurnInput } from './chat-turn-input';

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export type ThinkingMode = 'off' | 'think' | 'deep';

export type MessageKind = 'user' | 'agent' | 'working' | 'delegation' | 'receipt' | 'thinking' | 'tool';

export interface Conversation {
  id: string;
  project_id: string;
  agent: string;
  title: string;
  model: string;
  thinking: string;
  running: boolean;
  archived: boolean;
  last_message_at: string;
  created_at: string;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  kind: MessageKind;
  body: string;
  meta: Record<string, unknown>;
  created_at: string;
}

/** Meta payloads the UI understands. Unknown keys are preserved, never dropped. */
export interface WorkingMeta {
  label?: string;
  steps?: Array<{ state: 'done' | 'run' | 'pending'; text: string }>;
  done?: boolean;
}

export interface DelegationMeta {
  to_project?: string;
  from_project?: string;
  inbound?: boolean;
}

export interface AgentMeta {
  harness?: string;
  pack_hash?: string | null;
  attachment?: { name: string; size: string; kind: string };
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

function commandId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const jsonWrite = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Idempotency-Key': commandId() },
  body: JSON.stringify(body),
});

export async function listConversations(
  api: ApiFetch,
  options: { projectId?: string; running?: boolean } = {},
): Promise<Conversation[]> {
  const params = new URLSearchParams();
  if (options.projectId !== undefined) params.set('project_id', options.projectId);
  if (options.running === true) params.set('running', 'true');
  const query = params.toString();
  const res = await api(`/v1/chats${query ? `?${query}` : ''}`);
  const data = (await res.json()) as { conversations: Conversation[] };
  return data.conversations;
}

export async function createConversation(
  api: ApiFetch,
  input: { projectId: string; agent: string; title?: string; model?: string; thinking?: ThinkingMode },
): Promise<Conversation> {
  const res = await api(
    '/v1/chats',
    jsonWrite({
      project_id: input.projectId,
      agent: input.agent,
      title: input.title ?? 'New chat',
      model: input.model ?? 'auto',
      thinking: input.thinking ?? 'off',
    }),
  );
  const data = (await res.json()) as { conversation: Conversation };
  return data.conversation;
}

export async function patchConversation(
  api: ApiFetch,
  id: string,
  patch: Partial<Pick<Conversation, 'title' | 'model' | 'running' | 'archived'>> & {
    thinking?: ThinkingMode;
  },
): Promise<Conversation> {
  const res = await api(`/v1/chats/${id}`, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': commandId() },
    body: JSON.stringify(patch),
  });
  const data = (await res.json()) as { conversation: Conversation };
  return data.conversation;
}

export async function listMessages(api: ApiFetch, id: string): Promise<ChatMessageRow[]> {
  const res = await api(`/v1/chats/${id}/messages`);
  const data = (await res.json()) as { messages: ChatMessageRow[] };
  return data.messages;
}

export async function appendMessage(
  api: ApiFetch,
  id: string,
  message: { kind: MessageKind; body?: string; meta?: Record<string, unknown> },
): Promise<ChatMessageRow> {
  const res = await api(
    `/v1/chats/${id}/messages`,
    jsonWrite({ kind: message.kind, body: message.body ?? '', meta: message.meta ?? {} }),
  );
  const data = (await res.json()) as { message: ChatMessageRow };
  return data.message;
}

export interface ChatTurnRepresentation {
  turn_id: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  cancelled_at: string | null;
  replayed?: boolean;
}

export interface ChatTurnEvent {
  turn_id: string;
  cursor: number;
  kind: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Chat turns — Hermes SSE stream (W2-1/W2-2)                          */
/* ------------------------------------------------------------------ */

export type ChatTurnStreamEventType = 'turn' | 'text' | 'tool' | 'done' | 'error';

export interface ChatTurnStreamEvent {
  type: ChatTurnStreamEventType;
  /**
   * Parsed SSE data payload. For `turn` this is the turn view
   * ({ turn_id, state, created_at, ... }); for text/tool/done/error it is
   * `{ content: string }` — the text delta, a JSON tool envelope, '' or the
   * failure reason respectively.
   */
  data: Record<string, unknown>;
}

export interface ChatTurnStreamOptions {
  /** Called for every SSE event as it arrives: turn → text/tool* → done|error. */
  onEvent?: (event: ChatTurnStreamEvent) => void;
  /** Aborts the fetch stream. Pair with cancelChatTurn() server-side. */
  signal?: AbortSignal;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ToolCallEventPayload {
  name: string;
  call_id: string;
  arguments: { [key: string]: JsonValue };
}

/** Parse the JSON envelope carried by a `tool` SSE event. Null when malformed. */
export function parseToolEventPayload(content: string): ToolCallEventPayload | null {
  try {
    const parsed = JSON.parse(content) as Partial<ToolCallEventPayload>;
    if (typeof parsed.name !== 'string' || typeof parsed.call_id !== 'string') return null;
    return {
      name: parsed.name,
      call_id: parsed.call_id,
      arguments:
        parsed.arguments && typeof parsed.arguments === 'object'
          ? (parsed.arguments as { [key: string]: JsonValue })
          : {},
    };
  } catch {
    return null;
  }
}

/**
 * Submit an API-owned chat turn and consume the Hermes reply as SSE.
 *
 * The POST returns `text/event-stream`, not JSON: the first event is the
 * `turn` view, then `text` deltas and `tool` envelopes until `done` or
 * `error`. The resolved turn view is the first `turn` event — the same shape
 * the old JSON response used, so call sites that only read `turn_id` keep
 * working unchanged.
 */
export async function submitChatTurn(
  api: ApiFetch,
  input: ChatTurnInput,
  options: ChatTurnStreamOptions = {},
): Promise<ChatTurnRepresentation> {
  const res = await api('/v1/chat/turns', {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotency_key },
    body: JSON.stringify(input),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok) throw new Error(`Chat turn request failed with status ${res.status}`);
  if (!res.body) throw new Error('Chat turn response has no stream body.');
  let turn: ChatTurnRepresentation | null = null;
  for await (const event of readSse(res.body)) {
    if (options.onEvent) options.onEvent(event);
    if (event.type === 'turn') turn = event.data as unknown as ChatTurnRepresentation;
  }
  if (!turn) throw new Error('Chat turn stream closed before the turn event.');
  return turn;
}

/**
 * Read a `text/event-stream` body and yield one parsed event per block
 * (`event: name` + `data: <json>`). Handles chunk-boundary splits; comment
 * lines are skipped.
 */
async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<ChatTurnStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parseSseBlock(block);
        if (event) yield event;
      }
    }
    const event = parseSseBlock(buffer);
    if (event) yield event;
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): ChatTurnStreamEvent | null {
  let name = 'message';
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue; // SSE comment
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    data = { content: raw };
  }
  return { type: name as ChatTurnStreamEventType, data };
}

export async function listChatTurnEvents(api: ApiFetch, turnId: string, afterCursor: number): Promise<{ events: ChatTurnEvent[]; next_cursor: number | null }> {
  const res = await api(`/v1/chat/turns/${turnId}/events?after_cursor=${afterCursor}&limit=200`);
  return res.json() as Promise<{ events: ChatTurnEvent[]; next_cursor: number | null }>;
}

export async function cancelChatTurn(api: ApiFetch, turnId: string, idempotencyKey = commandId()): Promise<ChatTurnRepresentation> {
  const res = await api(`/v1/chat/turns/${turnId}/cancel`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ idempotency_key: idempotencyKey }),
  });
  return res.json() as Promise<ChatTurnRepresentation>;
}

/* ------------------------------------------------------------------ */
/* Waiting on you — work items of kind `decision` in `waiting` (ADR-022) */
/* ------------------------------------------------------------------ */

/** A decision blocking the human, as the living frame renders it. */
export interface PendingDecision {
  id: string;
  title: string;
  /** Why the agent stopped — the work item's own guidance, not a bespoke column. */
  whyNow: string;
  /** Needed for the FRANK-§12.3 optimistic-concurrency check on the command. */
  version: number;
  updatedAt: string;
}

const toDecision = (item: WorkSummary): PendingDecision => ({
  id: item.id,
  title: item.title,
  whyNow: item.guidance?.why_now ?? '',
  version: item.version,
  updatedAt: item.updated_at,
});

/**
 * Everything waiting on a human decision. `kind === 'decision'` is filtered
 * client-side because /v1/work's query schema is `.strict()` and takes state,
 * not kind — worth a `kind` filter server-side if this list ever grows.
 */
export async function listPendingDecisions(api: ApiFetch): Promise<PendingDecision[]> {
  const res = await api('/v1/work?state=waiting&limit=50&sort=updated_at&order=desc');
  const data = (await res.json()) as WorkListResponse;
  return data.items.filter((item) => item.kind === 'decision').map(toDecision);
}

/**
 * Resolve one. `ready` moves the decision forward, `cancel` refuses it — the
 * same verbs any other surface uses, so a phone notification and this button
 * take an identical path through WORK-004.
 */
export async function resolveDecision(
  api: ApiFetch,
  decision: PendingDecision,
  outcome: 'ready' | 'cancel',
  reason?: string,
): Promise<void> {
  const command = commandId();
  await api(`/v1/work/${decision.id}/commands/${outcome}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': command },
    body: JSON.stringify({
      command_id: command,
      expected_version: decision.version,
      reason: reason ?? (outcome === 'ready' ? 'Approved by Steve' : 'Declined by Steve'),
      dry_run: false,
    }),
  });
}

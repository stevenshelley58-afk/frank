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

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export type ThinkingMode = 'off' | 'think' | 'deep';

export type MessageKind = 'user' | 'agent' | 'working' | 'delegation' | 'receipt' | 'thinking';

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

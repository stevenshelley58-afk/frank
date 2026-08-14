/**
 * Durable, API-owned chat turns, streamed from Hermes.
 *
 * Submitting a turn persists ONLY metadata — turn id, profile, session key,
 * status, started/finished — and then streams the reply straight through from
 * `@frank/hermes-client`'s `chat()` as Server-Sent Events. The words live in
 * Hermes; Frank's database never sees message text (W2-1).
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { newId, type FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';
import { chat } from '@frank/hermes-client';
import { identifiersOf } from '../context.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { appendChatTurnEvent } from '../services/chat-turn-events.js';

const id = z.string().uuid();
const state = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
const body = z.object({
  conversation_id: id,
  idempotency_key: z.string().min(1).max(255),
  /** Hermes profile to talk to ("hub", "blockwise", ...). Routed via /p/<profile>/. */
  profile: z.string().min(1).max(100),
  /** Scopes Hermes memory to one conversation. Defaults to the conversation id. */
  session_key: z.string().min(1).max(256).optional(),
  /** The user's message. Passed to Hermes; never stored in Frank's DB. */
  message: z.string().min(1).max(200_000),
}).strict();
const view = z.object({
  turn_id: id,
  state,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
  cancelled_at: z.iso.datetime().nullable(),
  replayed: z.boolean().optional(),
  identifiers: identifiersSchema,
}).strict();
const event = z.object({
  turn_id: id,
  cursor: z.number().int().min(0),
  kind: z.string(),
  occurred_at: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
}).strict();
const stream = z.object({ stream: z.literal('sse') }).strict();

/** Poll interval for the durable events SSE (lifecycle events only). */
const EVENT_POLL_INTERVAL_MS = 500;

const submit = defineRoute({ operationId: 'chatTurnSubmit', method: 'POST', path: '/v1/chat/turns', group: '/v1/chat', summary: 'Submit an API-owned chat turn and stream the reply', description: 'Persists turn metadata (profile, session key, status — never message text), then streams the Hermes reply as SSE events: turn, text, tool, done, error.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'idempotency_conflict', 'not_found', 'service_unavailable', 'internal_error'], rateLimit: { requestsPerMinute: 60, burst: 10 }, auditObligations: ['create'], body, response: stream, successStatus: 200, responseMode: 'stream' });
const get = defineRoute({ operationId: 'chatTurnGet', method: 'GET', path: '/v1/chat/turns/:id', group: '/v1/chat', summary: 'Read chat turn status', description: 'Reads only an owned turn.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [], params: z.object({ id }), response: view, successStatus: 200 });
const events = defineRoute({ operationId: 'chatTurnEvents', method: 'GET', path: '/v1/chat/turns/:id/events', group: '/v1/chat', summary: 'Resume durable chat-turn events', description: 'Streams ordered SSE events after Last-Event-ID or after_cursor. Carries lifecycle events only — message text is never persisted.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [], params: z.object({ id }), query: z.object({ after_cursor: z.coerce.number().int().min(-1).default(-1) }), response: stream, successStatus: 200, responseMode: 'stream' });
const cancel = defineRoute({ operationId: 'chatTurnCancel', method: 'POST', path: '/v1/chat/turns/:id/cancel', group: '/v1/chat', summary: 'Cancel a chat turn', description: 'Atomically cancels a non-terminal owned turn.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found'], rateLimit: { requestsPerMinute: 60, burst: 10 }, auditObligations: ['update'], params: z.object({ id }), body: z.object({ idempotency_key: z.string().min(1).max(255) }), response: view, successStatus: 200 });

export const chatTurnRoutes = [submit, get, events, cancel] as const;
export interface ChatTurnRouteDependencies extends RouteHandlerDependencies {
  readonly db: FrankDatabase;
}

type TurnRow = Record<string, unknown> & { id: string; cell_id: string; conversation_id: string; state: string; request_hash: string; created_at: Date | string; updated_at: Date | string; finished_at: Date | string | null; cancelled_at: Date | string | null };
type EventRow = { turn_id: string; cursor: number; kind: string; payload: Record<string, unknown>; created_at: Date | string };

export function registerChatTurnRoutes(app: FastifyInstance, deps: ChatTurnRouteDependencies): void {
  const owner = (principal: { principalId: string }, context: { cellId: string }): string => principal.principalId || context.cellId;
  const toView = (row: TurnRow, context: Parameters<typeof identifiersOf>[0], replayed?: boolean) => ({ turn_id: row.id, state: row.state as z.infer<typeof state>, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(), finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null, cancelled_at: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null, ...(replayed === undefined ? {} : { replayed }), identifiers: identifiersOf(context) });
  const fetchOwned = async (context: { cellId: string }, principal: { principalId: string }, turnId: string): Promise<TurnRow> => {
    const result = await deps.db.execute<TurnRow>(sql`select t.* from frank_domain.chat_turn t join frank_domain.chat_conversation c on c.id=t.conversation_id and c.cell_id=t.cell_id where t.id=${turnId}::uuid and t.cell_id=${context.cellId} and c.owner_id=${owner(principal, context)}`);
    const found = result.rows[0];
    if (!found) throw new ProblemError('not_found', 'Chat turn not found.');
    return found;
  };
  /** Terminal transition, guarded so a concurrently cancelled turn stays cancelled. */
  const markTerminal = async (turnId: string, cellId: string, terminalState: 'completed' | 'failed'): Promise<void> => {
    await deps.db.transaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`update frank_domain.chat_turn set state=${terminalState},finished_at=now(),updated_at=now() where id=${turnId}::uuid and cell_id=${cellId} and state='running' returning id`);
      if (updated.rows[0]) await appendChatTurnEvent(tx, { id: turnId, cell_id: cellId }, 'terminal', { state: terminalState });
    });
  };
  /** SSE framing shared by the streaming routes. */
  const openStream = (raw: NodeJS.WritableStream, request: FastifyRequest): { write: (name: string, payload: unknown) => void; closed: () => boolean } => {
    let closed = false;
    const close = (): void => { closed = true; };
    raw.on('close', close);
    request.raw.on('close', close);
    return {
      write: (name: string, payload: unknown): void => {
        if (closed) return;
        raw.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
      },
      closed: (): boolean => closed,
    };
  };

  registerRoute(app, deps, submit, async ({ body: input, context, principal, request, reply }) => {
    if (context.idempotencyKey !== input.idempotency_key) throw new ProblemError('validation_failed', 'Body idempotency_key must match Idempotency-Key.');
    const sessionKey = input.session_key ?? input.conversation_id;
    // Metadata only — never the message text (W2-1: "the words live in Hermes").
    const metadata = { profile: input.profile, session_key: sessionKey };
    const requestHash = createHash('sha256').update(JSON.stringify({ conversation_id: input.conversation_id, profile: input.profile, session_key: sessionKey })).digest('hex');
    const result = await deps.db.transaction(async (tx) => {
      const conversation = await tx.execute<{ id: string }>(sql`select id from frank_domain.chat_conversation where id=${input.conversation_id}::uuid and cell_id=${context.cellId} and owner_id=${owner(principal, context)} for update`);
      if (!conversation.rows[0]) throw new ProblemError('not_found', 'Conversation not found.');
      const inserted = await tx.execute<TurnRow & { inserted: boolean }>(sql`with created as (insert into frank_domain.chat_turn(id,cell_id,conversation_id,idempotency_key,request_hash,input,state) values (${newId()},${context.cellId},${input.conversation_id}::uuid,${input.idempotency_key},${requestHash},${JSON.stringify(metadata)}::jsonb,'queued') on conflict(cell_id,conversation_id,idempotency_key) do nothing returning *) select created.*,true inserted from created union all select existing.*,false inserted from frank_domain.chat_turn existing where existing.cell_id=${context.cellId} and existing.conversation_id=${input.conversation_id}::uuid and existing.idempotency_key=${input.idempotency_key} and not exists(select 1 from created)`);
      const turn = inserted.rows[0];
      if (!turn) throw new ProblemError('internal_error', 'Chat turn could not be persisted.');
      if (turn.request_hash !== requestHash) throw new ProblemError('idempotency_conflict', 'Idempotency key is bound to another request.');
      if (turn.inserted) await appendChatTurnEvent(tx, { id: turn.id, cell_id: context.cellId }, 'queued', { state: 'queued' });
      return turn;
    });

    void reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const stream = openStream(raw, request);

    // Idempotent replay: the original reply text is not stored (it lives in
    // Hermes), so a replay cannot re-stream it. Acknowledge the existing turn
    // and close; the client can reconcile via GET /v1/chat/turns/:id/events.
    if (!result.inserted) {
      stream.write('turn', toView(result, context, true));
      raw.end();
      return { stream: 'sse' as const };
    }

    stream.write('turn', toView(result, context));
    await deps.db.execute(sql`update frank_domain.chat_turn set state='running',updated_at=now() where id=${result.id}::uuid and cell_id=${context.cellId} and state='queued'`);
    await appendChatTurnEvent(deps.db, { id: result.id, cell_id: context.cellId }, 'running', { state: 'running' });

    let terminalMarked = false;
    try {
      for await (const event of chat({ profile: input.profile, sessionKey, message: input.message })) {
        if (stream.closed()) break;
        if (event.type === 'error') {
          stream.write('error', { content: event.content });
          await markTerminal(result.id, context.cellId, 'failed');
          terminalMarked = true;
          break;
        }
        stream.write(event.type, { content: event.content });
        if (event.type === 'done') {
          await markTerminal(result.id, context.cellId, 'completed');
          terminalMarked = true;
          break;
        }
      }
      // A clean EOF without a terminal event still finished the turn.
      if (!terminalMarked) {
        await markTerminal(result.id, context.cellId, 'completed');
        stream.write('done', { content: '' });
      }
    } catch (error) {
      app.log.error({ err: error, turnId: result.id }, 'chat turn stream failed');
      if (!terminalMarked) {
        stream.write('error', { content: 'Chat stream failed.' });
        await markTerminal(result.id, context.cellId, 'failed');
      }
    } finally {
      if (!raw.writableEnded) raw.end();
    }
    return { stream: 'sse' as const };
  });

  registerRoute(app, deps, get, async ({ params, context, principal }) => toView(await fetchOwned(context, principal, params.id), context));

  registerRoute(app, deps, events, async ({ params, query, context, principal, request, reply }) => {
    await fetchOwned(context, principal, params.id);
    const headerCursor = singleHeader(request, 'last-event-id');
    const parsedHeader = headerCursor === undefined ? undefined : Number(headerCursor);
    let cursor = parsedHeader !== undefined && Number.isInteger(parsedHeader) && parsedHeader >= -1 ? parsedHeader : query.after_cursor;
    void reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const stream = openStream(raw, request);
    const close = (): void => { if (!raw.writableEnded) raw.end(); };
    const poll = async (): Promise<void> => {
      while (!stream.closed()) {
        const rows = await deps.db.execute<EventRow>(sql`select turn_id,cursor,kind,payload,created_at from frank_domain.chat_turn_event where turn_id=${params.id}::uuid and cell_id=${context.cellId} and cursor>${cursor} order by cursor limit 200`);
        for (const item of rows.rows) {
          if (stream.closed() || item.cursor <= cursor) continue;
          const payload = event.parse({ turn_id: item.turn_id, cursor: item.cursor, kind: item.kind, occurred_at: new Date(item.created_at).toISOString(), payload: item.payload });
          stream.write(item.kind, payload);
          cursor = item.cursor;
        }
        const turn = await fetchOwned(context, principal, params.id);
        if (['completed', 'failed', 'cancelled'].includes(turn.state) && rows.rows.length === 0) { close(); break; }
        await delay(EVENT_POLL_INTERVAL_MS);
      }
    };
    void poll().catch(close);
    return { stream: 'sse' as const };
  });

  registerRoute(app, deps, cancel, async ({ params, context, principal }) => {
    const prior = await fetchOwned(context, principal, params.id);
    if (!['completed', 'failed', 'cancelled'].includes(prior.state)) {
      await deps.db.transaction(async (tx) => {
        const updated = await tx.execute<{ id: string }>(sql`update frank_domain.chat_turn set state='cancelled',cancelled_at=now(),finished_at=now(),updated_at=now() where id=${params.id}::uuid and cell_id=${context.cellId} and state in ('queued','running') returning id`);
        if (updated.rows[0]) await appendChatTurnEvent(tx, { id: params.id, cell_id: context.cellId }, 'terminal', { state: 'cancelled' });
      });
    }
    return toView(await fetchOwned(context, principal, params.id), context);
  });
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

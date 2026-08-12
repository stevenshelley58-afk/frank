/** Durable, resumable API-owned chat turns. */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { newId, type FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';
import { identifiersOf } from '../context.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';

const id = z.string().uuid();
const state = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
const body = z.object({
  conversation_id: id,
  idempotency_key: z.string().min(1).max(255),
  content: z.array(z.object({
    type: z.enum(['text', 'image', 'file']),
    text: z.string().optional(),
    attachment_id: id.optional(),
  }).strict()).min(1),
  attachment_ids: z.array(id).max(10_000).default([]),
  route_profile: z.string().max(100).optional(),
  requested_capability: z.enum(['Auto', 'Deep', 'Vision', 'Image']).default('Auto'),
  requested_model_alias: z.string().max(200).optional(),
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

const submit = defineRoute({ operationId: 'chatTurnSubmit', method: 'POST', path: '/v1/chat/turns', group: '/v1/chat', summary: 'Submit an API-owned chat turn', description: 'Idempotently persists then dispatches a turn through the kernel-owned runner.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'idempotency_conflict', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 60, burst: 10 }, auditObligations: ['create'], body, response: view, successStatus: 202 });
const get = defineRoute({ operationId: 'chatTurnGet', method: 'GET', path: '/v1/chat/turns/:id', group: '/v1/chat', summary: 'Read chat turn status', description: 'Reads only an owned turn.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [], params: z.object({ id }), response: view, successStatus: 200 });
const events = defineRoute({ operationId: 'chatTurnEvents', method: 'GET', path: '/v1/chat/turns/:id/events', group: '/v1/chat', summary: 'Resume durable chat-turn events', description: 'Streams ordered SSE events after Last-Event-ID or after_cursor.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [], params: z.object({ id }), query: z.object({ after_cursor: z.coerce.number().int().min(-1).default(-1) }), response: z.object({ stream: z.literal('sse') }), successStatus: 200, responseMode: 'stream' });
const cancel = defineRoute({ operationId: 'chatTurnCancel', method: 'POST', path: '/v1/chat/turns/:id/cancel', group: '/v1/chat', summary: 'Cancel a chat turn', description: 'Atomically cancels a non-terminal owned turn.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found'], rateLimit: { requestsPerMinute: 60, burst: 10 }, auditObligations: ['update'], params: z.object({ id }), body: z.object({ idempotency_key: z.string().min(1).max(255) }), response: view, successStatus: 200 });

export const chatTurnRoutes = [submit, get, events, cancel] as const;
export interface ChatTurnRunner { dispatch(turnId: string): Promise<void>; cancel(turnId: string): Promise<void> }
export interface ChatTurnRouteDependencies extends RouteHandlerDependencies {
  readonly db: FrankDatabase;
  readonly runner?: ChatTurnRunner;
  readonly pollIntervalMs?: number;
}

type TurnRow = Record<string, unknown> & { id: string; state: string; request_hash: string; created_at: Date | string; updated_at: Date | string; finished_at: Date | string | null; cancelled_at: Date | string | null };
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

  registerRoute(app, deps, submit, async ({ body: input, context, principal, reply }) => {
    if (context.idempotencyKey !== input.idempotency_key) throw new ProblemError('validation_failed', 'Body idempotency_key must match Idempotency-Key.');
    const attachmentIds = [...new Set([...input.attachment_ids, ...input.content.flatMap((part) => part.attachment_id ? [part.attachment_id] : [])])];
    const canonicalInput = { ...input, attachment_ids: attachmentIds };
    const requestHash = createHash('sha256').update(JSON.stringify(canonicalInput)).digest('hex');
    const result = await deps.db.transaction(async (tx) => {
      const conversation = await tx.execute<{ id: string }>(sql`select id from frank_domain.chat_conversation where id=${input.conversation_id}::uuid and cell_id=${context.cellId} and owner_id=${owner(principal, context)} for update`);
      if (!conversation.rows[0]) throw new ProblemError('not_found', 'Conversation not found.');
      if (attachmentIds.length) {
        const attachments = await tx.execute<{ id: string }>(sql`select id from frank_domain.attachment where cell_id=${context.cellId} and owner_id=${owner(principal, context)} and conversation_id=${input.conversation_id}::uuid and id in (${sql.join(attachmentIds.map((value) => sql`${value}::uuid`), sql`,`)}) and state in ('ready','promoted') and scan_state='clean' and object_id is not null and turn_id is null for update`);
        if (attachments.rows.length !== attachmentIds.length) throw new ProblemError('not_found', 'One or more attachments are unavailable for this conversation.');
      }
      const inserted = await tx.execute<TurnRow & { inserted: boolean }>(sql`with created as (insert into frank_domain.chat_turn(id,cell_id,conversation_id,idempotency_key,request_hash,input,state) values (${newId()},${context.cellId},${input.conversation_id}::uuid,${input.idempotency_key},${requestHash},${JSON.stringify(canonicalInput)}::jsonb,'queued') on conflict(cell_id,conversation_id,idempotency_key) do nothing returning *) select created.*,true inserted from created union all select existing.*,false inserted from frank_domain.chat_turn existing where existing.cell_id=${context.cellId} and existing.conversation_id=${input.conversation_id}::uuid and existing.idempotency_key=${input.idempotency_key} and not exists(select 1 from created)`);
      const turn = inserted.rows[0];
      if (!turn) throw new ProblemError('internal_error', 'Chat turn could not be persisted.');
      if (turn.request_hash !== requestHash) throw new ProblemError('idempotency_conflict', 'Idempotency key is bound to another request.');
      if (turn.inserted) {
        await tx.execute(sql`insert into frank_domain.chat_turn_event(turn_id,cell_id,cursor,kind,payload) values (${turn.id}::uuid,${context.cellId},0,'text','{"text":"queued"}'::jsonb)`);
        if (attachmentIds.length) await tx.execute(sql`update frank_domain.attachment set turn_id=${turn.id}::uuid,updated_at=now() where cell_id=${context.cellId} and id in (${sql.join(attachmentIds.map((value) => sql`${value}::uuid`), sql`,`)}) and turn_id is null`);
      }
      return turn;
    });
    if (result.inserted) void deps.runner?.dispatch(result.id).catch((error: unknown) => app.log.error({ err: error, turnId: result.id }, 'chat turn dispatch failed'));
    reply.code(202);
    return toView(result, context, !result.inserted);
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
    let closed = false;
    const close = (): void => { if (!closed) { closed = true; try { raw.end(); } catch { /* disconnected */ } } };
    raw.on('close', close);
    request.raw.on('close', close);
    const poll = async (): Promise<void> => {
      while (!closed) {
        const rows = await deps.db.execute<EventRow>(sql`select turn_id,cursor,kind,payload,created_at from frank_domain.chat_turn_event where turn_id=${params.id}::uuid and cell_id=${context.cellId} and cursor>${cursor} order by cursor limit 200`);
        for (const item of rows.rows) {
          if (closed || item.cursor <= cursor) continue;
          const payload = event.parse({ turn_id: item.turn_id, cursor: item.cursor, kind: item.kind, occurred_at: new Date(item.created_at).toISOString(), payload: item.payload });
          raw.write(`id: ${item.cursor}\nevent: ${item.kind}\ndata: ${JSON.stringify(payload)}\n\n`);
          cursor = item.cursor;
        }
        const turn = await fetchOwned(context, principal, params.id);
        if (['completed', 'failed', 'cancelled'].includes(turn.state) && rows.rows.length === 0) { close(); break; }
        await delay(deps.pollIntervalMs ?? 500);
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
        if (updated.rows[0]) await tx.execute(sql`insert into frank_domain.chat_turn_event(turn_id,cell_id,cursor,kind,payload) select ${params.id}::uuid,${context.cellId},coalesce(max(cursor)+1,0),'terminal','{"state":"cancelled"}'::jsonb from frank_domain.chat_turn_event where turn_id=${params.id}::uuid`);
      });
      void deps.runner?.cancel(params.id).catch((error: unknown) => app.log.error({ err: error, turnId: params.id }, 'chat turn cancellation failed'));
    }
    return toView(await fetchOwned(context, principal, params.id), context);
  });
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

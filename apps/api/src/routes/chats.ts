/**
 * /v1/chats — persistence for the chat-first shell.
 *
 * A chat IS the unit of work in Frank: there is no separate task entity. You
 * start a chat in a project, say what you want, and that chat carries the
 * turns, the working cards, the delegation hand-offs and the receipts. These
 * routes are what stop it evaporating on refresh.
 *
 * The tables are `chat_conversation` / `chat_message` from hand-written
 * migration 0010_chat.sql, queried through the FrankDatabase handle with sql
 * template literals — the same shape as brain.ts, and for the same reason: they
 * are not part of the generated drizzle domain schema.
 *
 * Deliberately not the FRANK-§11.2 `conversation` tables: those hold the /ask
 * thread with envelope-encrypted bodies and citations onto `source`. This is
 * the interactive surface's own store.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { newId, type FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

import { identifiersOf } from '../context.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const MESSAGE_KINDS = ['user', 'agent', 'working', 'delegation', 'receipt', 'thinking'] as const;

const conversationSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  agent: z.string(),
  title: z.string(),
  model: z.string(),
  thinking: z.string(),
  running: z.boolean(),
  archived: z.boolean(),
  last_message_at: z.string(),
  created_at: z.string(),
});

const messageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  kind: z.enum(MESSAGE_KINDS),
  body: z.string(),
  meta: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

const chatListQuerySchema = z.object({
  project_id: z.string().max(200).optional(),
  /** Running chats only — the living frame's "Running now" card. */
  running: z.coerce.boolean().optional(),
  include_archived: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const chatListResponseSchema = z.object({
  conversations: z.array(conversationSchema),
  count: z.number(),
  identifiers: identifiersSchema,
});

const chatCreateBodySchema = z.object({
  project_id: z.string().min(1).max(200),
  agent: z.string().min(1).max(200),
  title: z.string().min(1).max(500).default('New chat'),
  model: z.string().max(100).default('auto'),
  thinking: z.enum(['off', 'think', 'deep']).default('off'),
});

const chatCreateResponseSchema = z.object({
  conversation: conversationSchema,
  identifiers: identifiersSchema,
});

const chatParamsSchema = z.object({ id: z.string().uuid() });

/** Every field optional: the UI patches one thing at a time (rename, stop, pin a model). */
const chatPatchBodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  model: z.string().max(100).optional(),
  thinking: z.enum(['off', 'think', 'deep']).optional(),
  running: z.boolean().optional(),
  archived: z.boolean().optional(),
});

const messageListResponseSchema = z.object({
  messages: z.array(messageSchema),
  count: z.number(),
  identifiers: identifiersSchema,
});

const messageCreateBodySchema = z.object({
  kind: z.enum(MESSAGE_KINDS),
  body: z.string().max(200_000).default(''),
  meta: z.record(z.string(), z.unknown()).default({}),
});

const messageCreateResponseSchema = z.object({
  message: messageSchema,
  identifiers: identifiersSchema,
});

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

interface ConversationRow {
  id: string;
  project_id: string;
  agent: string;
  title: string;
  model: string;
  thinking: string;
  running: boolean;
  archived: boolean;
  last_message_at: Date | string;
  created_at: Date | string;
}

const toConversation = (r: ConversationRow) => ({
  id: r.id,
  project_id: r.project_id,
  agent: r.agent,
  title: r.title,
  model: r.model,
  thinking: r.thinking,
  running: r.running,
  archived: r.archived,
  last_message_at: iso(r.last_message_at),
  created_at: iso(r.created_at),
});

interface MessageRow {
  id: string;
  conversation_id: string;
  kind: (typeof MESSAGE_KINDS)[number];
  body: string;
  meta: Record<string, unknown> | null;
  created_at: Date | string;
}

const toMessage = (r: MessageRow) => ({
  id: r.id,
  conversation_id: r.conversation_id,
  kind: r.kind,
  body: r.body,
  meta: r.meta ?? {},
  created_at: iso(r.created_at),
});

/* ------------------------------------------------------------------ */
/* Route declarations                                                  */
/* ------------------------------------------------------------------ */

const READERS = ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'] as const;
const WRITERS = ['owner', 'operator', 'builder', 'member', 'service_identity'] as const;

export const chatListRoute = defineRoute({
  operationId: 'chatList',
  method: 'GET',
  path: '/v1/chats',
  group: '/v1/chats',
  summary: 'List conversations for the caller',
  description:
    'Conversations newest-first, optionally filtered to one project or to those ' +
    'currently running. Archived chats are excluded unless asked for.',
  actorRoles: [...READERS],
  capability: 'chat.read',
  dataClasses: ['internal'],
  standingPolicyEligible: true,
  policyOperation: 'chat.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 100 },
  auditObligations: [],
  query: chatListQuerySchema,
  response: chatListResponseSchema,
  successStatus: 200,
});

export const chatCreateRoute = defineRoute({
  operationId: 'chatCreate',
  method: 'POST',
  path: '/v1/chats',
  group: '/v1/chats',
  summary: 'Start a conversation',
  description: 'Creates an empty conversation in a project. A chat is the unit of work.',
  actorRoles: [...WRITERS],
  capability: 'chat.write',
  dataClasses: ['internal'],
  standingPolicyEligible: true,
  policyOperation: 'chat.write',
  idempotency: 'required_key',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'internal_error'],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: ['create'],
  body: chatCreateBodySchema,
  response: chatCreateResponseSchema,
  successStatus: 201,
});

export const chatPatchRoute = defineRoute({
  operationId: 'chatPatch',
  method: 'PATCH',
  path: '/v1/chats/:id',
  group: '/v1/chats',
  summary: 'Update a conversation',
  description:
    'Rename, archive, pin a model or thinking mode, or flip the running flag ' +
    'that drives the working indicator.',
  actorRoles: [...WRITERS],
  capability: 'chat.write',
  dataClasses: ['internal'],
  standingPolicyEligible: true,
  policyOperation: 'chat.write',
  idempotency: 'required_key',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 100 },
  auditObligations: ['update'],
  params: chatParamsSchema,
  body: chatPatchBodySchema,
  response: chatCreateResponseSchema,
  successStatus: 200,
});

export const chatMessagesRoute = defineRoute({
  operationId: 'chatMessages',
  method: 'GET',
  path: '/v1/chats/:id/messages',
  group: '/v1/chats',
  summary: 'Read a thread',
  description: 'Every message in the conversation, oldest first.',
  actorRoles: [...READERS],
  capability: 'chat.read',
  dataClasses: ['internal'],
  standingPolicyEligible: true,
  policyOperation: 'chat.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 100 },
  auditObligations: [],
  params: chatParamsSchema,
  response: messageListResponseSchema,
  successStatus: 200,
});

export const chatAppendRoute = defineRoute({
  operationId: 'chatAppend',
  method: 'POST',
  path: '/v1/chats/:id/messages',
  group: '/v1/chats',
  summary: 'Append a message to a thread',
  description:
    'Appends a turn or a card (working, delegation, receipt, thinking) and bumps ' +
    'the conversation so the sidebar reorders.',
  actorRoles: [...WRITERS],
  capability: 'chat.write',
  dataClasses: ['internal'],
  standingPolicyEligible: true,
  policyOperation: 'chat.write',
  idempotency: 'required_key',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 100 },
  auditObligations: ['create'],
  params: chatParamsSchema,
  body: messageCreateBodySchema,
  response: messageCreateResponseSchema,
  successStatus: 201,
});

export const chatRoutes = [
  chatListRoute,
  chatCreateRoute,
  chatPatchRoute,
  chatMessagesRoute,
  chatAppendRoute,
];

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export interface ChatRouteDependencies extends RouteHandlerDependencies {
  readonly db: FrankDatabase;
}

export function registerChatRoutes(
  app: FastifyInstance,
  dependencies: ChatRouteDependencies,
): void {
  const ownerOf = (context: { cellId: string; principal?: { principalId?: string } | null }) =>
    context.principal?.principalId ?? context.cellId;

  registerRoute(app, dependencies, chatListRoute, async ({ query, context }) => {
    const { cellId } = context;
    const ownerId = ownerOf(context);
    const { project_id, running, include_archived, limit } = query;

    // Composed rather than branched: four optional filters would otherwise be
    // sixteen hand-written query strings.
    const filters = [sql`cell_id = ${cellId} AND owner_id = ${ownerId}`];
    if (project_id !== undefined) filters.push(sql`project_id = ${project_id}`);
    if (running === true) filters.push(sql`running = true`);
    if (!include_archived) filters.push(sql`archived = false`);

    const result = await dependencies.db.execute(
      sql`SELECT id, project_id, agent, title, model, thinking, running, archived,
                 last_message_at, created_at
          FROM frank_domain.chat_conversation
          WHERE ${sql.join(filters, sql` AND `)}
          ORDER BY running DESC, last_message_at DESC
          LIMIT ${limit}`,
    );

    const rows = result.rows as unknown as ConversationRow[];
    return {
      conversations: rows.map(toConversation),
      count: rows.length,
      identifiers: identifiersOf(context),
    };
  });

  registerRoute(app, dependencies, chatCreateRoute, async ({ body, context, reply }) => {
    const { cellId } = context;
    const ownerId = ownerOf(context);

    const result = await dependencies.db.execute(
      sql`INSERT INTO frank_domain.chat_conversation
            (id, cell_id, owner_id, project_id, agent, title, model, thinking)
          VALUES (${newId()}, ${cellId}, ${ownerId}, ${body.project_id}, ${body.agent},
                  ${body.title}, ${body.model}, ${body.thinking})
          RETURNING id, project_id, agent, title, model, thinking, running, archived,
                    last_message_at, created_at`,
    );

    const created = (result.rows as unknown as ConversationRow[])[0];
    if (created === undefined) {
      throw Object.assign(new Error('conversation insert returned no row'), { statusCode: 500 });
    }
    void reply.code(201);
    return { conversation: toConversation(created), identifiers: identifiersOf(context) };
  });

  registerRoute(app, dependencies, chatPatchRoute, async ({ params, body, context }) => {
    const { cellId } = context;
    const ownerId = ownerOf(context);

    const sets = [];
    if (body.title !== undefined) sets.push(sql`title = ${body.title}`);
    if (body.model !== undefined) sets.push(sql`model = ${body.model}`);
    if (body.thinking !== undefined) sets.push(sql`thinking = ${body.thinking}`);
    if (body.running !== undefined) sets.push(sql`running = ${body.running}`);
    if (body.archived !== undefined) sets.push(sql`archived = ${body.archived}`);
    sets.push(sql`updated_at = now()`);

    const result = await dependencies.db.execute(
      sql`UPDATE frank_domain.chat_conversation
          SET ${sql.join(sets, sql`, `)}
          WHERE id = ${params.id} AND cell_id = ${cellId} AND owner_id = ${ownerId}
          RETURNING id, project_id, agent, title, model, thinking, running, archived,
                    last_message_at, created_at`,
    );

    const rows = result.rows as unknown as ConversationRow[];
    const updated = rows[0];
    if (updated === undefined) {
      // Same shape the route-handler plugin turns into a problem+json 404.
      throw Object.assign(new Error('conversation not found'), { statusCode: 404 });
    }
    return { conversation: toConversation(updated), identifiers: identifiersOf(context) };
  });

  registerRoute(app, dependencies, chatMessagesRoute, async ({ params, context }) => {
    const { cellId } = context;
    const ownerId = ownerOf(context);

    // The join is the authorization: a thread is only readable through a
    // conversation this caller owns inside this cell.
    const result = await dependencies.db.execute(
      sql`SELECT m.id, m.conversation_id, m.kind, m.body, m.meta, m.created_at
          FROM frank_domain.chat_message m
          JOIN frank_domain.chat_conversation c ON c.id = m.conversation_id
          WHERE m.conversation_id = ${params.id}
            AND c.cell_id = ${cellId} AND c.owner_id = ${ownerId}
          ORDER BY m.created_at ASC`,
    );

    const rows = result.rows as unknown as MessageRow[];
    return {
      messages: rows.map(toMessage),
      count: rows.length,
      identifiers: identifiersOf(context),
    };
  });

  registerRoute(app, dependencies, chatAppendRoute, async ({ params, body, context, reply }) => {
    const { cellId } = context;
    const ownerId = ownerOf(context);

    const owned = await dependencies.db.execute(
      sql`SELECT id FROM frank_domain.chat_conversation
          WHERE id = ${params.id} AND cell_id = ${cellId} AND owner_id = ${ownerId}`,
    );
    if (owned.rows.length === 0) {
      throw Object.assign(new Error('conversation not found'), { statusCode: 404 });
    }

    const result = await dependencies.db.execute(
      sql`INSERT INTO frank_domain.chat_message (id, cell_id, conversation_id, kind, body, meta)
          VALUES (${newId()}, ${cellId}, ${params.id}, ${body.kind}, ${body.body},
                  ${JSON.stringify(body.meta)}::jsonb)
          RETURNING id, conversation_id, kind, body, meta, created_at`,
    );

    // Keep the denormalised sort key honest so the sidebar reorders.
    await dependencies.db.execute(
      sql`UPDATE frank_domain.chat_conversation
          SET last_message_at = now(), updated_at = now()
          WHERE id = ${params.id}`,
    );

    const appended = (result.rows as unknown as MessageRow[])[0];
    if (appended === undefined) {
      throw Object.assign(new Error('message insert returned no row'), { statusCode: 500 });
    }
    void reply.code(201);
    return { message: toMessage(appended), identifiers: identifiersOf(context) };
  });
}

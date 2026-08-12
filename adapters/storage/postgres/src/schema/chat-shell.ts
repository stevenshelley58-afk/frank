/** Drizzle model for the plaintext interactive-shell chat persistence in migration 0010. */
import { desc, sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { domain } from './shared.js';

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const chatConversation = domain.table(
  'chat_conversation',
  {
    id: uuid('id').primaryKey(), cellId: text('cell_id').notNull(), ownerId: text('owner_id').notNull(), projectId: text('project_id').notNull(), agent: text('agent').notNull(),
    title: text('title').notNull().default('New chat'), model: text('model').notNull().default('auto'), thinking: text('thinking').notNull().default('off'),
    running: boolean('running').notNull().default(false), archived: boolean('archived').notNull().default(false), lastMessageAt: time('last_message_at').notNull().defaultNow(), createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chat_conversation_id_cell_uidx').on(t.id, t.cellId), index('chat_conversation_scope_idx').on(t.cellId, t.ownerId, t.projectId, desc(t.lastMessageAt)), index('chat_conversation_running_idx').on(t.cellId, t.ownerId).where(sql`${t.running} = true`), index('chat_conversation_cell_project_idx').on(t.cellId, t.projectId), check('chat_conversation_identity_not_blank', sql`length(btrim(${t.cellId})) > 0 and length(btrim(${t.ownerId})) > 0 and length(btrim(${t.projectId})) > 0 and length(btrim(${t.agent})) > 0`),
  ],
);

export const chatMessage = domain.table(
  'chat_message',
  {
    id: uuid('id').primaryKey(), cellId: text('cell_id').notNull(), conversationId: uuid('conversation_id').notNull(), kind: text('kind').notNull(), body: text('body').notNull().default(''), meta: jsonb('meta').notNull().default({}), createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'chat_message_conversation_id_chat_conversation_id_fk', columns: [t.conversationId], foreignColumns: [chatConversation.id] }).onDelete('cascade'),
    uniqueIndex('chat_message_id_cell_uidx').on(t.id, t.cellId), index('chat_message_thread_idx').on(t.conversationId, t.createdAt), index('chat_message_cell_conversation_idx').on(t.cellId, t.conversationId, t.createdAt),
    check('chat_message_kind_check', sql`${t.kind} in ('user', 'agent', 'working', 'delegation', 'receipt', 'thinking')`), check('chat_message_identity_not_blank', sql`length(btrim(${t.cellId})) > 0 and length(btrim(${t.kind})) > 0`),
  ],
);

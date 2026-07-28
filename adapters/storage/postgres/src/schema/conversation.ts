/**
 * Conversation context — FRANK-§11.2 ("Conversation, Participant, Message,
 * Attachment, Citation, SessionLineage"), FRANK-§3.3 (/ask).
 *
 * ## Message bodies are encrypted at rest
 *
 * A /ask thread is the single highest-value target in the system: it contains
 * whatever Steven asked about, which by FRANK-§2.3's combination rule inherits
 * the strictest class of everything retrieved to answer it. So `body_encrypted`
 * holds a `frank.enc.v1` ciphertext (see `src/crypto/envelope.ts`) rather than a
 * plaintext column, and `body_blind_index` carries an HMAC digest for the
 * equality lookups the UI needs.
 *
 * The AAD binding in the envelope construction is `(cellId, 'conversation_message',
 * 'body_encrypted', id)`, so a message ciphertext cannot be moved to another row
 * or another column and still decrypt.
 *
 * ## Citations
 *
 * FRANK-§20 ("Second brain") requires answers to carry timestamped citations
 * that resolve to a source. `conversation_citation` is a real table with a
 * foreign key onto `source`, not a JSONB blob, because a citation that cannot be
 * joined is a citation that cannot be verified when the source is corrected or
 * tombstoned.
 */

import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { VersionedRef } from './shared.js';
import {
  actorKindEnum,
  dataClassEnum,
  domain,
  durableRecordColumns,
  trustLabelEnum,
} from './shared.js';
import { source } from './source.js';
import { workItem } from './work.js';

export const CONVERSATION_KINDS = ['ask', 'delegation', 'review', 'system', 'buzz'] as const;

export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const conversationKindEnum = domain.enum('conversation_kind', CONVERSATION_KINDS);

export const CONVERSATION_STATES = ['open', 'awaiting_input', 'archived', 'deleted'] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const conversationStateEnum = domain.enum('conversation_state', CONVERSATION_STATES);

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const messageRoleEnum = domain.enum('message_role', MESSAGE_ROLES);

export const conversation = domain.table(
  'conversation',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    kind: conversationKindEnum('kind').notNull(),
    title: text('title'),
    state: conversationStateEnum('state').notNull().default('open'),

    /**
     * FRANK-§11.2 `SessionLineage`. A thread forked from another keeps its
     * ancestry so a delegated sub-conversation can be traced back to the ask
     * that produced it.
     */
    parentConversationId: uuid('parent_conversation_id'),
    rootConversationId: uuid('root_conversation_id'),

    /** The run this conversation drove, when it drove one (FRANK-§7.3). */
    runId: uuid('run_id'),
    workItemId: uuid('work_item_id').references(() => workItem.id, { onDelete: 'set null' }),

    /** FRANK-§2.3: strictest class of everything in the thread. */
    dataClass: dataClassEnum('data_class').notNull().default('private'),
    policyRef: jsonb('policy_ref').$type<VersionedRef>().notNull(),

    lastMessageAt: timestamp('last_message_at', { withTimezone: true, mode: 'date' }),
    messageCount: integer('message_count').notNull().default(0),

    version: integer('version').notNull().default(1),
  },
  (t) => [
    foreignKey({
      columns: [t.parentConversationId],
      foreignColumns: [t.id],
      name: 'conversation_parent_fk',
    }).onDelete('restrict'),
    index('conversation_cell_state_idx').on(t.cellId, t.state, t.lastMessageAt),
    index('conversation_root_idx').on(t.rootConversationId),
    index('conversation_work_item_idx').on(t.workItemId),
  ],
);

export const conversationParticipant = domain.table(
  'conversation_participant',
  {
    cellId: text('cell_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    participantKind: actorKindEnum('participant_kind').notNull(),
    participantId: text('participant_id').notNull(),
    role: text('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('conversation_participant_uidx').on(
      t.conversationId,
      t.participantKind,
      t.participantId,
    ),
  ],
);

export const conversationMessage = domain.table(
  'conversation_message',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    /** Monotonic within the conversation; the ordering key, not `created_at`. */
    seq: integer('seq').notNull(),

    role: messageRoleEnum('role').notNull(),
    authorKind: actorKindEnum('author_kind').notNull(),
    authorId: text('author_id').notNull(),

    /** FRANK-§15.7 envelope ciphertext. Never a plaintext body. */
    bodyEncrypted: text('body_encrypted').notNull(),
    /** HMAC-SHA256 blind index over the normalized body, for equality recall. */
    bodyBlindIndex: text('body_blind_index'),
    /** Version of the blind-index key used, so rotation can re-index. */
    bodyBlindIndexKeyVersion: integer('body_blind_index_key_version'),

    /** FRANK-§2.3: both axes on every message. Tool output is untrusted content. */
    dataClass: dataClassEnum('data_class').notNull(),
    trust: trustLabelEnum('trust').notNull(),

    /** FRANK-§19.2 telemetry: token counts are metadata, not content. */
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    modelRef: text('model_ref'),

    /** Tool call correlation, when `role = 'tool'`. */
    toolInvocationId: uuid('tool_invocation_id'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    correlationId: text('correlation_id').notNull(),
  },
  (t) => [
    uniqueIndex('conversation_message_seq_uidx').on(t.conversationId, t.seq),
    index('conversation_message_thread_idx').on(t.conversationId, t.createdAt),
    index('conversation_message_blind_idx').on(t.cellId, t.bodyBlindIndex),
  ],
);

/** FRANK-§11.2 `Attachment`. Bytes live in object storage (ADR-003). */
export const conversationAttachment = domain.table(
  'conversation_attachment',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => conversationMessage.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => source.id, { onDelete: 'restrict' }),
    uri: text('uri').notNull(),
    sha256: text('sha256').notNull(),
    mediaType: text('media_type'),
    bytes: integer('bytes'),
    dataClass: dataClassEnum('data_class').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('conversation_attachment_message_idx').on(t.messageId)],
);

/**
 * FRANK-§11.2 `Citation`. FRANK-§20 requires "correct timestamped citations",
 * so the locator is structured: a byte or character span for text, a media
 * offset for audio and video.
 */
export const conversationCitation = domain.table(
  'conversation_citation',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => conversationMessage.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'restrict' }),
    /** Which immutable version was cited; a later version may say something else. */
    sourceVersionId: uuid('source_version_id'),
    /** `{ kind: 'char', start, end } | { kind: 'media', startMs, endMs } | { kind: 'page', page }`. */
    locator: jsonb('locator').$type<Record<string, unknown>>().notNull(),
    quoteSha256: text('quote_sha256'),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('conversation_citation_message_idx').on(t.messageId, t.orderIndex),
    index('conversation_citation_source_idx').on(t.sourceId),
    uniqueIndex('conversation_citation_uidx').on(t.messageId, t.sourceId, sql`(locator::text)`),
  ],
);

export type ConversationRow = typeof conversation.$inferSelect;
export type ConversationMessageRow = typeof conversationMessage.$inferSelect;

/** Truthful, cross-surface read model for the Living Frame. */

import { z } from 'zod';

import { identifiersSchema } from './registry.js';
import { workItemSummarySchema } from './views.js';

const frameChatRunningSchema = z
  .object({
    kind: z.literal('chat'),
    id: z.string(),
    project_id: z.string(),
    agent: z.string(),
    title: z.string(),
    model: z.string(),
    thinking: z.string(),
    running: z.literal(true),
    last_message_at: z.string(),
  })
  .strict();

export const frameRunningSchema = frameChatRunningSchema;

const frameChatReceiptSchema = z
  .object({
    kind: z.literal('chat'),
    message_id: z.string(),
    conversation_id: z.string(),
    project_id: z.string(),
    body: z.string(),
    created_at: z.string(),
  })
  .strict();

export const frameReceiptSchema = frameChatReceiptSchema;

/** GET /v1/frame. Every field is a persisted fact read at request time. */
export const frameResponseSchema = z
  .object({
    /** Same work-item projection as GET /v1/work?state=waiting. */
    waiting: z.array(workItemSummarySchema),
    running: z.array(frameRunningSchema),
    receipts: z.array(frameReceiptSchema),
    generated_at: z.string().datetime({ offset: true }),
    identifiers: identifiersSchema,
  })
  .strict();

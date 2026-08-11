/** Truthful, cross-surface read model for the Living Frame. */

import { z } from 'zod';

import { identifiersSchema } from './registry.js';
import { workItemSummarySchema } from './views.js';

const frameWorkbenchRunningSchema = z
  .object({
    kind: z.literal('workbench'),
    id: z.string(),
    work_item_id: z.string(),
    room_id: z.string().nullable(),
    state: z.enum(['queued', 'provisioning', 'running', 'waiting', 'verifying']),
    updated_at: z.string(),
  })
  .strict();

const frameMissionRunningSchema = z
  .object({
    kind: z.literal('mission'),
    id: z.string(),
    room_id: z.string(),
    room_name: z.string(),
    objective: z.string(),
    state: z.enum(['planning', 'running', 'waiting']),
    updated_at: z.string(),
  })
  .strict();

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

export const frameRunningSchema = z.discriminatedUnion('kind', [
  frameWorkbenchRunningSchema,
  frameMissionRunningSchema,
  frameChatRunningSchema,
]);

const frameWorkbenchReceiptSchema = z
  .object({
    kind: z.literal('workbench'),
    workbench_id: z.string(),
    work_item_id: z.string(),
    room_id: z.string().nullable(),
    summary: z.string(),
    published_at: z.string(),
    published_by: z.string(),
  })
  .strict();

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

export const frameReceiptSchema = z.discriminatedUnion('kind', [
  frameWorkbenchReceiptSchema,
  frameChatReceiptSchema,
]);

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

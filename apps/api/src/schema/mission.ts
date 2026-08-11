/** Mission objective wire schemas. Snake case is confined to the API boundary. */

import { z } from 'zod';

import { identifiersSchema } from './registry.js';

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const POSTGRES_MONEY_EXCLUSIVE_MAX = 10_000_000_000_000_000;

export const missionBudgetInputSchema = z
  .object({
    spend_cap_usd: z.number().nonnegative().lt(POSTGRES_MONEY_EXCLUSIVE_MAX).optional(),
    token_budget: z.number().int().min(0).max(POSTGRES_INTEGER_MAX).optional(),
    wall_clock_sec: z.number().int().min(1).max(POSTGRES_INTEGER_MAX).optional(),
    max_attempts: z.number().int().min(1).max(POSTGRES_INTEGER_MAX).optional(),
  })
  .strict();

export const missionCreateBodySchema = z
  .object({
    command_id: z.string().trim().min(1),
    objective: z
      .string()
      .trim()
      .min(1, 'objective must not be empty')
      .max(12_000),
    title: z.string().trim().min(1).max(200).optional(),
    room_name: z.string().trim().min(1).max(120).optional(),
    budget: missionBudgetInputSchema.optional(),
  })
  .strict();

export const missionIdParamsSchema = z.object({ id: z.string().trim().min(1) }).strict();

export const missionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const missionStopBodySchema = z
  .object({
    command_id: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const missionStateSchema = z.enum([
  'planning',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);

export const missionBudgetSchema = z
  .object({
    spend_cap_usd: z.number().nonnegative(),
    token_budget: z.number().int().nonnegative(),
    wall_clock_sec: z.number().int().positive(),
    max_attempts: z.number().int().positive(),
  })
  .strict();

export const missionRecordSchema = z
  .object({
    id: z.string().min(1),
    room_id: z.string().min(1),
    room_name: z.string().min(1),
    objective: z.string().min(1),
    state: missionStateSchema,
    stop_new_work: z.boolean(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    completed_at: z.string().datetime({ offset: true }).nullable(),
    last_error: z.string().nullable(),
    budget: missionBudgetSchema,
  })
  .strict();

export const missionWorkGraphNodeSchema = z
  .object({
    work_item_id: z.string().min(1),
    title: z.string().min(1),
    state: z.string().min(1),
    depends_on: z.array(z.string().min(1)),
    workbench_id: z.string().min(1).nullable(),
    workbench_state: z.string().min(1).nullable(),
    attempts: z.number().int().nonnegative(),
    model_tier: z.enum(['cheap', 'strong']),
  })
  .strict();

export const missionResponseSchema = z
  .object({
    mission: missionRecordSchema,
    /** Public graph is deliberately a bare node array; planner prose is private. */
    work_graph: z.array(missionWorkGraphNodeSchema),
    identifiers: identifiersSchema,
  })
  .strict();

/** Lightweight mission collection; use GET /v1/missions/:id for its graph. */
export const missionListResponseSchema = z
  .object({
    missions: z.array(missionRecordSchema),
    identifiers: identifiersSchema,
  })
  .strict();

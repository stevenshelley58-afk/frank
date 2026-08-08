/**
 * Workbench wire schemas — WB-05..WB-09, frozen contract
 * `docs/plans/WORKBENCH_API_CONTRACT.md`.
 *
 * Snake_case at the boundary (FRANK-§12.3 convention, same as `views.ts`);
 * the internal TypeScript stays camelCase. A workbench is execution detail
 * for a canonical work item (master plan §3.1) — these shapes carry the
 * record plus its link to the work item, never a competing task state.
 */

import { z } from 'zod';

import { identifiersSchema } from './registry.js';

/* -------------------------------------------------------------- task def --- */

export const workbenchMountSchema = z
  .object({
    source: z.string().min(1),
    path: z.string().min(1),
    mode: z.enum(['ro', 'rw', 'staged']),
  })
  .strict();

export const workbenchHarnessSpecSchema = z
  .object({
    adapter: z.string().min(1),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

export const workbenchLeashSchema = z
  .object({
    wall_clock_sec: z.number().int().positive().optional(),
    token_budget: z.number().int().positive().optional(),
    spend_cap_usd: z.number().positive().optional(),
  })
  .strict();

export const workbenchNetworkSchema = z
  .object({
    egress_allowlist: z.array(z.string().min(1)).readonly().optional(),
  })
  .strict();

/** Master plan §4.2 `taskDef`, wire-shaped. */
export const workbenchTaskDefSchema = z
  .object({
    instruction: z.string().min(12, 'instruction must be a concrete task of at least 12 characters'),
    mounts: z.array(workbenchMountSchema).readonly().optional(),
    harness: workbenchHarnessSpecSchema.optional(),
    skills: z.array(z.string().min(1)).readonly().optional(),
    leash: workbenchLeashSchema.optional(),
    network: workbenchNetworkSchema.optional(),
  })
  .strict();

/* ------------------------------------------------------------- create body --- */

/**
 * POST /v1/workbenches body: the task def plus the delegation context Frank
 * needs to file the work item (room, title). `command_id` doubles as the
 * idempotency key (FRANK-§12.1); the `Idempotency-Key` header is the alias
 * and must agree when both are sent (route-handler resolves that).
 */
export const workbenchCreateBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    room_id: z.string().min(1).optional(),
    /** Human-facing work-item title; defaults to the instruction's first line. */
    title: z.string().min(1).max(200).optional(),
    task_def: workbenchTaskDefSchema,
  })
  .strict();

/* ------------------------------------------------------------ record view --- */

export const workbenchStateSchema = z.enum([
  'queued',
  'provisioning',
  'running',
  'waiting',
  'verifying',
  'done',
  'failed',
  'cancelled',
]);

export const workbenchRecordSchema = z
  .object({
    id: z.string(),
    cell_id: z.string(),
    work_item_id: z.string(),
    room_id: z.string().nullable(),
    idempotency_key: z.string(),
    task_def: workbenchTaskDefSchema,
    state: workbenchStateSchema,
    attempts: z.number().int(),
    container_id: z.string().nullable(),
    schedule: z
      .object({ cron: z.string(), tz: z.string() })
      .nullable(),
    version: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    last_error: z.string().nullable(),
  })
  .strict();

export const workbenchCreateResponseSchema = z
  .object({
    workbench: workbenchRecordSchema,
    /** False when the idempotency key was already seen (replay). */
    created: z.boolean(),
    identifiers: identifiersSchema,
  })
  .strict();

/* ----------------------------------------------------------------- detail --- */

export const workbenchPlanStepSchema = z
  .object({
    seq: z.number().int(),
    step: z.string(),
    state: z.enum(['pending', 'doing', 'done', 'failed', 'skipped']),
    note: z.string().nullable(),
    updated_at: z.string(),
  })
  .strict();

export const workbenchReceiptSchema = z
  .object({
    summary: z.string(),
    assumptions: z.array(z.string()),
    evidence: z.array(z.unknown()),
    published_at: z.string(),
    published_by: z.string(),
  })
  .strict();

export const workbenchDetailResponseSchema = z
  .object({
    workbench: workbenchRecordSchema,
    plan: z.array(workbenchPlanStepSchema),
    receipt: workbenchReceiptSchema.nullable(),
    identifiers: identifiersSchema,
  })
  .strict();

export const workbenchIdParamsSchema = z
  .object({ id: z.string().min(1) })
  .strict();

/* -------------------------------------------------------------- WB-07 stop --- */

/** POST /v1/workbenches/:id/stop body (frozen contract: `{ reason }`). */
export const workbenchStopBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const workbenchStopResponseSchema = z
  .object({
    /** 'live-run' = a runner's leash handled it; 'durable' = written to Postgres. */
    via: z.enum(['live-run', 'durable']),
    workbench_id: z.string(),
    work_item_id: z.string(),
    state: z.literal('cancelled'),
    identifiers: identifiersSchema,
  })
  .strict();

/* ------------------------------------------------- HITL-01 decision seam --- */

/**
 * POST /v1/workbenches/:id/decisions body (frozen contract):
 * `{ question, whyNow, nextSafeAction, evidence[] }`.
 */
export const workbenchDecisionBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    question: z.string().min(1).max(2000),
    why_now: z.string().min(1).max(1000).optional(),
    next_safe_action: z.string().min(1).max(1000).optional(),
    evidence: z.array(z.string().min(1).max(2000)).max(20).optional(),
  })
  .strict();

export const workbenchDecisionResponseSchema = z
  .object({
    /** The decision work item (a normal ADR-022 approval in `waiting`). */
    decision_work_item_id: z.string(),
    workbench_id: z.string(),
    workbench_state: z.literal('waiting'),
    identifiers: identifiersSchema,
  })
  .strict();

/* ------------------------------------------------ WB-08 artifacts/receipt --- */

/** POST /v1/workbenches/:id/artifacts body (master plan §4.2 artifact shape). */
export const workbenchArtifactBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    path: z.string().min(1).max(2000),
    kind: z.string().min(1).max(100),
    preview_url: z.string().url().max(2000).optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    media_type: z.string().max(200).optional(),
  })
  .strict();

export const workbenchArtifactResponseSchema = z
  .object({
    artifact_id: z.string(),
    workbench_id: z.string(),
    path: z.string(),
    identifiers: identifiersSchema,
  })
  .strict();

/* --------------------------------------------------------- room workbenches --- */

export const workbenchRoomParamsSchema = z
  .object({ roomId: z.string().min(1) })
  .strict();

export const workbenchRoomListResponseSchema = z
  .object({
    workbenches: z.array(workbenchRecordSchema),
    identifiers: identifiersSchema,
  })
  .strict();

/* ---------------------------------------------- FS-05 preview + room files --- */

/**
 * POST /v1/workbenches/:id/artifacts/:artifactId/preview params
 * (FS-05): the workbench plus the artifact row to publish a preview for.
 */
export const workbenchArtifactPreviewParamsSchema = z
  .object({ id: z.string().min(1), artifactId: z.string().min(1) })
  .strict();

/** FS-05 publish-preview body. Empty body is valid (pure trigger). */
export const workbenchArtifactPreviewBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
  })
  .strict();

/**
 * FS-05 publish-preview response: the preview URL written back to the
 * artifact row (null when the artifact is not viewable, i.e. not
 * auto-deployable), plus the classification that decided it.
 */
export const workbenchArtifactPreviewResponseSchema = z
  .object({
    artifact_id: z.string(),
    workbench_id: z.string(),
    path: z.string(),
    preview_url: z.string().url().nullable(),
    classification: z.enum(['html', 'mockup', 'report', 'other']),
    slug: z.string().nullable(),
    identifiers: identifiersSchema,
  })
  .strict();

/** One entry of the FS-05 room Files listing. */
export const roomFileSchema = z
  .object({
    artifact_id: z.string(),
    workbench_id: z.string(),
    workbench_state: z.string(),
    path: z.string(),
    kind: z.string(),
    preview_url: z.string().url().nullable(),
    created_at: z.string(),
  })
  .strict();

/** GET /v1/rooms/:roomId/files response (FS-05). */
export const roomFilesResponseSchema = z
  .object({
    files: z.array(roomFileSchema),
    identifiers: identifiersSchema,
  })
  .strict();

/* ---------------------------------------------- WB-08 reopen-with-note --- */

/**
 * POST /v1/workbenches/:id/reopen body — Central reopens a `done` workbench
 * with a note rather than silently accepting bad output (master plan §8D
 * WB-08). Moves the run back to `verifying` so it can be re-run or re-reviewed.
 */
export const workbenchReopenBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    note: z.string().min(1).max(2000),
  })
  .strict();

export const workbenchReopenResponseSchema = z
  .object({
    workbench_id: z.string(),
    workbench_state: z.literal('verifying'),
    identifiers: identifiersSchema,
  })
  .strict();

/* ------------------------------------------- FS-03 staged shared writes --- */

/**
 * POST /v1/workbenches/:id/staged-writes body (FS-03): a staged-mounted
 * folder proposes to write its copy back to the shared source. The proposal
 * files a NORMAL decision work item (ADR-022) — nothing lands until that
 * decision resolves `ready` through the command envelope.
 */
export const workbenchStagedWriteBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    room_id: z.string().min(1),
    /** The synced folder's id/name (FS-01) bound to the room as `staged`. */
    folder_source: z.string().min(1).max(200),
    /** Where the run's copy lives (VPS path) that approval would land. */
    staged_copy_path: z.string().min(2).max(500),
    /** The proposer's note for the approver (WORK-006 "why now"). */
    note: z.string().min(1).max(2000).optional(),
  })
  .strict();

export const workbenchStagedWriteResponseSchema = z
  .object({
    staged_write_id: z.string(),
    /** The ADR-022 decision that approves the write (a normal approval). */
    decision_work_item_id: z.string(),
    workbench_id: z.string(),
    workbench_state: z.literal('waiting'),
    identifiers: identifiersSchema,
  })
  .strict();

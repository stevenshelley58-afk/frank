/**
 * Write-back queue wire schemas — FS-04 (master plan §8G FS-04).
 *
 * Snake_case at the boundary (FRANK-§12.3 convention, same as
 * `folder-binding.ts`); the internal TypeScript stays camelCase. A
 * `pending_sync` row is a RECORD of what a landed, approved write-back means
 * for the destination device — waiting to sync, or recorded as a conflict.
 * Nothing here syncs anything: the physical transport is FS-01/Syncthing.
 */

import { z } from 'zod';

import { identifiersSchema } from './registry.js';

/* --------------------------------------------------------------- params --- */

export const pendingSyncRoomParamsSchema = z
  .object({ roomId: z.string().min(1) })
  .strict();

/* ------------------------------------------------------------ vocabulary --- */

/** The queue entry's state (migration 0009 CHECK constraint). */
export const pendingSyncStateSchema = z.enum(['pending', 'synced', 'conflict']);

/** Why the entry exists — an honest note, not a status. */
export const pendingSyncReasonSchema = z.enum([
  'device-offline',
  'device-online',
  'target-changed-on-device',
]);

/* ------------------------------------------------------------- record view --- */

export const pendingSyncRecordSchema = z
  .object({
    id: z.string(),
    cell_id: z.string(),
    workbench_id: z.string(),
    room_id: z.string(),
    folder_source: z.string(),
    binding_id: z.string(),
    staged_write_id: z.string(),
    source_path: z.string(),
    target_path: z.string(),
    state: pendingSyncStateSchema,
    reason: pendingSyncReasonSchema,
    detail: z.string().nullable(),
    proposed_at: z.string(),
    proposed_by: z.string(),
    synced_at: z.string().nullable(),
    synced_by: z.string().nullable(),
  })
  .strict();

/* ------------------------------------------------------------- responses --- */

export const pendingSyncListResponseSchema = z
  .object({
    pending_syncs: z.array(pendingSyncRecordSchema),
    identifiers: identifiersSchema,
  })
  .strict();

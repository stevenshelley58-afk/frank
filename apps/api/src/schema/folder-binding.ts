/**
 * Room folder-binding wire schemas — FS-02 (master plan §8G, docs/plans/
 * FS_PREP.md).
 *
 * Snake_case at the boundary (FRANK-§12.3 convention, same as `workbench.ts`);
 * the internal TypeScript stays camelCase. A binding is a *declaration* — the
 * mount enforcement FS-03 reads these values; nothing here mounts anything.
 */

import { z } from 'zod';

import { identifiersSchema } from './registry.js';

/* ------------------------------------------------------------ vocabulary --- */

/** FS_PREP §5 direction vocabulary, wire form. */
export const folderSyncDirectionSchema = z.enum(['send-only', 'receive-only', 'bidirectional']);

/** The workbench mount mode FS-03 will enforce. */
export const folderMountModeSchema = z.enum(['ro', 'rw', 'staged']);

/* ------------------------------------------------------------- params --- */

export const folderBindingRoomParamsSchema = z
  .object({ roomId: z.string().min(1) })
  .strict();

export const folderBindingIdParamsSchema = z
  .object({
    roomId: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

/* ------------------------------------------------------------------ body --- */

/**
 * POST /v1/rooms/:roomId/folder-bindings body. `command_id` doubles as the
 * idempotency key (FRANK-§12.1); the `Idempotency-Key` header is the alias and
 * must agree when both are sent (route-handler resolves that). The binding is
 * idempotent on its natural key `(room, folder_source)` as well: a re-bind
 * updates the existing declaration rather than creating a second row.
 */
export const folderBindingCreateBodySchema = z
  .object({
    command_id: z.string().min(8).max(128).optional(),
    /** The synced folder's id/name on the source device (FS-01 folder model). */
    folder_source: z.string().min(1).max(200),
    /** The folder's path on the VPS; the mount source FS-03 binds into runs. */
    server_path: z.string().min(2).max(500),
    sync_direction: folderSyncDirectionSchema,
    mount_mode: folderMountModeSchema,
    /** FS-04: write-back is opt-in per folder; default false. */
    write_back: z.boolean().default(false),
  })
  .strict();

/* ------------------------------------------------------------ record view --- */

export const folderBindingRecordSchema = z
  .object({
    id: z.string(),
    cell_id: z.string(),
    room_id: z.string(),
    folder_source: z.string(),
    server_path: z.string(),
    sync_direction: folderSyncDirectionSchema,
    mount_mode: folderMountModeSchema,
    write_back: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

/* ------------------------------------------------------------- responses --- */

export const folderBindingCreateResponseSchema = z
  .object({
    binding: folderBindingRecordSchema,
    /** False when the (room, folder_source) binding already existed (re-bind). */
    created: z.boolean(),
    identifiers: identifiersSchema,
  })
  .strict();

export const folderBindingListResponseSchema = z
  .object({
    bindings: z.array(folderBindingRecordSchema),
    identifiers: identifiersSchema,
  })
  .strict();

export const folderBindingRevokeResponseSchema = z
  .object({
    binding_id: z.string(),
    room_id: z.string(),
    revoked: z.boolean(),
    identifiers: identifiersSchema,
  })
  .strict();

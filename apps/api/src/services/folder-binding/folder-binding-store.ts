/**
 * RoomFolderBindingStore — the PostgreSQL persistence for room folder bindings.
 *
 * A folder binding declares, per room, that a synced folder (FS-01) is attached
 * to the room's workbenches: which folder source on the device, its path on the
 * VPS, the sync direction, the workbench mount mode FS-03 will enforce, and the
 * FS-04 write-back opt-in. This store is the one place that knows the
 * `frank_domain.room_folder_binding` column names — the same role
 * {@link WorkbenchStore} plays for the workbench tables. Raw SQL via drizzle's
 * `sql` template because 0006 is hand-written (like 0003/0004) and has no
 * generated drizzle projection.
 *
 * ## What the database enforces here, not this file
 *
 *  - One binding per (cell, room, folder source): the
 *    `room_folder_binding_cell_room_source_uidx` unique constraint (migration
 *    0006). {@link upsertBinding} is INSERT ... ON CONFLICT DO UPDATE on exactly
 *    that constraint, so re-binding the same folder source in the same room
 *    updates the declaration instead of creating a second row — FS-02's
 *    idempotent re-bind.
 *  - Sync direction and mount mode vocabularies: the CHECK constraints of 0006.
 *
 * ## Mount enforcement is out of scope here (FS-03)
 *
 * This store only records declarations. The runner/provisioner reads them when
 * composing mounts; nothing in this file mounts or restricts anything.
 */

import { sql } from 'drizzle-orm';

import type { FrankDatabase } from '@frank/adapter-postgres';

/* --------------------------------------------------------------- types --- */

/** FS_PREP §5 direction vocabulary, wire form (matches the zod schema). */
export type FolderSyncDirection = 'send-only' | 'receive-only' | 'bidirectional';

/** The workbench mount mode FS-03 enforces. */
export type FolderMountMode = 'ro' | 'rw' | 'staged';

export interface RoomFolderBindingRecord {
  readonly id: string;
  readonly cellId: string;
  readonly roomId: string;
  /** The synced folder's id/name on the source device (FS-01 folder model). */
  readonly folderSource: string;
  /** The folder's path on the VPS; the mount source FS-03 binds into runs. */
  readonly serverPath: string;
  readonly syncDirection: FolderSyncDirection;
  readonly mountMode: FolderMountMode;
  /** FS-04: write-back is opt-in per folder; default false. */
  readonly writeBack: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UpsertBindingInput {
  readonly id: string;
  readonly cellId: string;
  readonly roomId: string;
  readonly folderSource: string;
  readonly serverPath: string;
  readonly syncDirection: FolderSyncDirection;
  readonly mountMode: FolderMountMode;
  readonly writeBack: boolean;
  /** FRANK-§11.5 audit attribution (`user/<id>`, `agent/<id>`, `service/<id>`). */
  readonly actor: string;
  readonly now: Date;
}

export interface UpsertBindingResult {
  readonly record: RoomFolderBindingRecord;
  /** True when this call inserted the row; false when it updated an existing one. */
  readonly created: boolean;
}

/* ------------------------------------------------------------ row mapping --- */

/**
 * `type` (not `interface`) because drizzle's `execute<T>` constrains T to
 * `Record<string, unknown>`, which only object-literal-shaped types satisfy
 * (same convention as `workbench/store.ts`).
 */
type BindingRow = {
  id: string;
  cell_id: string;
  room_id: string;
  folder_source: string;
  server_path: string;
  sync_direction: FolderSyncDirection;
  mount_mode: FolderMountMode;
  write_back: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * The raw-SQL `execute` path returns `timestamptz` columns as ISO strings on
 * some driver configurations. Funnel every mapping through here (same
 * convention as `workbench/store.ts`).
 */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toRecord(row: BindingRow): RoomFolderBindingRecord {
  return {
    id: row.id,
    cellId: row.cell_id,
    roomId: row.room_id,
    folderSource: row.folder_source,
    serverPath: row.server_path,
    syncDirection: row.sync_direction,
    mountMode: row.mount_mode,
    writeBack: row.write_back,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

/* ------------------------------------------------------------------ store --- */

export class RoomFolderBindingStore {
  constructor(private readonly db: FrankDatabase) {}

  /**
   * Idempotent binding creation (FS-02): the unique constraint on
   * `(cell_id, room_id, folder_source)` means a re-bind of the same folder
   * source in the same room updates the existing declaration and reports
   * `created: false`, never a second row. `xmax = 0` distinguishes the fresh
   * INSERT from the conflict UPDATE on the same RETURNING path.
   */
  async upsertBinding(input: UpsertBindingInput): Promise<UpsertBindingResult> {
    const rows = await this.db.execute<BindingRow & { created: boolean }>(sql`
      insert into "frank_domain"."room_folder_binding"
        (id, cell_id, room_id, folder_source, server_path,
         created_at, updated_at, created_by, updated_by,
         sync_direction, mount_mode, write_back)
      values (${input.id}, ${input.cellId}, ${input.roomId}, ${input.folderSource}, ${input.serverPath},
              ${input.now}, ${input.now}, ${input.actor}, ${input.actor},
              ${input.syncDirection}, ${input.mountMode}, ${input.writeBack})
      on conflict ("cell_id", "room_id", "folder_source") do update set
        "server_path" = excluded."server_path",
        "sync_direction" = excluded."sync_direction",
        "mount_mode" = excluded."mount_mode",
        "write_back" = excluded."write_back",
        "updated_at" = excluded."updated_at",
        "updated_by" = excluded."updated_by"
      returning *, (xmax = 0) as created
    `);
    const row = rows.rows[0];
    if (row === undefined) {
      // Unreachable: RETURNING always yields the row; guard for type narrowing.
      throw new Error('room_folder_binding upsert returned no row');
    }
    return { record: toRecord(row), created: row.created };
  }

  /** Every binding for the room, newest first (GET /v1/rooms/:roomId/folder-bindings). */
  async listByRoom(cellId: string, roomId: string): Promise<RoomFolderBindingRecord[]> {
    const rows = await this.db.execute<BindingRow>(sql`
      select id, cell_id, room_id, folder_source, server_path,
             sync_direction, mount_mode, write_back, created_at, updated_at
      from "frank_domain"."room_folder_binding"
      where "cell_id" = ${cellId} and "room_id" = ${roomId}
      order by "created_at" desc, "id" desc
    `);
    return rows.rows.map(toRecord);
  }

  /** One binding by id, scoped to the cell; null when absent. */
  async get(cellId: string, id: string): Promise<RoomFolderBindingRecord | null> {
    const rows = await this.db.execute<BindingRow>(sql`
      select id, cell_id, room_id, folder_source, server_path,
             sync_direction, mount_mode, write_back, created_at, updated_at
      from "frank_domain"."room_folder_binding"
      where "cell_id" = ${cellId} and "id" = ${id}
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /**
   * Delete one binding (FS-02 revoke). Returns the deleted record, or null
   * when no such binding exists in the cell (the route maps that to 404).
   */
  async revoke(cellId: string, id: string): Promise<RoomFolderBindingRecord | null> {
    const rows = await this.db.execute<BindingRow>(sql`
      delete from "frank_domain"."room_folder_binding"
      where "cell_id" = ${cellId} and "id" = ${id}
      returning id, cell_id, room_id, folder_source, server_path,
                sync_direction, mount_mode, write_back, created_at, updated_at
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }
}

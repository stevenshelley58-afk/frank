-- FS-02 — room folder bindings (master plan §8G FS-02, docs/plans/FS_PREP.md).
--
-- A folder binding declares, per room, that a synced folder (FS-01 Syncthing
-- model: `/srv/frank/sync/<room-id>/<folder>` on the VPS) is attached to the
-- room's workbenches. Each row carries the whole declaration FS-02 fixes:
--
--   folder_source   the synced folder's id/name (the source on the device)
--   server_path     the folder's path on the VPS (the mount source FS-03 binds)
--   sync_direction  'send-only' | 'receive-only' | 'bidirectional'
--                   (FS_PREP default: PC send-only / VPS receive-only)
--   mount_mode      'ro' | 'rw' | 'staged' — the workbench mount mode FS-03
--                   enforces; 'staged' means writes land as a staged copy plus
--                   a decision work item (ADR-022) before anything lands.
--   write_back      per-folder write-back opt-in (FS-04). Default false: a
--                   workbench never writes back to a device copy unless this
--                   row says so.
--
-- ## Records and API only (FS-02 scope)
--
-- Mount ENFORCEMENT is FS-03's job: this table is the declaration, and the
-- runner/provisioner reads it when composing mounts. Nothing in this migration
-- touches the workbench tables.
--
-- ## At most one binding per (cell, room, folder)
--
-- `room_folder_binding_cell_room_source_uidx` makes the binding idempotent on
-- its natural key: re-binding the same folder source in the same room is an
-- UPDATE of the existing declaration, never a second row. The API's upsert is
-- INSERT ... ON CONFLICT on exactly this constraint.
--
-- ## Linkage conventions (see 0004)
--
-- Rooms are not canonical PostgreSQL tables (they live in the
-- web/collaboration layer), so `room_id` is text with no FK — the same
-- convention 0004 uses for `workbench.room_id` and 0003 for
-- `brain_entry.room_id`. `folder_source` names a synced folder by id/name; the
-- Syncthing folder registry itself lives on the VPS (FS-01), not in Postgres.
--
-- ## Identifiers
--
-- FRANK-§11.1: `id` is minted by the caller (UUIDv7 via
-- adapters/storage/postgres ids.ts), never by a column default.

CREATE TABLE "frank_domain"."room_folder_binding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	-- The room this binding belongs to (text, not an FK — see header).
	"room_id" text NOT NULL,
	-- The synced folder's id/name on the source device (FS-01 folder model).
	"folder_source" text NOT NULL,
	-- The folder's path on the VPS; the mount source FS-03 binds into runs.
	"server_path" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	-- FS_PREP §5 direction vocabulary, normalised to the wire form.
	"sync_direction" text NOT NULL,
	-- The workbench mount mode FS-03 enforces ('staged' = staged copy +
	-- decision work item before a shared write lands).
	"mount_mode" text NOT NULL,
	-- FS-04 write-back is opt-in per folder; default false.
	"write_back" boolean DEFAULT false NOT NULL,
	CONSTRAINT "room_folder_binding_sync_direction_valid" CHECK ("sync_direction" in ('send-only','receive-only','bidirectional')),
	CONSTRAINT "room_folder_binding_mount_mode_valid" CHECK ("mount_mode" in ('ro','rw','staged'))
);--> statement-breakpoint

-- One binding per (cell, room, folder source): the natural key of the
-- declaration, and the conflict target the API's upsert relies on (FS-02).
ALTER TABLE "frank_domain"."room_folder_binding" ADD CONSTRAINT "room_folder_binding_cell_room_source_uidx" UNIQUE ("cell_id", "room_id", "folder_source");--> statement-breakpoint

-- The list-by-room query (GET /v1/rooms/:roomId/folder-bindings).
CREATE INDEX "room_folder_binding_room_idx" ON "frank_domain"."room_folder_binding" USING btree ("cell_id", "room_id", "created_at");

-- ---------------------------------------------------------------------------
-- ROLLBACK (per WB-01 rule: migrations include rollback instructions)
--
-- Reverse order, one statement each; then remove this file and the
-- `0007_room_folder_binding` entry from migrations/meta/_journal.json:
--
--   DROP INDEX "frank_domain"."room_folder_binding_room_idx";
--   ALTER TABLE "frank_domain"."room_folder_binding" DROP CONSTRAINT "room_folder_binding_cell_room_source_uidx";
--   DROP TABLE "frank_domain"."room_folder_binding";
-- ---------------------------------------------------------------------------

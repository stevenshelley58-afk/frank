-- FS-04 — write-back and offline behavior (master plan §8G FS-04).
--
-- The plan's clarification: "A workbench can continue with the server copy
-- while the laptop is closed. Results sync back when the PC reconnects. The
-- plan must not claim live write-back to an offline device."
--
-- When an APPROVED staged write (migration 0008) lands into a shared folder
-- whose binding opted into write-back (`room_folder_binding.write_back`,
-- FS-02), the landing always succeeds on the VPS — the server copy is where
-- the staged copy lands. What happens next depends on the destination PC:
--
--   * PC offline (the normal "laptop closed" case): the result is recorded
--     here as a `pending_sync` row (state 'pending', reason 'device-offline')
--     and the workbench completes NORMALLY. Nothing failed; the result is
--     waiting to sync. FS-01/Syncthing drains the queue when the PC
--     reconnects (WriteBackService.markSynced is that seam).
--   * Conflict: if the write-back would overwrite a file that CHANGED on the
--     device, the row is recorded state 'conflict' instead — no destructive
--     auto-override, ever. A conflict row is never auto-synced.
--   * PC online: the row is still recorded (state 'pending', reason
--     'device-online') because the physical transport is FS-01/Syncthing,
--     not this API; the row is the honest work item the syncer drains.
--
-- Columns:
--
--   workbench_id      the run whose approved write produced this queue entry
--                     (cascades: a dropped workbench drops its queue entries)
--   room_id           the room the target folder is bound to
--   folder_source     the synced folder's id/name (FS-01) being written back
--   binding_id        the room_folder_binding that authorised write-back
--                     (restrict: never drop a binding out from under a queue)
--   staged_write_id   the landed staged write this entry syncs (unique:
--                     one queue entry per landed write — replaying the
--                     resolution cannot mint a second entry)
--   source_path       the landed server copy the sync transfers FROM
--   target_path       the binding's server_path captured at landing time —
--                     the destination the device syncs TO
--   state             'pending' -> 'synced' (PC reconnected) | 'conflict'
--   reason            why the entry exists: 'device-offline' |
--                     'device-online' | 'target-changed-on-device'
--
-- ## Identifiers
--
-- FRANK-§11.1: `id` is minted by the caller (UUIDv7 via
-- adapters/storage/postgres ids.ts), never by a column default.
CREATE TABLE "frank_domain"."pending_sync" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"workbench_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"folder_source" text NOT NULL,
	"binding_id" uuid NOT NULL,
	"staged_write_id" uuid NOT NULL,
	"source_path" text NOT NULL,
	"target_path" text NOT NULL,
	"state" text NOT NULL,
	-- Why the entry exists (see header): an honest note, not a status.
	"reason" text NOT NULL,
	-- Free-form honesty: e.g. the conflict detail or a probe degradation note.
	"detail" text,
	"proposed_at" timestamp with time zone NOT NULL,
	"proposed_by" text NOT NULL,
	-- NULL until FS-01 sync drains the entry (markSynced).
	"synced_at" timestamp with time zone,
	"synced_by" text,
	CONSTRAINT "pending_sync_state_valid" CHECK ("state" in ('pending','synced','conflict'))
);--> statement-breakpoint

ALTER TABLE "frank_domain"."pending_sync" ADD CONSTRAINT "pending_sync_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "frank_domain"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."pending_sync" ADD CONSTRAINT "pending_sync_binding_id_room_folder_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "frank_domain"."room_folder_binding"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."pending_sync" ADD CONSTRAINT "pending_sync_staged_write_id_staged_write_id_fk" FOREIGN KEY ("staged_write_id") REFERENCES "frank_domain"."staged_write"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- One queue entry per landed staged write: replaying a resolution must not
-- mint a second entry (WriteBackService upserts on exactly this constraint).
CREATE UNIQUE INDEX "pending_sync_staged_write_uidx" ON "frank_domain"."pending_sync" USING btree ("staged_write_id");--> statement-breakpoint
-- The list-by-room query (GET /v1/rooms/:roomId/pending-syncs).
CREATE INDEX "pending_sync_room_idx" ON "frank_domain"."pending_sync" USING btree ("cell_id", "room_id", "state", "proposed_at");--> statement-breakpoint
-- The list-by-workbench query (a run's outstanding write-back queue).
CREATE INDEX "pending_sync_workbench_idx" ON "frank_domain"."pending_sync" USING btree ("cell_id", "workbench_id", "proposed_at");

-- ---------------------------------------------------------------------------
-- ROLLBACK (per WB-01 rule: migrations include rollback instructions)
--
-- Reverse order, one statement each; then remove this file and the
-- `0009_pending_sync` entry from migrations/meta/_journal.json:
--
--   DROP INDEX "frank_domain"."pending_sync_workbench_idx";
--   DROP INDEX "frank_domain"."pending_sync_room_idx";
--   DROP INDEX "frank_domain"."pending_sync_staged_write_uidx";
--   ALTER TABLE "frank_domain"."pending_sync" DROP CONSTRAINT "pending_sync_staged_write_id_staged_write_id_fk";
--   ALTER TABLE "frank_domain"."pending_sync" DROP CONSTRAINT "pending_sync_binding_id_room_folder_binding_id_fk";
--   ALTER TABLE "frank_domain"."pending_sync" DROP CONSTRAINT "pending_sync_workbench_id_workbench_id_fk";
--   DROP TABLE "frank_domain"."pending_sync";
-- ---------------------------------------------------------------------------

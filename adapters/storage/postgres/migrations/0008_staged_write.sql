-- FS-03 — staged shared writes (master plan §8G FS-03, §3.2 filesystem fence).
--
-- A workbench whose room folder binding is `mount_mode = 'staged'` never
-- writes to the shared source directly: WB-03's provisioner copy-ins the
-- source into the scratch volume and never bind-mounts it, so the run can
-- only edit the copy. When the run wants its edits to LAND in the shared
-- source, the control plane records the proposal here and files a NORMAL
-- decision work item (ADR-022, HITL-01 shape). Only after that decision is
-- resolved `ready` through the normal command envelope does the controlled
-- copy (staged copy -> shared source) happen — outside the harness, fully
-- audited.
--
--   workbench_id          the proposing run (cascades: a dropped workbench
--                         takes its staged-write proposals with it)
--   room_id               the room the target folder is bound to
--   folder_source         the synced folder's id/name (FS-01) being written
--   binding_id            the room_folder_binding declaration that authorises
--                         this folder at all (restrict: never drop a binding
--                         out from under a staged-write record)
--   staged_copy_path      where the approved copy lives (VPS path)
--   target_path           the binding's server_path captured at propose time —
--                         the landing destination in the shared source
--   decision_work_item_id the ADR-022 decision that approves/denies the write
--                         (unique: one staged write per decision, one open
--                         decision per workbench already holds upstream)
--   state                 'pending' -> 'landed' (ready) | 'denied' (cancel)
--
-- ## Why a table and not just the decision item
--
-- The decision work item is the approval; this row is the FILESYSTEM fact:
-- which copy lands where, and whether it did. `landed_at`/`landed_by` are
-- the landing receipt; the audit chain entries (FRANK-§11.5) reference this
-- row's id as their target.
--
-- ## Identifiers
--
-- FRANK-§11.1: `id` is minted by the caller (UUIDv7 via
-- adapters/storage/postgres ids.ts), never by a column default.

CREATE TABLE "frank_domain"."staged_write" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"workbench_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"folder_source" text NOT NULL,
	"binding_id" uuid NOT NULL,
	"staged_copy_path" text NOT NULL,
	"target_path" text NOT NULL,
	-- The proposer's note for the approver (WORK-006 "why now" rides on the
	-- decision item itself; this is the folder-specific context).
	"note" text,
	"decision_work_item_id" uuid NOT NULL,
	"state" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"proposed_by" text NOT NULL,
	-- NULL until the decision resolves.
	"landed_at" timestamp with time zone,
	"landed_by" text,
	CONSTRAINT "staged_write_state_valid" CHECK ("state" in ('pending','landed','denied'))
);--> statement-breakpoint

ALTER TABLE "frank_domain"."staged_write" ADD CONSTRAINT "staged_write_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "frank_domain"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."staged_write" ADD CONSTRAINT "staged_write_binding_id_room_folder_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "frank_domain"."room_folder_binding"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."staged_write" ADD CONSTRAINT "staged_write_decision_work_item_id_work_item_id_fk" FOREIGN KEY ("decision_work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- One staged write per decision item (the resolution path looks the write up
-- by decision_work_item_id; uniqueness keeps that lookup total).
CREATE UNIQUE INDEX "staged_write_decision_uidx" ON "frank_domain"."staged_write" USING btree ("decision_work_item_id");--> statement-breakpoint
-- The list-by-workbench query (a run's outstanding staged writes).
CREATE INDEX "staged_write_workbench_idx" ON "frank_domain"."staged_write" USING btree ("cell_id", "workbench_id", "proposed_at");

-- ---------------------------------------------------------------------------
-- ROLLBACK (per WB-01 rule: migrations include rollback instructions)
--
-- Reverse order, one statement each; then remove this file and the
-- `0008_staged_write` entry from migrations/meta/_journal.json:
--
--   DROP INDEX "frank_domain"."staged_write_workbench_idx";
--   DROP INDEX "frank_domain"."staged_write_decision_uidx";
--   ALTER TABLE "frank_domain"."staged_write" DROP CONSTRAINT "staged_write_decision_work_item_id_work_item_id_fk";
--   ALTER TABLE "frank_domain"."staged_write" DROP CONSTRAINT "staged_write_binding_id_room_folder_binding_id_fk";
--   ALTER TABLE "frank_domain"."staged_write" DROP CONSTRAINT "staged_write_workbench_id_workbench_id_fk";
--   DROP TABLE "frank_domain"."staged_write";
-- ---------------------------------------------------------------------------

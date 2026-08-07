-- CH-06 — canonical room↔channel bindings (master plan §8E CH-06).
--
-- Frank OWNS the binding (§ChannelPort contract: "Frank owns the binding; the
-- surface only observes"). The channels-listener reads these rows (via the
-- Domain API) to know which rooms route to which platform conversations.
-- Bindings are control-plane state: durable, audited, revocable.
--
-- One binding per (cell, room, platform): re-binding the same room+platform
-- replaces the conversation (upsert at the API layer). Revocation sets
-- revoked_at — a revoked binding routes nothing (CH-05/adapter rule).

CREATE TABLE "frank_domain"."room_channel_binding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"room_id" text NOT NULL,
	"platform" text NOT NULL,
	"platform_conversation_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL
);--> statement-breakpoint

-- One live binding per (cell, room, platform).
CREATE UNIQUE INDEX "room_channel_binding_uidx" ON "frank_domain"."room_channel_binding" USING btree ("cell_id", "room_id", "platform");--> statement-breakpoint
CREATE INDEX "room_channel_binding_room_idx" ON "frank_domain"."room_channel_binding" USING btree ("cell_id", "room_id");

-- ---------------------------------------------------------------------------
-- ROLLBACK (per WB-01 rule: migrations include rollback instructions)
--
--   DROP INDEX "frank_domain"."room_channel_binding_room_idx";
--   DROP INDEX "frank_domain"."room_channel_binding_uidx";
--   DROP TABLE "frank_domain"."room_channel_binding";
--
-- Then remove this file and the `0006_room_channel_binding` entry from
-- migrations/meta/_journal.json. Nothing outside this migration references
-- the table, so the drop is self-contained.
-- ---------------------------------------------------------------------------

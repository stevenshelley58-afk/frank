-- Autonomous rooms and missions.
--
-- `room` is the durable identity, objective, policy fence, aggregate budget,
-- and pause boundary for a long-lived autonomous objective. `mission` is one
-- bounded execution programme inside that room, rooted in a canonical
-- WorkItem. These records add supervisory context; they do not replace the
-- WorkItem or Run state machines.
--
-- The migration is additive, creates no seed/demo data, and stores no secrets.
-- IDs and timestamps are supplied by the domain boundary under FRANK-§11.1.

CREATE TYPE "frank_domain"."room_state" AS ENUM('active', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "frank_domain"."mission_state" AS ENUM('planning', 'running', 'waiting', 'completed', 'failed', 'cancelled');--> statement-breakpoint

CREATE TABLE "frank_domain"."room" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"identity" text NOT NULL,
	"objective" text NOT NULL,
	"fence" jsonb NOT NULL,
	"state" "frank_domain"."room_state" DEFAULT 'active' NOT NULL,
	"budget" jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"data_class" "frank_domain"."data_class" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "room_identity_not_blank" CHECK (length(btrim("frank_domain"."room"."identity")) > 0),
	CONSTRAINT "room_objective_not_blank" CHECK (length(btrim("frank_domain"."room"."objective")) > 0),
	CONSTRAINT "room_fence_is_object" CHECK (jsonb_typeof("frank_domain"."room"."fence") = 'object'),
	CONSTRAINT "room_budget_is_object" CHECK (jsonb_typeof("frank_domain"."room"."budget") = 'object'),
	CONSTRAINT "room_version_positive" CHECK ("frank_domain"."room"."version" >= 1),
	CONSTRAINT "room_paused_only_active" CHECK (not "frank_domain"."room"."paused" or "frank_domain"."room"."state" = 'active')
);--> statement-breakpoint

CREATE TABLE "frank_domain"."mission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"room_id" uuid NOT NULL,
	"root_work_item_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"objective" text NOT NULL,
	"planned_work_graph" jsonb NOT NULL,
	"state" "frank_domain"."mission_state" DEFAULT 'planning' NOT NULL,
	"spend_limit" numeric(24, 8) NOT NULL,
	"spend_currency" text DEFAULT 'USD' NOT NULL,
	"token_limit" integer NOT NULL,
	"wall_clock_limit_seconds" integer NOT NULL,
	"attempt_limit" integer NOT NULL,
	"stop_new_work" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"data_class" "frank_domain"."data_class" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "mission_idempotency_key_not_blank" CHECK (length(btrim("frank_domain"."mission"."idempotency_key")) > 0),
	CONSTRAINT "mission_objective_not_blank" CHECK (length(btrim("frank_domain"."mission"."objective")) > 0),
	CONSTRAINT "mission_planned_work_graph_is_object" CHECK (jsonb_typeof("frank_domain"."mission"."planned_work_graph") = 'object'),
	CONSTRAINT "mission_spend_limit_non_negative" CHECK ("frank_domain"."mission"."spend_limit" >= 0 and "frank_domain"."mission"."spend_limit" <> 'NaN'::numeric),
	CONSTRAINT "mission_spend_currency_not_blank" CHECK (length(btrim("frank_domain"."mission"."spend_currency")) > 0),
	CONSTRAINT "mission_token_limit_non_negative" CHECK ("frank_domain"."mission"."token_limit" >= 0),
	CONSTRAINT "mission_wall_clock_limit_positive" CHECK ("frank_domain"."mission"."wall_clock_limit_seconds" >= 1),
	CONSTRAINT "mission_attempt_limit_positive" CHECK ("frank_domain"."mission"."attempt_limit" >= 1),
	CONSTRAINT "mission_version_positive" CHECK ("frank_domain"."mission"."version" >= 1),
	CONSTRAINT "mission_started_before_finished" CHECK ("frank_domain"."mission"."started_at" is null or "frank_domain"."mission"."finished_at" is null or "frank_domain"."mission"."started_at" <= "frank_domain"."mission"."finished_at"),
	CONSTRAINT "mission_terminal_finished_paired" CHECK (("frank_domain"."mission"."state" in ('completed', 'failed', 'cancelled')) = ("frank_domain"."mission"."finished_at" is not null)),
	CONSTRAINT "mission_terminal_stops_new_work" CHECK ("frank_domain"."mission"."state" not in ('completed', 'failed', 'cancelled') or "frank_domain"."mission"."stop_new_work")
);--> statement-breakpoint

ALTER TABLE "frank_domain"."mission" ADD CONSTRAINT "mission_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "frank_domain"."room"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."mission" ADD CONSTRAINT "mission_root_work_item_id_work_item_id_fk" FOREIGN KEY ("root_work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "room_cell_identity_uidx" ON "frank_domain"."room" USING btree ("cell_id", "identity");--> statement-breakpoint
CREATE INDEX "room_state_idx" ON "frank_domain"."room" USING btree ("cell_id", "state", "paused", "updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_cell_idempotency_uidx" ON "frank_domain"."mission" USING btree ("cell_id", "idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_root_work_item_uidx" ON "frank_domain"."mission" USING btree ("cell_id", "root_work_item_id");--> statement-breakpoint
CREATE INDEX "mission_room_state_idx" ON "frank_domain"."mission" USING btree ("cell_id", "room_id", "state", "updated_at");--> statement-breakpoint
CREATE INDEX "mission_runnable_idx" ON "frank_domain"."mission" USING btree ("cell_id", "state", "stop_new_work", "updated_at");

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Production rollback is a new forward migration. For an undeployed/test
-- database, reverse in this exact order, then remove this file and the
-- `0009_room_mission` journal entry:
--
--   DROP INDEX "frank_domain"."mission_runnable_idx";
--   DROP INDEX "frank_domain"."mission_room_state_idx";
--   DROP INDEX "frank_domain"."mission_root_work_item_uidx";
--   DROP INDEX "frank_domain"."mission_cell_idempotency_uidx";
--   DROP INDEX "frank_domain"."room_state_idx";
--   DROP INDEX "frank_domain"."room_cell_identity_uidx";
--   ALTER TABLE "frank_domain"."mission" DROP CONSTRAINT "mission_root_work_item_id_work_item_id_fk";
--   ALTER TABLE "frank_domain"."mission" DROP CONSTRAINT "mission_room_id_room_id_fk";
--   DROP TABLE "frank_domain"."mission";
--   DROP TABLE "frank_domain"."room";
--   DROP TYPE "frank_domain"."mission_state";
--   DROP TYPE "frank_domain"."room_state";
-- ---------------------------------------------------------------------------

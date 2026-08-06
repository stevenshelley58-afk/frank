-- WB-01 — the persisted workbench record (master plan §4.2, §8D WB-01).
--
-- A WORKBENCH is execution detail, never task state (master plan §3.1): work
-- items remain the canonical task and approval state, and every workbench
-- transition corresponds to a work-item transition, audit entry, and outbox
-- event performed by the caller. This migration therefore stores only what a
-- run needs to be durable and reconstructable:
--
--   workbench              one row per delegated execution (task def, state,
--                          claim columns for the runner queue, optional
--                          schedule reference)
--   workbench_plan_step    the 3-to-10 step plan every run publishes before
--                          substantive execution (master plan §3.4)
--   workbench_event        the append-only event log — event order is durable
--                          (WB-01 rule), enforced the same way 0001/0002
--                          enforce audit_entry and run_transition
--   workbench_artifact     registered outputs (path, kind, preview url)
--   workbench_receipt      the closing receipt: summary, assumptions, evidence
--
-- ## No separate task state machine
--
-- `workbench_state` is an enum, not a transition table: the WORK-004 machine
-- lives on `work_item` and is the only state machine. GOV-01 (docs/plans/
-- DECISIONS.md) fixes the mapping this record encodes, and
-- `apps/api/src/services/workbench/types.ts` mirrors it in TypeScript:
--
--   provisioning -> work_item blocked      running -> work_item active
--   waiting      -> work_item waiting      verifying -> work_item reviewing
--   done         -> work_item completed    failed -> work_item failed
--   cancelled    -> work_item cancelled
--
-- ## Linkage (canonical domain FK conventions, see 0000)
--
-- `work_item_id` is an enforced foreign key onto `frank_domain.work_item` with
-- ON DELETE restrict — a workbench never outlives its work item silently and
-- a work item with workbenches is never dropped silently. Rooms are not a
-- canonical PostgreSQL table (rooms live in the web/collaboration layer; the
-- canonical schema references them as text, e.g. `brain_entry.room_id` in
-- 0003), so `room_id` is text with no FK.
--
-- ## Idempotent creation
--
-- Workbench creation is idempotent against the delegation command key
-- (WB-01 rule): `workbench_idem_uidx (cell_id, idempotency_key)` lets the
-- front door INSERT ... ON CONFLICT DO NOTHING and read back the row a replay
-- already created, exactly like `capture_event_request_uidx` does for capture
-- (0000). The key is the delegation command envelope's `command_id`.
--
-- ## Identifiers
--
-- FRANK-§11.1: ids are minted by the caller (UUIDv7 via
-- adapters/storage/postgres ids.ts), never by a column default.

CREATE TYPE "frank_domain"."workbench_state" AS ENUM(
    'queued',
    'provisioning',
    'running',
    'waiting',
    'verifying',
    'done',
    'failed',
    'cancelled'
);--> statement-breakpoint

-- Master plan §4.2 fixed event vocabulary. Semantics are fixed; names follow
-- repository snake_case convention.
CREATE TYPE "frank_domain"."workbench_event_type" AS ENUM(
    'workbench_created',
    'provisioning_started',
    'provisioned',
    'plan_published',
    'step_updated',
    'decision_requested',
    'paused',
    'resumed',
    'artifact_registered',
    'receipt_published',
    'stop_requested',
    'timed_out',
    'failed',
    'cancelled',
    'completed'
);--> statement-breakpoint

-- Master plan §3.4 step states.
CREATE TYPE "frank_domain"."workbench_plan_step_state" AS ENUM(
    'pending',
    'doing',
    'done',
    'failed',
    'skipped'
);--> statement-breakpoint

CREATE TABLE "frank_domain"."workbench" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"room_id" text,
	-- The delegation command envelope's command_id (FRANK-§12.3). A replayed
	-- delegation command must produce the same workbench, never a second one.
	"idempotency_key" text NOT NULL,
	-- Master plan §4.2 taskDef: instruction, mounts[], harness, skills[],
	-- leash, network. Stored whole so a run is reproducible from this row.
	"task_def" jsonb NOT NULL,
	"state" "frank_domain"."workbench_state" DEFAULT 'queued' NOT NULL,
	-- Runner queue columns (WB-02): attempts survives requeueing; claimed_by /
	-- claimed_at hold the live claim; container_id ties the row to its Docker
	-- workspace (WB-03) for orphan cleanup.
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"container_id" text,
	-- Optional schedule reference (master plan §4.2 `schedule? { cron, tz }`).
	-- Paired-null constraint follows work_item's *_zone_paired convention.
	"schedule_cron" text,
	"schedule_timezone" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "workbench_version_positive" CHECK ("frank_domain"."workbench"."version" >= 1),
	CONSTRAINT "workbench_attempts_non_negative" CHECK ("frank_domain"."workbench"."attempts" >= 0),
	CONSTRAINT "workbench_schedule_zone_paired" CHECK (("frank_domain"."workbench"."schedule_cron" is null) = ("frank_domain"."workbench"."schedule_timezone" is null))
);--> statement-breakpoint

CREATE TABLE "frank_domain"."workbench_plan_step" (
	"workbench_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"step" text NOT NULL,
	"state" "frank_domain"."workbench_plan_step_state" DEFAULT 'pending' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workbench_plan_step_workbench_id_seq_pk" PRIMARY KEY("workbench_id","seq"),
	CONSTRAINT "workbench_plan_step_seq_positive" CHECK ("frank_domain"."workbench_plan_step"."seq" >= 1)
);--> statement-breakpoint

CREATE TABLE "frank_domain"."workbench_event" (
	"workbench_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"type" "frank_domain"."workbench_event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workbench_event_workbench_id_seq_pk" PRIMARY KEY("workbench_id","seq")
);--> statement-breakpoint

CREATE TABLE "frank_domain"."workbench_artifact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workbench_id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"preview_url" text,
	"sha256" text,
	"media_type" text,
	"created_at" timestamp with time zone NOT NULL
);--> statement-breakpoint

CREATE TABLE "frank_domain"."workbench_receipt" (
	"workbench_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by" text NOT NULL
);--> statement-breakpoint

ALTER TABLE "frank_domain"."workbench" ADD CONSTRAINT "workbench_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."workbench_plan_step" ADD CONSTRAINT "workbench_plan_step_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "frank_domain"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."workbench_event" ADD CONSTRAINT "workbench_event_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "frank_domain"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."workbench_artifact" ADD CONSTRAINT "workbench_artifact_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "frank_domain"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."workbench_receipt" ADD CONSTRAINT "workbench_receipt_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "frank_domain"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Idempotent creation against the delegation command key (WB-01 rule).
CREATE UNIQUE INDEX "workbench_idem_uidx" ON "frank_domain"."workbench" USING btree ("cell_id","idempotency_key");--> statement-breakpoint
-- The runner's queue scan (WB-02): oldest queued workbench first, per cell.
CREATE INDEX "workbench_queue_idx" ON "frank_domain"."workbench" USING btree ("cell_id","state","created_at");--> statement-breakpoint
CREATE INDEX "workbench_work_item_idx" ON "frank_domain"."workbench" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "workbench_room_idx" ON "frank_domain"."workbench" USING btree ("cell_id","room_id");--> statement-breakpoint
CREATE INDEX "workbench_plan_step_workbench_idx" ON "frank_domain"."workbench_plan_step" USING btree ("workbench_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "workbench_artifact_uidx" ON "frank_domain"."workbench_artifact" USING btree ("workbench_id","path");--> statement-breakpoint
CREATE INDEX "workbench_artifact_workbench_idx" ON "frank_domain"."workbench_artifact" USING btree ("workbench_id");--> statement-breakpoint

-- Event order is durable (WB-01 rule). Reuses `append_only_guard()` from 0001,
-- same shape as audit_entry (0001) and run_transition (0002): a row-level
-- guard against UPDATE/DELETE plus a statement-level guard against TRUNCATE,
-- which skips row triggers.
CREATE TRIGGER "workbench_event_append_only"
BEFORE UPDATE OR DELETE ON "frank_domain"."workbench_event"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."append_only_guard"();--> statement-breakpoint

CREATE TRIGGER "workbench_event_no_truncate"
BEFORE TRUNCATE ON "frank_domain"."workbench_event"
FOR EACH STATEMENT
EXECUTE FUNCTION "frank_domain"."append_only_guard"();

-- ---------------------------------------------------------------------------
-- ROLLBACK (per WB-01 rule: migrations include rollback instructions)
--
-- Reverse order, one statement each; then remove this file and the
-- `0004_workbench` entry from migrations/meta/_journal.json:
--
--   DROP TRIGGER "workbench_event_no_truncate" ON "frank_domain"."workbench_event";
--   DROP TRIGGER "workbench_event_append_only" ON "frank_domain"."workbench_event";
--   DROP TABLE "frank_domain"."workbench_receipt";
--   DROP TABLE "frank_domain"."workbench_artifact";
--   DROP TABLE "frank_domain"."workbench_event";
--   DROP TABLE "frank_domain"."workbench_plan_step";
--   DROP TABLE "frank_domain"."workbench";
--   DROP TYPE "frank_domain"."workbench_plan_step_state";
--   DROP TYPE "frank_domain"."workbench_event_type";
--   DROP TYPE "frank_domain"."workbench_state";
--
-- Nothing outside this migration references these objects, so the drop is
-- self-contained. (drizzle's migration journal has no down-migrations; the
-- journal row deletion plus the drops above are the rollback.)
-- ---------------------------------------------------------------------------

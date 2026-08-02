-- FRANK-§7.3 — durable run state.
--
-- Creates the `run` aggregate and its two companions (`run_state_transition`,
-- `run_transition`), then layers the invariants a generated schema cannot
-- express. The table/column/index DDL below is exactly what drizzle-kit emits
-- for `src/schema/run.ts` (typechecked against that module); the seed data,
-- triggers, and append-only enforcement are hand-written, matching the
-- convention established in `0001_domain_invariants.sql`.
--
--   1. FRANK-§7.3  seed `run_state_transition` and reject illegal run
--                  transitions in the database, not only in application code
--                  (the run analogue of WORK-004 in 0001).
--   2. FRANK-§7.3  make `run_transition` append-only, so a run's execution
--                  history cannot be rewritten after the fact (the run
--                  analogue of WORK-002 in 0001).

-- ---------------------------------------------------------------------------
-- run state vocabulary — FRANK-§7.3's Mermaid stateDiagram-v2, transcribed in
-- intake-to-outcome order so `ORDER BY state` is meaningful within a cell.
-- `src/run-state.ts` (RUN_STATES) is the TypeScript mirror; the integration
-- test asserts the two never drift.
-- ---------------------------------------------------------------------------

CREATE TYPE "frank_domain"."run_state" AS ENUM(
    'received',
    'clarifying',
    'planned',
    'queued',
    'running',
    'paused',
    'interrupted',
    'waiting',
    'blocked',
    'reviewing',
    'reworking',
    'ready',
    'merged',
    'ready_to_deploy',
    'promoting',
    'verifying',
    'deployment_failed',
    'recovering',
    'released',
    'release_reverted',
    'completed',
    'completed_with_recovery',
    'partially_completed',
    'failed',
    'cancelled'
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- the durable run record — FRANK-§7.3
--
-- One row per agent execution attempt against a work item. The work item may
-- produce many runs (retry, recovery, rework); each run carries its own
-- lifecycle, executor, policy decision, and evidence trail.
-- ---------------------------------------------------------------------------

CREATE TABLE "frank_domain"."run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"state" "frank_domain"."run_state" DEFAULT 'received' NOT NULL,
	"work_item_id" uuid NOT NULL,
	"predecessor_run_id" uuid,
	"executor_kind" "frank_domain"."actor_kind" NOT NULL,
	"executor_id" text NOT NULL,
	"harness" text NOT NULL,
	"policy_ref" jsonb NOT NULL,
	"policy_result" "frank_domain"."policy_result" DEFAULT 'allow' NOT NULL,
	"context_pack_ref" jsonb,
	"data_class" "frank_domain"."data_class" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"workflow_version" text DEFAULT '1' NOT NULL,
	CONSTRAINT "run_no_self_predecessor" CHECK ("frank_domain"."run"."predecessor_run_id" is null or "frank_domain"."run"."predecessor_run_id" <> "frank_domain"."run"."id"),
	CONSTRAINT "run_version_positive" CHECK ("frank_domain"."run"."version" >= 1),
	CONSTRAINT "run_started_before_finished" CHECK ("frank_domain"."run"."started_at" is null or "frank_domain"."run"."finished_at" is null or "frank_domain"."run"."started_at" <= "frank_domain"."run"."finished_at")
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- FRANK-§7.3's explicit transition table — the run analogue of 0001's
-- `work_state_transition`. A lookup table, not a check constraint, because
-- FRANK-§11.1 offers exactly that choice and a table can be inspected, joined
-- against, and amended with a visible diff.
-- ---------------------------------------------------------------------------

CREATE TABLE "frank_domain"."run_state_transition" (
	"from_state" "frank_domain"."run_state" NOT NULL,
	"to_state" "frank_domain"."run_state" NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "run_state_transition_from_state_to_state_pk" PRIMARY KEY("from_state","to_state"),
	CONSTRAINT "run_state_transition_no_self" CHECK ("frank_domain"."run_state_transition"."from_state" <> "frank_domain"."run_state_transition"."to_state")
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- FRANK-§7.3: "Every transition records actor, time, reason, policy decision,
-- correlation, and evidence." That sentence is this column list.
-- ---------------------------------------------------------------------------

CREATE TABLE "frank_domain"."run_transition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_state" "frank_domain"."run_state" NOT NULL,
	"to_state" "frank_domain"."run_state" NOT NULL,
	"actor_kind" "frank_domain"."actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"policy_result" "frank_domain"."policy_result" DEFAULT 'allow' NOT NULL,
	"evidence_ref" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"audit_entry_id" uuid,
	"correlation_id" text NOT NULL,
	"resulting_version" integer NOT NULL
);
--> statement-breakpoint

ALTER TABLE "frank_domain"."run" ADD CONSTRAINT "run_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."run" ADD CONSTRAINT "run_predecessor_fk" FOREIGN KEY ("predecessor_run_id") REFERENCES "frank_domain"."run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."run_transition" ADD CONSTRAINT "run_transition_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "frank_domain"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."run_transition" ADD CONSTRAINT "run_transition_legal_fk" FOREIGN KEY ("from_state","to_state") REFERENCES "frank_domain"."run_state_transition"("from_state","to_state") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_state_idx" ON "frank_domain"."run" USING btree ("cell_id","state");--> statement-breakpoint
CREATE INDEX "run_work_item_idx" ON "frank_domain"."run" USING btree ("cell_id","work_item_id","state");--> statement-breakpoint
CREATE INDEX "run_executor_idx" ON "frank_domain"."run" USING btree ("cell_id","executor_kind","executor_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "run_transition_seq_uidx" ON "frank_domain"."run_transition" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_transition_run_idx" ON "frank_domain"."run_transition" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "run_transition_cell_state_idx" ON "frank_domain"."run_transition" USING btree ("cell_id","to_state","occurred_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. FRANK-§7.3 — explicit run state transition table
--
-- Seeded from `legalRunTransitionPairs()` in `src/run-state.ts`. The
-- integration test `run-state-machine.integration.test.ts` reads this table
-- back and asserts it equals that function's output, so a change to one
-- without the other fails CI rather than drifting silently — the same
-- guardrail 0001 installed for work items (WORK-004).
-- ---------------------------------------------------------------------------

INSERT INTO "frank_domain"."run_state_transition" ("from_state", "to_state", "label") VALUES
	('received', 'clarifying', 'Clarifying'),
	('received', 'planned', 'Planned'),
	('clarifying', 'planned', 'Planned'),
	('planned', 'queued', 'Queued'),
	('queued', 'running', 'Running'),
	('running', 'paused', 'Paused'),
	('running', 'interrupted', 'Interrupted'),
	('running', 'waiting', 'Waiting'),
	('running', 'blocked', 'Blocked'),
	('running', 'reviewing', 'Reviewing'),
	('running', 'failed', 'Failed'),
	('running', 'partially_completed', 'Partially Completed'),
	('running', 'cancelled', 'Cancelled'),
	('paused', 'running', 'Running'),
	('paused', 'cancelled', 'Cancelled'),
	('interrupted', 'running', 'Running'),
	('interrupted', 'cancelled', 'Cancelled'),
	('waiting', 'running', 'Running'),
	('waiting', 'failed', 'Failed'),
	('waiting', 'cancelled', 'Cancelled'),
	('blocked', 'running', 'Running'),
	('blocked', 'failed', 'Failed'),
	('reviewing', 'reworking', 'Reworking'),
	('reviewing', 'ready', 'Ready'),
	('reworking', 'reviewing', 'Reviewing'),
	('ready', 'merged', 'Merged'),
	('ready', 'ready_to_deploy', 'Ready To Deploy'),
	('ready', 'completed', 'Completed'),
	('ready', 'cancelled', 'Cancelled'),
	('merged', 'ready_to_deploy', 'Ready To Deploy'),
	('ready_to_deploy', 'promoting', 'Promoting'),
	('ready_to_deploy', 'cancelled', 'Cancelled'),
	('promoting', 'verifying', 'Verifying'),
	('promoting', 'deployment_failed', 'Deployment Failed'),
	('verifying', 'released', 'Released'),
	('verifying', 'deployment_failed', 'Deployment Failed'),
	('deployment_failed', 'recovering', 'Recovering'),
	('recovering', 'release_reverted', 'Release Reverted'),
	('released', 'completed', 'Completed'),
	('release_reverted', 'completed_with_recovery', 'Completed With Recovery'),
	('failed', 'queued', 'Queued')
ON CONFLICT ("from_state", "to_state") DO NOTHING;
--> statement-breakpoint

-- Rejects any UPDATE that moves `run.state` along an edge absent from the table
-- above — the run analogue of 0001's `work_state_machine_guard`. A check that
-- only lives in the repository is a check that a psql session, a data-fix
-- script, or a future service can walk straight past.
CREATE OR REPLACE FUNCTION "frank_domain"."run_state_machine_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."state" IS NOT DISTINCT FROM OLD."state" THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "frank_domain"."run_state_transition" t
        WHERE t."from_state" = OLD."state"
          AND t."to_state" = NEW."state"
    ) THEN
        RAISE EXCEPTION
            'illegal run state transition % -> % on run %',
            OLD."state", NEW."state", OLD."id"
            USING ERRCODE = 'check_violation',
                  HINT = 'legal transitions are rows of frank_domain.run_state_transition (FRANK-§7.3)';
    END IF;

    -- FRANK-§11.1 optimistic concurrency: a state change is a user-visible edit
    -- and must move the version, or a concurrent reader cannot detect it.
    IF NEW."version" <= OLD."version" THEN
        RAISE EXCEPTION
            'run % changed state % -> % without incrementing version (was %, now %)',
            OLD."id", OLD."state", NEW."state", OLD."version", NEW."version"
            USING ERRCODE = 'check_violation',
                  HINT = 'FRANK-§11.1 requires an optimistic version field on user-editable aggregates';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "run_state_machine_guard"
BEFORE UPDATE ON "frank_domain"."run"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."run_state_machine_guard"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. FRANK-§7.3 — a run's execution history is history
--
-- `run_transition` is append-only: corrections are new rows, never edits.
-- Reuses `append_only_guard()` from 0001. Without the statement-level
-- TRUNCATE guard, "append-only" would be one `TRUNCATE` away from false.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "run_transition_append_only"
BEFORE UPDATE OR DELETE ON "frank_domain"."run_transition"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."append_only_guard"();
--> statement-breakpoint

CREATE TRIGGER "run_transition_no_truncate"
BEFORE TRUNCATE ON "frank_domain"."run_transition"
FOR EACH STATEMENT
EXECUTE FUNCTION "frank_domain"."append_only_guard"();

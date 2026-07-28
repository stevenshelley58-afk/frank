-- FRANK domain invariants that a generated schema cannot express.
--
-- Everything in this migration is hand-written and every statement traces to a
-- requirement. drizzle-kit generates tables, columns, indexes, and constraints;
-- it does not generate seed data, triggers, or append-only enforcement, and
-- those are exactly where WORK-004 and FRANK-§11.5 live.
--
--   1. WORK-004  seed `work_state_transition` and reject illegal transitions in
--                the database, not only in application code.
--   2. FRANK-§11.5  make `audit_entry` append-only.
--   3. FRANK-§11.3  make `source_version` append-only and `source.content_hash`
--                   immutable while the source is retained.
--   4. WORK-002  make `work_item_transition` append-only, so history cannot be
--                rewritten after the fact.

-- ---------------------------------------------------------------------------
-- 1. WORK-004 — explicit state transition table
--
-- Seeded from `legalTransitionPairs()` in `src/work-state.ts`. The integration
-- test `work-state-machine.integration.test.ts` reads this table back and
-- asserts it equals that function's output, so a change to one without the
-- other fails continuous integration rather than drifting silently.
-- ---------------------------------------------------------------------------

INSERT INTO "frank_domain"."work_state_transition" ("from_state", "to_state", "label") VALUES
	('inbox', 'planned', 'Plan'),
	('inbox', 'ready', 'Mark ready'),
	('inbox', 'scheduled', 'Schedule'),
	('inbox', 'waiting', 'Mark waiting'),
	('inbox', 'blocked', 'Mark blocked'),
	('inbox', 'cancelled', 'Cancel'),
	('planned', 'ready', 'Mark ready'),
	('planned', 'scheduled', 'Schedule'),
	('planned', 'waiting', 'Mark waiting'),
	('planned', 'blocked', 'Mark blocked'),
	('planned', 'cancelled', 'Cancel'),
	('ready', 'scheduled', 'Schedule'),
	('ready', 'active', 'Start'),
	('ready', 'waiting', 'Mark waiting'),
	('ready', 'blocked', 'Mark blocked'),
	('ready', 'cancelled', 'Cancel'),
	('scheduled', 'ready', 'Mark ready'),
	('scheduled', 'active', 'Start'),
	('scheduled', 'waiting', 'Mark waiting'),
	('scheduled', 'blocked', 'Mark blocked'),
	('scheduled', 'cancelled', 'Cancel'),
	('waiting', 'ready', 'Mark ready'),
	('waiting', 'scheduled', 'Schedule'),
	('waiting', 'active', 'Start'),
	('waiting', 'blocked', 'Mark blocked'),
	('waiting', 'cancelled', 'Cancel'),
	('waiting', 'failed', 'Mark failed'),
	('blocked', 'ready', 'Mark ready'),
	('blocked', 'scheduled', 'Schedule'),
	('blocked', 'active', 'Start'),
	('blocked', 'waiting', 'Mark waiting'),
	('blocked', 'cancelled', 'Cancel'),
	('blocked', 'failed', 'Mark failed'),
	('active', 'reviewing', 'Send to review'),
	('active', 'waiting', 'Mark waiting'),
	('active', 'blocked', 'Mark blocked'),
	('active', 'done', 'Complete'),
	('active', 'cancelled', 'Cancel'),
	('active', 'failed', 'Mark failed'),
	('reviewing', 'active', 'Start'),
	('reviewing', 'waiting', 'Mark waiting'),
	('reviewing', 'blocked', 'Mark blocked'),
	('reviewing', 'done', 'Complete'),
	('reviewing', 'cancelled', 'Cancel'),
	('reviewing', 'failed', 'Mark failed'),
	('failed', 'ready', 'Mark ready'),
	('failed', 'scheduled', 'Schedule'),
	('failed', 'active', 'Start'),
	('failed', 'cancelled', 'Cancel')
ON CONFLICT ("from_state", "to_state") DO NOTHING;
--> statement-breakpoint

-- Rejects any UPDATE that moves `state` along an edge absent from the table
-- above. WORK-004 says invalid transitions are rejected; a check that only lives
-- in the repository is a check that a psql session, a data-fix script, or a
-- future service can walk straight past.
CREATE OR REPLACE FUNCTION "frank_domain"."work_state_machine_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."state" IS NOT DISTINCT FROM OLD."state" THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "frank_domain"."work_state_transition" t
        WHERE t."from_state" = OLD."state"
          AND t."to_state" = NEW."state"
    ) THEN
        RAISE EXCEPTION
            'illegal work item state transition % -> % on work_item %',
            OLD."state", NEW."state", OLD."id"
            USING ERRCODE = 'check_violation',
                  HINT = 'legal transitions are rows of frank_domain.work_state_transition (WORK-004)';
    END IF;

    -- FRANK-§11.1 optimistic concurrency: a state change is a user-visible edit
    -- and must move the version, or a concurrent reader cannot detect it.
    IF NEW."version" <= OLD."version" THEN
        RAISE EXCEPTION
            'work_item % changed state % -> % without incrementing version (was %, now %)',
            OLD."id", OLD."state", NEW."state", OLD."version", NEW."version"
            USING ERRCODE = 'check_violation',
                  HINT = 'FRANK-§11.1 requires an optimistic version field on user-editable aggregates';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "work_item_state_machine_guard"
BEFORE UPDATE ON "frank_domain"."work_item"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."work_state_machine_guard"();
--> statement-breakpoint

-- A completed item must say when it completed. WORK-006 requires every item to
-- expose its definition of done; an item claiming `done` with no completion
-- instant cannot be reconciled against the run that finished it.
ALTER TABLE "frank_domain"."work_item"
    ADD CONSTRAINT "work_item_done_has_completed_at"
    CHECK ("state" <> 'done' OR "completed_at" IS NOT NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. FRANK-§11.5 — the canonical audit log is append-only
--
-- "The canonical audit log is append-only and hash-linked." A hash chain that
-- can be UPDATEd is not a hash chain; the trigger is what makes tampering
-- require table-owner privileges rather than an ordinary UPDATE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "frank_domain"."append_only_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        '% on %.% is forbidden: this table is append-only',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation',
              HINT = 'corrections are new rows; see FRANK-§11.5 and FRANK-§11.3';
    RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "audit_entry_append_only"
BEFORE UPDATE OR DELETE ON "frank_domain"."audit_entry"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."append_only_guard"();
--> statement-breakpoint

-- TRUNCATE bypasses row-level triggers entirely, so it gets a statement-level
-- one. Without this, "append-only" is one `TRUNCATE` away from being false.
CREATE TRIGGER "audit_entry_no_truncate"
BEFORE TRUNCATE ON "frank_domain"."audit_entry"
FOR EACH STATEMENT
EXECUTE FUNCTION "frank_domain"."append_only_guard"();
--> statement-breakpoint

-- The chain head is the one audit row that must be mutable — it advances on
-- every append — but it may only ever move forward. A head that can go backwards
-- lets an attacker rewind the chain and re-append a different history.
CREATE OR REPLACE FUNCTION "frank_domain"."audit_chain_head_monotonic"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."seq" <= OLD."seq" THEN
        RAISE EXCEPTION
            'audit chain head for cell % may not move backwards (% -> %)',
            OLD."cell_id", OLD."seq", NEW."seq"
            USING ERRCODE = 'restrict_violation',
                  HINT = 'FRANK-§11.5: the audit chain is append-only and hash-linked';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "audit_chain_head_monotonic"
BEFORE UPDATE ON "frank_domain"."audit_chain_head"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."audit_chain_head_monotonic"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. FRANK-§11.3 — source content is logically immutable while retained
--
-- "`SourceEnvelope` content is logically immutable while retained; privacy
-- deletion may physically erase content and leave a non-content tombstone."
-- So versions are append-only, and the envelope's content hash may only change
-- when the lifecycle is moving into an erasure state.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "source_version_append_only"
BEFORE UPDATE OR DELETE ON "frank_domain"."source_version"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."append_only_guard"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "frank_domain"."source_immutability_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."captured_at" IS DISTINCT FROM OLD."captured_at"
       OR NEW."capture_idempotency_key" IS DISTINCT FROM OLD."capture_idempotency_key"
       OR NEW."kind" IS DISTINCT FROM OLD."kind" THEN
        RAISE EXCEPTION
            'source % capture facts are immutable', OLD."id"
            USING ERRCODE = 'restrict_violation',
                  HINT = 'FRANK-§11.3: a re-capture is a new source version, not an edit';
    END IF;

    IF NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
       AND NEW."lifecycle" NOT IN ('deletion_pending', 'deleted', 'tombstoned') THEN
        RAISE EXCEPTION
            'source % content hash may only change through the deletion workflow', OLD."id"
            USING ERRCODE = 'restrict_violation',
                  HINT = 'FRANK-§11.3 / FRANK-§15.7: erasure produces a tombstone and a deletion manifest';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "source_immutability_guard"
BEFORE UPDATE ON "frank_domain"."source"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."source_immutability_guard"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. WORK-002 — history is history
--
-- "A work item must support ... history." A history that can be edited is a
-- record of what someone currently wants to have happened.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "work_item_transition_append_only"
BEFORE UPDATE OR DELETE ON "frank_domain"."work_item_transition"
FOR EACH ROW
EXECUTE FUNCTION "frank_domain"."append_only_guard"();
--> statement-breakpoint

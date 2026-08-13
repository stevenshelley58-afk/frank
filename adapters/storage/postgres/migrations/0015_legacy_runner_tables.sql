-- W1-3 (mission/workbench runner removal): the mission and workbench tables
-- were created by migrations 0004/0005/0009 for the deleted runner system.
-- Rename them to legacy_* so nothing references the old names. Guarded so the
-- migration is a no-op where the tables are absent (verified on prod DB
-- 2026-08-13: no mission_*/workbench_*/worktree_* tables exist — row counts
-- n/a). Tables live in the frank_domain schema (search_path pinned to
-- frank_domain,public in db.ts); the guard checks that schema explicitly.
DO $$ BEGIN IF to_regclass('frank_domain.mission') IS NOT NULL THEN ALTER TABLE frank_domain.mission RENAME TO legacy_mission; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('frank_domain.workbench') IS NOT NULL THEN ALTER TABLE frank_domain.workbench RENAME TO legacy_workbench; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('frank_domain.workbench_artifact') IS NOT NULL THEN ALTER TABLE frank_domain.workbench_artifact RENAME TO legacy_workbench_artifact; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('frank_domain.workbench_decision') IS NOT NULL THEN ALTER TABLE frank_domain.workbench_decision RENAME TO legacy_workbench_decision; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('frank_domain.workbench_event') IS NOT NULL THEN ALTER TABLE frank_domain.workbench_event RENAME TO legacy_workbench_event; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('frank_domain.workbench_plan_step') IS NOT NULL THEN ALTER TABLE frank_domain.workbench_plan_step RENAME TO legacy_workbench_plan_step; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF to_regclass('frank_domain.workbench_receipt') IS NOT NULL THEN ALTER TABLE frank_domain.workbench_receipt RENAME TO legacy_workbench_receipt; END IF; END $$;

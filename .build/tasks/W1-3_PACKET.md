# W1-3 packet (pre-staged for batch 2 — dispatch after batch 1 lands)

Goal: TASK W1-3 — Delete the mission and workbench runners. Delete:
- apps/api/src/services/workbench/ (whole dir: runner, store, provisioner, container-executor, harness-executor, front-door, preview-backend, staged-write, mount-composition, decision, channel-push, event-bus, egress, srt, terminal-reporter, cancellation, folder-binding-store, recipes, types + all their tests)
- apps/api/src/services/missions/ (whole dir — orchestrator/index/planner; it only feeds the deleted missions route; NOTE: main.ts imports MissionOrchestrator/MissionPlanner → hot-file request)
- apps/api/src/routes/missions.ts, apps/api/src/routes/workbench.ts, apps/api/src/routes/workbench-events.ts (+ their tests)
- apps/api/src/schema/workbench.ts (route schema — only serves deleted routes)
- apps/api/src/test/workbench*.integration.test.ts, apps/api/src/test/mission-orchestrator.integration.test.ts (tests of deleted code)
- adapters/storage/postgres/src/schema/run.ts + repositories/run.ts + their tests (workbench run persistence — verify sole purpose first)
- apps/web/src/lib/workbench/** (web-side workbench support — if W1-4 hasn't already removed it)
- apps/web/src/app/api/missions/**, apps/web/src/app/api/workbenches/**, apps/web/src/app/api/worktrees/**
Then remove every import of them repo-wide (delete the code that uses it, no stubs) — check apps/api/src/test/folder-binding.integration.test.ts and apps/api/src/test/codegraph-production-inputs.test.ts imports: if they import deleted workbench services, trim or delete per plan. Check apps/api/src/plugins/ + apps/api/src/schema/registry.js references.

HOT-FILE REQUESTS to file (in .build/tasks/W1-3.md, exact lines):
1. apps/api/src/main.ts — remove imports of ContainerWorkbenchExecutor, WorkbenchProvisioner, WorkbenchRunner, WorkbenchStore, WorkbenchTerminalReporter, WorkbenchCancellationService (lines ~32-37), MissionOrchestrator/MissionPlanner (line ~38) + their wiring/usages (find `workbench`/`mission` identifiers in the file body).
2. apps/api/src/server.ts — remove registerWorkbenchRoutes/workbenchAllRoutes (line ~65), registerMissionRoutes (lines ~68-69 + MissionRouteOrchestrator type), registerWorkbenchEventsRoute (line ~72) imports + their registration calls.
3. docs/requirements/registry.json + registry.md — AG-0 regenerates at gate (do not hand-edit).
4. adapters/storage/postgres/migrations/meta/_journal.json — exact journal entry for 0015 (copy format from an existing entry).

SCOPE EXTENSIONS (AG-0 additions — workbench/mission persistence and web support code):
- adapters/storage/postgres/src/schema/run.ts (workbench run table schema — the `harness` column lives here), adapters/storage/postgres/src/repositories/run.ts, their tests, and any `run`/workbench exports from adapters/storage/postgres/src/db.ts or a schema index — DELETE (they persist ONLY workbench runs; verify nothing outside deleted scope imports them; W1-1 may have already trimmed the harness column — check file state before editing).
- apps/web/src/lib/workbench/** (wire.ts, wire.test.ts, components) — web-side workbench support. W1-4 deletes the console (which imports it); if the dir still exists when you run, DELETE it and remove its imports (check apps/web/src/app/api/workbenches/** is gone first — that's your own deletion).
- apps/api/src/test/workbench-front-door.integration.test.ts, workbench.integration.test.ts, mission-orchestrator.integration.test.ts — tests of deleted code → DELETE. Check apps/api/src/test/folder-binding.integration.test.ts + codegraph-production-inputs.test.ts imports: if they import deleted workbench services, trim or delete per plan.

MIGRATION 0015 (only migration you create):
- Grep existing migrations for CREATE TABLE names matching mission_*/workbench_*/worktree_* (e.g. 0009_room_mission.sql). Prod DB verified 2026-08-13: NO such tables exist. Write adapters/storage/postgres/migrations/0015_legacy_runner_tables.sql using guarded renames:
  DO $$ BEGIN IF to_regclass('public.<name>') IS NOT NULL THEN ALTER TABLE public.<name> RENAME TO legacy_<name>; END IF; END $$;
  for every table the migrations define. Row counts: n/a (tables absent in prod) — record that in the commit message.
- Do NOT edit migrations/meta/ (journal) — hot-file request instead.

DONE-WHEN greps (report results):
- `grep -ri "workbenchrunner\|missionorchestrator" apps packages` → nothing
- The three apps/web/src/app/api dirs no longer exist
- `grep -rn "services/workbench\|services/missions" apps packages --include='*.ts'` → nothing (except hot-file requests pending AG-0)

TARGETED CHECKS: `export PATH="/c/Users/steve/node22:$PATH"` then `pnpm --filter @frank/api typecheck` (expect errors ONLY from unapplied hot-file requests — list them, don't fix coordinator files), `pnpm --filter @frank/api test` for fast unit tests.

Shared-tree rules: same as batch 1 (explicit git add only; never pull/push/rebase/merge; never touch .build/ beyond your task file; never run full gate; commit per logical unit with the W1-3 commit format; final commit Status: complete).
HANDOFF: deleted paths, grep results, hot-file requests, BLOCKED items, checks, commit hashes.

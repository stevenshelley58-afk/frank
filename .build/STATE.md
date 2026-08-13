# Frank rebuild — task board (AG-0 control plane)

Source of truth for the FRANK REBUILD (plan: `docs/plans/FRANK_REBUILD_PLAN.md`).
Maintained by AG-0 (Hermes orchestrator) only. Agents never edit this file.

Repo: `C:\Dev\Frank` (git-bash: `/c/Dev/Frank`). Integration branch per wave.
Main is PROTECTED (M14, strict, contexts=[verify]) — no direct pushes; merges
via PR after CI verify.

## Ground rules (from plan §1, adapted to this machine)

1. Never edit Hermes itself (`C:\Users\steve\AppData\Local\hermes`).
2. Never edit any project other than this repo.
3. No model calls in deterministic code paths.
4. Never drop a DB table that has rows — rename to `legacy_*` (or `legacy_` prefix).
5. Never hardcode a model name — use aliases `frank-planner`/`frank-coder`/`frank-bulk`.
6. Never store in Frank what Hermes already stores.
7. Commit every verified increment; minimum once an hour.
8. Never force-push. Never merge your own work. Never deploy.
9. Reuse OSS libs from Appendix A only; check licence + last release date.
10. If a rule blocks you: name the rule, the reason, what you would do instead, stop.

## Coordinator-only files (agents: file `## HOT-FILE REQUEST` in your task file instead)

Plan's list:
- `packages/contracts/src/index.ts`
- `apps/api/src/main.ts`
- `apps/web/src/components/shell/frank-shell.tsx`
- `infra/docker-compose.dev.yml`
- `pnpm-lock.yaml`
- drizzle migration journal (`adapters/storage/postgres/migrations/meta/`)

AG-0 extension for Wave 1 (shared hotspots, one consolidated edit at gate):
- `apps/api/src/server.ts` (route registration)
- `docs/requirements/registry.json` + `registry.md`
- `packages/contracts/src/harness*.ts` (deletion decision at gate)

## Migration number lease

| Number | Task | Renames |
|---|---|---|
| 0014 | W1-2 | brain_* → legacy_brain_* |
| 0015 | W1-3 | mission_*/workbench_*/worktree_* → legacy_* |
| 0016+ | W4-1 | **ask AG-0 before picking** |

## Task status

| Task | Depends | Owner | Status | Notes |
|---|---|---|---|---|
| W1-1 harness layer | — | AG-1 | ✅ DONE (8815531 + e5100bc hot files) | adapters/harness, harness-broker, harness-control, chat-turn-runner/config, contracts harness.ts deleted |
| W1-2 memory system | — | AG-2 | ✅ DONE (61f457b..f2249c1 + e5100bc hot files) | packages/memory, brain.ts, web memory api, kernel memory-recall stripped; migration 0014 (counts all 0) |
| W1-3 mission+workbench runners | — | AG-3 | ✅ DONE (7360a29..db3f9f6 + 2e7959a restore/hot-files) | workbench+missions deleted; channels/folder-binding RESTORED by AG-0 (plan keeps them); migration 0015 |
| W1-4 console/files/previews/explorer | — | AG-4 | ✅ DONE (621cccf..1882816 + e5100bc frank-shell) | console/**, explorer/previews/files/worktrees libs deleted; nav cleaned |
| W1-5 stale paths | W1-1..W1-4 | AG-5 | ✅ DONE (bc4cefc) | legacy VPS path → new paths, longest match first |
| WAVE 1 GATE | W1-1..W1-5 | AG-0 | ✅ PASSED locally (2026-08-13) | net −49,532 lines (260 files); /srv/frank grep = 0; typecheck 13/13; tests 11/12 pkgs green (api: 25 fails all pre-existing/untouched-by-wave — 14 symlink-EPERM Windows-only, 8 disk-gate env, 2 runbook golden drift, 1 production-inputs; see notes); build: api ✓ web ✗ Windows symlink EPERM (CI-Linux covers); PR → main for the authoritative CI gate |
| W2-1 Hermes client | W1 gate | AG-6 | pending | packages/hermes-client + chat-turns rewrite |
| W2-2 chat UI assistant-ui | W2-1 | AG-7 | pending | |
| W3-1 files page | W2 | AG-8 | pending | |
| W3-2 skills page | W2 | AG-9 | pending | |
| W4-1 factory tables | W3 | AG-10 | pending | migration number from AG-0 |
| W4-2 factory runner | W4-1 | AG-11 | pending | pg-boss, escalation ladder |
| W4-3 trace viewer | W4-2 | AG-12 | pending | |
| W4-4 tools page | W4-3 | AG-13 | pending | |
| W5-1 ad-template skill | W4 | AG-14 | pending | skills dir target: TBD (see notes) |
| W5-2 template-pack contracts | W5-1 | AG-15 | pending | |
| W5-3 renderer (satori+resvg) | W5-2 | AG-16 | pending | golden hash test first |
| W5-4 ad-templates factory | W5-3 | AG-17 | pending | |
| W6-1 release signing | W5 | AG-18 | pending | @noble/ed25519 |
| W6-2 releases page | W6-1 | AG-19 | pending | |
| W7-1 project pages + widgets | W6 | AG-20 | pending | |
| W8-1 graph page | W7 | AG-21 | pending | |
| W8-2 discovery job | W8-1 | AG-22 | pending | |

## Notes / open items

- W5-1 skills dir: plan says `~/agent-skills/skills`. On this machine Hermes skills
  live at `C:\Users\steve\AppData\Local\hermes\skills`. Decision needed at Wave 5
  (probably: write the skill there so the running Hermes sees it; Frank's skills
  page target dir TBD).
- VPS still runs the old layout (the legacy VPS root exists; `/frank/deployed` exists;
  `/projects/frank` does NOT). W1-5 string replacements land in the repo as the
  plan specifies; VPS reorg is a separate infra task (flagged to user).
- Row counts W1-2: all five brain_* tables = 0 rows (recorded from prod DB
  frank-frank-db-1 on 2026-08-13).

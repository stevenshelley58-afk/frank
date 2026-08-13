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
| WAVE 1 GATE | W1-1..W1-5 | AG-0 | ✅ MERGED to main (PR #75, 717fd3a, 2026-08-13) | CI verify on the PR was green (Linux). F0 main merged in first (7072ade). F-board stays at `.build/STATE.md`; this file is the W-board. |
| W2-1 Hermes client | W1 gate | AG-6 | ✅ DONE (99e8658..efc4044) | `@frank/hermes-client` `chat()` streams Responses API SSE; chat-turns persist metadata only; 8+2 tests + api typecheck green |
| W2-2 chat UI assistant-ui | W2-1 | AG-7 | ✅ DONE (39c24f4..58e7573, 2026-08-13) | assistant-ui 0.15.14 thread+composer+tool cards; SSE bridge route; /chat page; frank-shell adopted (58e7573, hot-file A); reload-restore degrades via sessionKey chaining + note (Hermes session id not exposed — backlog C); web 50/50 tests, 14/14 typecheck |
| W2 GATE | W2-1..W2-2 | AG-0 | ✅ MERGED to main (PR #76, 2026-08-13) | CI verify green on Linux. Frank chats through Hermes end to end (hermes-client + assistant-ui). |
| W3-1 files page | W2 | AG-8 | 🔄 IN_PROGRESS (rebuild/wave3) | deleg_5ba77704; read-only browser, react-arborist |
| W3-2 skills page | W2 | AG-9 | 🔄 IN_PROGRESS (rebuild/wave3) | deleg_6c7d8c82; reads Hermes skills root read-only |
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

## Parallel F-series build (merged from origin/main 2026-08-13)

A separate build program (owner "cowork") runs F0-F3/B4 tasks on main. Its board was
merged here to keep one source of truth. Original F-board: F0-1..F0-4 DONE; F0-5,
F0-6, F1-1, F3-0, F3-4, B4-1 READY; the rest BLOCKED-DEP on those.

| id | status | notes |
|---|---|---|
| F0-1 scaffold | DONE | main d5ae122 |
| F0-2 deploy frank | DONE | main e1d19a5 — VPS live, chat E2E via Goose ACP (old stack) |
| F0-3 graphify registry | DONE | main 6cbc25f (5 projects indexed) |
| F0-4 gitignore | DONE | main d5ae122 |
| F0-5 retire legacy VPS path paths | DONE by W1-5 | mapping per FRANK_REBUILD_PLAN (/projects/frank + /frank/deployed/*) — supersedes F0-5's draft (/frank/repo); rebuild plan wins |
| F0-6 dev compose in git | READY | secrets reconciliation needed before commit (see F0-6 note) |
| F1-1..F1-4 | READY / BLOCKED-DEP | project registry → release contract → module manifest → delivery |
| F2-A1/A2 · B1-B4 · C1 | BLOCKED-DEP | renderer / template factory / intelligence+outreach / content factory |
| F3-0..F3-4 | READY / BLOCKED-DEP | chat / project home / widgets / night watch / graphify+lakehouse |
| B4-1..B4-6 | READY / BLOCKED-DEP | adstudio legacy deletion → consumer boundary → editor → publish |

Wave 0 gate PASSED 2026-08-12: frank.fail live (Caddy, basic auth); 14 migrations,
69 tables; chat turn E2E streamed WAVE0-OK via Goose ACP.

⚠️ MIGRATION LEASE CONFLICT: the F-board reserved 0014 (F3-1 dashboard) + 0015
(F3-3 night watch) — BOTH were consumed by this rebuild's W1-2 (0014 brain_* rename)
and W1-3 (0015 runner tables). F3-1/F3-3 must request 0016+ when they execute.
Next free migration number: **0016**.

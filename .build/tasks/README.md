# Wave-1 agent protocol (read before dispatching)

## Shared-tree rules

All Wave-1 agents work in ONE tree (`C:\Dev\Frank`) on branch `rebuild/wave1`,
each touching only its own allowed paths. Disjoint paths → no conflicts.

- First command in every agent: `cd /c/Dev/Frank && git status --short` (verify
  branch + clean-ish tree).
- Commit ONLY your own paths: `git add <explicit paths>` then commit. NEVER
  `git add -A` / `git add .` / `git commit -am` — you would sweep up sibling
  agents' work.
- NEVER `git pull`, `git push`, `git rebase`, `git merge`, `git checkout -b`.
- NEVER touch `.build/` (AG-0 owns the board).
- NEVER run the full gate (`pnpm typecheck && pnpm test && pnpm build`) — sibling
  agents are deleting other modules concurrently; the gate is green only at wave
  end. Use TARGETED checks: `npx tsc --noEmit -p <package tsconfig>` and
  `pnpm --filter <pkg> test` (unit only; DB suites need env vars you don't have).
- Node: engines are `>=22.11 <23` with `engine-strict=true`; default shell node
  is v26 → EVERY pnpm/npx command must be prefixed:
  `PATH="/c/Users/steve/node22:$PATH" pnpm ...` (or export once at the start:
  `export PATH="/c/Users/steve/node22:$PATH"`).
- The `patch`/`write_file` tools work on this repo; `search_files` (rg) works.
  Read files with `read_file`. Windows + git-bash: POSIX syntax.

## Coordinator-only files (Wave 1)

`apps/api/src/main.ts`, `apps/api/src/server.ts`, `packages/contracts/src/index.ts`,
`apps/web/src/components/shell/frank-shell.tsx`, `infra/docker-compose.dev.yml`,
`pnpm-lock.yaml`, `adapters/storage/postgres/migrations/meta/` (journal),
`docs/requirements/registry.json` + `registry.md`.

If your deletion removes a module that ONE OF THESE files imports, do NOT edit
the file. Instead append to your task file (`.build/tasks/<TASK>.md`):

```
## HOT-FILE REQUEST
File: <path>
Change: <exact lines to remove / exact diff>
Reason: <which deletion caused it>
```

Then CONTINUE with everything else — do not mark BLOCKED. AG-0 applies all
hot-file requests in one consolidated edit at the wave gate.

## Commit format (plan §2 — use exactly)

```
<TASK-ID>: <one line saying what changed>

Status: complete
Done: <what now works that did not before>
Next: <the exact next thing to do>
Files: <every path you touched>
```

Commit per logical unit (delete dir → commit; fix references → commit; etc.).
Final commit of the task carries the full Done/Next/Files block.

## Handoff report (return this in your final summary)

1. Exact list of deleted paths (dirs + files).
2. Results of every "Done when" grep from the plan.
3. Hot-file requests filed (with file + change).
4. Anything BLOCKED / rule that stopped you.
5. Targeted checks you ran and their results.

---

## F-series task index (merged from origin/main 2026-08-13)

Drop this directory into `frank/.build/tasks/` — each file is the full brief for one
F/B task (owner: cowork). Model tiers + parallelism live in `EXECUTION-PLAN.md` §1-3.

| ID | File | Wave | Model | Parallel with |
|---|---|---|---|---|
| F0-1..4 | (in EXECUTION-PLAN §3) | 0 | cheap | serial — DONE (d5ae122/6cbc25f/e1d19a5) |
| F0-5 retire /srv/frank | — | 0 | cheap | DONE by W1-5 (see STATE.md) |
| F1-1..F1-4 | F1-1-project-registry / F1-2-release-contract / F1-3-module-manifest / F1-4-delivery | 1 | strong | serial |
| F2-A1/A2 | F2-A1-renderer / F2-A2-template-factory | 2 | cheap + strong rubric | group A |
| F2-B1..B4 | F2-B-intelligence-prospect-mail-outreach | 2 | cheap | group B |
| F2-C1 | F2-C1-content-factory | 2 | cheap | group C |
| F3-0 | F3-0-chat | 3 | cheap ×3 lanes | lanes then serial |
| F3-1 | F3-1-project-home | 3 | cheap, strong review | after F3-0 |
| F3-2/3 | F3-2-3-widgets-nightwatch | 3 | cheap | after F3-1 |
| F3-4 | F3-4-graphify-lakehouse | 3 | cheap/medium | independent |
| B4-1 | B4-1-deletion | 4 | cheap | starts immediately |
| B4-2/3/5 | B4-2-3-5-consumer-catalogue-save | 4 | cheap, strong for Save | after B4-1 |
| B4-4 | B4-4-editor | 4 | cheap ×3 | after B4-3 |
| B4-6 | B4-6-publish-meta | 4 | strong | after B4-5 |

F-series rules: no blockwise-specific code in modules/; commit at every green
checkpoint; never edit an applied migration (next free = 0016 after this rebuild).

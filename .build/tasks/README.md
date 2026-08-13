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

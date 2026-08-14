# W1-4 packet — Delete Console, files, previews and explorer modules

Goal: TASK W1-4 — delete `apps/web/src/app/console/**`, `apps/web/src/lib/explorer-fs.ts`,
`apps/web/src/lib/explorer-media.ts`, `apps/web/src/lib/files*.ts` (+ test),
`apps/web/src/lib/worktrees*.ts` (+ test), `apps/web/src/app/api/explorer/**`,
`apps/web/src/app/api/previews/**`, then remove every import/reference repo-wide and
all nav entries pointing at console/previews/explorer/files.

## Deleted paths

- `apps/web/src/app/console/**` (whole dir, 42 files incl. `graph/graph-data.test.ts`, `registry.ts`)
- `apps/web/src/lib/explorer-fs.ts`
- `apps/web/src/lib/explorer-media.ts` (sole consumer was the deleted `api/explorer/thumb/route.ts` — verified)
- `apps/web/src/lib/files.ts` + `files.test.ts`
- `apps/web/src/lib/worktrees.ts` + `worktrees.test.ts`
- `apps/web/src/app/api/explorer/**` (file, raw, search, thumb, tidy, tree)
- `apps/web/src/app/api/previews/**` (route.ts)
- `apps/web/src/components/worktree-panel.tsx` (dead consumer — sole importer was `components/frame.tsx`, which itself has zero importers; entire content was the worktrees UI)

## Reference removals (edits)

- `apps/web/src/components/frame.tsx` — removed `WorktreesBody` import, the "Code status" worktrees widget, and `IconTree`/`IconPin` import cleanup. File kept: it's the (unimported, dead) living-frame widget column; harness/mission widgets inside are W1-1/W1-3 territory.
- `apps/web/src/components/command-palette.tsx` — removed `consoleModules` import (`@/app/console/registry`), the "Consoles" CommandGroup, `CommandShortcut` import, placeholder copy → "Jump to a room…".
- `apps/web/src/components/rail.tsx` — removed Console + Files nav links, `IconFolder`/`IconFrame` imports, and the now-unused `next/link` import.
- `apps/web/src/components/icons.tsx` — removed `IconFrame`, `IconFolder`, `IconTree` exports (all now unused).
- `apps/web/src/components/shell/living-frame.tsx` — receipts filtered to `kind === 'chat'` (type-guarded); `ReceiptRow` simplified; workbench-receipt navigation to `/console/workbench` removed.
- `apps/web/src/app/dev/workbench-preview/workbench-preview.tsx` — removed "Real console:" link to `/console/workbench` + `next/link` import.
- `apps/web/Dockerfile` — stale comment referencing FRANK_EXPLORER_ROOT / Console Files / worktrees rewritten (RUN line kept for image stability).
- `infra/production/docker-compose.app.yml` — removed `FRANK_EXPLORER_ROOT`, `FRANK_EXPLORER_CACHE`, `FRANK_PREVIEWS_ROOT` env vars (zero consumers after deletions).

## HOT-FILE REQUEST — apps/web/src/components/shell/frank-shell.tsx (coordinator-only)

Remove both Console nav links and the now-unused `next/link` import (the only two `<Link>` usages in the file are these):

1. **Import (line 4):** delete
   `import Link from 'next/link';`

2. **Desktop footer Console link (lines 515–524):** delete
   ```
             <Link
               href="/console"
               className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
               aria-label="Console"
             >
               <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                 <path d="m4 17 6-6-6-6M12 19h8" />
               </svg>
               <span>Console</span>
             </Link>
   ```

3. **Mobile header Console link (lines 559–564):** delete
   ```
             <Link
               href="/console"
               className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink lg:hidden"
             >
               Console
             </Link>
   ```

(Line numbers verified on commit 814fb81. `grep -n "next/link"` = line 4; `grep -n 'href="/console"'` = lines 516, 560.)

## HANDOFF notes (NOT W1-4's to fix — sibling/coordinator scope)

- `apps/web/src/app/api/worktrees/route.ts` still references `FRANK_EXPLORER_ROOT` (lines 5, 19) — W1-3 deletes this whole dir; the only remaining hit of the W1-4 done-when grep. Clears when W1-3 lands.
- `apps/web/src/lib/missions/mission-panel.tsx` (dead, zero importers) contains two `href` to `/console/workbench` (lines 51, 119) — missions module, W1-3/coordinator to delete the dead lib/missions files.
- `apps/web/src/lib/workbench/components.tsx` line 224 has `href="/console/tasks?work=…"` — workbench module (W1-3), still used by `dev/workbench-preview`.
- `packages/contracts/src/index.ts` errors `Cannot find module './harness.js' / './harness-control.js'` — W1-1's in-flight deletion; coordinator-owned file.
- `apps/web/Dockerfile` `RUN apk add --no-cache ffmpeg git` — no longer needed after explorer (ffmpeg) + worktrees route (git) deletions; kept for image stability, W1-3/W1-5 may drop.
- `docs/plans/FRANK_REBUILD_PLAN.md` line 284 mentions the done-when grep (plan text, leave).

## DONE-WHEN grep results

- `grep -ri "explorer-fs\|FRANK_EXPLORER_ROOT\|FRANK_PREVIEWS_ROOT" apps packages` → ONLY `apps/web/src/app/api/worktrees/route.ts` (W1-3's file; clears when W1-3 lands). FRANK_PREVIEWS_ROOT: zero hits.
- Console routes 404: verified at wave gate by AG-0 (app not run here — shared tree).
- Dangling imports `from './explorer-fs'|'./files'|'./worktrees'|explorer-media` in apps/web/src: zero hits.

## TARGETED CHECKS (node22)

- `pnpm --filter @frank/web typecheck` — PASS for @frank/web; only remaining errors are `packages/contracts/src/index.ts` harness imports (W1-1 in-flight, coordinator-owned, not W1-4).
- `pnpm --filter @frank/web test` — 14 files / 65 tests PASS.

## Commits

- 621cccf W1-4: delete the Console module (apps/web/src/app/console/**)
- aa12e01 W1-4: delete explorer-fs/files/worktrees lib modules and their dead consumers
- 7f2fb50 W1-4: delete explorer and previews API routes
- e320a36 W1-4: remove navigation entries pointing at deleted console/explorer/files routes
- dd08c60 W1-4: fix typecheck after nav removal (icons brace, receipt chat-narrowing)
- 814fb81 W1-4: drop FRANK_EXPLORER_ROOT/FRANK_PREVIEWS_ROOT env config and Dockerfile references

Status: complete

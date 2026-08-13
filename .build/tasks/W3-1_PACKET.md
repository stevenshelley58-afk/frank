# W3-1 packet (pre-staged — dispatch after W2 lands)

Goal: TASK W3-1 — Files page. A read-only browser for the projects root
(`/projects` in the plan; locally the parent of this repo — default
`C:/Dev`, overridable via env `FRANK_FILES_ROOT`). The owner cannot use a
terminal, so this page is how he reads project files.

## Scope
- Allowed: `apps/web/src/app/files/**` (new), `apps/api/src/routes/files.ts` (new),
  `apps/web/package.json` (new deps), `apps/web/src/lib/files-api.ts` (new).
- Coordinator-only (hot-file request, exact lines): `apps/web/src/components/shell/frank-shell.tsx`
  (nav link), `apps/api/src/server.ts` (route registration), `pnpm-lock.yaml`,
  `docs/requirements/registry.json`.
- Node: `export PATH="/c/Users/steve/node22:$PATH"` before pnpm/npx. Branch: rebuild/wave2.
- Never `git add -A`; never push; commit format W3-1: <line> + Status/Done/Next/Files.

## Libraries (plan Appendix A — do not hand-roll)
- Tree: `react-arborist` (npm, MIT). Markdown view: `react-markdown` + `shiki`.
- API: ONE endpoint `GET /v1/files?path=...`:
  - resolves the path against FRANK_FILES_ROOT (default C:/Dev)
  - **rejects anything that resolves outside the root — 403** (test this)
  - rejects any path containing `..` — 403 (test)
  - directory → listing (name, kind, size); file → contents (text)
  - refuses files over 2 MB (413 or 403 — pick one, test it)
  - never returns `.env` files or anything matching `*secret*`, `*key*`, `*token*` (403, test)
- Windows specifics: path resolution must use `path.resolve` + a root-escape check on
  the REAL path (not the raw string) — on Windows also reject `:` drive tricks.

## Done-when
- Browse C:/Dev in a browser and read a file.
- `GET /v1/files?path=C:/Windows/System32/drivers/etc/hosts` → 403
- `GET /v1/files?path=C:/Dev/../Windows` → 403  (and `C:/Dev/frank/../..` → 403)
- `GET /v1/files?path=C:/Dev/frank/apps/api/.env` → 403
- One vitest test for each of those three cases (and the 2MB cap).
- `pnpm --filter @frank/web typecheck` + `pnpm --filter @frank/api typecheck` +
  the two packages' fast unit tests — green (no new errors; api-contract snapshot
  count will change because you ADD a route — recount from the merged list and
  update the test; that test file is editable by you IF the only change is the count
  + path list — otherwise hot-file request).

## Pitfalls (this repo)
- CRLF files — use patch/write_file tools, never sed -i.
- patch lint noise (TS6053) on Windows is a false alarm — verify with real typecheck.
- Never write auth/token literals in tests; assemble headers at runtime.
- `.env` files are never readable — the 403 tests prove it.

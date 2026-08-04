# BASELINE — delegation refactor

Recorded: 2026-08-04
Branch: `refactor/delegation-v2` (created from `delegation` @ `401ad73` = `origin/main`)
Worktree: `C:\Dev\Frank\.worktrees\delegation`

> **Note:** the plan's Phase 0 step 2 STOPPED at `C:\Dev\Frank` (root tree): `git status
> --porcelain` was non-empty (21 modified + ~60 untracked files of in-flight
> postgres/api/ADR work on branch `finishv1`). Per the plan, nothing was stashed or
> committed there. Steve approved running the refactor in this clean worktree instead.
> Local `main`/`finishv1` at the root sit at `6b51d31`, 3 commits behind `origin/main`;
> this baseline is taken from `401ad73`.

## Install

```bash
npm_config_engine_strict=false pnpm install   # engines pin >=22.11 <23; host Node is v26
```

✅ Done in ~20s, no errors. (Warning only: build scripts for esbuild/sharp ignored — pnpm 10 default.)

## Typecheck

```bash
npm_config_engine_strict=false pnpm -w typecheck
```

✅ **14/14 tasks passed** (57.7s). No typecheck failures.

## Tests

```bash
npm_config_engine_strict=false pnpm -w test
```

❌ 2 of 11 workspace test tasks fail. **Pre-existing failures below — NOT caused by this refactor.**
(Turbo bails on first failure, so the two adapter tasks were also run individually to get a complete picture.)

### Pre-existing failures (4 tests)

**`@frank/api` — `apps/api/src/test/api-contract.test.ts` (2 failed | 54 passed | 13 skipped)**

1. `ADR-017 OpenAPI > serves an OpenAPI 3.1 document generated from the route registry`
2. `ADR-017 OpenAPI > declares everything FRANK-§12.2 requires on every operation`

**`@frank/adapter-postgres` — `adapters/storage/postgres/src/schema/schema.test.ts` (2 failed | 242 passed | 109 skipped)**

3. `FRANK-§7.3 run state machine is the same in TypeScript and in SQL > emits the run_state enum with exactly the states RUN_STATES declares`
4. `FRANK-§11.1 identifiers are minted at the domain boundary > gives no table a generated identifier default`

### Passing packages (all green)

| Package | Result |
|---|---|
| `@frank/contracts` | 38 passed (3 files) |
| `@frank/policy` | 98 passed (3 files) |
| `@frank/identity` | 26 passed (1 file) |
| `@frank/memory` | 18 passed, 1 skipped (2 files) |
| `@frank/web` | 17 passed (2 files) |
| `@frank/adapter-tools-zapier-mcp` | 17 passed (1 file) |
| `@frank/adapter-collaboration-buzz` | 11 passed (1 file) |
| `@frank/kernel` | 43 passed (2 files) |
| `@frank/adapter-harness-goose` | no test files (exits 0) |

## Plan-vs-reality checks done at baseline

- `apps/web/src/lib/frank.ts` — `callbacks.onDone()` appears at exactly 3 sites: lines 129, 167, 176. ✅ Matches plan's Bug 1 description.
- `apps/web/src/app/api/chat/route.ts:206` — `send({ done: true, harness: activeProvider.id, reason, packHash })`. ✅ Matches plan's Bug 3 description.
- `apps/web/src/lib/delegation.ts` — exports `parseDelegations`, `ParsedDelegation`, `taskFromText` (regex `/@([a-z0-9][a-z0-9-]*)/g`). ✅ Matches plan's Bug 2 description.
- Next.js version: **14.2.29** → the Phase 2 `[id]` route must use the Next 14 signature `ctx: { params: { id: string } }` with `ctx.params.id` directly (NOT the Next 15 Promise form).

## Phase 1 deviations (recorded 2026-08-04)

1. **VERIFY contradiction in the plan.** Step 1.1's own guard code necessarily contains one
   literal `callbacks.onDone()` (inside `fireDone`) and one `callbacks.onError(e)` (inside
   `fireError`), so the plan's VERIFY check `grep -c "callbacks.onDone()" … must return 0`
   is unsatisfiable as written. Post-Phase-1 actual: `1`, and it is the guarded call site
   itself. All other call sites use `fireDone()`/`fireError()`; the guarantee (exactly one
   terminal callback per stream) holds.
2. `dispatchDelegation(p: ParsedDelegation)` in `delegation.ts` was the only remaining
   consumer of the deleted `ParsedDelegation` interface; its parameter is now an inline
   structural type with the same shape. File is deleted entirely in Phase 2 anyway.

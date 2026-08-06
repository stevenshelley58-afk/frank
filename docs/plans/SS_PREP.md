# SS prep (AG-6) — Wave 0 notes only. No integration before Gate G3.

Recorded 2026-08-06. Companion to `FRANK_MASTER_PARALLEL_BUILD_PLAN.md` §8H.

## Goose schedule fixture (SS-01/SS-02 prep)

- Goose 1.45.0 on VPS at `/root/.local/bin/goose`; `goose schedule list` =
  empty (verified 2026-08-06). ACP server live via `frank-goose.service`.
- Interim trigger: `goose schedule add` fires a recipe that POSTs to
  `apps/api` createWorkbench — the schedule never executes the task itself,
  it only mints a fresh work item + workbench (SS-01 hard rule: consecutive
  runs share no scratch state).
- Fixture: `fixtures/ss-schedule/` — a trivial "echo receipt" task def with
  `cron: "*/15 * * * *"`, `tz: "Asia/Shanghai"`, expected receipt shape.
- Receipt routing test: schedule fires with all clients closed → receipt in
  room thread → audit entry → verification state.

## srt egress test profile (SS-03 prep)

- `sandbox-runtime` wraps harness exec inside the workbench container (WB-03
  provides the container; srt adds fs + egress policy).
- Test profile `fixtures/ss-egress/taskdef.json`:
  - allowlist: `registry.npmjs.org`, `github.com`, `preview.frank.fail`
  - deny: everything else. Acceptance: `curl https://example.com` fails
    inside; `curl https://registry.npmjs.org` succeeds.
- Verify srt can enforce per-container policy without CAP_NET_ADMIN surprises
  on cgroup v2 Docker 29.4 during WB-03 merge.

## Microsandbox applicability (SS-04 — CLOSED, not applicable)

`ls /dev/kvm` on the VPS: **No such file or directory** (recorded in
BASELINE.md, 2026-08-06). Per decision M10 the pilot is closed as
not-applicable; Docker + srt remains the release-1 isolation path. No host
change inside this program. Re-open only if the VPS gains KVM.

## Hermes migration prep (SS-06 prep)

- Inventory of Hermes cron jobs to migrate will be taken at G4 (SS-06 deps:
  CH-06 + SS-02 + G4). Rule: move one job at a time, each must produce a
  correct scheduled-workbench receipt before its Hermes cron entry is
  removed; no duplicate delivery (one event → one phone path).

## Temporal boundary (SS-07 — docs task, may land any time)

The runner's queue + schedule interface (claim loop, enqueue, cron mint) is
defined behind `apps/api/src/services/workbench/` types only, so Temporal can
replace the claim loop + cron mint later without touching the workbench
contract. Temporal is NOT deployed in this program.

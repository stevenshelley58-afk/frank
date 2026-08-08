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

## SS-03 implementation status (control-plane layer) — 2026-08-08

- Control-plane + testable layer landed on `agent/ss/sandbox-select`:
  - `apps/api/src/services/workbench/egress.ts` — `EgressPolicy` builder.
    `network.egressAllowlist` -> `allowlist` policy; absent/empty ->
    `deny-all` (never "everything"). Entries normalized + validated.
  - `apps/api/src/services/workbench/srt.ts` — srt wrapper. Binary path
    injectable via `SRT_BIN`; when the binary is absent the harness command
    is returned UNWRAPPED (`degraded: { reason }`) and the WB-03 docker
    network profile stays the enforcement layer. Argv built element-by-
    element, no shell interpolation.
  - `provisioner.ts` `ProvisionSpec` now carries `egress` (the same policy
    descriptor both layers consume) and `srtFilesystem` (writable scratch
    volume + rw mounts; ro mounts read-only; staged copy-ins land inside
    /workspace).
- NOTE: npm `sandbox-runtime@0.3.5` is an empty placeholder package (README
  only, no binary) — confirmed 2026-08-08. There is no srt binary to
  install from npm today; the real binary must come from the srt upstream
  once it publishes. Live srt enforcement is DEFERRED until then.
- VPS install + acceptance test runbook (run once a real srt binary exists):

  ```sh
  # install (adjust when the real srt distribution lands; if npm-based:)
  ssh vps 'npm install -g sandbox-runtime@latest && command -v srt && srt --version'

  # point the api at it
  ssh vps 'echo SRT_BIN=$(command -v srt) >> /etc/frank/api.env'  # or the service's env file
  systemctl restart frank-api

  # acceptance (SS-03 master-plan verify): inside the workbench container
  ssh vps 'docker exec <workbench-container> srt run \
    --fs-write /workspace \
    --egress-allow registry.npmjs.org --egress-allow github.com --egress-allow preview.frank.fail \
    --workdir /workspace \
    -- sh -c "curl -fsS https://example.com; echo EXIT=$?"'      # must FAIL
  ssh vps 'docker exec <workbench-container> srt run \
    --fs-write /workspace \
    --egress-allow registry.npmjs.org --egress-allow github.com --egress-allow preview.frank.fail \
    --workdir /workspace \
    -- sh -c "curl -fsS https://registry.npmjs.org"'             # must SUCCEED
  ```

  (Flag spelling in the runbook mirrors `buildSrtArgv` in `srt.ts`; if the
  real srt CLI differs, update `buildSrtArgv` + `srt.test.ts` together.)
- Deferred: live srt enforcement (needs a real srt binary on the VPS);
  wiring `wrapWithSrt` into the harness exec call site (needs the srt
  binary to exist end-to-end; the wrapper + degrade path are unit-tested).

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

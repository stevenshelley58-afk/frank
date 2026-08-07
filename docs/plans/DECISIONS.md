# Master plan decision lock (GOV-02)

Recorded 2026-08-06 by AG-0. Decisions M1–M15 from
`docs/plans/FRANK_MASTER_PARALLEL_BUILD_PLAN.md` §2 are locked as follows.
Reversible assumptions marked (R).

| ID | Decision | Reversible? |
|---|---|---|
| M1 | First channel platform = Telegram, direct adapter, polling mode | (R) |
| M2 | First channel scope = notify + approve only | no |
| M3 | Channels C5 deferred, needs separate ADR | no |
| M4 | Channels StateStore = Postgres; conformance suite is a hard gate | no |
| M5 | Hermes keeps background/cron until scheduled workbenches replace each task | (R) |
| M6 | One interactive decision surface per binding; ntfy deferred | no |
| M7 | Frank tokens only, no tweakcn | no |
| M8 | First shadcn target = tasks console | no (already shipped) |
| M9 | Isolation rung 1 = Docker per workbench + `srt` | no |
| M10 | Microsandbox only if `/dev/kvm` exists → **KVM ABSENT, closed N/A** | n/a |
| M11 | Goose schedule interim; Temporal target without contract change | (R) |
| M12 | `ɵruntime` only inside Channels adapter package | no |
| M13 | Durable approval: post card → finish turn → resolve via inbound + outbox | no |
| M14 | Verify workflow first; branch protection after 2 representative greens | (R) |
| M15 | Workbench persistence = Postgres from day one | no |

## GOV-01 authority audit results

- ADRs 001, 005, 008, 011, 012, 013, 014, 019, 021 accepted in `docs/adr/`. ✅
- **ADR-022, ADR-023**: authored + accepted by Steven but were untracked in the
  root work tree. Landed in this commit so the workbench program can depend on
  them. ✅
- **WORK-004 states** (`docs/requirements/registry.md`): waiting, blocked,
  scheduled, active, reviewing, completed, cancelled, failed — enforced in
  `apps/api/src/test/slice1.integration.test.ts`. Master plan's
  `provisioning/running/verifying` are **workbench execution detail**, mapped
  onto work-item states: provisioning→blocked, running→active,
  waiting→waiting, verifying→reviewing, done→completed. No WORK-004 change
  needed; WB-01 must encode this mapping.
- Command envelope endpoint exists: `POST /v1/work/{id}/commands/{command}`
  (`apps/api/src/routes/work.ts`), FRANK-§12.3 shape with `command_id`,
  `expected_version`, `reason`, `dry_run`. ✅
- Delegation refactor phases 1–3 landed (commit 671355d lineage; delegation
  now Central→Letta tool, `delegation-store.run() → runTurn()` still the
  in-memory execution path that WB-05 replaces). ✅

## GOV-03 path map (resolved)

| Concern | Path |
|---|---|
| Channel contract | `packages/contracts/src/channel.ts` |
| Channel schemas | `schemas/channel-*.v1.schema.json` |
| Channels adapter | `adapters/collaboration/channels/` |
| Listener app | `apps/channels-listener/` |
| shadcn UI | `apps/web/src/components/ui/` (exists) |
| CI | `.github/workflows/verify.yml` (exists) |
| Preview skill | `skills/engineering/verify-preview/SKILL.md` (exists) |
| **Workbench runner module** | `apps/api/src/services/workbench/` (runner, provisioner, harness glue) |
| **Workbench schema migration** | `adapters/storage/postgres/migrations/0004_workbench.sql` |
| **Workbench API routes** | `apps/api/src/routes/workbench.ts` |
| Goose recipe templates | `apps/api/src/services/workbench/recipes/` |
| Decision seam | `apps/api/src/services/workbench/decision.ts` |


## M16 — Prime Agent as experimental second harness (2026-08-07)

Decision: adopt `PrimeIntellect-ai/prime-agent` (pinned exact version — v0.7.0 at writing, pre-1.0, breaking churn) as an EXPERIMENTAL first-class harness behind `AgentHarnessAdapter` (WB-04C). Goose remains the default engine until WB-04E/WB-10 evidence says otherwise. Frank stays the control plane and daily driver; Prime is a worker engine inside the workbench fence.

Binding rules:

- One Prime environment per workbench (own container, state dir, credentials, root session, child tree, declared mounts only). No shared daemon.
- Frank's Docker + srt fence stays mandatory: Prime's process separation is lifecycle recovery, not security.
- Frank owns schedules: Prime persistent cron disabled in production workbenches; fresh workbench per firing (W9).
- Frank's outer leash is authoritative; Prime inner limits set slightly under Frank's wall-clock; spend caps + kill stay Frank's.
- `/refine` + global harness store disabled in release 1; promotion of refinement output requires staged change + ADR-022 approval. Frank memory/skills are the only canonical stores.
- Prime child agents are internal detail — never Frank work items, rooms, identities, or approval authorities.
- All Prime types behind the adapter; no daemon/_meta in Frank contracts; upgrade smoke test; Goose fallback always available.

Reversible: yes — default-engine routing is evidence-pending (WB-04E report).

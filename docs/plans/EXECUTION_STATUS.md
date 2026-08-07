# FRANK Master Build — Execution Status (AG-0 control plane)

Source of truth for leases, merge order, and gate status. Updated by AG-0 only.
Master plan: `docs/plans/FRANK_MASTER_PARALLEL_BUILD_PLAN.md`

## Leases (shared-file hotspots)

| Hotspot | Leased to | Since |
|---|---|---|
| Root `package.json` / `pnpm-lock.yaml` | — (none) | — |
| Workspace config (`pnpm-workspace.yaml`) | — (none) | — |
| Contract exports (`packages/contracts/src/index.ts`) | AG-4 (CH-01 only, additive export) | wave-1 |
| Schema registry (`docs/requirements/registry.json` hash) | AG-0 | — |
| Migration journal (`adapters/storage/postgres/migrations/`) | AG-3 (WB-01; next number: **0004**) | wave-1 |
| Docker Compose / VPS manifests (`/srv/frank/infra/`) | AG-3 (WB runner deployment only) | wave-1 |
| `apps/web/src/app/globals.css` + Tailwind config | — (none; A-track done) | — |
| App shell / rail / console registry | AG-2 (UI-07, after WB-06) | not started |
| `AGENTS.md` + precedence docs | AG-0 | — |

## Merge order (dependency, not finish order)

1. GOV commit (this file + DECISIONS.md + BASELINE WB-00 + ADR-022/023) → main
2. WB-01 (migration 0004 + schema) → main
3. WB-02..WB-04 (runner/provisioner/harness) → main (single branch `agent/wb/wb-core`)
4. CH-01/CH-02 (contracts + statestore) → main
5. WB-05..WB-07 (front door, SSE, leash) → main
6. HITL-01/02 → main → **Gate G3**
7. CH-03..CH-06 (listener + Telegram) → main (needs bot token — HUMAN-GATED)
8. FS-*, SS-* (post-G3) → main

## Gates

| Gate | Status | Notes |
|---|---|---|
| G0 Authority & baseline | ✅ DONE (this commit) | ADR-022/023 landed, WB-00 facts recorded, decisions locked |
| G1 Delivery controls | ✅ DONE | verify.yml live, verify-preview skill, red/green proof. **M14 branch protection ENABLED 2026-08-06** (strict, contexts=[verify]) |
| G2 Workbench core | ⏳ in progress | WB-01..WB-09 |
| G3 Human loop | blocked on G2 + Telegram token | |
| G4 Folders & schedules | blocked on G3 | |
| G5 Release | not started | |

## GOV-06: stably/orca re-review (recorded 2026-08-06)

**Decision: CONTINUE-BUILD.** Evidence: 2026-08-02 repo review (session
20260802_132510_8d702d, log: /srv/frank/repo/docs/research/repo-reviews.md)
rated orca 🟡 "evaluate later" — it is a cockpit for a fleet of coding agents
in parallel git worktrees with a phone companion app. It owns no work items,
no approval state machine, no fences, no receipts, no VPS control plane, and
its execution unit is a git worktree, not an isolated container workspace.
Per the GOV-06 decision rule it could only accelerate presentation/session-
steering pieces — and Wave 3's surfaces (Telegram cards via ChannelPort,
Running/Waiting/Files UI) are canonical-state renderers we must own anyway.
Nothing it offers replaces CH-06 or the Wave 3 surface work. Revisit trigger:
if Frank needs N-way competitive agent fan-out on one repo (Steven's
"multiple agents on 1 project" ask), evaluate orca as a layer UNDER the
workbench runner, never as a replacement for it.

## Human-gated items

- **Telegram bot token**: CH-00 spike + CH-03..CH-06 need a bot token injected via OpenBao/env. Asked Steven 2026-08-06. Until then AG-4 builds CH-01/CH-02 (no token needed).

## Task status

| Task | Owner | Branch | Status |
|---|---|---|---|
| GOV-01..04 | AG-0/AG-1 | main | ✅ (issue board = #15..#57) |
| GOV-05/06 | AG-0 | main | ✅ |
| WB-00 | AG-0/AG-3 | — | ✅ (facts in BASELINE.md) |
| WB-01..04 | AG-3 | merged 9068898 | ✅ verify green, issues #15/16/18/19 closed |
| WB-05 | AG-3 | merged 68da4f7 | ✅ front door + web wiring, integration 4/4, issue #23 closed |
| WB-06 | AG-3 | merged b13f87f | ✅ SSE snapshot→live, gap-free resume, integration 3/3, issue #24 closed |
| WB-07 + HITL-01/02 | AG-3 | `agent/wb/wb-behavior` | 🔄 next: leash+stop, decision seam, pause/resume |
| CH-01 | AG-4 | merged dc7ee9a | ✅ contracts:validate green |
| CH-02 | AG-4 | merged dc7ee9a | ✅ conformance 21/21 (M4 hard gate passed) |
| DEL-04, GOV-04, DEL-05 | AG-1 | `agent/del/delivery-controls` | ✅ merged ff9ab38 |
| SS-07 | AG-0 | main | ✅ (docs/plans/SS-07_TEMPORAL_BOUNDARY.md) |
| PLG-04 | AG-7 | `agent/plg/trigger-eval` | ✅ merged abb66d6, issue #14 closed |
| UI-07 | AG-2 | merged (0753cd6 → main) | ✅ frozen-contract build, verify green |
| CH-03..05 | AG-4 | `agent/ch/listener-cards` | 🔄 in flight |
| M14 branch protection | AG-0 | — | ✅ enabled (strict, contexts=[verify]) |
| CH-00 | AG-4 | — | ⛔ needs bot token |
| FS-01..06 | AG-5 | — | blocked on G3 (prep done: FS_PREP.md + fixtures) |
| SS-01..03/05 | AG-6 | — | blocked on G3 (prep done: SS_PREP.md + fixtures) |

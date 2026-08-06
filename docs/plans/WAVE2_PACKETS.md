# Wave 2 task packets (pre-staged by AG-0)

Dispatch immediately after Wave 1 merges (WB-01..04 → main, CH-01/02 → main,
delivery → main). Contracts frozen: `docs/plans/WORKBENCH_API_CONTRACT.md`.

## Packet WB-W2: WB-05..WB-09 + HITL-01/02 (AG-3)

Branch `agent/wb/wb-behavior` from post-merge main. Allowed paths:
`apps/api/src/services/workbench/`, `apps/api/src/routes/workbench.ts`,
`apps/web/src/lib/delegation-store.ts` (WB-05 replacement only), tests.

- **WB-05** replace `delegation-store.run() → runTurn()` with
  `createWorkbench()`; keep proposal/confirmation/idempotency/delegate-tool.
  Verify: delegate from Central → exactly one workbench + work-item + audit.
- **WB-06** plan persisted before work; step updates appended;
  `GET /v1/workbenches/:id/events` SSE snapshot→live, `Last-Event-ID` resume,
  no dupes/gaps. Frozen contract is binding.
- **WB-07** wall-clock timeout, token/spend hooks, Stop < 5s, audit entries,
  terminal work-item states; model output cannot disable leash.
- **WB-08** artifact registration API, receipt schema + room-thread message,
  verification-before-done, Central reopen-with-note.
- **WB-09** restart recovery + reconciliation for
  provisioning/running/waiting/verifying; honest failure receipt when unsafe;
  container/volume/tmp cleanup; idempotent recovery.
- **HITL-01** decision request → normal `decision` work item in `waiting`
  (ADR-022); indistinguishable in API from other approvals.
- **HITL-02** resume on `ready`, cancel/safe-fail on `cancel`, waiting
  survives runner restart, stale/dup commands rejected via expected_version.
  API-only test BEFORE any mobile integration.

Gate: G2 + G3 (API side). Rollback: revert branch; drop routes; restore
delegation-store path.

## Packet CH-W2: CH-03..CH-05 (AG-4) — token-gated parts behind mocks

Branch `agent/ch/listener-cards` from post-merge main. Allowed paths:
`adapters/collaboration/channels/`, `apps/channels-listener/`, tests.

- **CH-03** adapter package (depends only on `@frank/contracts` + pinned
  `@copilotkit/channels@0.7.3`); ONE `ɵruntime` use inside adapter;
  `apps/channels-listener` separate process calling apps/api over HTTP;
  health + restart behavior.
- **CH-04** waiting decision → native Telegram card (room, action, why_now,
  next_safe_action, evidence); Approve/Deny submit command envelopes;
  in-place card update; expired/stale/already-resolved handled. Real-Telegram
  acceptance deferred to token; SDK layer mocked in tests.
- **CH-05** identifyUser (Steven only), token via env/OpenBao path,
  `COPILOTKIT_TELEMETRY_DISABLED=true` + automated assertion.

Gate: G3 (code-ready; live proof needs token). Rollback: remove packages +
app from workspace.

## Packet UI-W2: UI-07 Running/Waiting/detail (AG-2)

Branch `agent/ui/workbench-surfaces` from post-merge main. Allowed paths:
`apps/web/src/` (running/waiting components, console registry entries);
app shell/rail lease granted for this packet.

- Build against the FROZEN contract (WORKBENCH_API_CONTRACT.md) — do not
  wait for WB-06 to merge; the SSE client consumes snapshot+live with `seq`
  dedupe. If the implementation drifts from the frozen contract, stop and
  report (contract wins).
- Running entry: room, task, step k/n, active step note, elapsed, Stop.
- Detail view: raw events + evidence. Waiting surface links the decision
  work item (no second approval state machine).
- Preview evidence on preview lane per DEL-01/DEL-02; keyboard pass.

Gate: G2/G5 evidence. Rollback: revert branch.

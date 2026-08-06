# SS-07 — Temporal migration boundary (documentation only)

Status: defined. **Temporal is NOT deployed in this program** (decision M11,
§13.1 deferred). This document fixes the interface the workbench runner
exposes today so a future Temporal migration swaps implementation without
touching the workbench contract (WB-01 schema, events, receipts, fences).

## What Temporal would replace

| Concern | Today (interim) | Temporal replacement |
|---|---|---|
| Queue claim | `SELECT … FOR UPDATE SKIP LOCKED` claim loop in `apps/api/src/services/workbench/runner.ts` | Temporal task queue + activity workers |
| Scheduling | Goose schedule mints a fresh work item + workbench (SS-01/SS-02) | Temporal schedules / cron workflows |
| Leash enforcement | Runner wall-clock timer + budget hooks (WB-07) | Workflow timers + heartbeat timeout |
| Pause/resume | Waiting work item + `expected_version` command envelope (HITL-02, ADR-022) | Workflow signal/query — **the envelope stays the wire format**; Temporal only carries it |
| Recovery | Restart reconciliation scan (WB-09) | Temporal durable execution replay |

## What Temporal must NEVER replace

- Work items as canonical task/approval state (plan §3.1). Temporal workflows
  are execution records, mirroring workbench events — never the authority.
- The append-only workbench event log. Temporal history is an implementation
  detail; the Postgres event stream remains the evidence source.
- Receipts, audit entries, outbox events — emitted by the runner activity,
  exactly as today.
- Filesystem fence / mounts / egress policy — container-level, orthogonal.

## The boundary interface (stable surface)

```ts
// apps/api/src/services/workbench/queue.ts — the ONLY seam Temporal touches
interface WorkbenchQueue {
  /** Claim up to `limit` queued workbenches atomically (one owner each). */
  claim(limit: number): Promise<ClaimedWorkbench[]>;
  /** Re-enqueue a workbench that could not be started. */
  release(id: string, reason: string): Promise<void>;
  /** Enqueue a newly created workbench. */
  enqueue(id: string): Promise<void>;
}
```

Rules for the future migration:

1. Temporal arrives behind `WorkbenchQueue` + a workflow-per-workbench
   mapping; the runner loop becomes a Temporal worker. No other module
   imports Temporal SDK types.
2. `workbench.schedule { cron, tz }` keeps its shape; the minter swaps from
   Goose schedule to a Temporal schedule, still producing **fresh work item +
   fresh workbench per firing** (SS-01 hard rule).
3. The pause/resume seam stays the ADR-022 command envelope. Temporal signals
   are fed *from* the envelope handler, never the reverse.
4. Migration gate: a Temporal run must reproduce the WB-09 restart-recovery
   acceptance test identically before the Goose/claim-loop path is retired.

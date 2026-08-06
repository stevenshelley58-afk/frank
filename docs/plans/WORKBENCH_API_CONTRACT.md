# Workbench API contract (WB-05..WB-07 ⇄ UI-07)

Frozen by AG-0 2026-08-06. Changes require an ADR-class note + AG-0 sign-off.
All routes under `apps/api/src/routes/workbench.ts`. Auth follows existing
`apps/api` conventions. Work items remain canonical: workbench routes never
mutate work-item state directly — transitions go through
`POST /v1/work/{id}/commands/{command}` (ADR-022 envelope).

## Routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/workbenches` | Create from task def; idempotent on `Idempotency-Key` (= delegation command key). Body: `TaskDef` (plan §4.2). 200 returns existing if key seen. |
| GET | `/v1/workbenches/:id` | Record + plan + latest receipt. Includes `workItemId`, `state`, `version`. |
| GET | `/v1/workbenches/:id/events` | **SSE**: snapshot first (`event: snapshot`, full ordered events), then live appends. `Last-Event-ID` resume supported — no duplicates/gaps (WB-06). |
| POST | `/v1/workbenches/:id/stop` | Leash stop (WB-07). Body: `{ reason }`. Must halt < 5s. Audit entry. |
| POST | `/v1/workbenches/:id/decisions` | Harness requests decision (HITL-01). Creates `decision` work item in `waiting`, appends `decision_requested` + `paused`, pauses run. Body: `{ question, whyNow, nextSafeAction, evidence[] }`. |
| GET | `/v1/rooms/:roomId/workbenches` | List for room surfaces. |

## SSE event envelope

```json
{ "seq": 12, "type": "step_updated", "at": "2026-08-06T15:00:00Z",
  "payload": { "step": 3, "state": "doing", "note": "…" } }
```

Event types (fixed list, plan §4.2): `workbench_created`,
`provisioning_started`, `provisioned`, `plan_published`, `step_updated`,
`decision_requested`, `paused`, `resumed`, `artifact_registered`,
`receipt_published`, `stop_requested`, `timed_out`, `failed`, `cancelled`,
`completed`.

## UI rules (UI-07)

- Running entry: room, task, step `k/n`, active step note, elapsed, Stop.
- Reconnect = snapshot then live; dedupe on `seq`.
- Waiting surface links the decision work item — never renders a second
  approval state machine.
- Raw events live in the detail view; chat gets handoff + receipt only.

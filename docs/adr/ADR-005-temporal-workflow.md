# ADR-005 — Temporal as durable workflow implementation

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §13.1, §23.2 |

## Context

FRANK runs long-lived autonomous work across process restarts and model failures. A workflow engine must provide durable state, timers, signals, retries, and resumability without coupling the domain model to vendor-specific job tables. Temporal is mature, self-hostable, open, and provides all required primitives.

## Decision

Temporal is the sole durable scheduler for FRANK workflows and automations. It owns orchestration state, timers, signals, and retry decisions. PostgreSQL owns work identity, user intent, policy records, and final business outcomes. FRANK's domain API remains the authority.

## Alternatives considered

- Restate (rejected: less mature SDK ecosystem and fewer self-host resources)
- Windmill (rejected: designed for visual workflow builders, not FRANK's API-driven integration)
- Database queue only (rejected: loses durable retries and timer primitives)

## Consequences

- **Buys:** Native long-running execution; deterministic replay and versioning; signals for interrupts and steering; sideline monitoring and debugging
- **Costs:** Separate Temporal deployment and database; workflow-code versioning discipline; complexity of activity-based side effects

## Measured evidence

§13.1 details required production capabilities: namespace isolation, mTLS, Worker Build IDs, history encryption, activity idempotency, and side-effect ledger conformance. §21 (construction workstream 5) includes Temporal integration testing.

## Migration and exit trigger

If Temporal operational burden exceeds database-queue simplicity, evaluate other durable schedulers using the same § 13.1 contract. PostgreSQL outbox and run records remain stable; swap Temporal by re-implementing activities as workers querying the same outbox and providing equivalent resumability guarantees.

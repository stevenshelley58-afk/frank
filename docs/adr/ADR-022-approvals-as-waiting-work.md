# ADR-022 — Approvals are work items in `waiting`, acted on by verb commands

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-03 |
| Owner | Steven |
| Review date | 2027-02-03 |
| Spec locators | WORK-004, FRANK-§12.2, FRANK-§12.3 |

## Context

Agents repeatedly reach a point where a human must approve before something proceeds: a plan to confirm, a spend to authorize, a merge to allow. The system needs one approval mechanism that is auditable, cannot be bypassed by a surface, and does not multiply entity kinds. A parallel "approval" record would duplicate the work item's state machine, owner, provenance, and audit obligations instead of reusing them.

## Decision

An approval is a work item — kind `decision` — in the `waiting` state. Approving and rejecting are the existing WORK-004 verb commands on that item: `ready` moves it forward, `cancel` refuses it. The wire format is the FRANK-§12.3 command envelope (`command_id`, `expected_version`, `reason`, `dry_run`) posted to `POST /v1/work/{id}/commands/{command}`, which is transport-agnostic: the web app, Buzz, or a notification deep link all invoke the same endpoint, so surfaces remain swappable and no surface owns the transition. Every approval decision therefore inherits the work item's version, audit entry, outbox event, and provenance chain for free.

## Alternatives considered

- A dedicated `approval` entity with its own state machine (rejected: duplicates WORK-004 enforcement, audit, and optimistic concurrency that work items already provide)
- Approvals as chat messages answered inline (rejected: a message has no version, audit obligation, or idempotency key; FRANK-§11.5 requires every decision to be recorded)

## Consequences

- **Buys:** one state machine and one audit path for all approvals; any client surface can present and resolve them; the Waiting-on-you queue is a filtered work list (`state=waiting`), not a new read model.
- **Costs:** approval-specific display (who must decide, what exactly is being approved) must be carried by the work item's fields (`why_now`, `definition_of_done`, `next_safe_action`) rather than bespoke columns.

## Measured evidence

`apps/api` contract tests exercise the `ready` and `cancel` verbs against a seeded `waiting` item; the WORK-004 transition table, database trigger, and composite foreign key all enforce the same path an approval takes.

## Migration and exit trigger

If approvals ever need semantics a work item cannot carry (multi-party quorum, timed expiry with escalation), add them as extensions of the work item's command envelope and transition table. The exit trigger for this ADR is a requirement that cannot be expressed as a state transition with an audit entry.

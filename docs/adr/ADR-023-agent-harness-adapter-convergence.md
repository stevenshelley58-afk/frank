# ADR-023 — AgentHarnessAdapter is the convergence target for chat providers

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-03 |
| Owner | Steven |
| Review date | 2027-02-03 |
| Spec locators | FRANK-§6.2, FRANK-§7.3, ADR-001, ADR-008 |

## Context

The web app currently abstracts chat backends behind a `ChatProvider` interface in `apps/web`, with several provider implementations. Meanwhile the kernel layer (`packages/kernel`) and the wire contracts (`packages/contracts`) define how FRANK itself drives an agent execution — a harness session, its tool calls, and the FRANK-§7.3 run those produce. Two abstractions that both answer "how do we talk to an agent" will drift unless one is named the target.

## Decision

`AgentHarnessAdapter` — built on `packages/kernel` plus `packages/contracts`, speaking ACP to harnesses per ADR-008 — is named as the single convergence target for all chat/provider abstractions. Web `ChatProvider` implementations become thin views over it: a room's chat is the surface of a run, and the adapter is the one component that knows which harness executes it. This ADR names the direction only; **no code is touched now**. The web providers keep their current interfaces and are migrated room-by-room in a later phase, each migration proven by a contract test against the adapter rather than by a rewrite.

## Alternatives considered

- Let `apps/web` keep its own provider abstraction permanently (rejected: two agent abstractions diverge, and the web layer ends up owning session and run concerns that belong to the kernel — against ADR-001's kernel independence)
- Migrate all providers immediately (rejected: a big-bang rewrite of working surfaces risks regressions the plan cannot absorb; naming the target now costs nothing)

## Consequences

- **Buys:** one place where harness protocol details live; runs, audit, and receipts flow through the FRANK-§7.3 path regardless of surface; future harnesses are added once, in the adapter.
- **Costs:** the web providers carry a known interim duplication until each is migrated; the migration must be sequenced room-by-room so a failing adapter can fall back to the legacy provider.

## Measured evidence

None yet — this decision is prospective. The first migration carries the obligation to add a contract test showing the adapter-driven room and the legacy provider agree on message shape and run linkage.

## Migration and exit trigger

Exit trigger: if `packages/kernel` proves unable to host a chat session model (latency or protocol limits ACP cannot express), re-open this ADR before any provider is migrated. Until then, new provider work must not extend the web-only abstraction.

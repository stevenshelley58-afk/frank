# ADR-011 — Buzz is collaboration, not canonical data or audit

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §4.13, §23.2 |

## Context

FRANK must support human-agent collaboration through private rooms where Steven and agents share context and proposals. Buzz provides signed events and relay infrastructure. However, Buzz is pre-1.0, remains a fast-moving dependency, and must never become a single point of failure for canonical work, policy, or audit.

## Decision

Buzz is a collaboration relay and optional room provider. It displays FRANK-owned sessions but never creates or schedules work independently. FRANK remains the authority for life/build records, workflow state, and policy decisions. Buzz events are untrusted proposals until FRANK processes them.

## Alternatives considered

- Buzz as the workflow engine (rejected: violates kernel independence; couples control to pre-1.0 project)
- Matrix or Mattermost only (rejected: less agent-friendly integration; still pre-1.0 for many features)

## Consequences

- **Buys:** Natural collaboration surface for human-agent work; signed event retention; optional private relay option; proposal workflow without forking authority
- **Costs:** Events must be redacted and remapped to FRANK canonical records; Buzz outages do not block canonical work; event verification overhead

## Measured evidence

§4.13 (collaboration with Buzz) defines acceptance gates: membership contracts, signed-event verification, revocation, and failure isolation. §23.1 (adoption checklist) and §21 (workstream 9) include conformance tests for Buzz integration.

## Migration and exit trigger

`BuzzPort` contract remains stable. If Buzz compatibility or security gates fail, disable the relay and retain canonical FRANK work. Switch to another collaboration platform by re-implementing the same contract.

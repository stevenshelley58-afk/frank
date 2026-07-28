# ADR-014 — Evidence-ready work before production promotion review

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §1.2.3, §14.2, §20 |

## Context

Steven must review and approve high-consequence changes before they ship. Asking for review of an unfinished proposal wastes time and creates decision fatigue. A completed evidence pack includes code, checks, preview, risks, rollback, and spend evidence—everything needed for an informed decision.

## Decision

Work reaches Review status only after it is complete, tested, previewed, and has fresh-context and cross-model-family reviews. The Review action then shows distinct options (approve, request edits, reroute) based on evidence quality and policy.

## Alternatives considered

- Proposal-stage review (rejected: asks Steven to make decisions without complete information)
- Auto-promote without review (rejected: loses safety gates for production promotion)

## Consequences

- **Buys:** Faster reviews because evidence is complete; clearer decision scope; reduced decision fatigue; auditable promotion trail
- **Costs:** Additional time in build phase before Review; must complete all evidence steps automatically

## Measured evidence

§14.2 (build lifecycle) defines the 16-step workflow and evidence requirements. §14.4 (evidence pack contents) specifies the acceptance gate. § 20 (acceptance scorecard) measures promotion decision quality.

## Migration and exit trigger

Not reversible; evidence completeness is a non-negotiable principle (§1.2.3). Changing promotion gates requires updating the evidence checklist and Review action options, not the basic flow.

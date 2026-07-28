# ADR-015 — One customer cell per isolated deployment

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §2.4, §22.2 |

## Context

When FRANK is offered to customers, each customer must have an isolated deployment with no shared data plane. A cell-per-customer model enforces this boundary automatically and prevents cross-customer data exposure.

## Decision

Each customer receives a dedicated VPS, domain, database set, object store, secret root, identity realm, Buzz relay, telemetry store, backups, and provider-native credentials. Deployments share no data plane.

## Alternatives considered

- Shared control plane with per-customer schemas (rejected: violates cell isolation principle; single point of failure)
- Multi-tenant with encryption (rejected: secrets, audit, and recovery remain coupled)

## Consequences

- **Buys:** Complete data isolation per customer; independent backups and recovery; clean white-label separation; clear security boundaries
- **Costs:** Operational overhead per cell; fleet-level provisioning and monitoring; no volume economies of scale

## Measured evidence

§22.2 (cell rules) and §22.3 (module and pack rules) define customer-cell conformance criteria. §21 (workstream 15) includes customer-cell provisioning, isolation verification, and destruction testing.

## Migration and exit trigger

This is a fixed architectural boundary for commercial readiness. Changing to shared tenancy requires architectural redesign and fails the isolation principle (§2.4).

# ADR-002 — Single private cell with later isolated customer cells

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §2.4, §16.1, §22.2 |

## Context

FRANK is Steven's personal operating system and must never share infrastructure with future customer deployments. Cell isolation is the primary boundary that prevents data leakage and allows independent operation, upgrade, and recovery. A multi-tenant architecture would require shared secrets, databases, or identity realms—creating unavoidable cross-scope risks.

## Decision

Steven's FRANK runs on one isolated cell with dedicated VPS, database, object storage, secrets, identity realm, and provider accounts. Later customer cells are separate deployments, not tenants sharing a data plane.

## Alternatives considered

- Multi-tenant cell serving Steven and customers (rejected: cell isolation is security boundary; sharing violates §2.4)
- Shared infrastructure with per-customer encryption (rejected: secrets, audit, and recovery remain coupled)

## Consequences

- **Buys:** Complete data isolation; independent backups and recovery per cell; no cross-scope data leakage path; clean separation for commercial readiness
- **Costs:** Operational overhead per cell; no volume economies of scale; separate provisioning, monitoring, and support per deployment

## Measured evidence

§16.1 (topology) and §16.3.1 (cutover contract) define the infrastructure conformance; §2.4 (isolation rule) sets acceptance gates for customer-cell testing.

## Migration and exit trigger

This is a fixed architectural boundary. Moving to a shared cell violates FRANK's non-negotiable isolation principle (§1.2, principle 5). Conversely, if cell overhead becomes unmanageable, abstract it behind a standardized cell-provisioning contract that remains replaceable.

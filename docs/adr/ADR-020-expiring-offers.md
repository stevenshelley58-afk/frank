# ADR-020 — Expiring inference offers are opportunistic routes only

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §4.11, §9.4, §23.2 |

## Context

Vendors periodically offer free credits and promotional capacity. FRANK can leverage these for open-source analysis, documentation, and evaluation work. However, promotional offers expire and must never become required dependencies for production work.

## Decision

Promotional offers are verified daily from provider-controlled sources and treated as opportunistic, expiring, and lower-trust. They are used only for open-repository analysis, test generation, documentation, and synthetic evals. Private data and sensitive work always have a paid fallback.

## Alternatives considered

- Assume promotional offers will remain (rejected: expiry is a known risk; §25 lists free-offer expiry as a managed risk)
- Ignore promotional capacity entirely (rejected: wastes cost-optimization opportunity for low-stakes work)

## Consequences

- **Buys:** Cost optimization for evaluation and open work; flexibility to use transient capacity; reduced spend for analysis and documentation
- **Costs:** Route complexity for verification and fallback; promotional credentials must be rotated and redacted; no core dependency on volatile capacity

## Measured evidence

§4.11 (inference deal scout) defines daily verification, model/expiry probing, and provider-endpoint calls. §9.4 (provider pools) specifies eligibility rules for open data class. § 26 (runbooks, RB-DEAL-001) includes deal-expiry handling and fallback drills.

## Migration and exit trigger

If the cost benefits of monitoring and managing promotional capacity become excessive, disable promotional routes and rely on paid pools. The fallback path remains stable.

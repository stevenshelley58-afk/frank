# ADR-019 — Source/assertion/provenance model for the second brain

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §1.2.8, §10.1, §10.2 |

## Context

FRANK's second brain must distinguish source truth from AI-generated summaries. A memory index or vector database treats all items as equivalent; FRANK requires explicit traceability. Sources are immutable; assertions are versioned and may be corrected or superseded; provenance records the authority and time.

## Decision

Sources are immutable records linked to canonical storage. Assertions are explicit records with lifecycle states (proposed, accepted, superseded, retracted). Each assertion carries provenance (authority, time, reason). Retrievals cite sources and assertions, never hide them.

## Alternatives considered

- Vector-database-only memory (rejected: loses deletion, audit, and correction capability)
- All summaries treated as accepted truth (rejected: confuses generated content with verified facts)

## Consequences

- **Buys:** Provenance trail for every fact; clear distinction between source and interpretation; correction is auditable; deletion is complete; supports FRANK's non-negotiable principle 8 (sources outrank summaries)
- **Costs:** More storage for explicit assertion records; assertion lifecycle management overhead; rejection of pure vector-search convenience

## Measured evidence

§10.2 specifies the canonical model and lifecycle. §10.4 (retrieval pipeline) measures citation accuracy. §14.2 (review lattice, product review) checks that sources are visible and cited.

## Migration and exit trigger

The source/assertion/provenance model is a data-model choice that depends on the knowledge projection engine. Swap projection engines while keeping this model stable through the `MemoryProjection` contract.

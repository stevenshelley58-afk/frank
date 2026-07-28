# ADR-010 — Cognee is a rebuildable projection subject to eval

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §10.2, §10.3, §16.2 |

## Context

Cognee's relational, vector, and graph design fits FRANK's heterogeneous source and connected-recall needs. However, it is pre-1.0 and must be benchmarked against a PostgreSQL baseline and other candidates before becoming the default memory projection.

## Decision

Cognee is installed only in the evaluation environment until private benchmarking completes. PostgreSQL full-text plus pgvector ships as the canonical baseline. Cognee becomes the default only if it produces statistically meaningful gains without failing deletion, provenance, privacy, latency, or cost gates.

## Alternatives considered

- Cognee as default from the start (rejected: pre-1.0 stability risk; no empirical comparison)
- Graph engines only (rejected: loses full-text and vector capabilities; Graphiti is evaluated separately)
- Mem0 (rejected: designed for conversation memory, not heterogeneous source integration)

## Consequences

- **Buys:** Mature PostgreSQL baseline from day one; empirical data to justify projection choice; flexibility to use multiple projections for different retrieval classes
- **Costs:** Benchmark and evaluation work before decision; running multiple indexes during eval; operational complexity if multiple projections are adopted

## Measured evidence

§10.3 specifies the benchmark criteria: deletion, provenance, privacy, latency, and cost gates. §10.4 (retrieval pipeline) and §21 (workstream 10) include eval datasets and performance testing.

## Migration and exit trigger

The `MemoryProjection` contract remains stable. If Cognee evaluation succeeds, replace PostgreSQL/pgvector with Cognee as the default. If Cognee fails, continue PostgreSQL baseline. Future projections adopt the same contract and evaluation process.

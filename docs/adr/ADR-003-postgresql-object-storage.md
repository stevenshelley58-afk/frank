# ADR-003 — PostgreSQL and object storage are canonical

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §1.2.1, §5.2, §6.13, §11, §16.2 |

## Context

FRANK must distinguish canonical truth from AI-oriented indexes. Memories, projections, embeddings, and summaries are rebuildable from source records. If a search index or knowledge engine owns the authoritative record, deletion becomes lossy, recovery is impossible, and vendor changes mean data loss. PostgreSQL provides durable, queryable, transactional storage; object storage holds immutable sources and artifacts.

## Decision

PostgreSQL and S3-compatible object storage own canonical business truth: domain data, work records, sources, audit logs, and artifacts. Knowledge projections (embeddings, graphs, summaries) are rebuilt ephemeral indexes behind the `MemoryProjection` contract.

## Alternatives considered

- Vector database as canonical memory store (rejected: cannot guarantee deletion, recovery, or audit)
- Kafka-only event sourcing without SQL storage (rejected: requires complex reconstruction for queries and compliance)

## Consequences

- **Buys:** Deletion and correction are first-class (§1.2); recovery and compliance audits are deterministic; knowledge engines become replaceable
- **Costs:** Knowledge projection rebuild latency; embedding and graph compute overhead; multiple storage systems to monitor

## Measured evidence

§11.3 (audit model) and §10.2 (canonical source/assertion model) define the canonical contract; §10.3 (Cognee decision) and §10.4 (retrieval pipeline) measure projection performance.

## Migration and exit trigger

Switch projection engines through the `MemoryProjection` contract and rebuild jobs. If PostgreSQL scaling fails, migrate to a larger managed instance or split schemas across dedicated stores, keeping the canonical boundary stable. Changing canonical truth requires a new cell with full migration and zero-loss guarantee.

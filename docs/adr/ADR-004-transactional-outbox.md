# ADR-004 — Transactional outbox plus replaceable event transport

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §11.5, §12.4, §13.1 |

## Context

Microservice choreography requires durability and ordering. If a domain mutation commits but events never publish, subscribers miss state changes. If events publish but the domain record fails, duplicates occur. A transactional outbox ensures atomic consistency: domain state and outbox commit together, and the event transport remains replaceable.

## Decision

Domain mutations and outbox entries commit in one PostgreSQL transaction. A publisher sends events to a replaceable transport; NATS JetStream is the preferred implementation. Consumers use inbox tables and idempotency keys to survive message loss and redelivery.

## Alternatives considered

- Publish events directly from the domain layer (rejected: loses atomic guarantee and replay capability)
- Use only Kafka without a database outbox (rejected: recovery and replay become provider-dependent)

## Consequences

- **Buys:** No lost events; exactly-once delivery semantics (at consumer); transport can be swapped via adapter; recovery is deterministic
- **Costs:** Added outbox table and publisher process; slightly higher latency between commit and first event; consumer idempotency key management

## Measured evidence

§12.4 (event transport) and §13.1 (workflow engine decision) define the conformance suite. §12.5 (core event catalogue) specifies required event families and replay procedures.

## Migration and exit trigger

Transport may be replaced through the published event schema contract and consumer idempotency ledger. If PostgreSQL outbox becomes the bottleneck, move publisher to a dedicated worker or shard by event family. Exit event transport by replaying from the durable outbox table and confirming all consumers are caught up.

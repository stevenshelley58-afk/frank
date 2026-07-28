# ADR-016 — NATS JetStream transport with PostgreSQL durability anchor

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §12.4, §23.2 |

## Context

FRANK needs a lightweight, durable event transport for a single-cell system. NATS JetStream provides durable stream persistence and replay. PostgreSQL's transactional outbox remains the durability anchor, so the transport remains replaceable without losing events.

## Decision

NATS JetStream is the preferred transport for single-cell event flow. PostgreSQL outbox tables retain the durable record. Consumers use inbox tables and idempotency keys. If NATS fails or is unavailable, work queues or uses recovery procedures until it is restored.

## Alternatives considered

- Redis Streams (rejected: less durable than NATS; requires separate persistence)
- RabbitMQ (rejected: higher operational overhead than NATS for single-cell needs)
- Kafka (rejected: over-engineered for single-cell; persistent outbox makes it redundant)

## Consequences

- **Buys:** Lightweight self-hosted option; durable persistence and replay; strong ordering guarantees; no external cloud dependency
- **Costs:** Separate NATS deployment and operations; must manage stream retention and archival

## Measured evidence

§12.4 (event transport) and §13.1 (workflow engine) specify conformance tests: message ordering, idempotency, outage recovery, and replay procedures. §26 (runbooks, RB-EVT-001) includes event quarantine and replay drills.

## Migration and exit trigger

NATS may be replaced through the published event schema and outbox-first durability model. Switch transports by verifying all consumers have caught up to the outbox, then routing new events through the new transport while old messages are replayed as needed.

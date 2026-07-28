# Architecture Decision Records

This directory contains the 20 accepted Architecture Decision Records (ADRs) for the FRANK monorepo, as specified in §24 of the FRANK Complete Build Plan and System Specification v1.0.

## Index

| ADR | Title | Status | Link |
|-----|-------|--------|------|
| ADR-001 | FRANK Kernel is independent of harness and model vendors | Accepted | [ADR-001-kernel-independence.md](ADR-001-kernel-independence.md) |
| ADR-002 | Single private cell with later isolated customer cells | Accepted | [ADR-002-single-cell-isolation.md](ADR-002-single-cell-isolation.md) |
| ADR-003 | PostgreSQL and object storage are canonical | Accepted | [ADR-003-postgresql-object-storage.md](ADR-003-postgresql-object-storage.md) |
| ADR-004 | Transactional outbox plus replaceable event transport | Accepted | [ADR-004-transactional-outbox.md](ADR-004-transactional-outbox.md) |
| ADR-005 | Temporal as durable workflow implementation | Accepted | [ADR-005-temporal-workflow.md](ADR-005-temporal-workflow.md) |
| ADR-006 | Fastify domain API separate from Next.js web | Accepted | [ADR-006-fastify-domain-api.md](ADR-006-fastify-domain-api.md) |
| ADR-007 | Browser/PWA is the complete client; Tauri adds native capability | Accepted | [ADR-007-browser-pwa-tauri.md](ADR-007-browser-pwa-tauri.md) |
| ADR-008 | ACP for harness sessions, MCP for tools, A2A only at system boundaries | Accepted | [ADR-008-acp-mcp-protocols.md](ADR-008-acp-mcp-protocols.md) |
| ADR-009 | FRANK Model Broker above LiteLLM | Accepted | [ADR-009-frank-model-broker.md](ADR-009-frank-model-broker.md) |
| ADR-010 | Cognee is a rebuildable projection subject to eval | Accepted | [ADR-010-cognee-projection.md](ADR-010-cognee-projection.md) |
| ADR-011 | Buzz is collaboration, not canonical data or audit | Accepted | [ADR-011-buzz-collaboration.md](ADR-011-buzz-collaboration.md) |
| ADR-012 | OpenBao machine secrets and opaque credential handles | Accepted | [ADR-012-openbao-secrets.md](ADR-012-openbao-secrets.md) |
| ADR-013 | Hardened microVM execution for untrusted code plus privileged Ops envelopes | Accepted | [ADR-013-hardened-microvm.md](ADR-013-hardened-microvm.md) |
| ADR-014 | Evidence-ready work before production promotion review | Accepted | [ADR-014-evidence-ready-work.md](ADR-014-evidence-ready-work.md) |
| ADR-015 | One customer cell per isolated deployment | Accepted | [ADR-015-customer-cell-isolation.md](ADR-015-customer-cell-isolation.md) |
| ADR-016 | NATS JetStream transport with PostgreSQL durability anchor | Accepted | [ADR-016-nats-jetstream.md](ADR-016-nats-jetstream.md) |
| ADR-017 | OpenAPI and versioned event schemas as client/integration contracts | Accepted | [ADR-017-openapi-event-schemas.md](ADR-017-openapi-event-schemas.md) |
| ADR-018 | Plain system-font design system and progressive disclosure | Accepted | [ADR-018-plain-design-system.md](ADR-018-plain-design-system.md) |
| ADR-019 | Source/assertion/provenance model for the second brain | Accepted | [ADR-019-source-assertion-provenance.md](ADR-019-source-assertion-provenance.md) |
| ADR-020 | Expiring inference offers are opportunistic routes only | Accepted | [ADR-020-expiring-offers.md](ADR-020-expiring-offers.md) |

## Change Control

Per FRANK specification §0.2: Breaking contract changes require an ADR, a migration, compatibility tests, and a rollback path. A third-party package may not become a core dependency merely because an agent can install it. Research findings create proposals and tested branches; they do not silently alter production.

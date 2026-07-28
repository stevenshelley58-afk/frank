# ADR-006 — Fastify domain API separate from Next.js web

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §5.1, §12.1, §16.2, §23.2 |

## Context

FRANK's domain logic must remain independent of client frameworks and rendering concerns. Next.js couples web rendering with server code; Fastify is minimal, explicit, and optimized for domain API servers. A separate API layer allows multiple clients (web, desktop, mobile, extension, third-party integrations) to share one authoritative interface.

## Decision

The FRANK Domain API runs on Fastify with TypeScript, OpenAPI schema validation, and explicit routing. Next.js App Router serves the web and BFF only. The API and web application are separate deployments.

## Alternatives considered

- Next.js API routes only (rejected: couples rendering and domain; harder to version independently)
- NestJS (rejected: more boilerplate and less transparent than Fastify)
- Python service (rejected: increases runtime diversity without sufficient gain)

## Consequences

- **Buys:** Clean separation of concerns; versioned API contracts independent of UI; multiple clients without UI server load; explicit OpenAPI surface
- **Costs:** Additional service to deploy and monitor; network latency between web and API (mitigated by same VPS); separate scaling concerns

## Measured evidence

§12.1 (API style) and §12.2 (endpoint groups) define the OpenAPI contract conformance suite. §3.2–3.7 (experience specification) verify client contract compliance across web, mobile, desktop, and extension clients.

## Migration and exit trigger

API contract versioning remains stable (/v1, /v2, etc.). If Fastify becomes inadequate, migrate to another framework while preserving OpenAPI and contract semantics. Clients remain unchanged so long as API versions are maintained.

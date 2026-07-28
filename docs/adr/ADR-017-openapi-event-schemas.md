# ADR-017 — OpenAPI and versioned event schemas as client/integration contracts

| Field | Value |
|---|---|
| Status | Accepted (by FRANK specification v1.0, §24) |
| Date | 2026-07-28 |
| Owner | Steven |
| Review date | 2027-01-28 |
| Spec locators | §12.1, §12.2, §12.5 |

## Context

FRANK must support multiple clients (web, mobile, desktop, extension, integrations, and future customer APIs) from one authoritative domain model. Versioned contracts allow clients to evolve independently from the server and enable clear compatibility contracts.

## Decision

The REST API is versioned and published as OpenAPI 3.1 (/v1, /v2, etc.). Events are versioned as schema-validated types (e.g., `frank.run.started.v1`). Clients declare supported schema versions and FRANK enforces compatibility.

## Alternatives considered

- GraphQL only (rejected: REST provides simpler versioning; OpenAPI is an industry standard)
- No versioning (rejected: breaks clients on incompatible changes)

## Consequences

- **Buys:** Clear API contracts; independent client and server versioning; multiple API versions in production; generated SDK consistency; integration documentation
- **Costs:** Multiple API versions must be maintained; schema compatibility tests; client SDK generation overhead

## Measured evidence

§12.1–12.5 define API style, endpoint groups, command patterns, and event families. §6.1 (module manifest) specifies version fields. § 21 (workstream 4) includes contract suite and SDK generation conformance tests.

## Migration and exit trigger

Versioning remains stable through the contract layer. New API versions may deprecate old ones following a support window. Clients upgrade at their own pace or fall back to older API versions.

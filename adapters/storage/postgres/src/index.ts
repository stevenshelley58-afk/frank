/**
 * `@frank/adapter-postgres` — the canonical FRANK domain store.
 *
 * ADR-003: "PostgreSQL and S3-compatible object storage own canonical business
 * truth: domain data, work records, sources, audit logs, and artifacts."
 *
 * ## Why this package sits in `adapters/`
 *
 * It imports `drizzle-orm` and `pg`, both of which `tools/lint/provider-sdks.json`
 * lists as provider SDKs and denies to the `contracts` and `domain-module`
 * layers. FRANK-§17.2 says domain modules do not import provider SDKs and
 * adapters implement contracts declared in `packages/contracts`, which is
 * exactly what this package does: it depends on `@frank/contracts` and on
 * nothing else in the workspace, and the schema is a projection of the
 * FRANK-§11 model onto one replaceable storage technology.
 *
 * ## What is here
 *
 *   `schema/`        Drizzle schema for the Slice 1 bounded contexts (FRANK-§11.2).
 *   `migrations/`    drizzle-kit output plus a hand-written invariants migration.
 *   `repositories/`  the invariant-bearing write paths (ADR-004, FRANK-§11.5).
 *   `crypto/`        FRANK-§15.7 envelope encryption and blind indexes.
 *   `money.ts`       exact decimal arithmetic (FIN-002).
 *   `ids.ts`         UUIDv7 minted at the domain boundary (FRANK-§11.1).
 *   `work-state.ts`  the WORK-004 state machine, shared with the SQL trigger.
 */

export * from './ids.js';
export * from './money.js';
export * from './work-state.js';
export * from './run-state.js';
export * from './canonical-json.js';
export * from './capture-key.js';
export * from './audit-chain.js';
export * from './events.js';
export * from './db.js';
export * from './crypto/index.js';
export * from './repositories/index.js';
export * as schema from './schema/index.js';

/**
 * `@frank/api` — the FRANK Domain API (ADR-006, FRANK-§16.2).
 *
 * ## Why a separate service from the Next.js web application
 *
 * ADR-006: "FRANK's domain logic must remain independent of client frameworks
 * and rendering concerns… A separate API layer allows multiple clients (web,
 * desktop, mobile, extension, third-party integrations) to share one
 * authoritative interface."
 *
 * FRANK-§17.2 enforces the other half: `tools/lint/dependency-direction.mjs`
 * forbids one app importing another app's internals, so the web application
 * cannot reach into this one and has to go through the versioned contract —
 * which is the point of having a versioned contract.
 *
 * ## Request path, once, in order
 *
 *     validate (Zod, FRANK-§17.3)
 *       -> authenticate (@frank/identity port, FRANK-§15.2)
 *       -> authorize    (capability from the route declaration, FRANK-§3.8)
 *       -> build + sign an ActionEnvelope (FRANK-§6.9)
 *       -> evaluate policy (@frank/policy, the action boundary)
 *       -> execute in ONE transaction (@frank/adapter-postgres, ADR-004)
 *       -> respond
 *       -> submit enrichment off the request path (UX-004)
 *
 * Every step is in `plugins/route-handler.ts` except the last three, which are
 * per-route because what they execute differs.
 */

export { buildServer, buildSignerRegistry, ALL_ROUTES } from './server.js';
export type { BuildServerOptions, BuiltServer } from './server.js';
export { resolveConfig } from './config.js';
export type { AppConfig, FrankEnvironment } from './config.js';
// ADR-017. The document is also served at `GET /v1/openapi.json`; this export
// exists so a build or contract-diff task can produce it without a running
// server, since it is a function of the route registry alone.
export { buildOpenApiDocument } from './openapi.js';
export { PostgresDomainStore } from './services/postgres-store.js';
export { HealthService, DEFAULT_HEALTH_THRESHOLDS } from './services/health.js';
export {
  InProcessEnrichmentDispatcher,
  noopEnrichmentHandler,
} from './services/enrichment.js';
export type {
  EnrichmentDispatcher,
  EnrichmentJob,
  EnrichmentStatus,
} from './services/enrichment.js';
export type { DomainStore } from './services/store.js';
export * from './problem.js';

/**
 * `@frank/contracts` — the frozen cross-cutting contract surface (FRANK-§6).
 *
 * Every type here is hand-written to mirror one of the JSON Schemas in
 * `./schemas`, which remain the normative artifact. Ajv validates instances
 * against those schemas (`tools/registry/validate-contracts.mjs`); the types
 * here make a drift between schema and code a compile error.
 *
 * Nothing in this package may import from any other workspace package.
 */

export * from './common.js';
export * from './classification.js';
export * from './event-envelope.js';
export * from './policy.js';
export * from './evidence.js';
export * from './module-manifest.js';
export * from './screen.js';
export * from './pack.js';

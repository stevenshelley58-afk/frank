/**
 * `@frank/policy` — the FRANK-§6.9 action boundary.
 *
 * ## Why this is a shared package and not a domain module or an adapter
 *
 * FRANK-§17.2, as mechanised by `tools/lint/dependency-direction.mjs`, gives
 * each layer a fixed set of things it may import:
 *
 *     packages        -> contracts, packages
 *     domain-module   -> contracts, packages, domain-module
 *     adapter         -> contracts, packages
 *     app             -> everything above
 *
 * Policy has to be reachable from *all* of them. The API evaluates policy at
 * every command, the agent kernel will evaluate it before every tool call
 * (FRANK-§7.1), and the Execution Service will re-check the decision before it
 * exchanges a credential handle (FRANK-§6.9). Only the `packages` layer is
 * importable from every one of those places: a `modules/policy` could not be
 * used by an adapter, and an `adapters/policy` could not be used by a module.
 *
 * The second reason is negative. FRANK-§6.9 says policy is evaluated *on an
 * immutable envelope* and *not inferred from a model's confidence*. A package
 * that may not import a provider SDK, may not open a database, and takes its
 * clock as a parameter cannot quietly grow a dependency on either. The layer
 * choice is a constraint on this code, not a filing decision.
 *
 * ## What is here
 *
 *   `operating-policy.ts`  FRANK-§7.6's table, as data. The engine has no
 *                          per-operation conditionals anywhere.
 *   `envelope.ts`          canonicalisation, hashing, deep-freezing.
 *   `signing.ts`           signer registry and signature verification —
 *                          "models may propose but cannot sign".
 *   `nonce.ts`             single-use enforcement.
 *   `authorization.ts`     standing-authorization matching and revocation.
 *   `trust.ts`             COMMS-004 / FRANK-§15.5 untrusted-influence gate.
 *   `engine.ts`            the decision procedure.
 *   `decision.ts`          the executor-side re-check.
 *   `conformance/`         the eight attacks FRANK-§6.9 makes mandatory.
 */

export * from './operating-policy.js';
export * from './envelope.js';
export * from './signing.js';
export * from './nonce.js';
export * from './authorization.js';
export * from './trust.js';
export * from './engine.js';
export * from './decision.js';

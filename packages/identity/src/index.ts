/**
 * `@frank/identity` — FRANK-§15.2 identity and FRANK-§2.2 roles.
 *
 * ## Why a shared package rather than code inside `apps/api`
 *
 * Three consumers already exist or are already specified: the domain API, the
 * worker that runs automations under a service identity (FRANK-§13), and the
 * operator surface (FRANK-§3.8 `/system`). `tools/lint/dependency-direction.mjs`
 * forbids one app importing another app's internals, so identity living in
 * `apps/api` would have to be duplicated or reached for illegally.
 *
 * The role model is also *contract-adjacent*: FRANK-§2.2 says the authorization
 * model must support six roles "even though Steven's cell initially assigns them
 * to one person". A vocabulary that several layers must agree on belongs where
 * several layers can import it.
 *
 * It is not in `packages/contracts` because that package "may not import any
 * workspace package" and, more importantly, is frozen — the capability matrix is
 * expected to grow with every slice, and a frozen contract is the wrong home for
 * something that changes on purpose.
 *
 * ## Authentik
 *
 * Is not here. FRANK-§16.2: "implementation remains behind the identity
 * contract." `provider.ts` is the contract; `local-signed-session.ts` is the
 * Slice 1 implementation; the Authentik OIDC provider is a future third file and
 * no change anywhere else.
 */

export * from './roles.js';
export * from './provider.js';
export * from './local-signed-session.js';
export * from './authorize.js';

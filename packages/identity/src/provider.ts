/**
 * The identity provider port — FRANK-§15.2, FRANK-§16.2.
 *
 * FRANK-§16.2 names Authentik as the preferred implementation and then says, in
 * the same row, "**implementation remains behind the identity contract**". This
 * file is that contract. Nothing in this package, in `apps/api`, or in any
 * future caller imports an Authentik client, knows an Authentik URL, or parses
 * an Authentik token shape.
 *
 * ## What the port is, and what it deliberately is not
 *
 * {@link IdentityProvider.authenticate} takes *credential material as presented*
 * and returns a {@link Principal} or a typed failure. It does not take a request
 * object: a provider that could read the URL could authorize on the route, and
 * FRANK-§3.8 forbids exactly that ("server authorization never trusts the client
 * route or manifest"). Handing the provider only the bearer credential means a
 * route-dependent identity is not expressible.
 *
 * It is synchronous-or-async by returning a promise, because an OIDC provider
 * will need to fetch a JWKS and the Slice 1 local verifier will not. A port
 * whose shape assumed the fast case would force the real one into a cache with
 * no way to await a refresh.
 *
 * ## What Slice 1 ships
 *
 * `local-signed-session.ts` implements this interface over an HMAC-signed
 * session token minted by this same process. That is honestly what Slice 1 is:
 * one user, no Authentik deployed yet, FRANK-§16.4's environments not yet
 * standing. When Authentik arrives it is a second class implementing this
 * interface and one line of composition in `apps/api/src/server.ts` — no call
 * site changes, which is the requirement.
 */

import type { Capability, Role } from './roles.js';

/**
 * An authenticated principal.
 *
 * FRANK-§11.5 wants "authenticated actor and delegated actor" recorded
 * separately on every audit entry, so both live here rather than being collapsed
 * into one id at the boundary and reconstructed later.
 */
export interface Principal {
  /** Stable subject identifier from the identity provider. `user/steven`. */
  readonly principalId: string;
  /** FRANK-§2.4: a principal is always scoped to one cell. */
  readonly cellId: string;
  /** FRANK-§2.2. At least one; the cell's owner holds several in Slice 1. */
  readonly roles: readonly Role[];
  /**
   * Explicit operation grants carried by a workload identity. Human sessions
   * derive authority from roles; service identities must be scoped narrowly at
   * issuance instead of inheriting every capability of their generic role.
   */
  readonly capabilities?: readonly Capability[];
  /**
   * FRANK-§7.5 delegation. Set when a human's session is being exercised by an
   * agent or service on their behalf. The *delegate* is what authorization
   * matches on — see `packages/policy/src/authorization.ts` for why.
   */
  readonly delegatedActorId?: string;
  /** Session identifier, for FRANK-§15.2's "device and session inventory". */
  readonly sessionId: string;
  /** FRANK-§15.2 "short-lived sessions". */
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /**
   * FRANK-§15.2: "Step-up authentication for recovery, trust-root, and
   * high-consequence actions." Recorded so a later high-consequence route can
   * require it without re-authenticating everything.
   */
  readonly authenticationMethods: readonly AuthenticationMethod[];
  /** Which provider vouched for this principal. Audited; never trusted as input. */
  readonly providerId: string;
}

/** FRANK-§15.2: "Passkeys preferred; phishing-resistant MFA required." */
export type AuthenticationMethod =
  | 'passkey'
  | 'webauthn'
  | 'password'
  | 'totp'
  | 'recovery_code'
  | 'workload_identity'
  | 'local_signed_session';

export type AuthenticationFailureReason =
  | 'missing_credential'
  | 'malformed_credential'
  | 'unknown_key'
  | 'bad_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'wrong_audience'
  | 'wrong_cell'
  | 'unknown_role'
  | 'unknown_capability'
  | 'revoked';

export type AuthenticationResult =
  | { readonly authenticated: true; readonly principal: Principal }
  | {
      readonly authenticated: false;
      readonly reason: AuthenticationFailureReason;
      /**
       * Safe to log and to return in a problem detail. Implementations must not
       * put credential material here — see the note in `local-signed-session.ts`.
       */
      readonly detail: string;
    };

export interface PresentedCredential {
  /** `Bearer`, `DPoP`, … — the scheme as presented. */
  readonly scheme: string;
  /** The credential value. Treated as `secret` class: never logged, never echoed. */
  readonly value: string;
}

export interface IdentityProvider {
  /** Stable id recorded on the principal and in audit entries. */
  readonly providerId: string;
  /**
   * Verify a presented credential. Must never throw for a bad credential —
   * a rejection is a result, so it can be counted (FRANK-§19.2 "authorization
   * denials") without a try/catch at every call site.
   */
  authenticate(credential: PresentedCredential): Promise<AuthenticationResult>;
  /**
   * FRANK-§15.2: "Device and session inventory with revocation." Returns `true`
   * when the session was known and is now revoked.
   */
  revokeSession(sessionId: string): Promise<boolean>;
}

/**
 * FRANK-§15.2: "Step-up authentication for … high-consequence actions."
 *
 * A principal whose only authentication method is a bearer session has not
 * proven presence. Phishing-resistant methods are the ones that have.
 */
const PHISHING_RESISTANT: readonly AuthenticationMethod[] = ['passkey', 'webauthn'];

export function hasPhishingResistantAuthentication(principal: Principal): boolean {
  return principal.authenticationMethods.some((method) => PHISHING_RESISTANT.includes(method));
}

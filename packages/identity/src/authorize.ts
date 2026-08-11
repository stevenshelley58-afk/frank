/**
 * Server-side authorization — FRANK-§3.8, FRANK-§15.2, FRANK-§2.2.
 *
 * FRANK-§3.8: "**Server authorization never trusts the client route or
 * manifest.**"
 *
 * {@link authorize} therefore takes a {@link Capability} — a value from the same
 * operation vocabulary the policy engine uses — and a {@link Principal}. It has
 * no parameter for a path, a screen id, a manifest, a `X-Frank-Screen` header,
 * or anything else the client could choose. A caller wanting to authorize "the
 * route the client asked for" has nothing to pass, which is the enforcement.
 *
 * The server derives the capability from the route *it matched*, in the route's
 * own definition, at registration time. See `apps/api/src/schema/registry.ts`:
 * `capability` is a property of the route declaration, colocated with the
 * handler, not read from the request.
 *
 * ## This is the first of two gates, not the only one
 *
 * FRANK-§15.5.6: "Apply policy after the model proposes an action." The order in
 * `apps/api` is: authenticate -> **authorize (here)** -> build an action
 * envelope -> evaluate FRANK-§6.9 policy -> execute. Identity answers "may this
 * principal ask for this kind of thing"; policy answers "may this exact action
 * happen, right now, on this exact target". Collapsing them would lose the
 * second question, which is the one FRANK-§6.9's conformance tests are about.
 */

import { hasPhishingResistantAuthentication } from './provider.js';
import type { Principal } from './provider.js';
import type { Capability } from './roles.js';
import { rolesGrant } from './roles.js';

export type AuthorizationRefusal =
  | 'session_expired'
  | 'wrong_cell'
  | 'capability_not_granted'
  | 'step_up_required'
  | 'unknown_capability';

export type AuthorizationVerdict =
  | { readonly authorized: true }
  | {
      readonly authorized: false;
      readonly refusal: AuthorizationRefusal;
      readonly detail: string;
    };

export interface AuthorizeInput {
  readonly principal: Principal;
  /**
   * Derived by the server from the route it matched. Never read from the
   * request — see the module comment.
   */
  readonly capability: Capability;
  /** FRANK-§2.4: the cell the server is operating as. */
  readonly cellId: string;
  readonly now: Date;
  /**
   * FRANK-§15.2: "Step-up authentication for recovery, trust-root, and
   * high-consequence actions." Declared per route, not inferred.
   */
  readonly requiresPhishingResistantAuthentication?: boolean;
}

export function authorize(input: AuthorizeInput): AuthorizationVerdict {
  // FRANK-§2.4 before anything else: a principal from another cell is not a
  // principal with fewer permissions, it is not a principal here at all.
  if (input.principal.cellId !== input.cellId) {
    return {
      authorized: false,
      refusal: 'wrong_cell',
      detail: 'principal is scoped to a different cell (FRANK-§2.4)',
    };
  }

  // FRANK-§15.2 "short-lived sessions": expiry is checked at every authorization,
  // not only at authentication, so a long-lived request cannot outlive its
  // session.
  if (input.now.getTime() >= input.principal.expiresAt.getTime()) {
    return {
      authorized: false,
      refusal: 'session_expired',
      detail: 'session expired before this operation was authorized',
    };
  }

  const explicitlyScopedService =
    input.principal.roles.includes('service_identity') &&
    input.principal.capabilities?.includes(input.capability) === true;
  if (!rolesGrant(input.principal.roles, input.capability) && !explicitlyScopedService) {
    return {
      authorized: false,
      refusal: 'capability_not_granted',
      detail:
        `roles [${input.principal.roles.join(', ')}] do not grant ${JSON.stringify(input.capability)} (FRANK-§2.2). ` +
        'An operation absent from the capability matrix is granted to nobody, including the owner.',
    };
  }

  if (
    input.requiresPhishingResistantAuthentication === true &&
    !hasPhishingResistantAuthentication(input.principal)
  ) {
    return {
      authorized: false,
      refusal: 'step_up_required',
      detail:
        'this operation requires phishing-resistant authentication; the session was established with a weaker method (FRANK-§15.2)',
    };
  }

  return { authorized: true };
}

/**
 * The actor reference the storage layer wants.
 *
 * `adapters/storage/postgres` records `{ kind, id }` with `kind` from its
 * `actor_kind` enum. Mapping the FRANK-§2.2 role onto that enum happens here,
 * once, rather than at each call site — and `service_identity` maps to `service`
 * rather than to `user`, so an audit entry never claims a machine was a person.
 */
export function actorKindOf(principal: Principal): 'user' | 'agent' | 'service' {
  if (principal.roles.includes('service_identity')) return 'service';
  if (principal.delegatedActorId !== undefined) return 'agent';
  return 'user';
}

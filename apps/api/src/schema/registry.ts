/**
 * The route registry — FRANK-§12.1, FRANK-§12.2, FRANK-§3.8, ADR-017.
 *
 * Every route is declared as a value before it is registered with Fastify. That
 * indirection buys three things the specification explicitly requires and which
 * a bare `app.get(path, handler)` cannot provide:
 *
 *   1. **FRANK-§12.2's operation metadata.** "Every OpenAPI operation declares
 *      actor roles, data classes, standing-policy eligibility, request and
 *      response schemas, idempotency semantics, consistency, error catalogue,
 *      rate limits, and audit obligations." Those are fields of
 *      {@link RouteDefinition}, so an operation missing one does not compile.
 *   2. **ADR-017's OpenAPI 3.1 document, generated rather than written.**
 *      `openapi.ts` walks this registry. A route that exists cannot be absent
 *      from the document, and a documented operation cannot be one nothing
 *      serves — FRANK-§12.2's "The generated contract suite rejects undocumented
 *      operations", from the other direction.
 *   3. **FRANK-§3.8's "server authorization never trusts the client route".**
 *      `capability` is a property of the declaration, colocated with the
 *      handler, resolved at registration time. There is no code path where a
 *      capability is read from a request.
 *
 * ## Zod at the boundary, JSON Schema on the wire
 *
 * FRANK-§17.3: "Zod/JSON Schema at trust boundaries." Zod 4 emits draft-2020-12
 * JSON Schema natively (`z.toJSONSchema`), which is exactly OpenAPI 3.1's
 * dialect — so one declaration validates the request at runtime *and* documents
 * it, with no second source of truth and no conversion library
 * (FRANK-§0.2: a dependency has to earn its place).
 *
 * Validation runs here rather than through Fastify's own AJV pipeline on
 * purpose: Fastify's request validation coerces, and a coercing validator at a
 * trust boundary is a parser that accepts more than the schema says.
 */

import { z } from 'zod';

import type { DataClass } from '@frank/contracts';
import type { Capability, Role } from '@frank/identity';

import type { ProblemKind } from '../problem.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** FRANK-§12.2's per-operation consistency declaration. */
export type ConsistencyModel =
  /** Reads the canonical row inside the request. */
  | 'read_own_writes'
  /** Reads a projection that may lag; the response carries its freshness. */
  | 'eventually_consistent';

/** FRANK-§12.1: "Idempotency keys on all action endpoints." */
export type IdempotencyMode =
  /** GETs. Naturally idempotent, no key. */
  | 'safe'
  /** Requires a key; a replay returns the original result. */
  | 'required_key'
  /** Requires a key; a replay is refused. */
  | 'required_key_single_use';

export interface RateLimit {
  readonly requestsPerMinute: number;
  readonly burst: number;
}

/**
 * One operation, fully declared.
 *
 * `Schemas` is generic so a handler receives parsed, typed values rather than
 * `unknown` plus a cast.
 */
export interface RouteDefinition<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TResponse extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** OpenAPI `operationId`. Unique across the registry; checked on build. */
  readonly operationId: string;
  readonly method: HttpMethod;
  /** Fastify path with `:param` placeholders; converted to `{param}` for OpenAPI. */
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  /** FRANK-§12.2 endpoint group, e.g. `/v1/work`. Used as the OpenAPI tag. */
  readonly group: string;

  /* -------------------------------------------- FRANK-§12.2 declarations --- */

  /** FRANK-§2.2 roles that may invoke it. Derived from the capability matrix. */
  readonly actorRoles: readonly Role[];
  /**
   * FRANK-§3.8: resolved server-side from *this declaration*, never from the
   * request. `null` marks an unauthenticated transport probe (liveness), which
   * is the only kind of route permitted to have no capability.
   */
  readonly capability: Capability | null;
  /** FRANK-§2.3 classes this operation may return. */
  readonly dataClasses: readonly DataClass[];
  /** FRANK-§6.9: whether a standing authorization can cover this operation. */
  readonly standingPolicyEligible: boolean;
  /**
   * The FRANK-§6.9 operation name this route proposes to the policy engine, or
   * `null` for routes that take no policy decision (liveness).
   */
  readonly policyOperation: string | null;
  readonly idempotency: IdempotencyMode;
  readonly consistency: ConsistencyModel;
  /** FRANK-§12.2 "error catalogue". */
  readonly errors: readonly ProblemKind[];
  readonly rateLimit: RateLimit;
  /** FRANK-§12.2 "audit obligations"; FRANK-§11.5 actions this route appends. */
  readonly auditObligations: readonly string[];
  /** FRANK-§15.2: high-consequence routes demand a phishing-resistant session. */
  readonly requiresStepUp?: boolean;

  /* --------------------------------------------------------- the schemas --- */

  readonly params?: TParams;
  readonly query?: TQuery;
  readonly body?: TBody;
  readonly response: TResponse;
  readonly successStatus: number;
  /** A declared binary response still gets central auth/input validation, but
   * its body is intentionally streamed rather than JSON-schema validated. */
  readonly responseMode?: 'json' | 'stream';
}

export type AnyRouteDefinition = RouteDefinition<
  z.ZodTypeAny,
  z.ZodTypeAny,
  z.ZodTypeAny,
  z.ZodTypeAny
>;

/**
 * Declare a route.
 *
 * A function rather than an object literal so the generic parameters are
 * inferred from the schemas and the handler gets typed inputs for free.
 */
export function defineRoute<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TResponse extends z.ZodTypeAny = z.ZodTypeAny,
>(
  definition: RouteDefinition<TParams, TQuery, TBody, TResponse>,
): RouteDefinition<TParams, TQuery, TBody, TResponse> {
  return definition;
}

/**
 * Check the registry's own invariants.
 *
 * FRANK-§3.8: "Duplicate paths … fail continuous integration." Run at server
 * construction, so a duplicate is a startup failure rather than a surprise at
 * the first request.
 */
export function assertRegistryConsistent(routes: readonly AnyRouteDefinition[]): void {
  const byOperation = new Set<string>();
  const byRoute = new Set<string>();

  for (const route of routes) {
    if (byOperation.has(route.operationId)) {
      throw new Error(`duplicate operationId ${JSON.stringify(route.operationId)} in the route registry`);
    }
    byOperation.add(route.operationId);

    const key = `${route.method} ${route.path}`;
    if (byRoute.has(key)) {
      throw new Error(`duplicate route ${key} in the registry (FRANK-§3.8)`);
    }
    byRoute.add(key);

    if (!route.path.startsWith('/v1/')) {
      throw new Error(`route ${key} is not under a version prefix (ADR-017)`);
    }
    if (route.errors.length === 0) {
      throw new Error(
        `route ${key} declares no error catalogue; FRANK-§12.2 requires one on every operation`,
      );
    }
    if (route.method !== 'GET' && route.idempotency === 'safe') {
      throw new Error(
        `route ${key} is an action endpoint with no idempotency key requirement (FRANK-§12.1)`,
      );
    }
    if (route.capability === null && route.policyOperation !== null) {
      throw new Error(
        `route ${key} takes a policy decision but declares no capability; both gates or neither`,
      );
    }
    if (route.dataClasses.includes('secret')) {
      throw new Error(
        `route ${key} declares it may return \`secret\`-class data. FRANK-§2.3 forbids it: secrets never leave as values.`,
      );
    }
  }
}

/* ------------------------------------------------------- shared schemas --- */

/**
 * FRANK-§12.1: "Explicit cell, actor, policy, trace, and request identifiers."
 *
 * Present on every response body as well as in headers. Headers alone would be
 * lost by any client that stores the body, and the identifiers are what makes a
 * stored response explainable later.
 */
export const identifiersSchema = z.object({
  cell_id: z.string().min(1),
  actor_id: z.string().min(1),
  request_id: z.string().min(1),
  correlation_id: z.string().min(1),
  trace_id: z.string().min(1),
  policy_version: z.string().min(1),
});

/**
 * FRANK-§12.2: a list response declares "freshness, projection lag".
 * UX-007: "The interface must show stale data and sync failures rather than
 * silently presenting an old state as current."
 *
 * `state` is the OPS-004 vocabulary, not a boolean, because "stale" and
 * "degraded" are different things a client renders differently, and a boolean
 * would force the client to guess which.
 */
export const freshnessSchema = z.object({
  /** OPS-004 state of the data behind this response. */
  state: z.enum(['healthy', 'degraded', 'unavailable', 'stale', 'intentionally_paused']),
  /** When the underlying data was last known good. */
  as_of: z.string(),
  /** UX-007: "displays age". Seconds since `as_of`. */
  age_seconds: z.number().int().nonnegative(),
  /** FRANK-§12.2 "projection lag". Null when the read is canonical. */
  projection_lag_seconds: z.number().int().nonnegative().nullable(),
  /** UX-007: "and recovery action". Null only when `state` is `healthy`. */
  recovery_action: z.string().nullable(),
});

/** FRANK-§6.9 decision, as returned by a command endpoint (FRANK-§12.3). */
export const policyDecisionSchema = z.object({
  result: z.enum(['allow', 'allow_with_limits', 'hold_for_review', 'deny']),
  policy_version: z.string(),
  reasons: z.array(z.string()),
  evaluated_envelope_hash: z.string(),
  matched_authorization_id: z.string().optional(),
  obligations: z.array(z.string()),
  limits: z.object({
    budget: z.object({
      currency: z.string(),
      maximum_spend: z.number(),
      maximum_wall_clock_seconds: z.number(),
      maximum_tokens: z.number().optional(),
    }),
    network_scope: z.object({
      mode: z.enum(['none', 'allowlist', 'proxied-allowlist']),
      allowed_hosts: z.array(z.string()),
    }),
    maximum_data_class: z.enum(['open', 'internal', 'private', 'sensitive', 'secret']),
    retry_limit: z.number().int().optional(),
  }),
  expires_at: z.string().optional(),
});

/**
 * FRANK-§12.3's command body.
 *
 * `command_id` doubles as the idempotency key. FRANK-§12.1 requires
 * "idempotency keys on all action endpoints" and FRANK-§12.3's body already
 * carries a `command_id`; treating them as two different values would mean two
 * things to keep in agreement and one of them eventually forgotten. The
 * `Idempotency-Key` header is accepted as an alias and must agree — see
 * `plugins/request-context.ts`.
 */
export const commandEnvelopeSchema = z.object({
  command_id: z.string().min(8).max(128),
  expected_version: z.number().int().positive().optional(),
  reason: z.string().max(2_000).optional(),
  dry_run: z.boolean().default(false),
});

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
  cell_id: z.string(),
  request_id: z.string(),
  correlation_id: z.string(),
  policy_version: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

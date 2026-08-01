/**
 * `/v1/auth/dev-session` — a development-only session mint (FRANK-§16.2 seam).
 *
 * ## Why this exists and why it is NOT a normal route
 *
 * Slice 1 has one user and no Authentik deployed (that is Workstream 3). The
 * browser nevertheless needs a bearer session to call any authenticated route,
 * and there is no login flow yet to produce one. This endpoint is the smallest
 * honest bridge: it mints an owner session with the very key the verifier holds,
 * so the token it returns actually authenticates.
 *
 * It is registered **directly on the Fastify instance**, deliberately outside
 * {@link registerRoute} and the route registry, for two reasons:
 *
 *   * the registry's capability gate authenticates before authorizing — a route
 *     whose job is to *issue* a session cannot sit behind a gate that demands
 *     one; that is a circle with no entrance;
 *   * the OpenAPI document is generated from the registry, and a dev-only mint
 *     must never be described as part of the public contract (ADR-017).
 *
 * `/v1/openapi.json` and `/v1/system/rebuild` are registered directly for the
 * same class of reason; this is the third member of that small family.
 *
 * ## Safety: it refuses to exist outside development
 *
 * FRANK-§15.1 names reconnaissance and secret leakage among the threats; an
 * unauthenticated endpoint that hands out owner sessions would be a total
 * compromise in any shared environment. So the handler checks `config.environment`
 * on **every request** and answers 403 `forbidden` unless it is `development` or
 * `test`. The check is at request time, not build time, so it can be exercised
 * by a test (the conformance suite asserts the 403) rather than only trusted by
 * construction. In `staging`, `production`, `recovery`, and `preview` this route
 * is effectively a wall.
 *
 * When Authentik arrives this file is deleted and the OIDC provider is composed
 * in `server.ts` — no call site elsewhere changes, which is the FRANK-§16.2
 * requirement the port exists to protect.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { LocalSignedSessionProvider } from '@frank/identity';
import type { Role } from '@frank/identity';

import type { AppConfig, FrankEnvironment } from '../config.js';
import { buildRequestContext, identifierHeaders } from '../context.js';
import { POLICY_VERSION } from '@frank/policy';
import { PROBLEM_CONTENT_TYPE, ProblemError, toProblemDetail } from '../problem.js';

/** FRANK-§2.1: Steven holds every role in his single-user cell. */
const DEV_OWNER_ROLES: readonly Role[] = [
  'owner',
  'operator',
  'builder',
  'member',
  'reviewer',
];

const DEV_PRINCIPAL_ID = 'user/steven';
const DEV_SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7; // one week; refresh by re-calling.

/** Environments in which an unauthenticated session mint is permitted. */
function environmentPermitsDevAuth(environment: FrankEnvironment): boolean {
  return environment === 'development' || environment === 'test';
}

export interface DevAuthRouteDependencies {
  readonly config: AppConfig;
  readonly now: () => Date;
}

export function registerDevAuthRoute(
  app: FastifyInstance,
  dependencies: DevAuthRouteDependencies,
): void {
  // A minting provider built from the SAME key material the verifier uses
  // (config.sessionSigningKey), so the tokens issued here authenticate against
  // the live identity provider. `issue` is intentionally not on the
  // IdentityProvider port — the Authentik provider has no issue method — which
  // is why we construct a LocalSignedSessionProvider directly here rather than
  // reaching through the injected `identity`.
  const minter = new LocalSignedSessionProvider({
    signingKey: dependencies.config.sessionSigningKey,
    audience: dependencies.config.audience,
    cellId: dependencies.config.cellId,
    now: dependencies.now,
  });

  app.post('/v1/auth/dev-session', async (request, reply) => {
    const context = buildRequestContext({
      cellId: dependencies.config.cellId,
      policyVersion: POLICY_VERSION,
      inboundCorrelationId: Array.isArray(request.headers['x-correlation-id'])
        ? request.headers['x-correlation-id'][0]
        : request.headers['x-correlation-id'],
      now: dependencies.now(),
    });
    void reply.headers(identifierHeaders(context));

    if (!environmentPermitsDevAuth(dependencies.config.environment)) {
      const problem = toProblemDetail(
        new ProblemError(
          'forbidden',
          'The development session mint is not available in this environment.',
        ),
        {
          cellId: context.cellId,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      void reply.code(403).type(PROBLEM_CONTENT_TYPE);
      return problem;
    }

    const sessionId = `dev-${randomUUID()}`;
    const token = minter.issue({
      principalId: DEV_PRINCIPAL_ID,
      roles: DEV_OWNER_ROLES,
      sessionId,
      lifetimeSeconds: DEV_SESSION_LIFETIME_SECONDS,
      methods: ['local_signed_session'],
    });

    void reply.code(200);
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: DEV_SESSION_LIFETIME_SECONDS,
      principal_id: DEV_PRINCIPAL_ID,
      roles: [...DEV_OWNER_ROLES],
      session_id: sessionId,
      environment: dependencies.config.environment,
    };
  });
}

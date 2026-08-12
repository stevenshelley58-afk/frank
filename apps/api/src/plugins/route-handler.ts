/**
 * The single path every request takes — FRANK-§3.8, FRANK-§12.1, FRANK-§17.3.
 *
 * Registering a route means calling {@link registerRoute} with a
 * {@link RouteDefinition} and a handler. Everything the specification requires to
 * happen on every request happens here, once, rather than being repeated in each
 * handler where one of them would eventually be missed:
 *
 *   * parse and validate `params`, `query`, and `body` with the route's Zod
 *     schemas (FRANK-§17.3: "Zod/JSON Schema at trust boundaries");
 *   * authenticate through the {@link IdentityProvider} port;
 *   * authorize with the capability *from the route declaration*, never from the
 *     request (FRANK-§3.8);
 *   * resolve and cross-check the idempotency key (FRANK-§12.1);
 *   * attach the FRANK-§12.1 identifier headers;
 *   * validate the response against the route's schema before sending it.
 *
 * ## The response is validated too
 *
 * Unusual, and deliberate. FRANK-§12.2 says the generated contract suite rejects
 * undocumented operations; validating outbound bodies is the same rule pointed
 * inward. It is also the mechanical guard for FRANK-§2.3: the response schemas
 * have no field that can hold a `secret`, so a handler that accidentally put one
 * in an extra property gets a 500 instead of a leak. Zod's default `strict`
 * object parsing strips unknown keys — the schema is the allowlist.
 *
 * The cost is one extra parse per response. On a Slice 1 payload that is
 * microseconds, and UX-004's budget is 500 ms.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { IdentityProvider, Principal } from '@frank/identity';
import { authorize } from '@frank/identity';

import { buildRequestContext, identifierHeaders } from '../context.js';
import type { RequestContext } from '../context.js';
import { ProblemError } from '../problem.js';
import type { AnyRouteDefinition, RouteDefinition } from '../schema/registry.js';

export interface RouteHandlerDependencies {
  readonly cellId: string;
  readonly policyVersion: string;
  readonly identity: IdentityProvider;
  readonly now: () => Date;
}

export interface HandlerInput<TParams, TQuery, TBody> {
  readonly params: TParams;
  readonly query: TQuery;
  readonly body: TBody;
  readonly context: RequestContext;
  /** Present whenever the route declares a capability. */
  readonly principal: Principal;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
}

export type RouteHandler<TParams, TQuery, TBody, TResponse> = (
  input: HandlerInput<TParams, TQuery, TBody>,
) => Promise<TResponse>;

/** Fastify path `:id` -> OpenAPI `{id}`. Used by `openapi.ts`. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function fieldErrorsOf(error: z.ZodError): Array<{ path: string; message: string }> {
  // Paths and messages only. Never `error.issues[].input`: that is the rejected
  // value, and the rejected value of a capture body is user content (FRANK-§2.3).
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? '<root>' : issue.path.join('.'),
    message: issue.message,
  }));
}

function parseOrProblem<T extends z.ZodTypeAny>(
  schema: T | undefined,
  value: unknown,
  where: string,
): z.output<T> | undefined {
  if (schema === undefined) return undefined;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new ProblemError('validation_failed', `${where} failed schema validation`, {
      fieldErrors: fieldErrorsOf(result.error),
    });
  }
  return result.data as z.output<T>;
}

/**
 * Resolve the FRANK-§12.1 idempotency key.
 *
 * The key is `command_id` from the FRANK-§12.3 body. `Idempotency-Key` is
 * accepted as a header alias and **must agree** when both are present.
 * Disagreement is a 409 rather than a "header wins" rule, because a client that
 * sends two different keys does not know which action it is retrying, and
 * picking one for it would silently make the retry a new action.
 */
function resolveIdempotencyKey(
  route: AnyRouteDefinition,
  body: unknown,
  headerValue: string | undefined,
): string | undefined {
  if (route.idempotency === 'safe') return undefined;

  const bodyKey =
    typeof body === 'object' && body !== null && 'command_id' in body
      ? (body as { command_id?: unknown }).command_id
      : typeof body === 'object' && body !== null && 'idempotency_key' in body
        ? (body as { idempotency_key?: unknown }).idempotency_key
        : undefined;

  const fromBody = typeof bodyKey === 'string' ? bodyKey : undefined;

  if (fromBody !== undefined && headerValue !== undefined && fromBody !== headerValue) {
    throw new ProblemError(
      'idempotency_conflict',
      'Idempotency-Key header and command_id disagree. Send one, or send the same value in both (FRANK-§12.1, FRANK-§12.3).',
    );
  }

  const key = fromBody ?? headerValue;
  if (key === undefined) {
    throw new ProblemError(
      'validation_failed',
      'This action endpoint requires an idempotency key: send command_id in the body or an Idempotency-Key header (FRANK-§12.1).',
    );
  }
  return key;
}

export function registerRoute<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
>(
  app: FastifyInstance,
  dependencies: RouteHandlerDependencies,
  route: RouteDefinition<TParams, TQuery, TBody, TResponse>,
  handler: RouteHandler<z.output<TParams>, z.output<TQuery>, z.output<TBody>, z.input<TResponse>>,
): void {
  app.route({
    method: route.method,
    url: route.path,
    // Fastify's own schema validation is deliberately not configured. Its AJV
    // instance coerces types by default, and a coercing validator at a trust
    // boundary accepts inputs the declared schema does not describe.
    handler: async (request, reply) => {
      const context = buildRequestContext({
        cellId: dependencies.cellId,
        policyVersion: dependencies.policyVersion,
        inboundCorrelationId: headerOf(request, 'x-correlation-id'),
        now: dependencies.now(),
      });
      request.frankContext = context;

      for (const [name, value] of Object.entries(identifierHeaders(context))) {
        void reply.header(name, value);
      }

      /* ---- authenticate ------------------------------------------------- */
      let principal: Principal | undefined;
      if (route.capability !== null) {
        principal = await authenticateOrThrow(dependencies.identity, request);
        context.principal = principal;
        // Re-emit the actor now that it is known.
        void reply.header('x-frank-actor-id', principal.principalId);

        /* ---- authorize (FRANK-§3.8: capability from the DECLARATION) ---- */
        const verdict = authorize({
          principal,
          capability: route.capability,
          cellId: dependencies.cellId,
          now: context.receivedAt,
          ...(route.requiresStepUp === undefined
            ? {}
            : { requiresPhishingResistantAuthentication: route.requiresStepUp }),
        });
        if (!verdict.authorized) {
          throw new ProblemError(
            verdict.refusal === 'session_expired' ? 'unauthenticated' : 'forbidden',
            verdict.detail,
          );
        }
      }

      /* ---- validate inputs ---------------------------------------------- */
      const params = parseOrProblem(route.params, request.params, 'path parameters');
      const query = parseOrProblem(route.query, request.query, 'query string');
      const body = parseOrProblem(route.body, request.body, 'request body');

      const idempotencyKey = resolveIdempotencyKey(
        route,
        body ?? request.body,
        headerOf(request, 'idempotency-key'),
      );
      if (idempotencyKey !== undefined) context.idempotencyKey = idempotencyKey;

      /* ---- handle -------------------------------------------------------- */
      const result = await handler({
        params: params as z.output<TParams>,
        query: query as z.output<TQuery>,
        body: body as z.output<TBody>,
        context,
        // Safe: `principal` is set whenever `capability !== null`, and a route
        // with a null capability is a probe whose handler does not read it.
        principal: principal as Principal,
        request,
        reply,
      });

      // Binary downloads remain a central route: authentication, authorization,
      // request schemas and identifier headers above still apply. The declared
      // stream mode is the one explicit exception to JSON response validation.
      if (route.responseMode === 'stream') {
        if (!reply.sent) {
          throw new ProblemError('internal_error', 'A declared stream route completed without sending its response.');
        }
        return;
      }

      // A conditional GET may deliberately have no representation. Validate
      // normal successful bodies below, but never try to parse `undefined` as
      // a route response after the handler selected HTTP 304.
      if (reply.statusCode === 304) {
        return reply.send();
      }

      /* ---- validate the response ----------------------------------------- */
      const validated = route.response.safeParse(result);
      if (!validated.success) {
        // The handler produced something the contract does not describe. That is
        // a server defect, and returning the malformed body would publish it.
        throw new ProblemError(
          'internal_error',
          'The response did not match its declared schema. Quote the correlation id when reporting this.',
          { fieldErrors: fieldErrorsOf(validated.error) },
        );
      }

      // The declared success status, unless the handler already chose one.
      // `/v1/system/ready` returns 503 when it is not ready (FRANK-§19.3), and
      // unconditionally stamping the declared status here would erase that.
      if (reply.statusCode === 200) void reply.code(route.successStatus);
      void reply.type('application/json');
      return validated.data;
    },
  });
}

function headerOf(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

async function authenticateOrThrow(
  identity: IdentityProvider,
  request: FastifyRequest,
): Promise<Principal> {
  const header = headerOf(request, 'authorization');
  if (header === undefined) {
    throw new ProblemError('unauthenticated', 'No Authorization header was presented.');
  }
  const spaceAt = header.indexOf(' ');
  if (spaceAt <= 0) {
    throw new ProblemError('unauthenticated', 'Authorization header is not a scheme and a value.');
  }

  const result = await identity.authenticate({
    scheme: header.slice(0, spaceAt),
    value: header.slice(spaceAt + 1),
  });

  if (!result.authenticated) {
    // `result.detail` is written by the provider and is documented never to
    // contain credential material. See `packages/identity/src/local-signed-session.ts`.
    throw new ProblemError('unauthenticated', result.detail);
  }
  return result.principal;
}

declare module 'fastify' {
  interface FastifyRequest {
    frankContext?: RequestContext;
  }
}

/**
 * OpenAPI 3.1 generation — ADR-017, FRANK-§12.1, FRANK-§12.2.
 *
 * ADR-017: "The REST API is versioned and published as OpenAPI 3.1 (/v1, /v2,
 * etc.)." FRANK-§12.1: "OpenAPI as the public and client contract."
 *
 * The document is **generated from the route registry**, never written. That is
 * the only way to keep FRANK-§12.2's last sentence honest — "The generated
 * contract suite rejects undocumented operations" — because a hand-written
 * document drifts the first time somebody adds a route in a hurry, and the drift
 * is invisible until a client breaks.
 *
 * ## No conversion library
 *
 * Zod 4 emits draft-2020-12 JSON Schema natively, and OpenAPI 3.1 *is*
 * draft-2020-12 (that was the headline change from 3.0). So a route's Zod schema
 * becomes its OpenAPI schema with one call and no adapter, no
 * `zod-to-json-schema`, and no `@fastify/swagger`. FRANK-§0.2's rule about
 * dependencies earning their place cuts both ways: three packages avoided is
 * three supply-chain surfaces avoided.
 *
 * ## The `x-frank-*` extensions carry FRANK-§12.2's declarations
 *
 * "Every OpenAPI operation declares actor roles, data classes, standing-policy
 * eligibility, request and response schemas, idempotency semantics, consistency,
 * error catalogue, rate limits, and audit obligations."
 *
 * Six of those nine have no home in vanilla OpenAPI. They are emitted as
 * specification extensions, which is what extensions are for, and — because they
 * come from the same {@link RouteDefinition} the server enforces — a client
 * reading the document sees the roles the server will actually check rather than
 * a comment about them.
 */

import { z } from 'zod';

import { PROBLEM_TYPES } from './problem.js';
import type { ProblemKind } from './problem.js';
import { problemSchema } from './schema/registry.js';
import type { AnyRouteDefinition } from './schema/registry.js';
import { toOpenApiPath } from './plugins/route-handler.js';

export interface OpenApiOptions {
  readonly title: string;
  readonly version: string;
  readonly description: string;
  readonly serverUrl: string;
}

type JsonSchema = Record<string, unknown>;

function jsonSchemaOf(schema: z.ZodTypeAny): JsonSchema {
  // `io: 'input'` for request bodies would render defaults as optional; the
  // server applies defaults, so the *output* shape is what a client can rely on
  // receiving and the input shape is what it may send. Requests use 'input'.
  return z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'output',
    unrepresentable: 'any',
  }) as JsonSchema;
}

function requestSchemaOf(schema: z.ZodTypeAny): JsonSchema {
  return z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
}

/** Path and query parameters, expanded from the route's Zod object schemas. */
function parametersOf(route: AnyRouteDefinition): JsonSchema[] {
  const parameters: JsonSchema[] = [];

  const expand = (schema: z.ZodTypeAny | undefined, location: 'path' | 'query'): void => {
    if (schema === undefined) return;
    const json = requestSchemaOf(schema);
    const properties = json['properties'];
    if (typeof properties !== 'object' || properties === null) return;
    const required = Array.isArray(json['required']) ? (json['required'] as string[]) : [];
    for (const [name, propertySchema] of Object.entries(properties as Record<string, unknown>)) {
      parameters.push({
        name,
        in: location,
        // A path parameter is required by definition; a query parameter is
        // required only if the schema says so.
        required: location === 'path' ? true : required.includes(name),
        schema: propertySchema,
      });
    }
  };

  expand(route.params, 'path');
  expand(route.query, 'query');

  // FRANK-§12.1: "Idempotency keys on all action endpoints." Documented as a
  // header even though `command_id` in the body is the canonical carrier, because
  // a client that reads only the document must be able to find it.
  if (route.idempotency !== 'safe') {
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description:
        'Optional alias for `command_id`. When both are sent they must be identical, or the request is refused with 409 (FRANK-§12.1, FRANK-§12.3).',
      schema: { type: 'string', minLength: 8, maxLength: 128 },
    });
  }

  // FRANK-§19.1: correlation identifiers cross service boundaries.
  parameters.push({
    name: 'X-Correlation-Id',
    in: 'header',
    required: false,
    description:
      'Correlation id to join this request to an existing trace (FRANK-§19.1). Minted by the server when absent or malformed.',
    schema: { type: 'string', pattern: '^[A-Za-z0-9._-]{8,128}$' },
  });

  return parameters;
}

function responsesOf(route: AnyRouteDefinition): JsonSchema {
  const responses: JsonSchema = {
    [String(route.successStatus)]: {
      description: route.summary,
      headers: identifierHeaderDocs(),
      content: route.responseMode === 'stream'
        ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
        : { 'application/json': { schema: jsonSchemaOf(route.response) } },
    },
  };

  // FRANK-§12.2's "error catalogue", grouped by the status each problem uses.
  const byStatus = new Map<number, ProblemKind[]>();
  for (const kind of route.errors) {
    const status = PROBLEM_TYPES[kind].status;
    const existing = byStatus.get(status);
    if (existing === undefined) byStatus.set(status, [kind]);
    else existing.push(kind);
  }

  for (const [status, kinds] of [...byStatus].sort((a, b) => a[0] - b[0])) {
    responses[String(status)] = {
      description: kinds.map((kind) => PROBLEM_TYPES[kind].title).join(' | '),
      content: {
        'application/problem+json': {
          schema: jsonSchemaOf(problemSchema),
          examples: Object.fromEntries(
            kinds.map((kind) => [
              kind,
              {
                summary: PROBLEM_TYPES[kind].title,
                value: {
                  type: PROBLEM_TYPES[kind].type,
                  title: PROBLEM_TYPES[kind].title,
                  status: PROBLEM_TYPES[kind].status,
                },
              },
            ]),
          ),
        },
      },
    };
  }

  return responses;
}

function identifierHeaderDocs(): JsonSchema {
  // FRANK-§12.1: "Explicit cell, actor, policy, trace, and request identifiers."
  return {
    'x-frank-cell-id': { schema: { type: 'string' }, description: 'FRANK-§2.4 cell scope.' },
    'x-frank-request-id': { schema: { type: 'string' }, description: 'Unique to this hop.' },
    'x-frank-correlation-id': {
      schema: { type: 'string' },
      description: 'FRANK-§19.1 correlation id.',
    },
    'x-frank-trace-id': { schema: { type: 'string' }, description: 'FRANK-§19.1 trace id.' },
    'x-frank-policy-version': {
      schema: { type: 'string' },
      description: 'FRANK-§6.9 policy version this request was evaluated under.',
    },
  };
}

export function buildOpenApiDocument(
  routes: readonly AnyRouteDefinition[],
  options: OpenApiOptions,
): JsonSchema {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const path = toOpenApiPath(route.path);
    const operation: JsonSchema = {
      operationId: route.operationId,
      summary: route.summary,
      description: route.description,
      tags: [route.group],
      parameters: parametersOf(route),
      responses: responsesOf(route),
      security: route.capability === null ? [] : [{ frankSession: [] }],

      /* -------------------------- FRANK-§12.2 required declarations ------ */
      'x-frank-actor-roles': [...route.actorRoles],
      'x-frank-capability': route.capability,
      'x-frank-data-classes': [...route.dataClasses],
      'x-frank-standing-policy-eligible': route.standingPolicyEligible,
      'x-frank-policy-operation': route.policyOperation,
      'x-frank-idempotency': route.idempotency,
      'x-frank-consistency': route.consistency,
      'x-frank-error-catalogue': [...route.errors],
      'x-frank-rate-limit': {
        requests_per_minute: route.rateLimit.requestsPerMinute,
        burst: route.rateLimit.burst,
      },
      'x-frank-audit-obligations': [...route.auditObligations],
      ...(route.requiresStepUp === true ? { 'x-frank-requires-step-up': true } : {}),
    };

    if (route.body !== undefined) {
      operation['requestBody'] = {
        required: true,
        content: { 'application/json': { schema: requestSchemaOf(route.body) } },
      };
    }

    const existing = paths[path] ?? {};
    existing[route.method.toLowerCase()] = operation;
    paths[path] = existing;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      description: options.description,
    },
    servers: [{ url: options.serverUrl }],
    tags: [...new Set(routes.map((route) => route.group))].sort().map((group) => ({ name: group })),
    paths,
    components: {
      securitySchemes: {
        frankSession: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'frank-session.v1',
          description:
            'A signed session from the configured identity provider (FRANK-§15.2). ' +
            'The provider is pluggable; Slice 1 issues `frank-session.v1` tokens and Authentik/OIDC ' +
            'replaces it behind the same interface without a change to any operation here (FRANK-§16.2).',
        },
      },
    },
    'x-frank-spec-version': '1.0',
    'x-frank-slice': 1,
  };
}

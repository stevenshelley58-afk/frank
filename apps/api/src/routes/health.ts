/**
 * `/v1/system/health`, `/v1/system/live`, `/v1/system/ready` — OPS-004, UX-007,
 * FRANK-§3.8 `/system`, FRANK-§19.3.
 *
 * ## Why under `/v1/system`
 *
 * FRANK-§12.2's endpoint-group list has no `/v1/health` group; it has
 * `/v1/system`, and FRANK-§3.8's route table gives `/system` the responsibility
 * for "Health, agents, harnesses, models, skills, tools, connectors, spend,
 * audit, backups, settings". Health is a `/system` resource, so it lives there
 * rather than in a group the specification does not name.
 *
 * ## Three endpoints, because they answer three different questions
 *
 *   `/live`   Should this process be restarted? Touches nothing external.
 *             Unauthenticated: a container runtime has no session, and a
 *             liveness probe that can 401 is a probe that restarts a healthy
 *             process during an identity outage. It discloses only that the
 *             process is running.
 *   `/ready`  Should traffic be routed here? Touches the database.
 *             Unauthenticated for the same reason, and returns 503 when not
 *             ready so a proxy can act on the status code alone.
 *   `/health` What is actually wrong? The OPS-004 five-state report, with
 *             per-component measurements. **Authenticated**, and the detailed
 *             view is owner/operator only — component detail is a map of the
 *             system's internals and FRANK-§15.1 lists reconnaissance among the
 *             things to defend against.
 *
 * ## UX-007 is enforced, not documented
 *
 * Every non-healthy component carries an age and a recovery action;
 * `HealthService` repairs a report that lacks one and says so in the text, so a
 * missing recovery action is visible in the response rather than only in a test.
 */

import type { FastifyInstance } from 'fastify';

import { identifiersOf } from '../context.js';
import { defineRoute } from '../schema/registry.js';
import {
  healthResponseSchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from '../schema/views.js';
import type { HealthService } from '../services/health.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

export const livenessRoute = defineRoute({
  operationId: 'systemLive',
  method: 'GET',
  path: '/v1/system/live',
  group: '/v1/system',
  summary: 'Liveness probe',
  description:
    'True whenever the process is answering. Touches no dependency: restarting the API does not repair PostgreSQL, ' +
    'so a liveness probe that failed during a database outage would turn one outage into a crash loop.',
  actorRoles: [],
  // The only route in the registry permitted a null capability. See the module
  // comment; `assertRegistryConsistent` allows it only when no policy decision
  // is taken either.
  capability: null,
  dataClasses: ['open'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['internal_error'],
  rateLimit: { requestsPerMinute: 6_000, burst: 600 },
  auditObligations: [],
  response: livenessResponseSchema,
  successStatus: 200,
});

export const readinessRoute = defineRoute({
  operationId: 'systemReady',
  method: 'GET',
  path: '/v1/system/ready',
  group: '/v1/system',
  summary: 'Readiness probe',
  description:
    'Whether this instance can serve traffic. Returns 503 when a component a request depends on is unavailable, ' +
    'so a reverse proxy can route on the status code alone.',
  actorRoles: [],
  capability: null,
  dataClasses: ['open'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['internal_error'],
  rateLimit: { requestsPerMinute: 6_000, burst: 600 },
  auditObligations: [],
  response: readinessResponseSchema,
  successStatus: 200,
});

export const healthRoute = defineRoute({
  operationId: 'systemHealth',
  method: 'GET',
  path: '/v1/system/health',
  group: '/v1/system',
  summary: 'OPS-004 health report',
  description:
    'Per-component health across the five OPS-004 states: healthy, degraded, unavailable, stale, and intentionally paused. ' +
    'Every non-healthy component carries its age and a recovery action (UX-007). Owner and operator only.',
  actorRoles: ['owner', 'operator'],
  capability: 'system.health.read.detailed',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: 'system.health.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'internal_error'],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: [],
  response: healthResponseSchema,
  successStatus: 200,
});

export const healthRoutes = [livenessRoute, readinessRoute, healthRoute];

export interface HealthRouteDependencies extends RouteHandlerDependencies {
  readonly health: HealthService;
  readonly serviceName: string;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  dependencies: HealthRouteDependencies,
): void {
  registerRoute(app, dependencies, livenessRoute, async () => {
    const liveness = dependencies.health.liveness();
    return {
      live: liveness.live,
      service: dependencies.serviceName,
      checked_at: dependencies.now().toISOString(),
    };
  });

  registerRoute(app, dependencies, readinessRoute, async ({ reply }) => {
    const now = dependencies.now();
    const report = await dependencies.health.report(now);

    const blocking = report.components
      .filter((component) => component.state === 'unavailable')
      .map((component) => ({
        id: component.id,
        state: component.state,
        detail: component.detail,
      }));

    if (!report.ready) {
      // 503 rather than 200-with-a-false-flag: FRANK-§19.3's availability checks
      // and FRANK-§16.2's reverse proxy both act on status codes, and a proxy
      // that had to parse a body to find out would be a proxy that sends traffic
      // to a broken instance whenever the body shape changes.
      void reply.code(503);
    }

    return {
      ready: report.ready,
      state: report.state,
      checked_at: report.checkedAt.toISOString(),
      blocking,
    };
  });

  registerRoute(app, dependencies, healthRoute, async ({ context }) => {
    const now = dependencies.now();
    const report = await dependencies.health.report(now);
    return {
      state: report.state,
      live: report.live,
      ready: report.ready,
      checked_at: report.checkedAt.toISOString(),
      components: report.components.map((component) => ({
        id: component.id,
        state: component.state,
        detail: component.detail,
        observed_at: component.observedAt.toISOString(),
        age_seconds: component.ageSeconds,
        recovery_action: component.recoveryAction,
        paused_by: component.pausedBy,
        measurements: { ...component.measurements },
      })),
      identifiers: identifiersOf(context),
    };
  });
}

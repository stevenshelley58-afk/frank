/** Authenticated mission objective front door and durable lifecycle reads. */

import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { actorKindOf } from '@frank/identity';

import { identifiersOf } from '../context.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { defineRoute } from '../schema/registry.js';
import {
  missionCreateBodySchema,
  missionIdParamsSchema,
  missionListQuerySchema,
  missionListResponseSchema,
  missionResponseSchema,
  missionStopBodySchema,
} from '../schema/mission.js';
import type { ActionBoundary } from '../services/action-boundary.js';
import { ownerCommandInfluence } from '../services/action-boundary.js';
import {
  MissionAlreadyTerminalError,
  MissionNotFoundError,
  RoomUnavailableError,
} from '../services/missions/orchestrator.js';
import type {
  CreateMissionInput,
  MissionView,
  StopMissionInput,
} from '../services/missions/types.js';

export const missionCreateRoute = defineRoute({
  operationId: 'missionCreate',
  method: 'POST',
  path: '/v1/missions',
  group: '/v1/missions',
  summary: 'Create a durable autonomous mission',
  description:
    'Accepts a substantial objective, persists its room and work graph, and queues dependency-ready workbenches. ' +
    'command_id is the durable idempotency key; a replay returns the original mission.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'work.create',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.create',
  idempotency: 'required_key',
  consistency: 'read_own_writes',
  errors: [
    'validation_failed',
    'unauthenticated',
    'forbidden',
    'policy_denied',
    'policy_hold_for_review',
    'idempotency_conflict',
    'invalid_transition',
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 30, burst: 5 },
  auditObligations: ['mission.created', 'work.created', 'workbench.created'],
  body: missionCreateBodySchema,
  response: missionResponseSchema,
  successStatus: 200,
});

export const missionGetRoute = defineRoute({
  operationId: 'missionGet',
  method: 'GET',
  path: '/v1/missions/:id',
  group: '/v1/missions',
  summary: 'Get a mission and its durable work graph',
  description:
    'Returns the canonical mission lifecycle and public work graph nodes. Internal planner prose is not exposed.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  capability: 'work.read',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 60 },
  auditObligations: [],
  params: missionIdParamsSchema,
  response: missionResponseSchema,
  successStatus: 200,
});

export const missionListRoute = defineRoute({
  operationId: 'missionList',
  method: 'GET',
  path: '/v1/missions',
  group: '/v1/missions',
  summary: 'List missions',
  description: 'Returns newest-first mission lifecycle summaries. Read an individual mission for its durable work graph.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  capability: 'work.read',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 60 },
  auditObligations: [],
  query: missionListQuerySchema,
  response: missionListResponseSchema,
  successStatus: 200,
});

export const missionStopRoute = defineRoute({
  operationId: 'missionStop',
  method: 'POST',
  path: '/v1/missions/:id/stop',
  group: '/v1/missions',
  summary: 'Stop a mission and prevent new work',
  description:
    'Sets stop_new_work, cancels unfinished work and live workbenches, and returns the resulting durable mission snapshot.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'work.transition',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.transition',
  idempotency: 'required_key_single_use',
  consistency: 'read_own_writes',
  errors: [
    'validation_failed',
    'unauthenticated',
    'forbidden',
    'policy_denied',
    'policy_hold_for_review',
    'idempotency_conflict',
    'not_found',
    'invalid_transition',
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: ['mission.state_changed', 'workbench.cancelled'],
  params: missionIdParamsSchema,
  body: missionStopBodySchema,
  response: missionResponseSchema,
  successStatus: 200,
});

export const missionRoutes = [missionCreateRoute, missionListRoute, missionGetRoute, missionStopRoute];

/** Narrow port so route tests do not need a database-backed orchestrator instance. */
export interface MissionRouteOrchestrator {
  create(input: CreateMissionInput): Promise<MissionView>;
  list(cellId: string, limit: number): Promise<readonly MissionView['mission'][]>;
  get(cellId: string, missionId: string): Promise<MissionView | null>;
  stop(input: StopMissionInput): Promise<MissionView>;
}

export interface MissionRouteDependencies extends RouteHandlerDependencies {
  readonly orchestrator: MissionRouteOrchestrator;
  readonly actions: ActionBoundary;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerMissionRoutes(
  app: FastifyInstance,
  dependencies: MissionRouteDependencies,
): void {
  registerRoute(app, dependencies, missionCreateRoute, async ({ body, context, principal }) => {
    const commandId = context.idempotencyKey ?? body.command_id;
    authorizeMissionMutation(dependencies.actions, {
      principal,
      operation: 'work.create',
      targetId: commandId,
      commandId,
      body: {
        objective: body.objective,
        title: body.title ?? null,
        room_name: body.room_name ?? null,
        budget: body.budget ?? null,
      },
      cellId: context.cellId,
      correlationId: context.correlationId,
      now: context.receivedAt,
    });

    const mission = await mapMissionErrors(() =>
      dependencies.orchestrator.create({
        cellId: context.cellId,
        commandId,
        objective: body.objective,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.room_name === undefined ? {} : { roomName: body.room_name }),
        ...(body.budget === undefined
          ? {}
          : {
              budget: {
                ...(body.budget.spend_cap_usd === undefined
                  ? {}
                  : { spendCapUsd: body.budget.spend_cap_usd }),
                ...(body.budget.token_budget === undefined
                  ? {}
                  : { tokenBudget: body.budget.token_budget }),
                ...(body.budget.wall_clock_sec === undefined
                  ? {}
                  : { wallClockSec: body.budget.wall_clock_sec }),
                ...(body.budget.max_attempts === undefined
                  ? {}
                  : { maxAttempts: body.budget.max_attempts }),
              },
            }),
        actor: { kind: actorKindOf(principal), id: principal.principalId },
        correlationId: context.correlationId,
        now: context.receivedAt,
      }),
    );

    return missionResponse(mission, identifiersOf(context));
  });

  registerRoute(app, dependencies, missionListRoute, async ({ query, context }) => ({
    missions: await dependencies.orchestrator.list(context.cellId, query.limit),
    identifiers: identifiersOf(context),
  }));

  registerRoute(app, dependencies, missionGetRoute, async ({ params, context }) => {
    if (!UUID_RE.test(params.id)) {
      throw new ProblemError('not_found', 'No mission with that id exists in this cell.');
    }
    const mission = await mapMissionErrors(() =>
      dependencies.orchestrator.get(context.cellId, params.id),
    );
    if (mission === null) {
      throw new ProblemError('not_found', 'No mission with that id exists in this cell.');
    }
    return missionResponse(mission, identifiersOf(context));
  });

  registerRoute(app, dependencies, missionStopRoute, async ({ params, body, context, principal }) => {
    if (!UUID_RE.test(params.id)) {
      throw new ProblemError('not_found', 'No mission with that id exists in this cell.');
    }
    const commandId = context.idempotencyKey ?? body.command_id;
    authorizeMissionMutation(dependencies.actions, {
      principal,
      operation: 'work.transition',
      targetId: params.id,
      commandId,
      body: { mission_id: params.id, reason: body.reason },
      cellId: context.cellId,
      correlationId: context.correlationId,
      now: context.receivedAt,
    });

    const mission = await mapMissionErrors(() =>
      dependencies.orchestrator.stop({
        cellId: context.cellId,
        missionId: params.id,
        commandId,
        reason: body.reason,
        actor: { kind: actorKindOf(principal), id: principal.principalId },
        correlationId: context.correlationId,
        now: context.receivedAt,
      }),
    );
    return missionResponse(mission, identifiersOf(context));
  });
}

function missionResponse(
  view: MissionView,
  identifiers: ReturnType<typeof identifiersOf>,
) {
  return {
    mission: {
      ...view.mission,
      budget: { ...view.mission.budget },
    },
    work_graph: view.work_graph.map((node) => ({
      ...node,
      depends_on: [...node.depends_on],
    })),
    identifiers,
  };
}

function authorizeMissionMutation(
  actions: ActionBoundary,
  input: {
    principal: Parameters<ActionBoundary['evaluate']>[0]['principal'];
    operation: 'work.create' | 'work.transition';
    targetId: string;
    commandId: string;
    body: Record<string, unknown>;
    cellId: string;
    correlationId: string;
    now: Date;
  },
): void {
  const requestHash = `sha256:${createHash('sha256')
    .update(JSON.stringify(input.body), 'utf8')
    .digest('hex')}`;
  const evaluation = actions.evaluate({
    principal: input.principal,
    operation: input.operation,
    actionClass: 'internal_reversible',
    target: { kind: 'mission', id: input.targetId, cellId: input.cellId },
    requestHash,
    idempotencyKey: input.commandId,
    dataClasses: ['internal', 'private'],
    influences: ownerCommandInfluence(input.principal),
    correlationId: input.correlationId,
    now: input.now,
  });
  if (evaluation.decision.result === 'deny') {
    throw new ProblemError('policy_denied', evaluation.decision.reasons.join('; '), {
      policyVersion: evaluation.decision.policyVersion,
    });
  }
  if (evaluation.decision.result === 'hold_for_review') {
    throw new ProblemError('policy_hold_for_review', evaluation.decision.reasons.join('; '), {
      policyVersion: evaluation.decision.policyVersion,
    });
  }
}

async function mapMissionErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MissionNotFoundError) {
      throw new ProblemError('not_found', 'No mission with that id exists in this cell.');
    }
    if (error instanceof MissionAlreadyTerminalError) {
      throw new ProblemError('invalid_transition', 'The mission is already terminal and cannot be stopped.');
    }
    if (error instanceof RoomUnavailableError) {
      throw new ProblemError(
        'invalid_transition',
        'The selected room cannot accept this mission in its current state or budget.',
      );
    }
    throw error;
  }
}

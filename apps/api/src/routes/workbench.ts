/**
 * `/v1/workbenches` — WB-05 front door + detail read, per the frozen contract
 * `docs/plans/WORKBENCH_API_CONTRACT.md`.
 *
 *     POST /v1/workbenches        create from task def (idempotent on Idempotency-Key)
 *     GET  /v1/workbenches/:id    record + plan + latest receipt
 *
 * SSE (`/:id/events`), stop, decisions, and the room list arrive with WB-06/07
 * and HITL-01 in this same file.
 *
 * ## Canonical-state posture (§3.1)
 *
 * This route never mutates a work item directly: the front-door service files
 * the work item through `WorkItemRepository` inside one transaction
 * (FRANK-§11.5 — domain mutation, audit, outbox commit together). The
 * workbench is execution detail for that item, never a second state machine.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { FastifyInstance } from 'fastify';

import { identifiersOf } from '../context.js';
import { ProblemError } from '../problem.js';
import { defineRoute } from '../schema/registry.js';
import {
  workbenchCreateBodySchema,
  workbenchCreateResponseSchema,
  workbenchDetailResponseSchema,
  workbenchIdParamsSchema,
  workbenchStopBodySchema,
  workbenchStopResponseSchema,
  workbenchTaskDefSchema,
} from '../schema/workbench.js';
import type { ActionBoundary } from '../services/action-boundary.js';
import { ownerCommandInfluence } from '../services/action-boundary.js';
import type { WorkbenchFrontDoor } from '../services/workbench/front-door.js';
import type { WorkbenchCancellationService } from '../services/workbench/cancellation.js';
import { AlreadyTerminalError, WorkbenchNotFoundError } from '../services/workbench/cancellation.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from '../services/workbench/types.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

/* ------------------------------------------------------------ definitions --- */

export const workbenchCreateRoute = defineRoute({
  operationId: 'workbenchCreate',
  method: 'POST',
  path: '/v1/workbenches',
  group: '/v1/workbenches',
  summary: 'Create a workbench from a task definition',
  description:
    'The delegation front door (WB-05): files an agent_job work item and queues the workbench that executes it, ' +
    'idempotent on the Idempotency-Key header (= the delegation command key). A replay returns the original record.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'work.create',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.create',
  idempotency: 'required_key_single_use',
  consistency: 'read_own_writes',
  errors: [
    'validation_failed',
    'unauthenticated',
    'forbidden',
    'policy_denied',
    'policy_hold_for_review',
    'idempotency_conflict',
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 60, burst: 10 },
  auditObligations: ['work.created', 'workbench.created'],
  body: workbenchCreateBodySchema,
  response: workbenchCreateResponseSchema,
  successStatus: 200,
});

export const workbenchGetRoute = defineRoute({
  operationId: 'workbenchGet',
  method: 'GET',
  path: '/v1/workbenches/:id',
  group: '/v1/workbenches',
  summary: 'Get one workbench',
  description:
    'Record + plan + latest receipt (frozen contract). Raw events live at /v1/workbenches/:id/events (WB-06).',
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
  params: workbenchIdParamsSchema,
  response: workbenchDetailResponseSchema,
  successStatus: 200,
});

export const workbenchStopRoute = defineRoute({
  operationId: 'workbenchStop',
  method: 'POST',
  path: '/v1/workbenches/:id/stop',
  group: '/v1/workbenches',
  summary: 'Stop a workbench run (WB-07 leash)',
  description:
    'First-class Stop (frozen contract): halts the run under 5 seconds. A live run is cancelled through the runner leash; ' +
    'otherwise the cancellation is written durably (workbench + work item → cancelled, audit + outbox + honest receipt). ' +
    'Stopping an already-terminal workbench is refused (409).',
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
    'not_found',
    'version_conflict',
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: ['workbench.cancelled'],
  params: workbenchIdParamsSchema,
  body: workbenchStopBodySchema,
  response: workbenchStopResponseSchema,
  successStatus: 200,
});

export const workbenchRoutes = [workbenchCreateRoute, workbenchGetRoute, workbenchStopRoute];

/** Canonical UUID (the workbench id column type). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* --------------------------------------------------------------- handlers --- */

export interface WorkbenchRouteDependencies extends RouteHandlerDependencies {
  readonly frontDoor: WorkbenchFrontDoor;
  readonly actions: ActionBoundary;
  readonly cancellation: WorkbenchCancellationService;
}

function recordToWire(record: WorkbenchRecord) {
  return {
    id: record.id,
    cell_id: record.cellId,
    work_item_id: record.workItemId,
    room_id: record.roomId,
    idempotency_key: record.idempotencyKey,
    task_def: {
      instruction: record.taskDef.instruction,
      ...(record.taskDef.mounts === undefined ? {} : { mounts: record.taskDef.mounts }),
      ...(record.taskDef.harness === undefined ? {} : { harness: record.taskDef.harness }),
      ...(record.taskDef.skills === undefined ? {} : { skills: record.taskDef.skills }),
      ...(record.taskDef.leash === undefined
        ? {}
        : {
            leash: {
              ...(record.taskDef.leash.wallClockSec === undefined
                ? {}
                : { wall_clock_sec: record.taskDef.leash.wallClockSec }),
              ...(record.taskDef.leash.tokenBudget === undefined
                ? {}
                : { token_budget: record.taskDef.leash.tokenBudget }),
              ...(record.taskDef.leash.spendCapUsd === undefined
                ? {}
                : { spend_cap_usd: record.taskDef.leash.spendCapUsd }),
            },
          }),
      ...(record.taskDef.network === undefined
        ? {}
        : {
            network: {
              ...(record.taskDef.network.egressAllowlist === undefined
                ? {}
                : { egress_allowlist: record.taskDef.network.egressAllowlist }),
            },
          }),
    },
    state: record.state,
    attempts: record.attempts,
    container_id: record.containerId,
    schedule:
      record.scheduleCron === null || record.scheduleTimezone === null
        ? null
        : { cron: record.scheduleCron, tz: record.scheduleTimezone },
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    started_at: record.startedAt === null ? null : record.startedAt.toISOString(),
    finished_at: record.finishedAt === null ? null : record.finishedAt.toISOString(),
    last_error: record.lastError,
  };
}

/** Wire body → internal TaskDef, field-by-field (exactOptionalPropertyTypes-safe). */
function taskDefFromBody(body: z.input<typeof workbenchTaskDefSchema>): WorkbenchTaskDef {
  const harness = body.harness;
  const leash = body.leash;
  const network = body.network;
  return {
    instruction: body.instruction,
    ...(body.mounts === undefined ? {} : { mounts: body.mounts }),
    ...(harness === undefined
      ? {}
      : {
          harness: {
            adapter: harness.adapter,
            ...(harness.provider === undefined ? {} : { provider: harness.provider }),
            ...(harness.model === undefined ? {} : { model: harness.model }),
          },
        }),
    ...(body.skills === undefined ? {} : { skills: body.skills }),
    ...(leash === undefined
      ? {}
      : {
          leash: {
            ...(leash.wall_clock_sec === undefined ? {} : { wallClockSec: leash.wall_clock_sec }),
            ...(leash.token_budget === undefined ? {} : { tokenBudget: leash.token_budget }),
            ...(leash.spend_cap_usd === undefined ? {} : { spendCapUsd: leash.spend_cap_usd }),
          },
        }),
    ...(network === undefined
      ? {}
      : {
          network: {
            ...(network.egress_allowlist === undefined
              ? {}
              : { egressAllowlist: network.egress_allowlist }),
          },
        }),
  };
}

export function registerWorkbenchRoutes(
  app: FastifyInstance,
  dependencies: WorkbenchRouteDependencies,
): void {
  /* -------------------------------------------------------------- create --- */
  registerRoute(app, dependencies, workbenchCreateRoute, async ({ body, context, principal }) => {
    const now = dependencies.now();
    const idempotencyKey = context.idempotencyKey ?? body.command_id;
    if (idempotencyKey === undefined) {
      // registerRoute enforces this for required_key routes; belt and braces
      // because the workbench row's uniqueness depends on it.
      throw new ProblemError(
        'validation_failed',
        'POST /v1/workbenches requires an idempotency key: send command_id in the body or an Idempotency-Key header (FRANK-§12.1).',
      );
    }

    const requestHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          idempotency_key: idempotencyKey,
          room_id: body.room_id ?? null,
          task_def: body.task_def,
        }),
        'utf8',
      )
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'work.create',
      // Queueing durable execution of an internal record; the run itself is
      // fenced and leashed (WB-03/WB-07), not this call.
      actionClass: 'internal_reversible',
      target: { kind: 'workbench', id: idempotencyKey, cellId: context.cellId },
      requestHash,
      idempotencyKey,
      dataClasses: ['internal', 'private'],
      influences: ownerCommandInfluence(principal),
      correlationId: context.correlationId,
      now,
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

    const outcome = await dependencies.frontDoor.createWorkbench({
      cellId: context.cellId,
      idempotencyKey,
      taskDef: taskDefFromBody(body.task_def),
      ...(body.room_id === undefined ? {} : { roomId: body.room_id }),
      ...(body.title === undefined ? {} : { title: body.title }),
      actor: { kind: actorKindFor(principal), id: principal.principalId },
      correlationId: context.correlationId,
      policyVersion: evaluation.decision.policyVersion,
      now,
    });

    return {
      workbench: recordToWire(outcome.workbench),
      created: outcome.created,
      identifiers: identifiersOf(context),
    };
  });

  /* ----------------------------------------------------------------- get --- */
  registerRoute(app, dependencies, workbenchGetRoute, async ({ params, context }) => {
    // `workbench.id` is a uuid column: a malformed id can never exist, so it
    // is a 404 (never a 500 from string_to_uuid).
    if (!UUID_RE.test(params.id)) {
      throw new ProblemError('not_found', `No workbench ${params.id} exists in this cell.`);
    }
    const snapshot = await dependencies.frontDoor.store.getSnapshot(context.cellId, params.id);
    if (snapshot === null) {
      throw new ProblemError('not_found', `No workbench ${params.id} exists in this cell.`);
    }
    return {
      workbench: recordToWire(snapshot.workbench),
      plan: snapshot.plan.map((step) => ({
        seq: step.seq,
        step: step.step,
        state: step.state,
        note: step.note,
        updated_at: step.updatedAt.toISOString(),
      })),
      receipt:
        snapshot.receipt === null
          ? null
          : {
              summary: snapshot.receipt.summary,
              assumptions: [...snapshot.receipt.assumptions],
              evidence: [...snapshot.receipt.evidence],
              published_at: snapshot.receipt.publishedAt.toISOString(),
              published_by: snapshot.receipt.publishedBy,
            },
      identifiers: identifiersOf(context),
    };
  });

  /* ---------------------------------------------------------------- stop --- */
  registerRoute(app, dependencies, workbenchStopRoute, async ({ params, body, context, principal }) => {
    const now = dependencies.now();

    if (!UUID_RE.test(params.id)) {
      throw new ProblemError('not_found', `No workbench ${params.id} exists in this cell.`);
    }

    const idempotencyKey = context.idempotencyKey ?? body.command_id;
    if (idempotencyKey === undefined) {
      throw new ProblemError(
        'validation_failed',
        'POST /v1/workbenches/:id/stop requires an idempotency key: send command_id in the body or an Idempotency-Key header (FRANK-§12.1).',
      );
    }

    const requestHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({ workbench_id: params.id, command: 'stop', reason: body.reason }),
        'utf8',
      )
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'work.transition',
      // Stopping is a reversible internal control decision; the fenced run
      // itself is what gets cancelled, not a domain write this call performs.
      actionClass: 'internal_reversible',
      target: { kind: 'workbench', id: params.id, cellId: context.cellId },
      requestHash,
      idempotencyKey,
      dataClasses: ['internal', 'private'],
      influences: ownerCommandInfluence(principal),
      correlationId: context.correlationId,
      now,
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

    try {
      const outcome = await dependencies.cancellation.cancel({
        cellId: context.cellId,
        workbenchId: params.id,
        reason: body.reason,
        actor: { kind: actorKindFor(principal), id: principal.principalId },
        correlationId: context.correlationId,
        now,
      });
      return {
        via: outcome.via,
        workbench_id: params.id,
        work_item_id: outcome.workItemId,
        state: 'cancelled' as const,
        identifiers: identifiersOf(context),
      };
    } catch (error) {
      if (error instanceof WorkbenchNotFoundError) {
        throw new ProblemError('not_found', `No workbench ${params.id} exists in this cell.`);
      }
      if (error instanceof AlreadyTerminalError) {
        throw new ProblemError(
          'version_conflict',
          `Workbench ${params.id} is already in a terminal state (${error.state}); stop is a no-op that cannot be replayed.`,
        );
      }
      throw error;
    }
  });
}

function actorKindFor(principal: {
  roles: readonly string[];
  delegatedActorId?: string;
}): 'user' | 'agent' | 'service' {
  if (principal.roles.includes('service_identity')) return 'service';
  if (principal.delegatedActorId !== undefined) return 'agent';
  return 'user';
}

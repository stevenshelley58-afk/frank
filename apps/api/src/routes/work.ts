/**
 * `/v1/work` — WORK-001..006, FRANK-§12.2, FRANK-§12.3.
 *
 * Four operations, matching FRANK-§12.2's method table:
 *
 *     GET  /v1/work                          authorized cursor list with freshness and ETag
 *     GET  /v1/work/{id}                     canonical view with version, provenance, links, commands
 *     GET  /v1/work/{id}/history             redacted domain and audit timeline
 *     POST /v1/work/{id}/commands/{command}  explicit state transition
 *
 * ## Commands are verbs, and the server owns the verb-to-state mapping
 *
 * FRANK-§12.2 gives the pattern `POST /{resources}/{id}/commands/{command}`. The
 * commands are `start`, `complete`, `block`, … — never a target state — because
 * a client that posts a state is a client that can attempt any state, and the
 * refusal then has to happen deep in the write path. With verbs, an unknown
 * command is a 404 before anything else runs, and the set of legal verbs is the
 * same table (`work-view.ts`) that produced the `available_commands` the client
 * was shown.
 *
 * ## `dry_run` writes nothing and spends nothing
 *
 * FRANK-§12.3's body carries `dry_run` and does not define it. Implemented as:
 * evaluate policy in dry-run mode (so the envelope's nonce is *not* spent, and
 * the real command afterwards still works), check the transition against the
 * WORK-004 table, and return what would happen. No transaction is opened. A
 * preview that consumed the action it was previewing would be worse than no
 * preview.
 */

import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { LEGAL_WORK_TRANSITIONS, canTransition } from '@frank/adapter-postgres';
import type { WorkState } from '@frank/adapter-postgres';

import { identifiersOf } from '../context.js';
import type { RequestContext } from '../context.js';
import { ProblemError } from '../problem.js';
import { commandEnvelopeSchema, defineRoute } from '../schema/registry.js';
import {
  workCommandParamsSchema,
  workCommandResponseSchema,
  workHistoryResponseSchema,
  workIdParamsSchema,
  workItemDetailSchema,
  workListQuerySchema,
  workListResponseSchema,
} from '../schema/views.js';
import type { ActionBoundary } from '../services/action-boundary.js';
import { ownerCommandInfluence, policyDecisionToWire } from '../services/action-boundary.js';
import { TRANSITION_COMMANDS, availableCommandsFor, guidanceFor } from '../services/work-view.js';
import type { WorkItemRecord, DomainStore } from '../services/store.js';
import { IllegalTransition, VersionConflict, WorkItemNotFound } from '../services/store.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

/* ------------------------------------------------------------ definitions --- */

export const workListRoute = defineRoute({
  operationId: 'workList',
  method: 'GET',
  path: '/v1/work',
  group: '/v1/work',
  summary: 'List work items',
  description:
    'Authorized cursor list with filter, sort, freshness and ETag (FRANK-§12.2). ' +
    'Every item carries WORK-006 guidance: why now, definition of done, and next safe action.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  capability: 'work.read',
  dataClasses: ['open', 'internal', 'private', 'sensitive'],
  standingPolicyEligible: false,
  policyOperation: 'work.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 60 },
  auditObligations: [],
  query: workListQuerySchema,
  response: workListResponseSchema,
  successStatus: 200,
});

export const workGetRoute = defineRoute({
  operationId: 'workGet',
  method: 'GET',
  path: '/v1/work/:id',
  group: '/v1/work',
  summary: 'Get one work item',
  description:
    'Canonical view with version, provenance, links, and the available commands derived from the WORK-004 state machine.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  capability: 'work.read',
  dataClasses: ['open', 'internal', 'private', 'sensitive'],
  standingPolicyEligible: false,
  policyOperation: 'work.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'internal_error'],
  rateLimit: { requestsPerMinute: 600, burst: 60 },
  auditObligations: [],
  params: workIdParamsSchema,
  response: workItemDetailSchema,
  successStatus: 200,
});

export const workHistoryRoute = defineRoute({
  operationId: 'workHistory',
  method: 'GET',
  path: '/v1/work/:id/history',
  group: '/v1/work',
  summary: 'Work item transition history',
  description:
    'Redacted domain and audit timeline (FRANK-§12.2). Each transition names the audit entry that recorded it (WORK-004).',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer'],
  capability: 'work.read',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'internal_error'],
  rateLimit: { requestsPerMinute: 300, burst: 30 },
  auditObligations: [],
  params: workIdParamsSchema,
  response: workHistoryResponseSchema,
  successStatus: 200,
});

export const workCommandRoute = defineRoute({
  operationId: 'workCommand',
  method: 'POST',
  path: '/v1/work/:id/commands/:command',
  group: '/v1/work',
  summary: 'Run a work item command',
  description:
    'Explicit state transition (FRANK-§12.3). Commands are verbs: plan, ready, schedule, start, wait, block, review, complete, cancel, fail. ' +
    'Illegal transitions are rejected by the state machine, the database trigger, and a foreign key (WORK-004).',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'work.transition',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: true,
  policyOperation: 'work.transition',
  idempotency: 'required_key_single_use',
  consistency: 'read_own_writes',
  errors: [
    'validation_failed',
    'unauthenticated',
    'forbidden',
    'not_found',
    'policy_denied',
    'policy_hold_for_review',
    'version_conflict',
    'invalid_transition',
    'idempotency_conflict',
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 300, burst: 30 },
  auditObligations: ['work.state_changed'],
  params: workCommandParamsSchema,
  body: commandEnvelopeSchema,
  response: workCommandResponseSchema,
  successStatus: 200,
});

export const workRoutes = [workListRoute, workGetRoute, workHistoryRoute, workCommandRoute];

/* --------------------------------------------------------------- handlers --- */

export interface WorkRouteDependencies extends RouteHandlerDependencies {
  readonly store: DomainStore;
  readonly actions: ActionBoundary;
}

function summaryOf(item: WorkItemRecord, now: Date): {
  id: string;
  kind: WorkItemRecord['kind'];
  title: string;
  state: WorkState;
  priority: WorkItemRecord['priority'];
  owner: WorkItemRecord['owner'];
  data_class: WorkItemRecord['dataClass'];
  version: number;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  scheduled_for: string | null;
  guidance: ReturnType<typeof guidanceToWire>;
  _links: { self: string; provenance: string; history: string };
} {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    state: item.state,
    priority: item.priority,
    owner: item.owner,
    data_class: item.dataClass,
    version: item.version,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
    due_at: item.dueAt === null ? null : item.dueAt.toISOString(),
    scheduled_for: item.scheduledForAt === null ? null : item.scheduledForAt.toISOString(),
    guidance: guidanceToWire(item, now),
    _links: {
      self: `/v1/work/${item.id}`,
      provenance: `/v1/work/${item.id}/provenance`,
      history: `/v1/work/${item.id}/history`,
    },
  };
}

/** WORK-006, snake_cased for the wire. */
export function guidanceToWire(
  item: WorkItemRecord,
  now: Date,
): {
  why_now: string;
  definition_of_done: Array<{ id: string; statement: string; verification: string }>;
  next_safe_action: { label: string; command: string | null; safety: string };
} {
  const guidance = guidanceFor(item, now);
  return {
    why_now: guidance.whyNow,
    definition_of_done: guidance.definitionOfDone.map((entry) => ({ ...entry })),
    next_safe_action: {
      label: guidance.nextSafeAction.label,
      command:
        guidance.nextSafeAction.command === null
          ? null
          : `/v1/work/${item.id}/commands/${guidance.nextSafeAction.command}`,
      safety: guidance.nextSafeAction.safety,
    },
  };
}

/**
 * The UX-007 freshness envelope for a canonical read.
 *
 * A canonical read is never stale — it went to the row — so the state is
 * `healthy`, the projection lag is `null` rather than `0` (there is no
 * projection, which is different from a projection that is caught up), and there
 * is no recovery action to offer.
 */
export function canonicalFreshness(asOf: Date, now: Date): {
  state: 'healthy';
  as_of: string;
  age_seconds: number;
  projection_lag_seconds: null;
  recovery_action: null;
} {
  return {
    state: 'healthy',
    as_of: asOf.toISOString(),
    age_seconds: Math.max(0, Math.floor((now.getTime() - asOf.getTime()) / 1000)),
    projection_lag_seconds: null,
    recovery_action: null,
  };
}

function detailOf(item: WorkItemRecord, context: RequestContext, now: Date, asOf: Date) {
  return {
    ...summaryOf(item, now),
    description: item.description,
    started_at: item.startedAt === null ? null : item.startedAt.toISOString(),
    completed_at: item.completedAt === null ? null : item.completedAt.toISOString(),
    policy_ref: item.policyRef,
    provenance: {
      method: item.provenance.method,
      producer: item.provenance.producer,
      correlation_id: item.provenance.correlationId,
    },
    source_ids: [...item.sourceIds],
    available_commands: availableCommandsFor(item).map((entry) => ({
      command: entry.command,
      to_state: entry.toState,
      label: entry.label,
      href: `/v1/work/${item.id}/commands/${entry.command}`,
    })),
    freshness: canonicalFreshness(asOf, now),
    identifiers: identifiersOf(context),
  };
}

export function registerWorkRoutes(app: FastifyInstance, dependencies: WorkRouteDependencies): void {
  /* ---------------------------------------------------------------- list --- */
  registerRoute(app, dependencies, workListRoute, async ({ query, context, reply }) => {
    const now = dependencies.now();
    const result = await dependencies.store.listWork({
      cellId: context.cellId,
      state: query.state,
      ownerId: query.owner_id,
      cursor: query.cursor,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
    });

    // FRANK-§12.2: "…and ETag". Derived from the ids and versions in the page,
    // so a client's conditional request is answered by content rather than by a
    // timestamp that changes when nothing did.
    const etag = `"${createHash('sha256')
      .update(result.items.map((item) => `${item.id}:${String(item.version)}`).join('|'))
      .digest('hex')
      .slice(0, 32)}"`;
    void reply.header('etag', etag);

    return {
      items: result.items.map((item) => summaryOf(item, now)),
      next_cursor: result.nextCursor,
      freshness: canonicalFreshness(result.asOf, now),
      identifiers: identifiersOf(context),
    };
  });

  /* ----------------------------------------------------------------- get --- */
  registerRoute(app, dependencies, workGetRoute, async ({ params, context, reply }) => {
    const now = dependencies.now();
    const item = await dependencies.store.getWork(context.cellId, params.id);
    if (item === undefined) {
      throw new ProblemError('not_found', `No work item ${params.id} exists in this cell.`);
    }
    void reply.header('etag', `"${item.id}:${String(item.version)}"`);
    return detailOf(item, context, now, now);
  });

  /* ------------------------------------------------------------- history --- */
  registerRoute(app, dependencies, workHistoryRoute, async ({ params, context }) => {
    const item = await dependencies.store.getWork(context.cellId, params.id);
    if (item === undefined) {
      throw new ProblemError('not_found', `No work item ${params.id} exists in this cell.`);
    }
    const transitions = await dependencies.store.workHistory(context.cellId, params.id);
    return {
      work_item_id: params.id,
      transitions: transitions.map((entry) => ({
        seq: entry.seq,
        from_state: entry.fromState,
        to_state: entry.toState,
        actor: entry.actor,
        reason: entry.reason,
        occurred_at: entry.occurredAt.toISOString(),
        audit_entry_id: entry.auditEntryId,
        resulting_version: entry.resultingVersion,
      })),
      identifiers: identifiersOf(context),
    };
  });

  /* ------------------------------------------------------------- command --- */
  registerRoute(app, dependencies, workCommandRoute, async ({ params, body, context, principal }) => {
    const now = dependencies.now();

    const toState: WorkState | undefined = Object.prototype.hasOwnProperty.call(
      TRANSITION_COMMANDS,
      params.command,
    )
      ? TRANSITION_COMMANDS[params.command]
      : undefined;

    if (toState === undefined) {
      throw new ProblemError(
        'not_found',
        `No command "${params.command}" exists on a work item. Legal commands: ${Object.keys(TRANSITION_COMMANDS).sort().join(', ')}.`,
      );
    }

    const item = await dependencies.store.getWork(context.cellId, params.id);
    if (item === undefined) {
      throw new ProblemError('not_found', `No work item ${params.id} exists in this cell.`);
    }

    const requestHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          work_item_id: params.id,
          command: params.command,
          to_state: toState,
          expected_version: body.expected_version ?? null,
          reason: body.reason ?? null,
        }),
        'utf8',
      )
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'work.transition',
      actionClass: 'internal_reversible',
      target: { kind: 'work_item', id: params.id, cellId: context.cellId },
      requestHash,
      idempotencyKey: context.idempotencyKey ?? body.command_id,
      dataClasses: [item.dataClass === 'secret' ? 'sensitive' : item.dataClass],
      influences: ownerCommandInfluence(principal),
      correlationId: context.correlationId,
      now,
      dryRun: body.dry_run,
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

    /* ---- dry run: decide, do not act ---------------------------------- */
    if (body.dry_run) {
      const legal = canTransition(item.state, toState);
      return {
        resource: null,
        preview: {
          from_state: item.state,
          to_state: toState,
          would_succeed: legal,
          reason: legal
            ? `"${item.state}" -> "${toState}" is a legal transition (WORK-004).`
            : `"${item.state}" -> "${toState}" is not legal; legal targets are [${LEGAL_WORK_TRANSITIONS[item.state].join(', ')}].`,
        },
        policy: policyDecisionToWire(evaluation.decision),
        audit_entry_id: null,
        emitted_event_ids: [],
        receipts: [],
        identifiers: identifiersOf(context),
      };
    }

    /* ---- execute -------------------------------------------------------- */
    try {
      const transition = await dependencies.store.transitionWork({
        cellId: context.cellId,
        workItemId: params.id,
        toState,
        expectedVersion: body.expected_version,
        reason: body.reason,
        actor: { kind: actorKindFor(principal), id: principal.principalId },
        correlationId: context.correlationId,
        now,
        policyVersion: evaluation.decision.policyVersion,
        policyResult: evaluation.decision.result,
      });

      const updated = await dependencies.store.getWork(context.cellId, params.id);
      if (updated === undefined) {
        throw new ProblemError('internal_error', 'The work item vanished between write and read.');
      }

      return {
        resource: detailOf(updated, context, now, now),
        preview: null,
        policy: policyDecisionToWire(evaluation.decision),
        audit_entry_id: transition.auditEntryId,
        emitted_event_ids: [...transition.emittedEventIds],
        // FRANK-§12.3 "receipts". Empty in Slice 1: a receipt records an
        // external side effect through the FRANK-§13.5 invocation ledger, and
        // Slice 1 has no connectors.
        receipts: [],
        identifiers: identifiersOf(context),
      };
    } catch (error) {
      if (error instanceof VersionConflict) {
        throw new ProblemError(
          'version_conflict',
          `This work item was modified concurrently: you sent expected_version ${String(error.expected)}, the current version is ${String(error.actual)} (FRANK-§12.3).`,
        );
      }
      if (error instanceof IllegalTransition) {
        throw new ProblemError('invalid_transition', error.message);
      }
      if (error instanceof WorkItemNotFound) {
        throw new ProblemError('not_found', `No work item ${params.id} exists in this cell.`);
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

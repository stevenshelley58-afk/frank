/**
 * CH-06 — room↔channel bindings + outbox poll/ack for the channels listener.
 *
 * Frank owns the binding (§ChannelPort). The channels-listener consumes these
 * routes over HTTP — it never touches Postgres directly (§3.5). State push is
 * frame-disciplined: the listener polls only the state-change events it needs
 * and acks after a successful push; it never streams every event (§3.4).
 *
 * Routes:
 *   POST   /v1/rooms/:roomId/channel-bindings      bind/upsert a room↔conversation
 *   GET    /v1/rooms/:roomId/channel-bindings      list bindings (incl. revoked)
 *   DELETE /v1/rooms/:roomId/channel-bindings/:id  revoke a binding
 *   GET    /v1/channels/outbox                     poll pending state-change events
 *   POST   /v1/channels/outbox/ack                 ack pushed events
 */

import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { FastifyInstance } from 'fastify';

import { identifiersOf } from '../context.js';
import { ProblemError } from '../problem.js';
import { defineRoute } from '../schema/registry.js';
import type { ActionBoundary } from '../services/action-boundary.js';
import { ownerCommandInfluence } from '../services/action-boundary.js';
import type { ChannelPushStore } from '../services/channels/channel-push.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

/* ---------------------------------------------------------------- schemas --- */

const bindingBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    platform: z.string().min(1).max(64),
    platform_conversation_id: z.string().min(1).max(200),
  })
  .strict();

const bindingSchema = z
  .object({
    id: z.string(),
    cell_id: z.string(),
    room_id: z.string(),
    platform: z.string(),
    platform_conversation_id: z.string(),
    revoked_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const bindingListResponseSchema = z
  .object({
    bindings: z.array(bindingSchema),
    identifiers: z.object({
      cell_id: z.string(),
      actor_id: z.string(),
      request_id: z.string(),
      correlation_id: z.string(),
    }).passthrough(),
  })
  .strict();

const bindingResponseSchema = z
  .object({
    binding: bindingSchema,
    identifiers: bindingListResponseSchema.shape.identifiers,
  })
  .strict();

const bindingIdParamsSchema = z
  .object({ roomId: z.string().min(1), id: z.string().min(1) })
  .strict();

const roomIdParamsSchema = z.object({ roomId: z.string().min(1) }).strict();

const outboxQuerySchema = z
  .object({
    after_sequence: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    // Comma-separated event types the listener wants (frame discipline).
    types: z.string().min(1).optional(),
  })
  .strict();

const outboxEventSchema = z
  .object({
    id: z.string(),
    sequence: z.number().int(),
    type: z.string(),
    source: z.string(),
    subject: z.string().nullable(),
    aggregate_kind: z.string(),
    aggregate_id: z.string(),
    data: z.record(z.string(), z.unknown()),
    created_at: z.string(),
  })
  .strict();

const outboxPollResponseSchema = z
  .object({
    events: z.array(outboxEventSchema),
    identifiers: bindingListResponseSchema.shape.identifiers,
  })
  .strict();

const outboxAckBodySchema = z
  .object({
    command_id: z.string().min(1).optional(),
    ids: z.array(z.string().min(1)).min(1).max(500),
  })
  .strict();

const outboxAckResponseSchema = z
  .object({
    acked: z.number().int(),
    identifiers: bindingListResponseSchema.shape.identifiers,
  })
  .strict();

/* ----------------------------------------------------------------- routes --- */

export const channelBindRoute = defineRoute({
  operationId: 'channelBind',
  method: 'POST',
  path: '/v1/rooms/:roomId/channel-bindings',
  group: '/v1/channels',
  summary: 'Bind a room to a platform conversation (CH-06)',
  description:
    'Idempotently associate a Frank room with a platform conversation. One live binding per (cell, room, platform). ' +
    'Frank owns the binding; a revoked binding routes nothing.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'work.transition',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.transition',
  idempotency: 'required_key_single_use',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'policy_denied', 'policy_hold_for_review', 'internal_error'],
  rateLimit: { requestsPerMinute: 60, burst: 10 },
  auditObligations: ['channel.bound'],
  params: roomIdParamsSchema,
  body: bindingBodySchema,
  response: bindingResponseSchema,
  successStatus: 200,
});

export const channelBindingListRoute = defineRoute({
  operationId: 'channelBindingList',
  method: 'GET',
  path: '/v1/rooms/:roomId/channel-bindings',
  group: '/v1/channels',
  summary: 'List a room’s channel bindings (CH-06)',
  description: 'Every binding for the room, including revoked (so the UI can show state).',
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
  params: roomIdParamsSchema,
  response: bindingListResponseSchema,
  successStatus: 200,
});

export const channelRevokeRoute = defineRoute({
  operationId: 'channelRevoke',
  method: 'DELETE',
  path: '/v1/rooms/:roomId/channel-bindings/:id',
  group: '/v1/channels',
  summary: 'Revoke a channel binding (CH-06)',
  description: 'Soft-delete a binding. Revoked bindings route nothing.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'work.transition',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.transition',
  idempotency: 'required_key_single_use',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'policy_denied', 'policy_hold_for_review', 'internal_error'],
  rateLimit: { requestsPerMinute: 60, burst: 10 },
  auditObligations: ['channel.revoked'],
  params: bindingIdParamsSchema,
  response: bindingResponseSchema,
  successStatus: 200,
});

export const channelOutboxPollRoute = defineRoute({
  operationId: 'channelOutboxPoll',
  method: 'GET',
  path: '/v1/channels/outbox',
  group: '/v1/channels',
  summary: 'Poll pending state-change events (CH-06)',
  description:
    'The channels listener polls the outbox for state-change events after a sequence cursor. ' +
    'Frame discipline: only the event types the listener requests are returned.',
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
  query: outboxQuerySchema,
  response: outboxPollResponseSchema,
  successStatus: 200,
});

export const channelOutboxAckRoute = defineRoute({
  operationId: 'channelOutboxAck',
  method: 'POST',
  path: '/v1/channels/outbox/ack',
  group: '/v1/channels',
  summary: 'Ack pushed outbox events (CH-06)',
  description: 'Mark outbox events published after the listener has pushed them. Idempotent.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'work.transition',
  dataClasses: ['internal', 'private'],
  standingPolicyEligible: false,
  policyOperation: 'work.transition',
  idempotency: 'required_key_single_use',
  consistency: 'read_own_writes',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'policy_denied', 'policy_hold_for_review', 'internal_error'],
  rateLimit: { requestsPerMinute: 300, burst: 60 },
  auditObligations: [],
  body: outboxAckBodySchema,
  response: outboxAckResponseSchema,
  successStatus: 200,
});

export const channelRoutes = [
  channelBindRoute,
  channelBindingListRoute,
  channelRevokeRoute,
  channelOutboxPollRoute,
  channelOutboxAckRoute,
];

/* --------------------------------------------------------------- handlers --- */

export interface ChannelRouteDependencies extends RouteHandlerDependencies {
  readonly channelPush: ChannelPushStore;
  readonly actions: ActionBoundary;
}

function bindingToWire(b: {
  id: string;
  cellId: string;
  roomId: string;
  platform: string;
  platformConversationId: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    cell_id: b.cellId,
    room_id: b.roomId,
    platform: b.platform,
    platform_conversation_id: b.platformConversationId,
    revoked_at: b.revokedAt === null ? null : b.revokedAt.toISOString(),
    created_at: b.createdAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
  };
}

export function registerChannelRoutes(
  app: FastifyInstance,
  dependencies: ChannelRouteDependencies,
): void {
  /* ---------------------------------------------------------------- bind --- */
  registerRoute(app, dependencies, channelBindRoute, async ({ params, body, context, principal }) => {
    const now = dependencies.now();

    const idempotencyKey = context.idempotencyKey ?? body.command_id;
    if (idempotencyKey === undefined) {
      throw new ProblemError(
        'validation_failed',
        'POST /v1/rooms/:roomId/channel-bindings requires an idempotency key (FRANK-§12.1).',
      );
    }

    const requestHash = `sha256:${createHash('sha256')
      .update(JSON.stringify({ room: params.roomId, command: 'bind', platform: body.platform }))
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'work.transition',
      actionClass: 'internal_reversible',
      target: { kind: 'room', id: params.roomId, cellId: context.cellId },
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

    const binding = await dependencies.channelPush.bind(
      context.cellId,
      params.roomId,
      body.platform,
      body.platform_conversation_id,
      principal.principalId,
      now,
    );
    return { binding: bindingToWire(binding), identifiers: identifiersOf(context) };
  });

  /* ---------------------------------------------------------------- list --- */
  registerRoute(app, dependencies, channelBindingListRoute, async ({ params, context }) => {
    const bindings = await dependencies.channelPush.listByRoom(context.cellId, params.roomId);
    return {
      bindings: bindings.map(bindingToWire),
      identifiers: identifiersOf(context),
    };
  });

  /* -------------------------------------------------------------- revoke --- */
  registerRoute(app, dependencies, channelRevokeRoute, async ({ params, context, principal }) => {
    const now = dependencies.now();

    const requestHash = `sha256:${createHash('sha256')
      .update(JSON.stringify({ room: params.roomId, command: 'revoke', binding: params.id }))
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'work.transition',
      actionClass: 'internal_reversible',
      target: { kind: 'room', id: params.roomId, cellId: context.cellId },
      requestHash,
      idempotencyKey: context.idempotencyKey ?? randomUUID(),
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

    const revoked = await dependencies.channelPush.revoke(
      context.cellId,
      params.id,
      principal.principalId,
      now,
    );
    if (revoked === null) {
      throw new ProblemError('not_found', `No live binding ${params.id} for room ${params.roomId}.`);
    }
    return { binding: bindingToWire(revoked), identifiers: identifiersOf(context) };
  });

  /* ----------------------------------------------------------- outbox poll --- */
  registerRoute(app, dependencies, channelOutboxPollRoute, async ({ query, context }) => {
    const types = (query.types ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    // Frame discipline: require an explicit type list so the listener never
    // receives events it did not ask for.
    if (types.length === 0) {
      throw new ProblemError('validation_failed', 'outbox poll requires a non-empty `types` filter.');
    }
    const events = await dependencies.channelPush.pollOutbox(
      context.cellId,
      query.after_sequence,
      query.limit,
      types,
    );
    return {
      events: events.map((e) => ({
        id: e.id,
        sequence: e.sequence,
        type: e.type,
        source: e.source,
        subject: e.subject,
        aggregate_kind: e.aggregateKind,
        aggregate_id: e.aggregateId,
        data: e.data,
        created_at: e.createdAt.toISOString(),
      })),
      identifiers: identifiersOf(context),
    };
  });

  /* ----------------------------------------------------------- outbox ack --- */
  registerRoute(app, dependencies, channelOutboxAckRoute, async ({ body, context }) => {
    const now = dependencies.now();
    await dependencies.channelPush.ackOutbox(body.ids, now);
    return { acked: body.ids.length, identifiers: identifiersOf(context) };
  });
}

/**
 * `/v1/rooms/:roomId/folder-bindings` — room folder bindings backend.
 *
 *     POST   /v1/rooms/:roomId/folder-bindings         create/upsert a binding
 *     GET    /v1/rooms/:roomId/folder-bindings         list the room's bindings
 *     DELETE /v1/rooms/:roomId/folder-bindings/:id     revoke one binding
 *
 * A folder binding declares, per room: the synced folder source (FS-01 id/name),
 * its path on the VPS, the sync direction, the workbench mount mode, and the
 * FS-04 write-back permission. FS-02 is the record + API only — mount
 * ENFORCEMENT (ro/rw/staged behavior, staged shared writes) arrives with FS-03,
 * which reads these rows when composing workbench mounts.
 *
 * Follows `workbench.ts` exactly: routes declared as registry values
 * (FRANK-§12.2 metadata), capability resolved from the declaration (FRANK-§3.8),
 * FRANK-§6.9 policy evaluation through {@link ActionBoundary} on every action,
 * and FRANK-§12.1 idempotency keys. The binding is *doubly* idempotent: the
 * key deduplicates the request, and the `(cell_id, room_id, folder_source)`
 * unique constraint (migration 0006) deduplicates the declaration, so a
 * re-bind updates the existing row instead of creating a second one.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { FastifyInstance } from 'fastify';

import { newId } from '@frank/adapter-postgres';

import { identifiersOf } from '../context.js';
import { ProblemError } from '../problem.js';
import { defineRoute } from '../schema/registry.js';
import {
  folderBindingCreateBodySchema,
  folderBindingCreateResponseSchema,
  folderBindingIdParamsSchema,
  folderBindingListResponseSchema,
  folderBindingRecordSchema,
  folderBindingRevokeResponseSchema,
  folderBindingRoomParamsSchema,
} from '../schema/folder-binding.js';
import type { ActionBoundary } from '../services/action-boundary.js';
import { ownerCommandInfluence } from '../services/action-boundary.js';
import type { RoomFolderBindingRecord } from '../services/folder-binding/folder-binding-store.js';
import { RoomFolderBindingStore } from '../services/folder-binding/folder-binding-store.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

/* ------------------------------------------------------------ definitions --- */

export const folderBindingCreateRoute = defineRoute({
  operationId: 'folderBindingCreate',
  method: 'POST',
  path: '/v1/rooms/:roomId/folder-bindings',
  group: '/v1/rooms',
  summary: 'Bind a synced folder to a room (FS-02)',
  description:
    'Declares that a synced folder (FS-01) is attached to the room\'s workbenches: folder source, server path on the VPS, ' +
    'sync direction, workbench mount mode, and write-back permission. Idempotent on the Idempotency-Key header ' +
    '(= command_id) AND on the natural key (room, folder_source): a re-bind updates the existing declaration, ' +
    'returning it with created=false. Mount enforcement is FS-03; this records the declaration only.',
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
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 60, burst: 10 },
  auditObligations: ['folder_binding.created'],
  params: folderBindingRoomParamsSchema,
  body: folderBindingCreateBodySchema,
  response: folderBindingCreateResponseSchema,
  successStatus: 200,
});

export const folderBindingListRoute = defineRoute({
  operationId: 'folderBindingList',
  method: 'GET',
  path: '/v1/rooms/:roomId/folder-bindings',
  group: '/v1/rooms',
  summary: 'List a room\'s folder bindings (FS-02)',
  description:
    'Every folder binding declared for the room, newest first. Powers the room Files surface (UI-08) and FS-03 mount composition.',
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
  params: folderBindingRoomParamsSchema,
  response: folderBindingListResponseSchema,
  successStatus: 200,
});

export const folderBindingRevokeRoute = defineRoute({
  operationId: 'folderBindingRevoke',
  method: 'DELETE',
  path: '/v1/rooms/:roomId/folder-bindings/:id',
  group: '/v1/rooms',
  summary: 'Revoke a room folder binding (FS-02)',
  description:
    'Removes the binding declaration so future workbenches no longer mount the folder. Requires an Idempotency-Key header ' +
    '(FRANK-§12.1); a replay of the same key is refused (single use), and revoking an absent binding is a 404. ' +
    'Running workbenches keep their existing mounts until they end (FS-03 owns live mount behavior).',
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
    'internal_error',
  ],
  rateLimit: { requestsPerMinute: 60, burst: 10 },
  auditObligations: ['folder_binding.revoked'],
  params: folderBindingIdParamsSchema,
  response: folderBindingRevokeResponseSchema,
  successStatus: 200,
});

export const folderBindingRoutes = [
  folderBindingCreateRoute,
  folderBindingListRoute,
  folderBindingRevokeRoute,
];

/** Canonical UUID (the binding id column type). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* --------------------------------------------------------------- handlers --- */

export interface FolderBindingRouteDependencies extends RouteHandlerDependencies {
  readonly bindings: RoomFolderBindingStore;
  readonly actions: ActionBoundary;
}

function recordToWire(record: RoomFolderBindingRecord): z.input<typeof folderBindingRecordSchema> {
  return {
    id: record.id,
    cell_id: record.cellId,
    room_id: record.roomId,
    folder_source: record.folderSource,
    server_path: record.serverPath,
    sync_direction: record.syncDirection,
    mount_mode: record.mountMode,
    write_back: record.writeBack,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export function registerFolderBindingRoutes(
  app: FastifyInstance,
  dependencies: FolderBindingRouteDependencies,
): void {
  /* -------------------------------------------------------- create/upsert --- */
  registerRoute(app, dependencies, folderBindingCreateRoute, async ({ params, body, context, principal }) => {
    const now = dependencies.now();
    const idempotencyKey = context.idempotencyKey ?? body.command_id;
    if (idempotencyKey === undefined) {
      // registerRoute enforces this for required_key routes; belt and braces
      // because the replay decision depends on a stable key.
      throw new ProblemError(
        'validation_failed',
        'POST /v1/rooms/:roomId/folder-bindings requires an idempotency key: send command_id in the body or an Idempotency-Key header (FRANK-§12.1).',
      );
    }

    const requestHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          idempotency_key: idempotencyKey,
          room_id: params.roomId,
          folder_source: body.folder_source,
          server_path: body.server_path,
          sync_direction: body.sync_direction,
          mount_mode: body.mount_mode,
          write_back: body.write_back,
        }),
        'utf8',
      )
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'work.create',
      // Recording a room-scoped declaration; internal and reversible (revoke
      // undoes it). Nothing is mounted by this call — FS-03 does that.
      actionClass: 'internal_reversible',
      target: {
        kind: 'room_folder_binding',
        id: `${params.roomId}/${body.folder_source}`,
        cellId: context.cellId,
      },
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

    const outcome = await dependencies.bindings.upsertBinding({
      id: newId(),
      cellId: context.cellId,
      roomId: params.roomId,
      folderSource: body.folder_source,
      serverPath: body.server_path,
      syncDirection: body.sync_direction,
      mountMode: body.mount_mode,
      writeBack: body.write_back,
      actor: `${actorKindFor(principal)}/${principal.principalId}`,
      now,
    });

    return {
      binding: recordToWire(outcome.record),
      created: outcome.created,
      identifiers: identifiersOf(context),
    };
  });

  /* ------------------------------------------------------------------ list --- */
  registerRoute(app, dependencies, folderBindingListRoute, async ({ params, context }) => {
    const records = await dependencies.bindings.listByRoom(context.cellId, params.roomId);
    return {
      bindings: records.map(recordToWire),
      identifiers: identifiersOf(context),
    };
  });

  /* ---------------------------------------------------------------- revoke --- */
  registerRoute(app, dependencies, folderBindingRevokeRoute, async ({ params, context, principal }) => {
    const now = dependencies.now();

    if (!UUID_RE.test(params.id)) {
      throw new ProblemError('not_found', `No folder binding ${params.id} exists in this cell.`);
    }

    // DELETE carries no body: the idempotency key arrives as the
    // Idempotency-Key header (resolved into `context` by registerRoute).
    const idempotencyKey = context.idempotencyKey;
    if (idempotencyKey === undefined) {
      throw new ProblemError(
        'validation_failed',
        'DELETE /v1/rooms/:roomId/folder-bindings/:id requires an Idempotency-Key header (FRANK-§12.1).',
      );
    }

    const requestHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({ room_id: params.roomId, binding_id: params.id, command: 'revoke' }),
        'utf8',
      )
      .digest('hex')}`;

    const evaluation = dependencies.actions.evaluate({
      principal,
      operation: 'work.transition',
      // Revoking is a reversible internal control decision: future mounts stop
      // referring to the folder; nothing already running is touched here.
      actionClass: 'internal_reversible',
      target: { kind: 'room_folder_binding', id: params.id, cellId: context.cellId },
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

    const revoked = await dependencies.bindings.revoke(context.cellId, params.id);
    if (revoked === null) {
      throw new ProblemError('not_found', `No folder binding ${params.id} exists in this cell.`);
    }

    return {
      binding_id: revoked.id,
      room_id: revoked.roomId,
      revoked: true,
      identifiers: identifiersOf(context),
    };
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

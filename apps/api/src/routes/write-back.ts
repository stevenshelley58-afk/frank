/**
 * `/v1/rooms/:roomId/pending-syncs` — FS-04 write-back queue backend
 * (master plan §8G FS-04).
 *
 *     GET /v1/rooms/:roomId/pending-syncs   list the room's write-back queue
 *
 * Each row is the honest record of what a landed, approved staged write
 * (FS-03) means for the destination device: waiting to sync while the PC is
 * offline (the normal "laptop closed" case), or recorded as a conflict when
 * the write-back would overwrite a file that changed on the device. The
 * physical transport that drains the queue is FS-01/Syncthing; this route
 * only reads the queue so the room Files surface can show "results waiting
 * to sync" honestly — never claiming live write-back to an offline device.
 *
 * Follows `folder-binding.ts` exactly: route declared as a registry value
 * (FRANK-§12.2 metadata), capability resolved from the declaration
 * (FRANK-§3.8).
 */

import type { FastifyInstance } from 'fastify';

import { z } from 'zod';

import { identifiersOf } from '../context.js';
import { defineRoute } from '../schema/registry.js';
import {
  pendingSyncListResponseSchema,
  pendingSyncRecordSchema,
  pendingSyncRoomParamsSchema,
} from '../schema/write-back.js';
import type { PendingSyncRecord } from '../services/workbench/write-back.js';
import { WriteBackService } from '../services/workbench/write-back.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

/* ------------------------------------------------------------ definitions --- */

export const pendingSyncListRoute = defineRoute({
  operationId: 'pendingSyncList',
  method: 'GET',
  path: '/v1/rooms/:roomId/pending-syncs',
  group: '/v1/rooms',
  summary: "List a room's write-back queue (FS-04)",
  description:
    'Every write-back queue entry recorded for the room, oldest first: approved staged writes that landed while the destination PC was offline (state pending, synced once FS-01 drains them) and recorded conflicts (state conflict, never auto-overwritten). ' +
    'The physical sync is FS-01/Syncthing; this surface only reports the honest queue.',
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
  params: pendingSyncRoomParamsSchema,
  response: pendingSyncListResponseSchema,
  successStatus: 200,
});

export const pendingSyncRoutes = [pendingSyncListRoute];

/* --------------------------------------------------------------- handlers --- */

export interface PendingSyncRouteDependencies extends RouteHandlerDependencies {
  readonly writeBack: WriteBackService;
}

function recordToWire(record: PendingSyncRecord): z.input<typeof pendingSyncRecordSchema> {
  return {
    id: record.id,
    cell_id: record.cellId,
    workbench_id: record.workbenchId,
    room_id: record.roomId,
    folder_source: record.folderSource,
    binding_id: record.bindingId,
    staged_write_id: record.stagedWriteId,
    source_path: record.sourcePath,
    target_path: record.targetPath,
    state: record.state,
    reason: record.reason,
    detail: record.detail,
    proposed_at: record.proposedAt.toISOString(),
    proposed_by: record.proposedBy,
    synced_at: record.syncedAt === null ? null : record.syncedAt.toISOString(),
    synced_by: record.syncedBy,
  };
}

export function registerPendingSyncRoutes(
  app: FastifyInstance,
  dependencies: PendingSyncRouteDependencies,
): void {
  registerRoute(app, dependencies, pendingSyncListRoute, async ({ params, context }) => {
    const records = await dependencies.writeBack.listByRoom(context.cellId, params.roomId);
    return {
      pending_syncs: records.map(recordToWire),
      identifiers: identifiersOf(context),
    };
  });
}

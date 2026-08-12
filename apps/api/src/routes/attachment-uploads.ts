import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

import { identifiersOf } from '../context.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';

const reservationState = z.enum(['authorized', 'uploading', 'completed', 'terminating', 'cancelled', 'expired', 'rejected']);
const attachmentState = z.enum(['staging', 'scanning', 'ready', 'promoted', 'rejected', 'cancelled', 'expired']);
const pendingUpload = z.object({ upload_id: z.string().min(1), reservation_state: reservationState }).strict();
const materializedUpload = z.object({
  upload_id: z.string().min(1), reservation_state: reservationState,
  attachment_id: z.string().uuid(), attachment_state: attachmentState,
  scan_state: z.enum(['pending', 'clean', 'blocked', 'failed']),
  extraction_state: z.enum(['none', 'pending', 'complete', 'failed']),
}).strict();

export const attachmentUploadStatusRoute = defineRoute({
  operationId: 'attachmentUploadStatus', method: 'GET', path: '/v1/attachments/uploads/:uploadId', group: '/v1/attachments',
  summary: 'Read upload and attachment materialization status',
  description: 'Returns attachment_id only after the authenticated upload has produced a durable attachment row.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read',
  dataClasses: ['private'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [],
  params: z.object({ uploadId: z.string().min(1).max(255) }).strict(),
  response: z.object({ upload: z.union([materializedUpload, pendingUpload]), identifiers: identifiersSchema }).strict(), successStatus: 200,
});

export const attachmentUploadRoutes = [attachmentUploadStatusRoute] as const;

export interface AttachmentUploadRouteDependencies extends RouteHandlerDependencies { readonly db: FrankDatabase }

interface UploadRow extends Record<string, unknown> {
  upload_id: string;
  reservation_state: z.infer<typeof reservationState>;
  attachment_id: string | null;
  attachment_state: z.infer<typeof attachmentState> | null;
  scan_state: 'pending'|'clean'|'blocked'|'failed'|null;
  extraction_state: 'none'|'pending'|'complete'|'failed'|null;
}

export function registerAttachmentUploadRoutes(app: FastifyInstance, dependencies: AttachmentUploadRouteDependencies): void {
  registerRoute(app, dependencies, attachmentUploadStatusRoute, async ({ params, context, principal }) => {
    const result = await dependencies.db.execute<UploadRow>(sql`
      select r.upload_id, r.state as reservation_state, a.id as attachment_id,
             a.state as attachment_state, a.scan_state, a.extraction_state
      from frank_domain.upload_reservation r
      left join frank_domain.attachment a
        on a.reservation_id = r.id and a.cell_id = r.cell_id
      where r.cell_id = ${context.cellId} and r.owner_id = ${principal.principalId}
        and r.upload_id = ${params.uploadId}
    `);
    const row = result.rows[0];
    if (row === undefined) throw new ProblemError('not_found', 'Upload not found.');
    const upload = row.attachment_id === null
      ? { upload_id: row.upload_id, reservation_state: row.reservation_state }
      : {
          upload_id: row.upload_id, reservation_state: row.reservation_state,
          attachment_id: row.attachment_id, attachment_state: row.attachment_state!,
          scan_state: row.scan_state!, extraction_state: row.extraction_state!,
        };
    return { upload, identifiers: identifiersOf(context) };
  });
}

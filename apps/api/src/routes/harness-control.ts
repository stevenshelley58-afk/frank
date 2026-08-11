import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { FrankDatabase } from '@frank/adapter-postgres';

import { identifiersOf } from '../context.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';
import { HarnessJobStore, HarnessJobStoreError } from '../services/harness-job-store.js';

const id = z.string().uuid();
const sourceRef = z
  .object({ kind: z.string().trim().min(1), id: z.string().trim().min(1), version: z.string().trim().min(1).optional() })
  .strict();
const artifact = z.object({ object_id: z.string().min(1), source_ref: sourceRef }).strict();
const jobStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
const terminalStatus = z.enum(['completed', 'failed', 'cancelled']);
const jobEvent = z.discriminatedUnion('kind', [
  z.object({ job_id: id, cursor: z.number().int().min(0), kind: z.literal('progress'), occurred_at: z.iso.datetime(), payload: z.object({ summary: z.string().min(1) }).strict() }).strict(),
  z.object({ job_id: id, cursor: z.number().int().min(0), kind: z.literal('artifact'), occurred_at: z.iso.datetime(), payload: artifact }).strict(),
  z.object({ job_id: id, cursor: z.number().int().min(0), kind: z.literal('error'), occurred_at: z.iso.datetime(), payload: z.object({ summary: z.string().min(1) }).strict() }).strict(),
  z.object({ job_id: id, cursor: z.number().int().min(0), kind: z.literal('terminal'), occurred_at: z.iso.datetime(), payload: z.object({ status: terminalStatus, summary: z.string().min(1).optional() }).strict() }).strict(),
]);
const jobRepresentation = {
  job_id: id,
  status: jobStatus,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
  cancelled_at: z.iso.datetime().nullable(),
  artifacts: z.array(artifact),
  source_refs: z.array(sourceRef),
};
const createResponse = z.object({ ...jobRepresentation, replayed: z.boolean(), identifiers: identifiersSchema }).strict();
const statusResponse = z.object({ ...jobRepresentation, identifiers: identifiersSchema }).strict();
const eventsResponse = z.object({ ...jobRepresentation, events: z.array(jobEvent), next_cursor: z.number().int().min(0).nullable(), identifiers: identifiersSchema }).strict();
const cancelResponse = z.object({ ...jobRepresentation, replayed: z.boolean(), identifiers: identifiersSchema }).strict();

export const harnessJobBody = z.object({
  idempotency_key: z.string().trim().min(1).max(255),
  harness: z.literal('hermes'),
  task_type: z.literal('browser-research'),
  // Tenant and owner are never public input; the handler injects both.
  scope: z.object({ project_id: z.string().trim().min(1).max(200).optional(), room_id: id.optional() }).strict(),
  input: z.object({ query: z.string().trim().min(1).max(4096), max_sources: z.number().int().min(1).max(50), locale: z.string().trim().min(2).max(35).optional() }).strict(),
  allowed_tools: z.array(z.enum(['browser.search', 'browser.open', 'browser.extract'])).min(1).max(3),
  egress_profile: z.enum(['research-public', 'research-allowlist']),
}).strict();

export const harnessJobCreateRoute = defineRoute({ operationId: 'harnessJobCreate', method: 'POST', path: '/v1/harness/jobs', group: '/v1/harness', summary: 'Queue a bounded harness job', description: 'Durably queues the Night Watch control-plane job. No executor or model is invoked.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'validation_failed', 'idempotency_conflict', 'internal_error'], rateLimit: { requestsPerMinute: 30, burst: 5 }, auditObligations: ['create'], body: harnessJobBody, response: createResponse, successStatus: 201 });
export const harnessJobGetRoute = defineRoute({ operationId: 'harnessJobGet', method: 'GET', path: '/v1/harness/jobs/:id', group: '/v1/harness', summary: 'Read durable harness status', description: 'Returns only a job owned by the authenticated principal in the authenticated cell.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [], params: z.object({ id }), response: statusResponse, successStatus: 200 });
export const harnessJobEventsRoute = defineRoute({ operationId: 'harnessJobEvents', method: 'GET', path: '/v1/harness/jobs/:id/events', group: '/v1/harness', summary: 'Resume ordered durable harness events', description: 'Returns events strictly after after_cursor in ascending cursor order.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'validation_failed', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [], params: z.object({ id }), query: z.object({ after_cursor: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict(), response: eventsResponse, successStatus: 200 });
export const harnessJobCancelRoute = defineRoute({ operationId: 'harnessJobCancel', method: 'POST', path: '/v1/harness/jobs/:id/cancel', group: '/v1/harness', summary: 'Cancel a queued or running harness job', description: 'Durably records an idempotent cancellation and performs only the terminal-safe control-plane transition.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'validation_failed', 'idempotency_conflict', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 30, burst: 5 }, auditObligations: ['update'], params: z.object({ id }), body: z.object({ idempotency_key: z.string().trim().min(1).max(255), reason: z.string().trim().min(1).max(1024).optional() }).strict(), response: cancelResponse, successStatus: 200 });

export const harnessControlRoutes = [harnessJobCreateRoute, harnessJobGetRoute, harnessJobEventsRoute, harnessJobCancelRoute] as const;
/** Backward-compatible name retained for contract consumers. */
export const harnessControlRouteDefinitions = harnessControlRoutes;

export interface HarnessControlRouteDependencies extends RouteHandlerDependencies { readonly db: FrankDatabase }

function rethrowStoreError(error: unknown): never {
  if (error instanceof HarnessJobStoreError) {
    if (error.failure === 'idempotency_conflict') throw new ProblemError('idempotency_conflict', 'The idempotency key is already bound to a different request.');
    if (error.failure === 'invalid_scope') throw new ProblemError('validation_failed', 'The requested project/room scope is not valid in this cell.');
    throw new ProblemError('not_found', 'Harness job not found.');
  }
  throw error;
}

export function registerHarnessControlRoutes(app: FastifyInstance, dependencies: HarnessControlRouteDependencies): void {
  const store = new HarnessJobStore(dependencies.db);
  registerRoute(app, dependencies, harnessJobCreateRoute, async ({ body, context, principal }) => {
    try {
      const result = await store.create({
        cellId: context.cellId,
        ownerId: principal.principalId,
        request: {
          ...body,
          scope: {
            ...(body.scope.project_id === undefined ? {} : { project_id: body.scope.project_id }),
            ...(body.scope.room_id === undefined ? {} : { room_id: body.scope.room_id }),
          },
          input: {
            query: body.input.query,
            max_sources: body.input.max_sources,
            ...(body.input.locale === undefined ? {} : { locale: body.input.locale }),
          },
        },
      });
      return { ...result.job, replayed: result.replayed, identifiers: identifiersOf(context) };
    } catch (error) { return rethrowStoreError(error); }
  });
  registerRoute(app, dependencies, harnessJobGetRoute, async ({ params, context, principal }) => {
    try { return { ...(await store.get(context.cellId, principal.principalId, params.id)), identifiers: identifiersOf(context) }; }
    catch (error) { return rethrowStoreError(error); }
  });
  registerRoute(app, dependencies, harnessJobEventsRoute, async ({ params, query, context, principal }) => {
    try {
      const result = await store.events({ cellId: context.cellId, ownerId: principal.principalId, jobId: params.id, afterCursor: query.after_cursor ?? -1, limit: query.limit });
      return { ...result.job, events: result.events, next_cursor: result.nextCursor, identifiers: identifiersOf(context) };
    } catch (error) { return rethrowStoreError(error); }
  });
  registerRoute(app, dependencies, harnessJobCancelRoute, async ({ params, body, context, principal }) => {
    try {
      const result = await store.cancel({ cellId: context.cellId, ownerId: principal.principalId, jobId: params.id, requestedBy: principal.principalId, request: { idempotency_key: body.idempotency_key, ...(body.reason === undefined ? {} : { reason: body.reason }) } });
      return { ...result.job, replayed: result.replayed, identifiers: identifiersOf(context) };
    } catch (error) { return rethrowStoreError(error); }
  });
}

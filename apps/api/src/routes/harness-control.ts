/**
 * Frozen route descriptions only. Harness execution is deliberately not wired
 * into the API composition root in Wave 1; PostgreSQL primitives own the
 * atomic creation/replay boundary and an executor may be added later.
 */
import { z } from 'zod';
import { defineRoute, identifiersSchema } from '../schema/registry.js';

const id = z.string().uuid();
const sourceRef = z.object({ kind: z.string().min(1), id: z.string().min(1), version: z.string().min(1).optional() }).strict();
const status = z.object({ status: z.enum(['success', 'warning', 'error']), summary: z.string(), next_actions: z.array(z.string()), artifacts: z.array(z.object({ object_id: z.string().min(1), source_ref: sourceRef }).strict()), identifiers: identifiersSchema }).strict();
const jobBody = z.object({
  idempotency_key: z.string().min(1).max(255), harness: z.literal('hermes'), task_type: z.literal('browser-research'),
  // cell_id and owner_id are intentionally absent: request context is authoritative.
  scope: z.object({ project_id: z.string().min(1).optional(), room_id: id.optional() }).strict(),
  input: z.object({ query: z.string().min(1).max(4096), max_sources: z.number().int().min(1).max(50), locale: z.string().min(2).max(35).optional() }).strict(),
  allowed_tools: z.array(z.enum(['browser.search', 'browser.open', 'browser.extract'])).min(1).max(3), egress_profile: z.enum(['research-public', 'research-allowlist']),
}).strict();

/** NightWatch-compatible future seam: POST /v1/harness/jobs, with durable status/events/cancel resources. */
export const harnessControlRouteDefinitions = [
  defineRoute({ operationId: 'harnessJobCreate', method: 'POST', path: '/v1/harness/jobs', group: '/v1/harness', summary: 'Queue a bounded harness job', description: 'Definition only in Wave 1; no executor is registered.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'internal_error'], rateLimit: { requestsPerMinute: 30, burst: 5 }, auditObligations: ['create'], body: jobBody, response: status, successStatus: 201 }),
  defineRoute({ operationId: 'harnessJobGet', method: 'GET', path: '/v1/harness/jobs/:id', group: '/v1/harness', summary: 'Read durable harness status', description: 'Definition only in Wave 1.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [], params: z.object({ id }), response: status, successStatus: 200 }),
  defineRoute({ operationId: 'harnessJobEvents', method: 'GET', path: '/v1/harness/jobs/:id/events', group: '/v1/harness', summary: 'Resume durable harness events', description: 'Definition only in Wave 1.', actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 120, burst: 20 }, params: z.object({ id }), response: status, successStatus: 200 }),
  defineRoute({ operationId: 'harnessJobCancel', method: 'POST', path: '/v1/harness/jobs/:id/cancel', group: '/v1/harness', summary: 'Request harness cancellation', description: 'Definition only in Wave 1.', actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['internal'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found', 'internal_error'], rateLimit: { requestsPerMinute: 30, burst: 5 }, auditObligations: ['update'], params: z.object({ id }), body: z.object({ reason: z.string().min(1).max(1024).optional() }).strict(), response: status, successStatus: 202 }),
] as const;

/**
 * Attachment lifecycle routes. Browser-facing routes deliberately use the same
 * registry/auth/response-validation path as every other Frank API surface.
 * The two tusd callbacks are private machine endpoints and are intentionally
 * raw Fastify routes: they authenticate a distinct hook/gate secret and never
 * accept a user session.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { identifiersOf } from '../context.js';
import { registerRoute, type RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';
import { AttachmentCancelError, AttachmentLifecycle, isCompactCapability } from '../services/attachments/lifecycle.js';
import { constantTimeEqual } from '../services/attachments/storage.js';
import type { AttachmentDownloadStorage, AttachmentPersistencePort, TusdHookRequest, TusdTerminationPort } from '../services/attachments/types.js';

const uuid = z.string().uuid();
const uploadId = uuid;
const text = z.string().trim().min(1).max(255);
const identifiersResponse = identifiersSchema;
const capabilityResponse = z.object({
  upload_id: uploadId,
  capability: z.string().min(16).max(4096),
  capability_expires_at: z.string().datetime(),
  reservation_expires_at: z.string().datetime(),
  identifiers: identifiersResponse,
}).strict();

export const attachmentAuthorizeRoute = defineRoute({
  operationId: 'attachmentAuthorize', method: 'POST', path: '/v1/attachments/uploads', group: '/v1/attachments',
  summary: 'Authorize one resumable attachment upload', description: 'Creates or idempotently replays a durable upload reservation. The response contains a short-lived capability and the public tus creation URL.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['private'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'validation_failed', 'idempotency_conflict', 'service_unavailable', 'internal_error'], rateLimit: { requestsPerMinute: 30, burst: 5 }, auditObligations: ['create'],
  body: z.object({ conversation_id: uuid, draft_message_id: uuid, idempotency_key: text.optional(), size_bytes: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]), original_name: z.string().trim().min(1).max(255), relative_path: z.string().trim().min(1).max(4096).optional(), media_type: z.string().trim().min(1).max(255).optional() }).strict(),
  response: z.object({ reservation_id: uuid, upload_id: uploadId, tus_creation_url: z.string().url(), tus_headers: z.object({ 'Upload-Metadata': z.string().min(1), 'X-Frank-Upload-Capability': z.string().min(16).max(4096) }).strict(), tus_metadata: z.object({ upload_id: uploadId, cell_id: z.string().min(1), conversation_id: uuid }).strict(), tus_allowed_meta_fields: z.tuple([z.literal('upload_id'), z.literal('cell_id'), z.literal('conversation_id')]), capability_expires_at: z.string().datetime(), reservation_expires_at: z.string().datetime(), replayed: z.boolean(), identifiers: identifiersResponse }).strict(), successStatus: 201,
});

export const attachmentCapabilityRenewRoute = defineRoute({
  operationId: 'attachmentCapabilityRenew', method: 'POST', path: '/v1/attachments/uploads/:uploadId/capability', group: '/v1/attachments',
  summary: 'Renew a short-lived upload capability', description: 'Renews only a still-resumable, unexpired reservation. Expired reservations never receive a browser capability.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['private'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found', 'validation_failed', 'internal_error'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [],
  params: z.object({ uploadId }).strict(), response: capabilityResponse, successStatus: 200,
});

export const attachmentCancelRoute = defineRoute({
  operationId: 'attachmentCancel', method: 'DELETE', path: '/v1/attachments/uploads/:uploadId', group: '/v1/attachments',
  summary: 'Request private tus upload termination', description: 'Begins durable cancellation then asks private tusd to delete the staging object. It is retry-safe while termination is pending.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'], capability: 'chat.write', dataClasses: ['private'], standingPolicyEligible: true, policyOperation: 'chat.write', idempotency: 'required_key', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found', 'validation_failed', 'internal_error'], rateLimit: { requestsPerMinute: 30, burst: 5 }, auditObligations: ['update'],
  params: z.object({ uploadId }).strict(), body: z.object({ idempotency_key: text.optional() }).strict().optional(), response: z.object({ state: z.enum(['termination_requested', 'already_terminated']), identifiers: identifiersResponse }).strict(), successStatus: 202,
});

export const attachmentDownloadRoute = defineRoute({
  operationId: 'attachmentDownload', method: 'GET', path: '/v1/attachments/objects/:objectId/download', group: '/v1/attachments',
  summary: 'Download a clean private attachment', description: 'Streams an owned, clean object through Frank with authenticated Range support.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'], capability: 'chat.read', dataClasses: ['private'], standingPolicyEligible: true, policyOperation: 'chat.read', idempotency: 'safe', consistency: 'read_own_writes', errors: ['unauthenticated', 'forbidden', 'not_found', 'validation_failed', 'internal_error'], rateLimit: { requestsPerMinute: 120, burst: 20 }, auditObligations: [],
  params: z.object({ objectId: uuid }).strict(), query: z.object({ conversation_id: uuid }).strict(), response: z.object({ download: z.literal('stream'), identifiers: identifiersResponse }).strict(), successStatus: 200, responseMode: 'stream',
});

export const attachmentRoutes = [attachmentAuthorizeRoute, attachmentCapabilityRenewRoute, attachmentCancelRoute, attachmentDownloadRoute] as const;

export interface AttachmentRouteDependencies extends RouteHandlerDependencies {
  readonly lifecycle: AttachmentLifecycle;
  readonly persistence: AttachmentPersistencePort;
  readonly downloader: AttachmentDownloadStorage;
  readonly tusdTerminator: TusdTerminationPort;
  /** Configured public API origin: never infer browser-facing URLs from Host. */
  readonly publicUrl: string;
  readonly tusdHookSecret: string;
  readonly tusdGateSecret: string;
}

type ByteRange = { start: bigint; end: bigint };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerAttachmentRoutes(app: FastifyInstance, deps: AttachmentRouteDependencies): void {
  if (!deps.tusdHookSecret || !deps.tusdGateSecret || deps.tusdHookSecret === deps.tusdGateSecret) throw new Error('invalid_attachment_ingress_configuration');
  const tusCreationUrl = new URL('/v1/uploads/tus/', deps.publicUrl).toString();
  if (new URL(tusCreationUrl).origin !== new URL(deps.publicUrl).origin) throw new Error('invalid_attachment_public_url');

  registerRoute(app, deps, attachmentAuthorizeRoute, async ({ body, context, principal, reply }) => {
    let sizeBytes: bigint;
    try { sizeBytes = BigInt(body.size_bytes); } catch { throw new ProblemError('validation_failed', 'size_bytes must be a nonnegative integer.'); }
    try {
      const result = await deps.lifecycle.authorize({ ownerId: principal.principalId, cellId: context.cellId, conversationId: body.conversation_id, draftMessageId: body.draft_message_id, idempotencyKey: context.idempotencyKey!, sizeBytes, originalName: body.original_name, ...(body.relative_path ? { relativePath: body.relative_path } : {}), ...(body.media_type ? { mediaType: body.media_type } : {}) });
      if (result.kind === 'error') {
        if (result.code === 'limit_exceeded') throw new ProblemError('validation_failed', result.hint);
        if (result.code === 'capacity_unavailable') throw new ProblemError('service_unavailable', result.hint);
        throw new ProblemError('idempotency_conflict', result.hint);
      }
      const { reservation, capability, capabilityExpiresAt, replayed } = result.value;
      reply.code(201).header('x-frank-upload-capability', capability);
      return { reservation_id: reservation.id, upload_id: reservation.uploadId, tus_creation_url: tusCreationUrl, tus_headers: { 'Upload-Metadata': metadataHeader(reservation), 'X-Frank-Upload-Capability': capability }, tus_metadata: { upload_id: reservation.uploadId, cell_id: reservation.cellId, conversation_id: reservation.conversationId! }, tus_allowed_meta_fields: ['upload_id', 'cell_id', 'conversation_id'] as ['upload_id', 'cell_id', 'conversation_id'], capability_expires_at: capabilityExpiresAt.toISOString(), reservation_expires_at: reservation.expiresAt.toISOString(), replayed, identifiers: identifiersOf(context) };
    } catch (error) { if (error instanceof ProblemError) throw error; throw new ProblemError('validation_failed', 'Attachment request is invalid.'); }
  });
  registerRoute(app, deps, attachmentCapabilityRenewRoute, async ({ params, context, principal }) => {
    const result = await deps.lifecycle.renewCapability(params.uploadId, principal.principalId, context.cellId);
    if (result.kind === 'error') throw new ProblemError(result.code === 'expired' ? 'not_found' : 'not_found', 'Upload cannot be renewed.');
    return { upload_id: result.value.reservation.uploadId, capability: result.value.capability, capability_expires_at: result.value.capabilityExpiresAt.toISOString(), reservation_expires_at: result.value.reservation.expiresAt.toISOString(), identifiers: identifiersOf(context) };
  });
  registerRoute(app, deps, attachmentCancelRoute, async ({ params, context, principal, request, reply }) => {
    const capability = headerText(request, 'x-frank-upload-capability');
    if (!capability) throw new ProblemError('forbidden', 'An upload capability is required.');
    try {
      const state = await deps.lifecycle.cancel(params.uploadId, principal.principalId, context.cellId, capability, deps.tusdTerminator);
      reply.code(202);
      return { state: state === 'already_terminated' ? 'already_terminated' as const : 'termination_requested' as const, identifiers: identifiersOf(context) };
    } catch (error) {
      if (error instanceof AttachmentCancelError) throw new ProblemError(error.reason === 'forbidden' ? 'forbidden' : error.reason === 'not_found' ? 'not_found' : 'internal_error', 'Upload termination could not be completed.');
      throw error;
    }
  });
  registerRoute(app, deps, attachmentDownloadRoute, async ({ params, query, context, principal, request, reply }) => {
    const manifest = await deps.persistence.findDownload({ objectId: params.objectId, cellId: context.cellId, ownerId: principal.principalId, conversationId: query.conversation_id });
    if (!manifest || manifest.security.scan_state !== 'clean') throw new ProblemError('not_found', 'Attachment not found.');
    const etag = `\"${manifest.sha256}\"`;
    if (etagMatches(headerText(request, 'if-none-match'), etag)) { void reply.code(304).header('etag', etag).send(); return { download: 'stream' as const, identifiers: identifiersOf(context) }; }
    let range: ByteRange | undefined;
    try { range = parseSingleRange(headerText(request, 'range'), BigInt(manifest.size_bytes)); } catch { void reply.code(416).header('content-range', `bytes */${manifest.size_bytes}`).send(); return { download: 'stream' as const, identifiers: identifiersOf(context) }; }
    const name = encodeURIComponent((manifest.original_name ?? manifest.object_id).replace(/[\r\n\"\\/]/g, '_'));
    reply.header('etag', etag).header('content-type', manifest.media_type).header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store').header('content-disposition', `attachment; filename*=UTF-8''${name}`).header('accept-ranges', 'bytes');
    if (range) reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${manifest.size_bytes}`).header('content-length', String(range.end - range.start + 1n));
    // Fastify's GET route exposes HEAD automatically. Stream only for GET; HEAD is body-free.
    if (request.method === 'HEAD') { void reply.send(); return { download: 'stream' as const, identifiers: identifiersOf(context) }; }
    const stream = await deps.downloader.readObject(manifest.object_key, range);
    void reply.send(stream);
    return { download: 'stream' as const, identifiers: identifiersOf(context) };
  });

  // Private tusd hooks are protected by a dedicated secret. They are not part of
  // the public contract registry and never consult browser/session identity.
  app.post('/private/tusd/hooks', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    if (!secretHeader(request, 'x-frank-tusd-hook-secret', deps.tusdHookSecret)) return reply.code(401).send({ error: 'unauthorized' });
    let hook: TusdHookRequest; try { hook = tusdHook(request.body); } catch { return reply.code(400).send({ error: 'invalid_tusd_hook' }); }
    if (hook.Type === 'pre-create') { const result = await deps.lifecycle.preCreate(hook); return result.kind === 'error' ? reply.code(403).send({ RejectUpload: true }) : reply.code(200).send(result.value); }
    if (hook.Type === 'pre-finish') { const result = await deps.lifecycle.preFinish(hook); return result.kind === 'error' ? reply.code(403).send({ RejectUpload: true }) : reply.code(200).send({}); }
    if (hook.Type === 'post-finish') { const result = await deps.lifecycle.confirmPostFinish(hook); return result.kind === 'error' ? reply.code(202).send({ confirmed: false }) : reply.code(202).send(result.value); }
    if (hook.Type === 'pre-terminate') { const result = await deps.lifecycle.preTerminate(hook); return result.kind === 'error' ? reply.code(403).send({ RejectUpload: true }) : reply.code(200).send({}); }
    const result = await deps.lifecycle.postTerminate(hook); return result.kind === 'error' ? reply.code(202).send({ persisted: false }) : reply.code(200).send(result.value);
  });
  app.get('/private/tusd/gate', async (request, reply) => {
    if (!secretHeader(request, 'x-frank-tusd-gate-secret', deps.tusdGateSecret)) return reply.code(401).send();
    const method = headerText(request, 'x-forwarded-method')?.toUpperCase(); const target = tusTarget(headerText(request, 'x-forwarded-uri')); const capability = headerText(request, 'x-frank-upload-capability');
    if (!method || !target || !capability || !isCompactCapability(capability) || !['POST', 'HEAD', 'PATCH', 'DELETE'].includes(method)) return reply.code(403).send();
    const id = method === 'POST' ? uploadIdFromMetadata(headerText(request, 'upload-metadata')) : target.uploadId;
    if (!id || (method === 'POST' && !target.isCollection) || (method !== 'POST' && target.isCollection)) return reply.code(403).send();
    const result = await deps.lifecycle.authorizeTusGate({ uploadId: id, capability, method: method as 'POST' | 'HEAD' | 'PATCH' | 'DELETE' });
    return result.kind === 'error' ? reply.code(403).send() : reply.code(204).send();
  });
}

function headerText(request: FastifyRequest, name: string): string | undefined { const value = request.headers[name]; return typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 ? value[0] : undefined; }
function secretHeader(request: FastifyRequest, name: string, expected: string): boolean { const value = headerText(request, name); return !!value && constantTimeEqual(value, expected); }
function metadataHeader(reservation: { uploadId: string; cellId: string; conversationId?: string }): string { return ([['upload_id', reservation.uploadId], ['cell_id', reservation.cellId], ['conversation_id', reservation.conversationId ?? '']] as Array<[string, string]>).map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`).join(','); }
function tusdHook(value: unknown): TusdHookRequest { const body = objectBody(value); if (!['pre-create', 'pre-finish', 'post-finish', 'pre-terminate', 'post-terminate'].includes(String(body.Type))) throw new Error('bad_type'); const event = objectBody(body.Event); const upload = objectBody(event.Upload); const http = objectBody(event.HTTPRequest); if (typeof upload.ID !== 'string' || typeof upload.Size !== 'number' || !Number.isSafeInteger(upload.Size) || upload.Size < 0 || typeof upload.SizeIsDeferred !== 'boolean' || typeof upload.Offset !== 'number' || !Number.isSafeInteger(upload.Offset) || upload.Offset < 0 || !isStringRecord(upload.MetaData) || typeof http.Method !== 'string' || typeof http.URI !== 'string' || !isHeaderRecord(http.Header)) throw new Error('bad_event'); return body as unknown as TusdHookRequest; }
function objectBody(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_body'); return value as Record<string, unknown>; }
function isStringRecord(value: unknown): value is Record<string, string> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string'); }
function isHeaderRecord(value: unknown): value is Record<string, string[]> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => Array.isArray(item) && item.every(part => typeof part === 'string')); }
export function tusTarget(uri: string | undefined): { isCollection: boolean; uploadId?: string } | undefined { if (!uri || /[\r\n]/.test(uri)) return undefined; let parsed: URL; try { parsed = new URL(uri, 'https://caddy.invalid'); } catch { return undefined; } if (parsed.origin !== 'https://caddy.invalid') return undefined; if (parsed.pathname === '/v1/uploads/tus/' || parsed.pathname === '/v1/uploads/tus') return { isCollection: true }; const match = /^\/v1\/uploads\/tus\/([0-9a-f-]{36})$/.exec(parsed.pathname); return match && UUID.test(match[1]!) ? { isCollection: false, uploadId: match[1]! } : undefined; }
export function uploadIdFromMetadata(value: string | undefined): string | undefined { const parts = value?.split(',').map(item => item.trim()) ?? []; const match = parts.filter(item => /^upload_id [A-Za-z0-9+/]+={0,2}$/.test(item)); if (match.length !== 1) return undefined; const encoded = match[0]!.slice(10); try { const decoded = Buffer.from(encoded, 'base64'); const normalized = decoded.toString('base64').replace(/=+$/, ''); if (normalized !== encoded.replace(/=+$/, '')) return undefined; return UUID.test(decoded.toString('utf8')) ? decoded.toString('utf8') : undefined; } catch { return undefined; } }
export function parseSingleRange(header: string | undefined, size: bigint): ByteRange | undefined { if (!header) return undefined; const match = /^bytes=(\d*)-(\d*)$/.exec(header); if (!match || (!match[1] && !match[2]) || size === 0n) throw new Error('invalid_range'); const suffix = !match[1] ? BigInt(match[2]!) : undefined; const start = match[1] ? BigInt(match[1]) : suffix! >= size ? 0n : size - suffix!; const end = match[1] && match[2] ? BigInt(match[2]) : size - 1n; if (start >= size || end < start) throw new Error('invalid_range'); return { start, end: end >= size ? size - 1n : end }; }
function etagMatches(value: string | undefined, etag: string): boolean { return value === '*' || !!value?.split(',').map(item => item.trim()).includes(etag); }

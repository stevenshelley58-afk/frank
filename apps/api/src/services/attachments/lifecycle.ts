import { createHash, randomUUID } from 'node:crypto';
import { MAX_CAPABILITY_TTL_MS, MAX_FILE_BYTES, type AttachmentErrorCode, type AttachmentPersistencePort, type LifecycleResult, type TusdHookRequest, type TusPreCreateResponse, type TusdTerminationPort, type UploadCapabilityPort, type UploadReservation } from './types.js';

type AuthorizeInput = { ownerId: string; cellId: string; conversationId: string; draftMessageId: string; idempotencyKey: string; sizeBytes: bigint; originalName: string; relativePath?: string | undefined; mediaType?: string | undefined };
type GateInput = { uploadId: string; capability: string; method: 'POST' | 'HEAD' | 'PATCH' | 'DELETE'; cellId?: string | undefined };

/** This class never reads object bytes: hooks only reserve, authorise, and enqueue durable work. */
export class AttachmentLifecycle {
  constructor(private readonly persistence: AttachmentPersistencePort, private readonly capabilities: UploadCapabilityPort, private readonly now = () => new Date()) {}

  async authorize(input: AuthorizeInput): Promise<LifecycleResult<{ reservation: UploadReservation; capability: string; capabilityExpiresAt: Date; replayed: boolean }>> {
    this.validateRequest(input);
    const originalName = this.safeName(input.originalName); const mediaType = input.mediaType ?? 'application/octet-stream';
    const requestHash = this.digest(JSON.stringify({ cellId: input.cellId, ownerId: input.ownerId, conversationId: input.conversationId, draftMessageId: input.draftMessageId, sizeBytes: input.sizeBytes.toString(), originalName, relativePath: input.relativePath ?? null, mediaType }));
    const result = await this.persistence.reserveAuthorization({ cellId: input.cellId, ownerId: input.ownerId, conversationId: input.conversationId, draftMessageId: input.draftMessageId, idempotencyKey: input.idempotencyKey, requestHash, uploadId: randomUUID(), sizeBytes: input.sizeBytes, originalName, ...(input.relativePath ? { relativePath: input.relativePath } : {}), mediaType, expiresAt: new Date(this.now().getTime() + 24 * 60 * 60 * 1000) });
    if (result.kind === 'refused') return this.error(result.reason === 'object_too_large' || result.reason.includes('message') ? 'limit_exceeded' : 'capacity_unavailable', 'Upload reservation was refused.', result.reason === 'host_free_insufficient' ? 'after_backoff' : 'never');
    if (result.kind === 'conflict') return this.error('invalid_request', 'Idempotency key was used for different upload details.', 'never');
    // A replay is a normal idempotent authorization: issue a new opaque signed capability
    // from durable claims. It is deliberately not represented as a hook replay.
    const issued = await this.issueCapability(result.reservation);
    return { kind: 'success', value: { reservation: result.reservation, capability: issued.capability, capabilityExpiresAt: issued.expiresAt, replayed: result.kind === 'replayed' }, warnings: [] };
  }
  async renewCapability(uploadId: string, ownerId: string, cellId: string): Promise<LifecycleResult<{ reservation: UploadReservation; capability: string; capabilityExpiresAt: Date }>> { const reservation = await this.persistence.findReservation(cellId, uploadId); if (!reservation || reservation.ownerId !== ownerId || reservation.expiresAt <= this.now() || !['authorized', 'uploading'].includes(reservation.state)) return this.error(reservation?.expiresAt && reservation.expiresAt <= this.now() ? 'expired' : 'not_found', 'Upload cannot be renewed.', 'never'); const issued = await this.issueCapability(reservation); return { kind: 'success', value: { reservation, capability: issued.capability, capabilityExpiresAt: issued.expiresAt }, warnings: [] }; }

  async authorizeTusGate(input: GateInput): Promise<LifecycleResult<UploadReservation>> {
    if (!isCompactCapability(input.capability)) return this.error('forbidden', 'Upload capability has an unsafe encoding.', 'never');
    const claims = await this.capabilities.verify(input.capability);
    if (!claims || claims.uploadId !== input.uploadId || (input.cellId && claims.cellId !== input.cellId) || claims.expiresAt <= this.now()) return this.error('forbidden', 'Upload capability is invalid or expired.', 'never');
    const reservation = await this.persistence.findReservation(claims.cellId, input.uploadId);
    if (!reservation || reservation.ownerId !== claims.ownerId || reservation.cellId !== claims.cellId || claims.capabilityVersion > reservation.capabilityVersion || claims.capabilityVersion < reservation.capabilityVersion - 1 || reservation.expiresAt <= this.now() || !['authorized', 'uploading'].includes(reservation.state)) return this.error('forbidden', 'Upload is not resumable.', 'never');
    return { kind: 'success', value: reservation, warnings: [] };
  }

  async preCreate(hook: TusdHookRequest): Promise<LifecycleResult<TusPreCreateResponse>> {
    const metadata = this.metadata(hook); const capability = oneHeader(hook.Event.HTTPRequest.Header, 'x-frank-upload-capability');
    const result = capability ? await this.authorizeTusGate({ uploadId: metadata.upload_id ?? '', capability, method: 'POST', cellId: metadata.cell_id }) : this.error('forbidden', 'Missing upload capability.', 'never');
    if (result.kind === 'error') return result;
    if (hook.Event.Upload.ID && hook.Event.Upload.ID !== result.value.uploadId) return this.error('hook_metadata_mismatch', 'Tus ID does not match the reservation.', 'never');
    if (hook.Event.Upload.Offset !== 0 || hook.Event.Upload.SizeIsDeferred || BigInt(hook.Event.Upload.Size) !== result.value.reservedBytes || !this.exactMetadata(metadata, result.value)) return this.error('hook_metadata_mismatch', 'Tus creation metadata does not match the reservation.', 'never');
    return { kind: 'success', value: { ChangeFileInfo: { ID: result.value.uploadId } }, warnings: [] };
  }

  async preFinish(hook: TusdHookRequest): Promise<LifecycleResult<{ accepted: boolean }>> {
    const valid = await this.validateFinishedHook(hook); if (valid.kind === 'error') return valid;
    // This is intentionally blocking: durable acceptance/outbox admission happens before tusd commits.
    // Persistence atomically CASes authorised/uploading→completed and inserts hash_scan_promote.
    const accepted = await this.persistence.acceptTusCompletion({ cellId: valid.value.cellId, uploadId: valid.value.uploadId, tusId: hook.Event.Upload.ID, sizeBytes: valid.value.reservedBytes, metadata: this.metadata(hook), sourceRef: { kind: 'tusd', id: hook.Event.Upload.ID } });
    if (accepted.kind === 'refused') return this.error('hook_replay', 'Completion cannot be accepted.', 'never');
    return { kind: 'success', value: { accepted: accepted.kind === 'accepted' }, warnings: [] };
  }
  async confirmPostFinish(hook: TusdHookRequest): Promise<LifecycleResult<{ confirmed: true }>> { const valid = await this.validateFinishedHook(hook); if (valid.kind === 'error') return valid; await this.persistence.confirmTusCompletion({ cellId: valid.value.cellId, uploadId: valid.value.uploadId, tusId: hook.Event.Upload.ID }); return { kind: 'success', value: { confirmed: true }, warnings: [] }; }
  async preTerminate(hook: TusdHookRequest): Promise<LifecycleResult<UploadReservation>> {
    const metadata = this.metadata(hook); const capability = oneHeader(hook.Event.HTTPRequest.Header, 'x-frank-upload-capability');
    const result = capability ? await this.authorizeTusGate({ uploadId: hook.Event.Upload.ID || metadata.upload_id || '', capability, method: 'DELETE', cellId: metadata.cell_id }) : this.error('forbidden', 'Missing upload capability.', 'never');
    if (result.kind === 'error') return result;
    if (hook.Event.Upload.ID !== result.value.uploadId || !this.exactMetadata(metadata, result.value) || BigInt(hook.Event.Upload.Size) !== result.value.reservedBytes || hook.Event.Upload.Offset > hook.Event.Upload.Size) return this.error('hook_metadata_mismatch', 'Termination payload does not match the reservation.', 'never');
    const begun = await this.persistence.beginTermination({ cellId: result.value.cellId, uploadId: result.value.uploadId, ownerId: result.value.ownerId });
    if (begun === 'not_found') return this.error('not_found', 'Upload reservation was not found.', 'never');
    return result;
  }
  async postTerminate(hook: TusdHookRequest): Promise<LifecycleResult<{ persisted: boolean }>> {
    const metadata = this.metadata(hook); const cellId = metadata.cell_id ?? ''; const uploadId = hook.Event.Upload.ID || metadata.upload_id || '';
    const reservation = await this.persistence.findReservation(cellId, uploadId);
    if (!reservation || hook.Event.Upload.ID !== reservation.uploadId || !this.exactMetadata(metadata, reservation)) return this.error('hook_metadata_mismatch', 'Termination payload does not match the reservation.', 'never');
    return { kind: 'success', value: { persisted: await this.persistence.persistTermination({ cellId, uploadId, reason: 'cancelled' }) }, warnings: [] };
  }
  async cancel(uploadId: string, ownerId: string, cellId: string, capability: string, tusd: TusdTerminationPort): Promise<'accepted' | 'already_terminated'> { const reservation = await this.requestCancel(uploadId, ownerId, cellId); const authorized = await this.authorizeTusGate({ uploadId, capability, method: 'DELETE', cellId }); if (authorized.kind === 'error') throw new AttachmentCancelError('forbidden'); const begun = await this.persistence.beginTermination({ cellId, uploadId: reservation.uploadId, ownerId }); if (begun === 'not_found') throw new AttachmentCancelError('not_found'); if (begun === 'already_terminated') return begun; try { await tusd.terminate({ uploadId: reservation.uploadId, capability }); } catch (error) { await this.persistence.retryTermination({ cellId, uploadId: reservation.uploadId, reason: error instanceof Error ? error.message : 'tusd_termination_failed' }); throw new AttachmentCancelError('unavailable'); } return 'accepted'; }
  private async requestCancel(uploadId: string, ownerId: string, cellId: string): Promise<UploadReservation> { const reservation = await this.persistence.findReservation(cellId, uploadId); if (!reservation || reservation.ownerId !== ownerId || !['authorized', 'uploading', 'terminating'].includes(reservation.state)) throw new AttachmentCancelError('not_found'); return reservation; }

  private async validateFinishedHook(hook: TusdHookRequest): Promise<LifecycleResult<UploadReservation>> {
    const metadata = this.metadata(hook); const reservation = await this.persistence.findReservation(metadata.cell_id ?? '', metadata.upload_id ?? '');
    if (!reservation || hook.Event.Upload.ID !== reservation.uploadId || hook.Event.Upload.SizeIsDeferred || BigInt(hook.Event.Upload.Size) !== reservation.reservedBytes || hook.Event.Upload.Offset !== hook.Event.Upload.Size || !this.exactMetadata(metadata, reservation)) return this.error('hook_metadata_mismatch', 'Finished upload payload does not match the reservation.', 'never');
    return { kind: 'success', value: reservation, warnings: [] };
  }
  private metadata(hook: TusdHookRequest): Record<string, string> { const source = hook.Event.Upload.MetaData; if (!source || Array.isArray(source)) return { __invalid_metadata: '' }; const metadata: Record<string, string> = {}; for (const [key, value] of Object.entries(source)) { const normalized = key.toLowerCase(); if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || Object.hasOwn(metadata, normalized)) return { __invalid_metadata: '' }; metadata[normalized] = value; } return metadata; }
  private exactMetadata(metadata: Record<string, string>, reservation: UploadReservation): boolean { const expected = Object.keys(metadata).sort(); return expected.length === 3 && expected.join(',') === 'cell_id,conversation_id,upload_id' && metadata.upload_id === reservation.uploadId && metadata.cell_id === reservation.cellId && metadata.conversation_id === (reservation.conversationId ?? ''); }
  private validateRequest(input: AuthorizeInput): void { if (!input.ownerId || !input.cellId || !input.conversationId || !input.idempotencyKey || !isUuid(input.draftMessageId) || input.sizeBytes < 0n || input.sizeBytes > MAX_FILE_BYTES) throw new Error('invalid_upload_request'); this.safeName(input.originalName); if (input.relativePath !== undefined && (!input.relativePath || input.relativePath.startsWith('/') || input.relativePath.includes('\\') || input.relativePath.split('/').some(x => !x || x === '.' || x === '..'))) throw new Error('invalid_relative_path'); }
  private safeName(value: string): string { const safe = value.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim(); if (!safe || safe === '.' || safe === '..') throw new Error('invalid_filename'); return safe.slice(0, 255); }
  private digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  private async issueCapability(reservation: UploadReservation): Promise<{ capability: string; expiresAt: Date }> { const expiresAt = new Date(Math.min(reservation.expiresAt.getTime(), this.now().getTime() + MAX_CAPABILITY_TTL_MS)); return { capability: await this.capabilities.issue({ uploadId: reservation.uploadId, cellId: reservation.cellId, ownerId: reservation.ownerId, capabilityVersion: reservation.capabilityVersion, expiresAt }), expiresAt }; }
  private error(code: AttachmentErrorCode, hint: string, retry: 'never' | 'after_backoff' | 'after_fix'): LifecycleResult<never> { return { kind: 'error', code, hint, retry, artifactIds: [] }; }
}
export class AttachmentCancelError extends Error { constructor(readonly reason: 'forbidden' | 'not_found' | 'unavailable') { super(reason); } }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

/** Opaque signed token permitted in an HTTP header. No fixed 32-byte/43-character assumption. */
export function isCompactCapability(value: string): boolean { return value.length >= 16 && value.length <= 4096 && /^[A-Za-z0-9._~-]+$/.test(value); }
export function oneHeader(headers: Record<string, string[]>, name: string): string | undefined { const values = Object.entries(headers).filter(([key]) => key.toLowerCase() === name).flatMap(([, value]) => value); return values.length === 1 && typeof values[0] === 'string' ? values[0] : undefined; }

import type { Readable } from 'node:stream';
import { normalizeSourceRef, type ObjectManifest as ContractObjectManifest, type SourceRef } from '@frank/contracts';

export type { SourceRef } from '@frank/contracts';

export const MAX_FILE_BYTES = 2n * 1024n * 1024n * 1024n;
export const MAX_MESSAGE_BYTES = 10n * 1024n * 1024n * 1024n;
export const MAX_MESSAGE_FILES = 10_000;
export const MAX_POOL_BYTES = 50n * 1024n * 1024n * 1024n;
export const MIN_FREE_POOL_BYTES = 30n * 1024n * 1024n * 1024n;
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
/** Browser capabilities are renewable signed proofs, not 24-hour bearer credentials. */
export const MAX_CAPABILITY_TTL_MS = 15 * 60 * 1000;

export type UploadReservationState = 'authorized' | 'uploading' | 'completed' | 'terminating' | 'cancelled' | 'expired' | 'rejected';
export type AttachmentState = 'staging' | 'scanning' | 'ready' | 'promoted' | 'rejected' | 'cancelled' | 'expired';
export type AttachmentErrorCode = 'invalid_request' | 'limit_exceeded' | 'capacity_unavailable' | 'not_found' | 'forbidden' | 'expired' | 'hook_replay' | 'hook_metadata_mismatch' | 'content_rejected' | 'scan_unavailable' | 'scan_infected' | 'storage_failed';
export type LifecycleResult<T> = { kind: 'success'; value: T; warnings: readonly string[] } | { kind: 'warning'; value: T; warnings: readonly string[] } | { kind: 'error'; code: AttachmentErrorCode; hint: string; retry: 'never' | 'after_backoff' | 'after_fix'; artifactIds: readonly string[] };

export interface UploadReservation { id: string; cellId: string; ownerId: string; conversationId?: string; draftMessageId: string; idempotencyKey: string; requestHash: string; uploadId: string; originalName: string; relativePath?: string; mediaType: string; state: UploadReservationState; reservedBytes: bigint; reservedCount: number; capabilityVersion: number; expiresAt: Date; }
/** `termination` is minted only inside the server after a durable expiry claim. */
export interface UploadCapabilityClaims { uploadId: string; cellId: string; ownerId: string; capabilityVersion: number; expiresAt: Date; purpose?: 'browser' | 'termination'; }
/** A compact signed capability is opaque. Its format and length belong to this port. */
export interface UploadCapabilityPort { issue(claims: UploadCapabilityClaims): Promise<string>; verify(capability: string): Promise<UploadCapabilityClaims | undefined>; }
export interface ReservationRequest { cellId: string; ownerId: string; conversationId?: string; draftMessageId: string; idempotencyKey: string; requestHash: string; uploadId: string; sizeBytes: bigint; originalName: string; relativePath?: string; mediaType: string; expiresAt: Date; }
export type ReservationResult = { kind: 'created' | 'replayed'; reservation: UploadReservation; capability: UploadCapabilityClaims } | { kind: 'conflict'; reservation: UploadReservation } | { kind: 'refused'; reason: 'object_too_large' | 'cell_pool_exhausted' | 'message_bytes_exhausted' | 'message_count_exhausted' | 'host_free_insufficient' | 'unauthorized' };
export interface AttachmentRecord { id: string; cellId: string; ownerId: string; conversationId?: string; reservationId: string; uploadId: string; objectId?: string; name: string; relativePath?: string; sizeBytes: bigint; mediaType: string; digest?: string; scanState: 'pending' | 'clean' | 'blocked' | 'failed'; extractionState: 'none' | 'pending' | 'complete' | 'failed'; state: AttachmentState; }
/** Internal worker representation; bigint prevents arithmetic loss until the canonical JSON boundary. */
export interface ObjectManifest extends Omit<ContractObjectManifest, 'sha256' | 'size_bytes' | 'source_ref'> { sha256: string; size_bytes: bigint; source_ref: SourceRef; }
export type CanonicalObjectManifest = ContractObjectManifest;
export function toCanonicalObjectManifest(manifest: ObjectManifest): CanonicalObjectManifest {
  if (manifest.size_bytes < 0n || manifest.size_bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unsafe_manifest_size');
  return { ...manifest, size_bytes: Number(manifest.size_bytes), source_ref: normalizeSourceRef(manifest.source_ref) };
}
export function toInternalObjectManifest(manifest: CanonicalObjectManifest): ObjectManifest { return { ...manifest, size_bytes: BigInt(manifest.size_bytes), source_ref: normalizeSourceRef(manifest.source_ref) }; }
export interface AttachmentOutbox { id: string; cellId: string; attachmentId: string; kind: 'hash_scan_promote' | 'extract' | 'cleanup' | 'reconcile'; payload: Record<string, unknown>; }
export interface TusUpload { ID: string; Size: number; SizeIsDeferred: boolean; MetaData: Record<string, string>; Offset: number; }
export interface TusdHookRequest { Type: 'pre-create' | 'pre-finish' | 'post-finish' | 'pre-terminate' | 'post-terminate'; Event: { Upload: TusUpload; HTTPRequest: { Method: string; URI: string; Header: Record<string, string[]> } }; }
export interface TusPreCreateResponse { ChangeFileInfo: { ID: string }; }

/** Mirrors the control-plane persistence seam. Each mutating operation is a DB transaction/CAS. */
export interface AttachmentPersistencePort {
  reserveAuthorization(request: ReservationRequest): Promise<ReservationResult>;
  findReservation(cellId: string, uploadId: string): Promise<UploadReservation | undefined>;
  acceptTusCompletion(input: { cellId: string; uploadId: string; tusId: string; sizeBytes: bigint; metadata: Record<string, string>; sourceRef: { kind: string; id: string } }): Promise<{ kind: 'accepted' | 'replayed' | 'refused'; attachment?: AttachmentRecord; outbox?: AttachmentOutbox }>;
  /** Non-blocking post-finish observation. It never creates work absent pre-finish acceptance. */
  confirmTusCompletion(input: { cellId: string; uploadId: string; tusId: string }): Promise<void>;
  /** Durable CAS for a user-requested tusd DELETE; post-terminate remains the final state confirmation. */
  beginTermination(input: { cellId: string; uploadId: string; ownerId: string }): Promise<'accepted' | 'already_terminated' | 'not_found'>;
  retryTermination(input: { cellId: string; uploadId: string; reason: string }): Promise<void>;
  persistTermination(input: { cellId: string; uploadId: string; reason: 'cancelled' | 'expired' }): Promise<boolean>;
  claimExpiredReservations(limit: number): Promise<UploadReservation[]>;
  claimOutbox(): Promise<AttachmentOutbox | undefined>;
  getAttachmentForWork(cellId: string, attachmentId: string): Promise<AttachmentRecord | undefined>;
  findCanonical(cellId: string, sha256: string): Promise<ObjectManifest | undefined>;
  commitCompletionAndEnqueue(input: { cellId: string; attachmentId: string; from: 'scanning'; manifest: ObjectManifest; outbox: AttachmentOutbox }): Promise<AttachmentRecord | null>;
  persistExtraction(input: { cellId: string; attachmentId: string; extraction: ObjectManifest['extraction'] }): Promise<void>;
  rejectWork(input: { cellId: string; attachmentId: string; reason: AttachmentErrorCode }): Promise<void>;
  retryOutbox(input: { id: string; reason: string }): Promise<void>;
  completeOutbox(id: string): Promise<void>;
  findDownload(input: { objectId: string; cellId: string; ownerId: string; conversationId: string }): Promise<ObjectManifest | undefined>;
}

export interface StagingIngressStorage { /** Only the tusd ingress credential may write staging. */ readonly role: 'staging-ingress'; }
export interface AttachmentPromoterStorage { readonly role: 'promoter'; headStaging(key: string, signal?: AbortSignal): Promise<{ size: bigint } | undefined>; readStaging(key: string, signal?: AbortSignal): Promise<Readable>; headObject(key: string, signal?: AbortSignal): Promise<{ size: bigint } | undefined>; copyStagingToObject(sourceKey: string, objectKey: string, signal?: AbortSignal): Promise<void>; removeStaging(key: string, signal?: AbortSignal): Promise<void>; readObject(key: string, signal?: AbortSignal): Promise<Readable>; }
export interface AttachmentDownloadStorage { readonly role: 'downloader'; readObject(key: string, range?: { start: bigint; end: bigint }, signal?: AbortSignal): Promise<Readable>; }
/** The API cancellation path has this narrowly-scoped tusd credential only. */
export interface TusdTerminationPort { terminate(input: { uploadId: string; capability: string }): Promise<'deleted' | 'absent'>; }
export interface ContentSandboxPort { inspect(stream: Readable, declaredMediaType: string, signal?: AbortSignal): Promise<{ mediaType: string; verdict: 'clean' | 'executable' | 'mime_spoof' | 'encrypted_archive' | 'archive_bomb' | 'unsafe_archive_path' | 'unsupported_archive' | 'error'; detail?: string }>; }
export interface MalwareScanner { scan(stream: Readable, signal?: AbortSignal): Promise<{ state: 'clean' | 'infected' | 'unavailable' | 'error'; detail?: string }>; }
/** Worker adapters only. A result may be complete only after all output artifacts were persisted. */
export interface ExtractionRunner { extract(input: { manifest: ObjectManifest; stream: Readable; signal?: AbortSignal }): Promise<{ state: 'complete' | 'unsupported' | 'error'; textObjectId?: string; previewObjectIds: readonly string[]; hint: string }>; }

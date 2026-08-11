/** Persistence boundary for the upload lifecycle; bytes and signing live outside this adapter. */
import type { FrankTransaction } from '../db.js';
import type { ObjectManifest, Sha256, SourceRef } from '@frank/contracts';

export const MAX_ATTACHMENT_BYTES = 2_147_483_648n;
/** Per-message aggregate ceiling; the cell pool is deliberately independent. */
export const MAX_MESSAGE_ATTACHMENT_BYTES = 10_737_418_240n;
export const MAX_MESSAGE_ATTACHMENT_COUNT = 10_000;
export const MAX_CELL_ATTACHMENT_POOL_BYTES = 53_687_091_200n;
export const MIN_HOST_FREE_BYTES = 32_212_254_720n;
export type UploadReservationState = 'authorized'|'uploading'|'completed'|'cancelled'|'expired'|'rejected';
export type AttachmentState = 'staging'|'scanning'|'ready'|'promoted'|'rejected'|'cancelled'|'expired';
export interface AttachmentRecord { id:string; cellId:string; ownerId:string; conversationId?:string; messageId?:string; turnId?:string; reservationId:string; uploadId:string; objectId?:string; name:string; relativePath?:string; sizeBytes:bigint; mediaType:string; digest?:Sha256; scanState:'pending'|'clean'|'blocked'|'failed'; extractionState:'none'|'pending'|'complete'|'failed'; sourceRef:SourceRef; state:AttachmentState; createdAt:Date; updatedAt:Date; }
export interface UploadReservation { id:string; cellId:string; ownerId:string; conversationId?:string; idempotencyKey:string; requestHash:Sha256; uploadId:string; state:UploadReservationState; reservedBytes:bigint; reservedCount:number; capabilityVersion:number; expiresAt:Date; }
/** Signed capability contains no persisted plaintext token; key material is supplied by the lifecycle signer. */
/** Persisted claims, not a token. The lifecycle signer issues/verifies a token from these claims.
 * Replays increment neither version nor invalidate concurrent previously-issued tokens; verifier
 * accepts the current and immediately preceding version until expiry, preventing replay races.
 */
export interface UploadCapabilityClaims { uploadId:string; cellId:string; ownerId:string; capabilityVersion:number; expiresAt:Date; }
export type ReservationResult = {kind:'created'|'replayed';reservation:UploadReservation;capability:UploadCapabilityClaims}|{kind:'conflict';reservation:UploadReservation}|{kind:'refused';reason:'object_too_large'|'cell_pool_exhausted'|'message_bytes_exhausted'|'message_count_exhausted'|'host_free_insufficient'|'unauthorized'};
export interface ReservationRequest { cellId:string; ownerId:string; conversationId?:string; idempotencyKey:string; requestHash:Sha256; uploadId:string; sizeBytes:bigint; expiresAt:Date; }
export interface AttachmentOutbox { id:string; cellId:string; attachmentId:string; kind:'hash_scan_promote'|'extract'|'cleanup'|'reconcile'; payload:Record<string,unknown>; }
export interface AttachmentPersistencePort {
  /** Locks quota+idempotency records and returns durable claims for the lifecycle signer. */
  reserveAuthorization(tx:FrankTransaction, request:ReservationRequest):Promise<ReservationResult>;
  /** Idempotent Tus callback: CAS authorized/uploading→completed and atomically enqueues hash_scan_promote. */
  acceptTusCompletion(tx:FrankTransaction,input:{cellId:string;uploadId:string;tusId:string;sizeBytes:bigint;metadata:Record<string,string>;sourceRef:SourceRef}):Promise<{kind:'accepted'|'replayed'|'refused';attachment?:AttachmentRecord;outbox?:AttachmentOutbox}>;
  /** CAS only after the Tus server confirms termination; also claims durable cleanup. */
  persistTermination(tx:FrankTransaction,input:{cellId:string;uploadId:string;reason:'cancelled'|'expired'}):Promise<boolean>;
  /** Atomically links immutable deduped manifest, releases quota, transitions scanning→ready, and enqueues extraction. */
  commitCompletionAndEnqueue(tx:FrankTransaction,input:{cellId:string;attachmentId:string;from:'scanning';manifest:ObjectManifest;outbox:AttachmentOutbox}):Promise<AttachmentRecord|null>;
}

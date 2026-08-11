/** Persistence boundary for the upload lifecycle; bytes and signing live outside this adapter. */
import type { FrankExecutor, FrankTransaction } from '../db.js';
import type { AttachmentOutboxKind, AttachmentOutboxState, AttachmentState, AttachmentUploadStatus, ObjectManifest, Sha256, SourceRef, UploadCapabilityClaims } from '@frank/contracts';

export const MAX_ATTACHMENT_BYTES = 2_147_483_648n;
/** Per-message aggregate ceiling; the cell pool is deliberately independent. */
export const MAX_MESSAGE_ATTACHMENT_BYTES = 10_737_418_240n;
export const MAX_MESSAGE_ATTACHMENT_COUNT = 10_000;
export const MAX_CELL_ATTACHMENT_POOL_BYTES = 53_687_091_200n;
export const MIN_HOST_FREE_BYTES = 32_212_254_720n;
export type UploadReservationState = 'authorized'|'uploading'|'completed'|'terminating'|'cancelled'|'expired'|'rejected';
export interface AttachmentRecord { id:string; cellId:string; ownerId:string; conversationId?:string; draftMessageId:string; messageId?:string; turnId?:string; reservationId:string; uploadId:string; objectId?:string; name:string; relativePath?:string; sizeBytes:bigint; mediaType:string; digest?:Sha256; scanState:'pending'|'clean'|'blocked'|'failed'; extractionState:'none'|'pending'|'complete'|'failed'; sourceRef:SourceRef; state:AttachmentState; createdAt:Date; updatedAt:Date; }
export interface UploadReservation { id:string; cellId:string; ownerId:string; conversationId:string; draftMessageId:string; idempotencyKey:string; requestHash:Sha256; uploadId:string; originalName:string; relativePath?:string; mediaType:string; state:UploadReservationState; reservedBytes:bigint; reservedCount:number; capabilityVersion:number; expiresAt:Date; terminationRequestedAt?:Date; terminationConfirmedAt?:Date; terminationAttempts:number; }
/** Signed capability contains no persisted plaintext token; key material is supplied by the lifecycle signer. */
/** Persisted claims, not a token. The lifecycle signer issues/verifies a token from these claims.
 * Replays increment neither version nor invalidate concurrent previously-issued tokens; verifier
 * accepts the current and immediately preceding version until expiry, preventing replay races.
 */
export type ReservationResult = {kind:'created'|'replayed';reservation:UploadReservation;capability:UploadCapabilityClaims}|{kind:'conflict';reservation:UploadReservation}|{kind:'refused';reason:'object_too_large'|'cell_pool_exhausted'|'message_bytes_exhausted'|'message_count_exhausted'|'host_free_insufficient'|'unauthorized'};
export interface ReservationRequest { cellId:string; ownerId:string; conversationId:string; draftMessageId:string; idempotencyKey:string; requestHash:Sha256; uploadId:string; originalName:string; relativePath?:string; mediaType:string; sizeBytes:bigint; expiresAt:Date; }
export interface AttachmentOutbox { id:string; cellId:string; attachmentId:string; kind:AttachmentOutboxKind; state:AttachmentOutboxState; payload:Record<string,unknown>; }
/** Tus pre-create must use this exact ID, preserving capability/upload binding. */
export interface TusPreCreateRequest { ChangeFileInfo: { ID: string } }
export interface AttachmentPersistencePort {
  /**
   * Atomically locks quota and idempotency rows. Same request hash replays the
   * same claims/version; another hash conflicts. Signers issue the compact token
   * separately, so no plaintext token or signer key enters PostgreSQL.
   */
  reserveAuthorization(tx:FrankTransaction, request:ReservationRequest):Promise<ReservationResult>;
  /** Reissues identical versioned claims while the 24-hour staging reservation remains valid; each signed claim expires within 15 minutes. */
  renewCapability(tx: FrankTransaction, input: { cellId: string; reservationId: string; requestHash: Sha256 }): Promise<UploadCapabilityClaims | null>;
  /** Force the upstream Tus server's ChangeFileInfo.ID to the reserved upload id. */
  tusPreCreate(reservation: UploadReservation): TusPreCreateRequest;
  /** Authenticated polling seam; attachment_id is absent until the callback creates the row. */
  getUploadStatus(db:FrankExecutor,input:{cellId:string;ownerId:string;uploadId:string}):Promise<AttachmentUploadStatus|null>;
  /** Idempotent Tus callback: CAS authorized/uploading→completed and atomically enqueues hash_scan_promote. */
  acceptTusCompletion(tx:FrankTransaction,input:{cellId:string;uploadId:string;tusId:string;sizeBytes:bigint;metadata:Record<string,string>;sourceRef:SourceRef}):Promise<{kind:'accepted'|'replayed'|'refused';attachment?:AttachmentRecord;outbox?:AttachmentOutbox}>;
  /** Persist termination intent before contacting Tus; terminal state is not entered yet. */
  beginTermination(tx:FrankTransaction,input:{cellId:string;uploadId:string;reason:'cancelled'|'expired'}):Promise<UploadReservation|null>;
  /** Claims another durable Tus termination attempt after a recoverable failure. */
  retryTermination(tx:FrankTransaction,input:{cellId:string;uploadId:string}):Promise<UploadReservation|null>;
  /** Enter cancelled/expired only after Tus confirms termination. */
  confirmTusCompletion(tx:FrankTransaction,input:{cellId:string;uploadId:string;reason:'cancelled'|'expired';confirmedAt:Date}):Promise<boolean>;
  /** Atomically links immutable deduped manifest, releases quota, transitions scanning→ready, and enqueues extraction. */
  commitCompletionAndEnqueue(tx:FrankTransaction,input:{cellId:string;attachmentId:string;from:'scanning';manifest:ObjectManifest;outbox:AttachmentOutbox}):Promise<AttachmentRecord|null>;
}

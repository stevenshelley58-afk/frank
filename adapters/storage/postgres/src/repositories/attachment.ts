/** Persistence boundary for the upload lifecycle; bytes and signing live outside this adapter. */
import type { FrankTransaction } from '../db.js';
import type { ObjectManifest, Sha256, SourceRef } from '@frank/contracts';

export const MAX_ATTACHMENT_BYTES = 2_147_483_648n;
export const MAX_ATTACHMENT_POOL_BYTES = 10_737_418_240n;
export const MAX_ATTACHMENT_POOL_COUNT = 10_000;
export type UploadReservationState = 'authorized'|'uploading'|'completed'|'cancelled'|'expired'|'rejected';
export type AttachmentState = 'staging'|'scanning'|'ready'|'promoted'|'rejected'|'cancelled'|'expired';
export interface AttachmentRecord { id:string; cellId:string; ownerId:string; conversationId?:string; messageId?:string; turnId?:string; reservationId:string; uploadId:string; objectId?:string; name:string; relativePath?:string; sizeBytes:bigint; mediaType:string; digest?:Sha256; scanState:'pending'|'clean'|'blocked'|'failed'; extractionState:'none'|'pending'|'complete'|'failed'; sourceRef:SourceRef; state:AttachmentState; createdAt:Date; updatedAt:Date; }
export interface UploadReservation { id:string; cellId:string; ownerId:string; conversationId?:string; idempotencyKey:string; requestHash:Sha256; uploadId:string; state:UploadReservationState; reservedBytes:bigint; reservedCount:number; capabilityVersion:number; expiresAt:Date; }
/** Signed capability contains no persisted plaintext token; key material is supplied by the lifecycle signer. */
export interface IssuedUploadCapability { uploadId:string; capabilityVersion:number; signedToken:string; expiresAt:Date; }
export type ReservationResult = {kind:'created'|'replayed';reservation:UploadReservation;capability:IssuedUploadCapability}|{kind:'conflict';reservation:UploadReservation}|{kind:'refused';reason:'object_too_large'|'pool_bytes_exhausted'|'pool_count_exhausted'|'unauthorized'};
export interface ReservationRequest { cellId:string; ownerId:string; conversationId?:string; idempotencyKey:string; requestHash:Sha256; uploadId:string; sizeBytes:bigint; expiresAt:Date; }
export interface AttachmentOutbox { id:string; cellId:string; attachmentId:string; kind:'hash_scan_promote'|'extract'|'cleanup'|'reconcile'; payload:Record<string,unknown>; }
export interface AttachmentPersistencePort {
  /** Locks quota+idempotency records, rotates capability_version on exact replay, and returns a newly signed capability. */
  reserveAuthorization(tx:FrankTransaction, request:ReservationRequest):Promise<ReservationResult>;
  /** Idempotent Tus callback: CAS authorized/uploading→completed and atomically enqueues hash_scan_promote. */
  acceptTusCompletion(tx:FrankTransaction,input:{cellId:string;uploadId:string;tusId:string;sizeBytes:bigint;metadata:Record<string,string>;sourceRef:SourceRef}):Promise<{kind:'accepted'|'replayed'|'refused';attachment?:AttachmentRecord;outbox?:AttachmentOutbox}>;
  /** CAS only after the Tus server confirms termination; also claims durable cleanup. */
  persistTermination(tx:FrankTransaction,input:{cellId:string;uploadId:string;reason:'cancelled'|'expired'}):Promise<boolean>;
  /** Atomically links immutable deduped manifest, releases quota, transitions scanning→ready, and enqueues extraction. */
  commitCompletionAndEnqueue(tx:FrankTransaction,input:{cellId:string;attachmentId:string;from:'scanning';manifest:ObjectManifest;outbox:AttachmentOutbox}):Promise<AttachmentRecord|null>;
}

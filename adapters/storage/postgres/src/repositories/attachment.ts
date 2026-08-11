/** Transaction-safe attachment reservation port. Lifecycle workers implement upload/scan outside DB authority. */
import type { FrankTransaction } from '../db.js';
import type { AttachmentRecord, Sha256 } from '@frank/contracts';

export interface AttachmentReservationRequest { cellId:string; ownerId:string; idempotencyKey:string; requestHash:Sha256; conversationId?:string; turnId?:string; name:string; relativePath?:string; sizeBytes:number; mediaType:string; reservedBytes:number; reservedCount:number; expiresAt:Date }
export interface AttachmentPoolCapacity { maxObjectBytes:2147483648; maxPoolBytes:10737418240; maxObjectCount:10000; reservedBytes:number; reservedCount:number; freeBytes:number }
export interface AttachmentPersistencePort {
  reserve(tx:FrankTransaction, request:AttachmentReservationRequest, capacity:AttachmentPoolCapacity):Promise<AttachmentRecord>;
  compareAndSetState(tx:FrankTransaction, input:{cellId:string;attachmentId:string;from:AttachmentRecord['upload_state'];to:AttachmentRecord['upload_state'];requestHash:Sha256}):Promise<AttachmentRecord | null>;
  promoteDeduplicated(tx:FrankTransaction, input:{cellId:string;attachmentId:string;digest:Sha256;objectId:string;requestHash:Sha256}):Promise<AttachmentRecord>;
  expireOrCancel(tx:FrankTransaction, input:{cellId:string;attachmentId:string;reason:'expired'|'cancelled'}):Promise<boolean>;
}

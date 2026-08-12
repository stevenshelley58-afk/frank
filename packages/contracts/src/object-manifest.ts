import type { IsoDateTime, Sha256 } from './common.js';
export type { Sha256 } from './common.js';
/** Stable, serialisable reference. Empty components are rejected at the boundary. */
export interface SourceRef { kind: string; id: string; version?: string }

function nonBlank(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`SourceRef.${field} must be a non-empty string`);
  return value;
}

/**
 * Compatibility boundary for Night Watch revisions. The frozen wire contract
 * uses a non-empty string so JSON identities stay stable across producers;
 * legacy numeric revisions are normalised before persistence or emission.
 */
export function normalizeSourceRef(input: { kind: string; id: string; version?: string | number }): SourceRef {
  const kind = nonBlank(input.kind, 'kind');
  const id = nonBlank(input.id, 'id');
  if (input.version === undefined) return { kind, id };
  if (typeof input.version === 'number' && !Number.isFinite(input.version)) {
    throw new Error('SourceRef.version number must be finite');
  }
  return { kind, id, version: nonBlank(String(input.version), 'version') };
}

/** Compact signed token claims. Tokens are transport values and are never persisted. */
export interface UploadCapabilityClaims {
  schema: 'frank.attachment-capability/v1'; key_id: string; reservation_id: string; upload_id: string;
  cell_id: string; owner_id: string; conversation_id: string; size_bytes: number;
  expires_at: IsoDateTime; capability_version: number;
}

/** A signer owns key material; storage only returns claims for it to sign. */
export interface UploadCapabilityTokenPort {
  issue(claims: UploadCapabilityClaims): Promise<string>;
  verify(token: string): Promise<UploadCapabilityClaims>;
}

export const MAX_UPLOAD_CAPABILITY_TOKEN_BYTES = 2048;
/** Signed capability lifetime; the separate upload reservation remains resumable for 24 hours. */
export const MAX_UPLOAD_CAPABILITY_TTL_SECONDS = 900;

/** Authorization binds a Tus creation request but never invents an attachment row. */
export interface AttachmentUploadAuthorizationResponse {
  upload_id: string;
  reservation_id: string;
  tus_creation_url: string;
  tus_headers: { 'Upload-Metadata': string; 'X-Frank-Upload-Capability': string };
  tus_metadata: { upload_id: string; cell_id: string; conversation_id: string };
  tus_allowed_meta_fields: ['upload_id', 'cell_id', 'conversation_id'];
  capability_expires_at: IsoDateTime;
  reservation_expires_at: IsoDateTime;
}

export type UploadReservationStatus = 'authorized'|'uploading'|'completed'|'terminating'|'cancelled'|'expired'|'rejected';
export type AttachmentUploadStatus =
  | { upload_id:string; reservation_state:UploadReservationStatus; attachment_id?:never; attachment_state?:never; scan_state?:never; extraction_state?:never }
  | { upload_id:string; reservation_state:UploadReservationStatus; attachment_id:string; attachment_state:AttachmentState; scan_state:'pending'|'clean'|'blocked'|'failed'; extraction_state:'none'|'pending'|'complete'|'failed' };
export interface AttachmentUploadStatusResponse {
  upload: AttachmentUploadStatus;
  identifiers: { cell_id:string; actor_id:string; request_id:string; correlation_id:string; trace_id:string; policy_version:string };
}

export type AttachmentState = 'staging'|'scanning'|'ready'|'promoted'|'rejected'|'cancelled'|'expired';
export type AttachmentOutboxKind = 'hash_scan_promote'|'extract'|'cleanup'|'reconcile';
export type AttachmentOutboxState = 'pending'|'leased'|'completed'|'failed'|'cancelled';
export interface AttachmentRecord { attachment_id: string; cell_id: string; owner_id: string; conversation_id?: string; message_id?: string; turn_id?: string; reservation_id: string; upload_id: string; object_id?: string; state: AttachmentState; name: string; relative_path?: string; size_bytes: number; media_type: string; digest?: Sha256; scan_state: 'pending'|'clean'|'blocked'|'failed'; extraction_state: 'none'|'pending'|'complete'|'failed'; source_ref: SourceRef; created_at: IsoDateTime; updated_at: IsoDateTime }

/** `schema://frank.object-manifest/v1`: immutable object-storage evidence. */
export interface ObjectManifest {
  schema: 'schema://frank.object-manifest/v1'; object_id: string; cell_id: string;
  /** Promoted manifests are immutable canonical objects; staging is never a manifest. */
  bucket: 'frank-objects'; object_key: string;
  sha256: Sha256; size_bytes: number; media_type: string;
  original_name?: string; relative_path?: string; created_at: IsoDateTime;
  source_ref: SourceRef;
  security: { scan_state: 'pending' | 'clean' | 'blocked' | 'failed'; scanned_at?: IsoDateTime };
  extraction: { state: 'none' | 'pending' | 'complete' | 'failed'; text_object_id?: string; preview_object_ids: string[] };
  retention: { class: string; expires_at?: IsoDateTime };
}

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

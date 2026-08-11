import type { IsoDateTime, Sha256 } from './common.js';
export interface SourceRef { kind: string; id: string; version?: string }
export interface AttachmentRecord { attachment_id: string; cell_id: string; owner_id: string; conversation_id?: string; message_id?: string; turn_id?: string; object_id?: string; upload_state: 'staging'|'promoted'|'rejected'; name: string; relative_path?: string; size_bytes: number; media_type: string; digest?: Sha256; scan_state: 'pending'|'clean'|'blocked'|'failed'; extraction_state: 'none'|'pending'|'complete'|'failed'; source_ref: SourceRef; created_at: IsoDateTime; updated_at: IsoDateTime }

/** `schema://frank.object-manifest/v1`: immutable object-storage evidence. */
export interface ObjectManifest {
  schema: 'schema://frank.object-manifest/v1'; object_id: string; cell_id: string;
  bucket: 'frank-attachment-staging' | 'frank-objects' | 'frank-object-previews'; object_key: string;
  sha256: Sha256; size_bytes: number; media_type: string;
  original_name?: string; relative_path?: string; created_at: IsoDateTime;
  source_ref: SourceRef;
  security: { scan_state: 'pending' | 'clean' | 'blocked' | 'failed'; scanned_at?: IsoDateTime };
  extraction: { state: 'none' | 'pending' | 'complete' | 'failed'; text_object_id?: string; preview_object_ids: string[] };
  retention: { class: string; expires_at?: IsoDateTime };
}

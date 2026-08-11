import type { IsoDateTime } from './common.js';

/** `schema://frank.object-manifest/v1`: immutable object-storage evidence. */
export interface ObjectManifest {
  schema: 'schema://frank.object-manifest/v1'; object_id: string; cell_id: string;
  bucket: 'frank-objects' | 'frank-quarantine' | 'frank-extracts'; object_key: string;
  sha256: `sha256:${string}`; size_bytes: number; media_type: string;
  original_name?: string; relative_path?: string; created_at: IsoDateTime;
  source_ref: { kind: string; id: string; version?: string };
  security: { scan_state: 'pending' | 'clean' | 'blocked' | 'failed'; scanned_at?: IsoDateTime };
  extraction: { state: 'none' | 'pending' | 'complete' | 'failed'; text_object_id?: string; preview_object_ids: string[] };
  retention: { class: string; expires_at?: IsoDateTime };
}

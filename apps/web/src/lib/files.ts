/**
 * Files console helpers — pure derivations for UI-08 (folder bindings,
 * artifacts, previews). Kept dependency-free so they unit-test in node.
 *
 * Wire shapes follow the merged backends:
 *  - FS-02 GET /v1/rooms/:roomId/folder-bindings → { bindings: [...] }
 *  - FS-05 GET /v1/rooms/:roomId/files           → { files: [...] }
 */

/* ---------------------------------------------------------------- types --- */

export type SyncDirection = 'send-only' | 'receive-only' | 'bidirectional';
export type MountMode = 'ro' | 'rw' | 'staged';

/** One FS-02 folder binding as returned by the API (wire form). */
export interface FolderBinding {
  id: string;
  room_id: string;
  folder_source: string;
  server_path: string;
  sync_direction: SyncDirection;
  mount_mode: MountMode;
  /** FS-04: opt-in write-back permission. */
  write_back: boolean;
  created_at: string;
  updated_at: string;
  /** FS-04 (may not be live yet) — degrade gracefully when absent. */
  sync_status?: string | null;
  pending_sync?: number | null;
}

/** One FS-05 room-files entry as returned by the API (wire form). */
export interface RoomFile {
  /** The API returns `artifact_id`; tolerate legacy `id` too. */
  artifact_id?: string;
  id?: string;
  workbench_id: string;
  workbench_state?: string;
  path: string;
  kind: string;
  preview_url: string | null;
  sha256?: string;
  media_type?: string;
  created_at: string;
}

/** Resolve the artifact's id whichever field the API sent. */
export function artifactIdOf(file: RoomFile): string {
  return file.artifact_id ?? file.id ?? '';
}

/* ------------------------------------------------------- badge vocabulary --- */

export const SYNC_DIRECTION_META: Record<SyncDirection, { label: string; className: string }> = {
  'send-only': {
    label: 'send-only',
    className: 'border-line bg-subtle text-muted',
  },
  'receive-only': {
    label: 'receive-only',
    className: 'border-success/30 bg-success/10 text-success',
  },
  bidirectional: {
    label: 'bidirectional',
    className: 'border-warning/30 bg-warning/10 text-warning',
  },
};

export const MOUNT_MODE_META: Record<MountMode, { label: string; className: string }> = {
  ro: {
    label: 'read-only mount',
    className: 'border-line bg-subtle text-muted',
  },
  rw: {
    label: 'read-write mount',
    className: 'border-warning/30 bg-warning/10 text-warning',
  },
  staged: {
    label: 'staged mount',
    className: 'border-accent/30 bg-accent/10 text-accent',
  },
};

/* -------------------------------------------------------- write-back state --- */

export type WriteBackState = 'write-back' | 'no-write-back';

/**
 * Truthful write-back state for a binding: FS-04 write-back is opt-in per
 * folder, so we surface exactly what the declaration says.
 */
export function writeBackStateOf(binding: FolderBinding): WriteBackState {
  return binding.write_back ? 'write-back' : 'no-write-back';
}

export const WRITE_BACK_META: Record<WriteBackState, { label: string; className: string }> = {
  'write-back': {
    label: 'write-back on',
    className: 'border-success/30 bg-success/10 text-success',
  },
  'no-write-back': {
    label: 'write-back off',
    className: 'border-line bg-subtle text-muted',
  },
};

/* ----------------------------------------------------- FS-04 sync waiting --- */

export type SyncWaiting = 'waiting' | 'clear' | 'unknown';

/**
 * Results-waiting-to-sync indicator. FS-04 may not be live yet:
 *  - pending_sync > 0 or sync_status === 'pending' → 'waiting'
 *  - sync_status present and not pending            → 'clear'
 *  - neither field present                          → 'unknown' (degrade: the
 *    UI shows the write-back state honestly instead of inventing a status).
 */
export function syncWaitingOf(binding: FolderBinding): SyncWaiting {
  const pending = binding.pending_sync;
  if (typeof pending === 'number' && pending > 0) return 'waiting';
  const status = binding.sync_status;
  if (typeof status === 'string' && status.length > 0) {
    return status === 'pending' ? 'waiting' : 'clear';
  }
  return 'unknown';
}

/* ------------------------------------------------------------ file utils --- */

/** Basename of an artifact path (the display name in the panel). */
export function fileBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** Locale timestamp or an em-dash — never throw on bad input. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

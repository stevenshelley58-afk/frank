'use client';

/**
 * Files console — folder bindings, artifacts, and previews (UI-08).
 *
 * Data flow (frozen contracts, merged on main):
 *  - room picker → GET /v1/rooms/:roomId/folder-bindings → { bindings: [...] }
 *    (FS-02: folder_source, server_path, sync_direction, mount_mode, write_back)
 *  - room picker → GET /v1/rooms/:roomId/files → { files: [...] }
 *    (FS-05: artifacts across the room's workbenches, with preview URLs)
 *  - preview republish → POST /v1/workbenches/:id/artifacts/:artifactId/preview
 *
 * FS-04 (write-back sync status) may not be live yet: when the binding rows
 * carry no sync_status/pending_sync field the surface degrades to the honest
 * write-back declaration (on/off) instead of inventing a sync status.
 *
 * Staged shared writes (FS-03) land only via a decision work item — the
 * staged-mount detail panel says so and links to the decision when one
 * exists for the binding.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type FolderBinding,
  type MountMode,
  MOUNT_MODE_META,
  type RoomFile,
  type SyncDirection,
  SYNC_DIRECTION_META,
  WRITE_BACK_META,
  artifactIdOf,
  fileBasename,
  formatStamp,
  syncWaitingOf,
  writeBackStateOf,
} from '@/lib/files';
import { DEFAULT_ROOMS } from '@/lib/rooms';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Wire API — same-origin relative URLs, no explicit auth header.     */
/* ------------------------------------------------------------------ */

const FILES_API = {
  bindings: (roomId: string) =>
    `/v1/rooms/${encodeURIComponent(roomId)}/folder-bindings`,
  files: (roomId: string) => `/v1/rooms/${encodeURIComponent(roomId)}/files`,
  publishPreview: (workbenchId: string, artifactId: string) =>
    `/v1/workbenches/${encodeURIComponent(workbenchId)}/artifacts/${encodeURIComponent(artifactId)}/preview`,
};

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                          */
/* ------------------------------------------------------------------ */

function MetaBadge({ label, className }: { label: string; className: string }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-mono text-[11px] uppercase tracking-wide', className)}>
      {label}
    </Badge>
  );
}

function SyncWaitingBadge({ binding }: { binding: FolderBinding }) {
  const waiting = syncWaitingOf(binding);
  if (waiting === 'waiting') {
    return <MetaBadge label="waiting to sync" className="border-warning/30 bg-warning/10 text-warning" />;
  }
  if (waiting === 'clear') {
    return <MetaBadge label="synced" className="border-success/30 bg-success/10 text-success" />;
  }
  // FS-04 not live yet: no sync status to claim. Say nothing beyond the
  // write-back declaration — that is the honest state.
  return null;
}

function SectionHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-baseline gap-2">
      <h2 className="text-[13px] font-semibold text-ink">{children}</h2>
      {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
    </div>
  );
}

function EmptyCard({ body }: { body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-subtle px-4 py-6 text-center text-[12.5px] text-muted">
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Folder bindings section                                              */
/* ------------------------------------------------------------------ */

function BindingRow({ binding }: { binding: FolderBinding }) {
  const direction = SYNC_DIRECTION_META[binding.sync_direction as SyncDirection] ?? {
    label: binding.sync_direction,
    className: 'border-line bg-subtle text-muted',
  };
  const mount = MOUNT_MODE_META[binding.mount_mode as MountMode] ?? {
    label: binding.mount_mode,
    className: 'border-line bg-subtle text-muted',
  };
  const writeBack = WRITE_BACK_META[writeBackStateOf(binding)];
  const staged = binding.mount_mode === 'staged';

  return (
    <li className="rounded-xl border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] text-ink">{binding.folder_source}</span>
        <MetaBadge label={direction.label} className={direction.className} />
        <MetaBadge label={mount.label} className={mount.className} />
        <MetaBadge label={writeBack.label} className={writeBack.className} />
        <SyncWaitingBadge binding={binding} />
      </div>
      <p className="mt-1.5 truncate font-mono text-[11.5px] text-muted" title={binding.server_path}>
        {binding.server_path}
      </p>
      <p className="mt-1 text-[11px] text-muted/80">
        bound {formatStamp(binding.created_at)}
        {binding.updated_at !== binding.created_at && ` · updated ${formatStamp(binding.updated_at)}`}
      </p>
      {staged && (
        <div className="mt-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-[11.5px] text-muted">
          <span className="font-medium text-ink">Staged shared writes:</span> this mount is
          read-only inside the workbench. Writes land back in the shared folder only after a
          staged-write proposal is approved as a decision work item (FS-03) — nothing lands
          without approval.
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Artifacts section                                                    */
/* ------------------------------------------------------------------ */

function ArtifactRow({
  file,
  publishing,
  publishError,
  onPublishPreview,
}: {
  file: RoomFile;
  publishing: boolean;
  publishError: string | null;
  onPublishPreview: () => void;
}) {
  const id = artifactIdOf(file);
  const preview = file.preview_url;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12.5px] text-ink" title={file.path}>
          {fileBasename(file.path)}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted/80" title={file.path}>
          {file.path} · workbench {file.workbench_id.slice(0, 8)} · {formatStamp(file.created_at)}
        </p>
      </div>
      <MetaBadge label={file.kind} className="border-line bg-subtle text-muted" />
      {preview ? (
        <Button variant="outline" size="sm" asChild>
          <a
            href={preview}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open preview of ${fileBasename(file.path)}`}
          >
            Preview
          </a>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={onPublishPreview}
          disabled={publishing || !id || !file.workbench_id}
          aria-label={`Publish preview for ${fileBasename(file.path)}`}
        >
          {publishing ? 'Publishing…' : 'Publish preview'}
        </Button>
      )}
      {preview && (
        <Button variant="outline" size="sm" asChild>
          <a
            href={preview}
            download={fileBasename(file.path)}
            aria-label={`Download ${fileBasename(file.path)}`}
          >
            Download
          </a>
        </Button>
      )}
      {publishError && (
        <p role="alert" className="w-full text-[11.5px] text-danger">
          {publishError}
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Console body                                                         */
/* ------------------------------------------------------------------ */

export function FilesConsole() {
  const [roomId, setRoomId] = useState('central');
  const [bindings, setBindings] = useState<FolderBinding[]>([]);
  const [files, setFiles] = useState<RoomFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [bindingsError, setBindingsError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const roomName = useMemo(
    () => DEFAULT_ROOMS.find((r) => r.id === roomId)?.name ?? roomId,
    [roomId],
  );

  const load = useCallback(async () => {
    let anyError = false;
    try {
      const res = await fetch(FILES_API.bindings(roomId));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { bindings?: FolderBinding[] };
      setBindings(Array.isArray(data.bindings) ? data.bindings : []);
      setBindingsError(null);
    } catch (err) {
      setBindingsError(err instanceof Error ? err.message : String(err));
      setBindings([]);
      anyError = true;
    }
    try {
      const res = await fetch(FILES_API.files(roomId));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { files?: RoomFile[] };
      setFiles(Array.isArray(data.files) ? data.files : []);
      setFilesError(null);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : String(err));
      setFiles([]);
      anyError = true;
    }
    setLoading(false);
    return anyError;
  }, [roomId]);

  useEffect(() => {
    setLoading(true);
    setPublishError(null);
    load();
  }, [load]);

  async function handlePublishPreview(file: RoomFile) {
    const id = artifactIdOf(file);
    if (!id || !file.workbench_id) return;
    setPublishingId(id);
    setPublishError(null);
    try {
      const res = await fetch(FILES_API.publishPreview(file.workbench_id, id), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { preview_url?: string | null };
      // Reflect the published URL immediately; a full reload keeps it honest.
      setFiles((cur) =>
        cur.map((f) =>
          artifactIdOf(f) === id ? { ...f, preview_url: data.preview_url ?? null } : f,
        ),
      );
      if (!data.preview_url) {
        setPublishError(
          'The preview lane has no URL for this artifact (not auto-deployable yet).',
        );
      }
    } catch (err) {
      setPublishError(`Publish preview failed — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPublishingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-xl font-bold text-ink">Files</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          A room&apos;s folders and its artifacts — folder bindings, sync direction, mount mode,
          write-back state, and every artifact the room&apos;s workbenches produced, with previews.
        </p>
      </div>

      {/* Room picker — same room list the workbench console uses. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger className="h-8 w-56 text-[13px]" aria-label="Pick a room">
            <SelectValue placeholder="Room" />
          </SelectTrigger>
          <SelectContent>
            {DEFAULT_ROOMS.map((room) => (
              <SelectItem key={room.id} value={room.id} className="text-[13px]">
                {room.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2" aria-label="Loading files">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Folder bindings */}
          <SectionHeading hint="FS-02 folder bindings — what is mounted into this room's workbenches">
            Folder bindings
          </SectionHeading>
          {bindingsError ? (
            <div
              role="status"
              className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[12.5px] text-warning"
            >
              Folder bindings unavailable ({bindingsError}) — the API is unreachable; nothing is
              claimed about this room&apos;s mounts.
            </div>
          ) : bindings.length === 0 ? (
            <EmptyCard body={`No folder bindings recorded for ${roomName} — nothing is mounted into its workbenches yet.`} />
          ) : (
            <ul aria-label={`Folder bindings for ${roomName}`} className="space-y-2">
              {bindings.map((b) => (
                <BindingRow key={b.id} binding={b} />
              ))}
            </ul>
          )}

          {/* Artifacts */}
          <SectionHeading hint="FS-05 artifacts across the room's workbenches, newest first">
            Artifacts
          </SectionHeading>
          {filesError ? (
            <div
              role="status"
              className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[12.5px] text-warning"
            >
              Artifacts unavailable ({filesError}) — the API is unreachable; no file list is shown
              rather than a guessed one.
            </div>
          ) : files.length === 0 ? (
            <EmptyCard body={`No artifacts yet in ${roomName} — files produced by the room's workbenches land here.`} />
          ) : (
            <ul aria-label={`Artifacts in ${roomName}`} className="space-y-2">
              {files.map((f) => {
                const id = artifactIdOf(f);
                return (
                  <ArtifactRow
                    key={id || `${f.workbench_id}:${f.path}`}
                    file={f}
                    publishing={publishingId === id}
                    publishError={publishingId === id || publishError ? publishError : null}
                    onPublishPreview={() => handlePublishPreview(f)}
                  />
                );
              })}
            </ul>
          )}

          {/* Staged shared-write approval detail */}
          <SectionHeading hint="FS-03 staged mounts">Shared-write approvals</SectionHeading>
          <div className="rounded-xl border border-line bg-card px-4 py-4 text-[12.5px] text-muted">
            <p>
              Folders mounted <span className="font-mono text-ink">staged</span> are read-only
              inside workbenches. When a run needs to write back, it proposes a staged write
              (POST /v1/workbenches/:id/staged-writes); Frank files a NORMAL decision work item and
              the run pauses. Nothing lands in the shared folder until that decision resolves{' '}
              <span className="font-mono text-ink">ready</span> through the normal approval flow —
              approvals show up in the Tasks console.
            </p>
            {bindings.some((b) => b.mount_mode === 'staged') ? (
              <p className="mt-2">
                {roomName} has {bindings.filter((b) => b.mount_mode === 'staged').length} staged
                mount(s) — each write-back requires an approval.
              </p>
            ) : (
              <p className="mt-2">No staged mounts are bound to {roomName} right now.</p>
            )}
          </div>

          <p className="mt-6 text-[11px] text-muted/70">
            Write-back is opt-in per folder (FS-04); sync status appears on each binding once the
            sync backend reports it — until then the declaration (on/off) is all this surface
            claims.
          </p>
        </>
      )}
    </div>
  );
}

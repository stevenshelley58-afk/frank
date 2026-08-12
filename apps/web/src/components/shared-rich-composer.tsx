'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import Dashboard from '@uppy/react/dashboard';
import Tus from '@uppy/tus';
import GoldenRetriever from '@uppy/golden-retriever';
import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';
import type { ChatAttachmentRef } from '@/lib/chat-turn-input';
import {
  cancelAttachmentUpload,
  renewAttachmentUploadCapability,
  reserveAttachmentUpload,
  waitForCleanAttachment,
  type AttachmentUploadReservation,
} from '@/lib/attachment-upload-auth';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_MANIFEST_ROWS = 40;

type SelectedFile = { data: File; relativePath?: string };
type FileEntry = { isFile: true; isDirectory: false; name: string; file(callback: (file: File) => void, error?: (error: DOMException) => void): void };
type DirectoryEntry = { isFile: false; isDirectory: true; name: string; createReader(): { readEntries(callback: (entries: DropEntry[]) => void, error?: (error: DOMException) => void): void } };
type DropEntry = FileEntry | DirectoryEntry;

type Props = {
  disabled?: boolean;
  dark?: boolean;
  conversationId?: string;
  draftEpoch?: number;
  pasteTargetRef?: React.RefObject<HTMLTextAreaElement | null>;
  onAttachmentsChange?: (files: ChatAttachmentRef[]) => void;
};

/** One bounded attachment surface shared by every real chat composer. */
export function SharedRichComposer({ disabled = false, dark = false, conversationId, draftEpoch = 0, pasteTargetRef, onAttachmentsChange }: Props) {
  const [runtimeEnabled, setRuntimeEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ReturnType<Uppy['getFiles']>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const callbackRef = useRef(onAttachmentsChange);
  const conversationRef = useRef(conversationId);
  const draftId = useRef(randomId());
  const priorEpoch = useRef(draftEpoch);
  const reservations = useRef(new Map<string, AttachmentUploadReservation>());
  const relativePaths = useRef(new Map<string, string | null>());
  const cleanAttachments = useRef(new Map<string, string>());
  const pollers = useRef(new Map<string, AbortController>());
  const stableId = useId();

  callbackRef.current = onAttachmentsChange;
  conversationRef.current = conversationId;
  const available = runtimeEnabled && Boolean(conversationId && draftId.current);

  const [uppy] = useState(() => new Uppy({
    id: `frank-composer-${stableId.replaceAll(':', '')}`,
    autoProceed: false,
    allowMultipleUploadBatches: true,
    restrictions: { maxFileSize: MAX_FILE_BYTES, maxTotalFileSize: MAX_MESSAGE_BYTES, maxNumberOfFiles: MAX_FILES },
  }).use(GoldenRetriever, { serviceWorker: false }).use(Tus, {
    limit: 3,
    retryDelays: [0, 1_000, 3_000, 5_000],
    // Each file supplies the server's exact allowlist after authorization.
    allowedMetaFields: [],
  }));

  const sync = () => {
    const next = uppy.getFiles();
    setFiles(next);
    callbackRef.current?.(next.flatMap((file) => {
      const attachmentId = cleanAttachments.current.get(file.id);
      return attachmentId ? [{ id: attachmentId, name: file.name, size: file.size ?? 0, relativePath: relativePaths.current.get(file.id) ?? null }] : [];
    }));
  };

  useEffect(() => {
    let active = true;
    void fetch('/api/runtime-capabilities', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() as Promise<{ attachments: boolean }> : Promise.reject(new Error('capabilities unavailable')))
      .then((capabilities) => { if (active) setRuntimeEnabled(capabilities.attachments === true); })
      .catch(() => { if (active) setRuntimeEnabled(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const added = () => sync();
    const removed = (file: ReturnType<Uppy['getFile']> | undefined) => {
      if (file) {
        pollers.current.get(file.id)?.abort();
        pollers.current.delete(file.id);
        const reservation = reservations.current.get(file.id);
        if (reservation && !cleanAttachments.current.has(file.id)) {
          const capability = reservation.tus_headers['X-Frank-Upload-Capability'];
          if (capability) void cancelAttachmentUpload(reservation.upload_id, capability, randomId()).catch(() => undefined);
        }
        reservations.current.delete(file.id);
        relativePaths.current.delete(file.id);
        cleanAttachments.current.delete(file.id);
      }
      sync();
    };
    const progress = () => sync();
    const success = (file: ReturnType<Uppy['getFile']> | undefined) => {
      if (!file) return;
      const reservation = reservations.current.get(file.id);
      if (!reservation) return;
      const controller = new AbortController();
      pollers.current.set(file.id, controller);
      void waitForCleanAttachment(reservation.upload_id, controller.signal).then((attachmentId) => {
        cleanAttachments.current.set(file.id, attachmentId);
        pollers.current.delete(file.id);
        sync();
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) uppy.setFileState(file.id, { error: error instanceof Error ? error.message : 'Attachment processing failed.' });
        pollers.current.delete(file.id);
        sync();
      });
    };
    uppy.on('file-added', added);
    uppy.on('file-removed', removed);
    uppy.on('upload-progress', progress);
    uppy.on('upload-error', progress);
    uppy.on('upload-success', success);
    const target = pasteTargetRef?.current;
    const paste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []).map((data) => ({ data }));
      if (!pasted.length) return;
      event.preventDefault();
      void addFiles(pasted);
    };
    target?.addEventListener('paste', paste);
    return () => {
      uppy.off('file-added', added);
      uppy.off('file-removed', removed);
      uppy.off('upload-progress', progress);
      uppy.off('upload-error', progress);
      uppy.off('upload-success', success);
      target?.removeEventListener('paste', paste);
      for (const controller of pollers.current.values()) controller.abort();
      uppy.destroy();
    };
  // Uppy is stable for the component lifetime; mutable callbacks are held in refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uppy, pasteTargetRef]);

  useEffect(() => {
    if (priorEpoch.current === draftEpoch) return;
    priorEpoch.current = draftEpoch;
    draftId.current = randomId();
    for (const controller of pollers.current.values()) controller.abort();
    pollers.current.clear();
    cleanAttachments.current.clear();
    relativePaths.current.clear();
    reservations.current.clear();
    uppy.cancelAll();
    callbackRef.current?.([]);
    setNotice(null);
  }, [draftEpoch, uppy]);

  async function addFiles(selected: SelectedFile[]) {
    if (!available || !conversationRef.current) {
      setNotice('Attachments are unavailable until the runtime and conversation are ready.');
      return;
    }
    for (const { data, relativePath } of selected) {
      try {
        const reservation = await reserveAttachmentUpload({
          conversation_id: conversationRef.current,
          draft_message_id: draftId.current,
          idempotency_key: randomId(),
          size_bytes: String(data.size),
          original_name: data.name,
          ...(relativePath ? { relative_path: relativePath } : {}),
          ...(data.type ? { media_type: data.type } : {}),
        });
        const fileId = uppy.addFile({
          data,
          name: data.name,
          type: data.type,
          // Do not add local display data: tus receives exactly the returned metadata.
          meta: { ...reservation.tus_metadata },
          tus: {
            endpoint: reservation.tus_creation_url,
            headers: { ...reservation.tus_headers },
            allowedMetaFields: [...reservation.tus_allowed_meta_fields],
          },
        });
        reservations.current.set(fileId, reservation);
        relativePaths.current.set(fileId, relativePath ?? null);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Attachment authorisation failed.');
      }
    }
    sync();
  }

  async function renewAndRetry(fileId: string) {
    const file = uppy.getFile(fileId);
    const reservation = reservations.current.get(fileId);
    if (!file || !reservation) return;
    try {
      const renewal = await renewAttachmentUploadCapability(reservation.upload_id, randomId());
      const headers = { ...reservation.tus_headers, 'X-Frank-Upload-Capability': renewal.capability };
      const renewed = { ...reservation, tus_headers: headers, capability_expires_at: renewal.capability_expires_at };
      reservations.current.set(fileId, renewed);
      uppy.setFileState(fileId, { error: null, tus: { ...file.tus, headers } });
      await uppy.retryUpload(fileId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Attachment retry failed.');
    }
  }

  if (!runtimeEnabled) return null;

  const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const rows = files.slice(0, MAX_MANIFEST_ROWS);
  const buttonClass = dark ? 'rounded-lg p-2 text-white/70 hover:bg-white/10 disabled:opacity-40' : 'rounded-lg p-2 text-muted hover:bg-hover disabled:opacity-40';

  return <>
    <button type="button" disabled={disabled || !available} onClick={() => setOpen(true)} aria-label="Add files or folders" title={available ? 'Add files or folders' : 'Attachments become available when this conversation has a durable ID'} className={buttonClass}>+</button>
    {open && <div role="dialog" aria-modal="true" aria-label="Add attachments" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void filesFromDrop(event.dataTransfer).then(addFiles); }} className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-shell p-4 shadow-2xl">
        <div className="mb-3 flex items-center"><h2 className="font-semibold text-ink">Attachments</h2><span className="flex-1"/><button type="button" onClick={() => setOpen(false)} className="rounded p-2 text-muted hover:bg-hover" aria-label="Close attachments">×</button></div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded border border-line px-3 py-1.5 text-sm text-ink">Choose files</button>
          <button type="button" onClick={() => folderRef.current?.click()} className="rounded border border-line px-3 py-1.5 text-sm text-ink">Choose folder</button>
          <button type="button" disabled={!files.length} onClick={() => void uppy.upload()} className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40">Upload</button>
          <span className="text-xs text-muted">{files.length.toLocaleString()}/{MAX_FILES.toLocaleString()} · {(total / 1024 / 1024).toFixed(1)} MiB</span>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files ?? []).map((data) => ({ data }))); event.target.value = ''; }} />
        <input ref={folderRef} type="file" multiple className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files ?? []).map((data) => ({ data, relativePath: data.webkitRelativePath || undefined }))); event.target.value = ''; }} {...({ webkitdirectory: '', directory: '' } as object)} />
        <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} showSelectedFiles={false} hideUploadButton note="Drop files or folder trees. Max 2 GiB/file; 10 GiB and 10,000 files/message." />
        {files.length > 0 && <div className="mt-3 rounded border border-line p-2 text-xs text-muted" aria-live="polite">
          <b className="text-ink">Manifest</b>
          {rows.map((file) => <div key={file.id} className="flex items-center gap-2 py-0.5">
            <span className="min-w-0 flex-1 truncate">{relativePaths.current.get(file.id) ?? file.name}</span>
            <span>{file.error ? `failed: ${file.error}` : cleanAttachments.current.has(file.id) ? 'ready' : file.progress.uploadComplete ? 'processing' : file.isPaused ? 'paused' : file.progress.uploadStarted ? 'uploading' : 'queued'}</span>
            {file.error && <button type="button" onClick={() => void renewAndRetry(file.id)}>Renew & retry</button>}
            {!file.progress.uploadComplete && !file.error && <button type="button" onClick={() => uppy.pauseResume(file.id)}>{file.isPaused ? 'Resume' : 'Pause'}</button>}
            <button type="button" onClick={() => uppy.removeFile(file.id)} aria-label={`Remove ${file.name}`}>Remove</button>
          </div>)}
          {files.length > MAX_MANIFEST_ROWS && <div>Showing {MAX_MANIFEST_ROWS} of {files.length.toLocaleString()} attachments.</div>}
        </div>}
        <p className="mt-3 text-xs text-muted">Only clean, materialized attachment IDs can be sent. Browser-restored files may need to be reselected.</p>
        {notice && <p className="mt-2 text-xs text-danger" role="status">{notice}</p>}
      </section>
    </div>}
  </>;
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000';
}

async function filesFromDrop(transfer: DataTransfer): Promise<SelectedFile[]> {
  const entries = Array.from(transfer.items).flatMap((item) => {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => DropEntry | null }).webkitGetAsEntry?.();
    return entry ? [entry] : [];
  });
  if (!entries.length) return Array.from(transfer.files).map((data) => ({ data }));
  const nested = await Promise.all(entries.map((entry) => filesFromEntry(entry, '')));
  return nested.flat();
}

async function filesFromEntry(entry: DropEntry, parent: string): Promise<SelectedFile[]> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) return new Promise((resolve, reject) => entry.file((data) => resolve([{ data, relativePath: path }]), reject));
  const children = await readDirectory(entry);
  const nested = await Promise.all(children.map((child) => filesFromEntry(child, path)));
  return nested.flat();
}

async function readDirectory(entry: DirectoryEntry): Promise<DropEntry[]> {
  const reader = entry.createReader();
  const all: DropEntry[] = [];
  while (true) {
    const batch = await new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

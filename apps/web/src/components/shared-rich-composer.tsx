'use client';

import { useEffect, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import Dashboard from '@uppy/react/dashboard';
import Tus from '@uppy/tus';
import GoldenRetriever from '@uppy/golden-retriever';
import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';
import type { ChatAttachmentRef } from '@/lib/chat-turn-input';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_MANIFEST_ROWS = 40;

type Props = { disabled?: boolean; dark?: boolean; onAttachmentsChange?: (files: ChatAttachmentRef[]) => void };

/** Shared attachment affordance for every conversational composer. */
export function SharedRichComposer({ disabled = false, dark = false, onAttachmentsChange }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ReturnType<Uppy['getFiles']>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [uppy] = useState(() => {
    const instance = new Uppy({
      id: 'frank-shared-composer',
      autoProceed: false,
      allowMultipleUploadBatches: true,
      restrictions: { maxFileSize: MAX_FILE_BYTES, maxTotalFileSize: MAX_MESSAGE_BYTES, maxNumberOfFiles: MAX_FILES },
    }).use(GoldenRetriever, { serviceWorker: false });
    // Tus is only armed when an attachment service exists. Do not silently send
    // file bytes through the legacy chat endpoint during the staged rollout.
    const endpoint = process.env.NEXT_PUBLIC_FRANK_TUS_ENDPOINT;
    if (endpoint) instance.use(Tus, { endpoint, limit: 3, retryDelays: [0, 1000, 3000, 5000] });
    return instance;
  });

  useEffect(() => {
    const sync = () => {
      const next = uppy.getFiles();
      setFiles(next);
      const references = next.flatMap((file) => {
        const body = file.response?.body as { attachmentId?: string } | undefined;
        return body?.attachmentId ? [{ id: body.attachmentId, name: file.name, size: file.size ?? 0, relativePath: (file.meta.relativePath as string | null) ?? null }] : [];
      });
      onAttachmentsChange?.(references);
    };
    uppy.on('file-added', sync); uppy.on('file-removed', sync); uppy.on('upload-success', sync); uppy.on('upload-error', sync);
    const paste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length) { uppy.addFiles(pasted.map((data) => ({ data, name: data.name, type: data.type, meta: { relativePath: null } }))); setNotice('Added pasted file(s).'); }
    };
    window.addEventListener('paste', paste);
    return () => { uppy.off('file-added', sync); uppy.off('file-removed', sync); uppy.off('upload-success', sync); uppy.off('upload-error', sync); window.removeEventListener('paste', paste); uppy.destroy(); };
  }, [onAttachmentsChange, uppy]);

  const folderPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    uppy.addFiles(selected.map((data) => ({ data, name: data.name, type: data.type, meta: { relativePath: data.webkitRelativePath || null } })));
    event.target.value = '';
  };
  const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const rows = files.slice(0, MAX_MANIFEST_ROWS);
  return <>
    <button type="button" disabled={disabled} onClick={() => setOpen(true)} aria-label="Add files or folders" title="Add files or folders" className={dark ? 'rounded-lg p-2 text-white/70 hover:bg-white/10' : 'rounded-lg p-2 text-muted hover:bg-hover'}>+</button>
    {files.length > 0 && <span className={dark ? 'max-w-36 truncate text-[10px] text-white/60' : 'max-w-36 truncate text-[10px] text-muted'}>{files.length.toLocaleString()} attachment{files.length === 1 ? '' : 's'}</span>}
    {open && <div role="dialog" aria-modal="true" aria-label="Add attachments" className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-shell p-4 shadow-2xl">
        <div className="mb-3 flex items-center"><h2 className="font-semibold text-ink">Attachments</h2><span className="flex-1"/><button type="button" onClick={() => setOpen(false)} className="rounded p-2 text-muted hover:bg-hover" aria-label="Close attachments">×</button></div>
        <div className="mb-3 flex flex-wrap gap-2"><button type="button" onClick={() => folderRef.current?.click()} className="rounded border border-line px-3 py-1.5 text-sm text-ink">Choose folder</button><span className="text-xs text-muted">Drop files or folders here, or paste files/images. {files.length.toLocaleString()}/{MAX_FILES.toLocaleString()} · {(total / 1024 / 1024).toFixed(1)} MiB</span></div>
        <input ref={folderRef} type="file" multiple className="hidden" onChange={folderPicked} {...({ webkitdirectory: '', directory: '' } as object)} />
        <Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} showProgressDetails hidePauseResumeButton={false} note="Max 2 GiB per file; 10 GiB and 10,000 files per message." />
        {files.length > 0 && <div className="mt-3 rounded border border-line p-2 text-xs text-muted" aria-live="polite"><b className="text-ink">Manifest</b>{rows.map((file) => <div key={file.id} className="truncate">{String(file.meta.relativePath ?? file.name)} · {file.progress.uploadComplete ? 'uploaded' : file.progress.uploadStarted ? 'uploading' : 'queued'}</div>)}{files.length > MAX_MANIFEST_ROWS && <div>Showing {MAX_MANIFEST_ROWS} of {files.length.toLocaleString()} attachments.</div>}</div>}
        <p className="mt-3 text-xs text-muted">Uploads resume while this browser keeps their data. Browser restarts and folder paste cannot reliably restore file handles; reselect any item marked unavailable. Files are uploaded separately and chat only receives completed attachment IDs.</p>
        {notice && <p className="mt-2 text-xs text-accent">{notice}</p>}
      </section>
    </div>}
  </>;
}

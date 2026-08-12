'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import Dashboard from '@uppy/react/dashboard';
import Tus from '@uppy/tus';
import GoldenRetriever from '@uppy/golden-retriever';
import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';
import type { ChatAttachmentRef } from '@/lib/chat-turn-input';
import { reserveAttachmentUpload, waitForCleanAttachment } from '@/lib/attachment-upload-auth';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_MANIFEST_ROWS = 40;
type Props = { disabled?: boolean; dark?: boolean; conversationId?: string; pasteTargetRef?: React.RefObject<HTMLTextAreaElement | null>; onAttachmentsChange?: (files: ChatAttachmentRef[]) => void };

/** Shared composer attachment UI. Bytes only go to a per-file authorised Tus URL. */
export function SharedRichComposer({ disabled = false, dark = false, conversationId, pasteTargetRef, onAttachmentsChange }: Props) {
  const [open, setOpen] = useState(false); const [files, setFiles] = useState<ReturnType<Uppy['getFiles']>>([]); const [notice, setNotice] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null); const callbackRef = useRef(onAttachmentsChange); callbackRef.current = onAttachmentsChange;
  const conversationRef = useRef(conversationId); conversationRef.current = conversationId;
  const draftId = useRef(typeof crypto === 'undefined' ? '' : crypto.randomUUID()); const stableId = useId();
  const available = Boolean(conversationId && draftId.current);
  const [uppy] = useState(() => new Uppy({ id: `frank-composer-${stableId.replaceAll(':', '')}`, autoProceed: false, allowMultipleUploadBatches: true, restrictions: { maxFileSize: MAX_FILE_BYTES, maxTotalFileSize: MAX_MESSAGE_BYTES, maxNumberOfFiles: MAX_FILES } })
    .use(GoldenRetriever, { serviceWorker: false })
    .use(Tus, { limit: 3, retryDelays: [0, 1000, 3000, 5000], allowedMetaFields: ['attachment_id', 'capability_expires_at'] }));

  useEffect(() => {
    const sync = () => { const next = uppy.getFiles(); setFiles(next); callbackRef.current?.(next.flatMap((file) => { const attachmentId = file.meta.clean_attachment_id as string | undefined; return attachmentId ? [{ id: attachmentId, name: file.name, size: file.size ?? 0, relativePath: (file.meta.relativePath as string | null) ?? null }] : []; })); };
    const finalize = (file: ReturnType<Uppy['getFile']>) => { const attachmentId = file?.meta.attachment_id as string | undefined; if (!file || !attachmentId) return; void waitForCleanAttachment(attachmentId).then(() => { uppy.setFileMeta(file.id, { clean_attachment_id: attachmentId }); sync(); }).catch((error: unknown) => { uppy.setFileState(file.id, { error: error instanceof Error ? error.message : 'Attachment processing failed.' }); sync(); }); };
    uppy.on('file-added', sync); uppy.on('file-removed', sync); uppy.on('upload-success', finalize); uppy.on('upload-error', sync); uppy.on('upload-progress', sync);
    const target = pasteTargetRef?.current;
    const paste = (event: ClipboardEvent) => { const pasted = Array.from(event.clipboardData?.files ?? []); if (!pasted.length) return; if (!conversationRef.current || !draftId.current) { setNotice('Attachments become available when this conversation has a durable ID.'); return; } event.preventDefault(); void addFiles(pasted); };
    target?.addEventListener('paste', paste);
    return () => { uppy.off('file-added', sync); uppy.off('file-removed', sync); uppy.off('upload-success', finalize); uppy.off('upload-error', sync); uppy.off('upload-progress', sync); target?.removeEventListener('paste', paste); uppy.destroy(); };
  // The Uppy instance is intentionally destroyed only on unmount; callbacks live in refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uppy, pasteTargetRef]);

  async function addFiles(selected: File[]) {
    if (!available || !conversationRef.current) { setNotice('Attachments become available when this conversation has a durable ID.'); return; }
    for (const data of selected) {
      try {
        const relativePath = data.webkitRelativePath || undefined;
        const reservation = await reserveAttachmentUpload({ conversation_id: conversationRef.current, draft_message_id: draftId.current, idempotency_key: crypto.randomUUID(), size_bytes: String(data.size), original_name: data.name, ...(relativePath ? { relative_path: relativePath } : {}), ...(data.type ? { media_type: data.type } : {}) });
        uppy.addFile({ data, name: data.name, type: data.type, meta: { attachment_id: reservation.attachment_id, capability_expires_at: reservation.capability_expires_at, ...(reservation.tus_metadata ?? {}), relativePath: relativePath ?? null }, tus: { endpoint: reservation.tus_creation_url, headers: { [reservation.capability_header.name]: reservation.capability_header.value }, allowedMetaFields: ['attachment_id', 'capability_expires_at', ...Object.keys(reservation.tus_metadata ?? {})] } });
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Attachment authorisation failed.'); }
    }
  }
  const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0); const rows = files.slice(0, MAX_MANIFEST_ROWS);
  return <><button type="button" disabled={disabled || !available} onClick={() => setOpen(true)} aria-label="Add files or folders" title={available ? 'Add files or folders' : 'Attachments become available when this conversation has a durable ID'} className={dark ? 'rounded-lg p-2 text-white/70 hover:bg-white/10 disabled:opacity-40' : 'rounded-lg p-2 text-muted hover:bg-hover disabled:opacity-40'}>+</button>{!available && <span className="text-[10px] text-muted">Attachments available after chat starts</span>}
    {open && <div role="dialog" aria-modal="true" aria-label="Add attachments" onPaste={(event) => { const items = Array.from(event.clipboardData.files); if (items.length) { event.preventDefault(); void addFiles(items); } }} className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4"><section className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-shell p-4 shadow-2xl"><div className="mb-3 flex items-center"><h2 className="font-semibold text-ink">Attachments</h2><span className="flex-1"/><button type="button" onClick={() => setOpen(false)} className="rounded p-2 text-muted hover:bg-hover" aria-label="Close attachments">×</button></div><div className="mb-3 flex flex-wrap gap-2"><button type="button" disabled={!available} onClick={() => folderRef.current?.click()} className="rounded border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-40">Choose folder</button><span className="text-xs text-muted">{files.length.toLocaleString()}/{MAX_FILES.toLocaleString()} · {(total / 1024 / 1024).toFixed(1)} MiB</span></div><input ref={folderRef} type="file" multiple className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} {...({ webkitdirectory: '', directory: '' } as object)} /><Dashboard uppy={uppy} proudlyDisplayPoweredByUppy={false} showProgressDetails hidePauseResumeButton={false} note="Max 2 GiB/file; 10 GiB and 10,000 files/message." />{files.length > 0 && <div className="mt-3 rounded border border-line p-2 text-xs text-muted" aria-live="polite"><b className="text-ink">Manifest</b>{rows.map((file) => <div key={file.id} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{String(file.meta.relativePath ?? file.name)}</span><span>{file.error ? `failed: ${file.error}` : file.progress.uploadComplete ? 'uploaded' : file.progress.uploadStarted ? 'uploading' : 'ready'}</span><button type="button" onClick={() => uppy.removeFile(file.id)} aria-label={`Remove ${file.name}`}>Remove</button></div>)}{files.length > MAX_MANIFEST_ROWS && <div>Showing {MAX_MANIFEST_ROWS} of {files.length.toLocaleString()} attachments.</div>}</div>}<p className="mt-3 text-xs text-muted">Browser restarts and folder paste cannot reliably restore file handles; reselect unavailable files. Chat receives only completed server attachment IDs.</p>{notice && <p className="mt-2 text-xs text-danger" role="status">{notice}</p>}</section></div>}</>;
}

export type AttachmentUploadReservation = {
  attachment_id: string;
  tus_creation_url: string;
  capability_header: { name: string; value: string };
  capability_expires_at: string;
  tus_metadata?: Record<string, string>;
};

export async function reserveAttachmentUpload(input: {
  conversation_id: string;
  draft_message_id: string;
  idempotency_key: string;
  size_bytes: string;
  original_name: string;
  relative_path?: string;
  media_type?: string;
}): Promise<AttachmentUploadReservation> {
  const response = await fetch('/v1/attachments/uploads', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(input) });
  if (!response.ok) throw new Error(`Attachment authorisation failed (${response.status}).`);
  return response.json() as Promise<AttachmentUploadReservation>;
}

/** Bytes being uploaded is not enough: wait for the service to mark the attachment clean. */
export async function waitForCleanAttachment(attachmentId: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(`/v1/attachments/${encodeURIComponent(attachmentId)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Attachment status failed (${response.status}).`);
    const body = (await response.json()) as { status?: string; attachment?: { status?: string } };
    const status = body.attachment?.status ?? body.status;
    if (status === 'clean' || status === 'ready') return;
    if (status === 'failed' || status === 'rejected' || status === 'infected') throw new Error(`Attachment ${status}.`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error('Attachment processing timed out.');
}

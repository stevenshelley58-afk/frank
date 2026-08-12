import type { AttachmentUploadStatusResponse } from '@frank/contracts';

export type AttachmentUploadReservation = {
  reservation_id: string;
  upload_id: string;
  tus_creation_url: string;
  tus_headers: Record<string, string>;
  tus_metadata: Record<string, string>;
  tus_allowed_meta_fields: string[];
  capability_expires_at: string;
  reservation_expires_at: string;
  replayed: boolean;
};

export type AttachmentCapability = {
  upload_id: string;
  capability: string;
  capability_expires_at: string;
  reservation_expires_at: string;
};

export type AttachmentUploadInput = {
  conversation_id: string;
  draft_message_id: string;
  idempotency_key: string;
  size_bytes: string;
  original_name: string;
  relative_path?: string;
  media_type?: string;
};

async function responseJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) throw new Error(`${action} failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function reserveAttachmentUpload(input: AttachmentUploadInput): Promise<AttachmentUploadReservation> {
  const response = await fetch('/v1/attachments/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': input.idempotency_key },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  return responseJson(response, 'Attachment authorisation');
}

export async function renewAttachmentUploadCapability(uploadId: string, idempotencyKey: string): Promise<AttachmentCapability> {
  const response = await fetch(`/v1/attachments/uploads/${encodeURIComponent(uploadId)}/capability`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    credentials: 'same-origin',
  });
  return responseJson(response, 'Attachment capability renewal');
}

export async function cancelAttachmentUpload(uploadId: string, capability: string, idempotencyKey: string): Promise<void> {
  const response = await fetch(`/v1/attachments/uploads/${encodeURIComponent(uploadId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey, 'X-Frank-Upload-Capability': capability },
    credentials: 'same-origin',
    body: JSON.stringify({ idempotency_key: idempotencyKey }),
  });
  await responseJson(response, 'Attachment cancellation');
}

export async function attachmentUploadStatus(uploadId: string): Promise<AttachmentUploadStatusResponse> {
  const response = await fetch(`/v1/attachments/uploads/${encodeURIComponent(uploadId)}`, { credentials: 'same-origin' });
  return responseJson(response, 'Attachment status');
}

/** Resolve only after a materialized attachment is clean and ready to bind to a turn. */
export async function waitForCleanAttachment(uploadId: string, signal?: AbortSignal): Promise<string> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Attachment status polling aborted.', 'AbortError');
    const { upload } = await attachmentUploadStatus(uploadId);
    if ('attachment_id' in upload && upload.scan_state === 'clean' && ['ready', 'promoted'].includes(upload.attachment_state)) return upload.attachment_id;
    if (['cancelled', 'expired', 'rejected'].includes(upload.reservation_state)) throw new Error(`Attachment upload ${upload.reservation_state}.`);
    if ('scan_state' in upload && ['blocked', 'failed'].includes(upload.scan_state)) throw new Error(`Attachment scan ${upload.scan_state}.`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error('Attachment processing timed out.');
}

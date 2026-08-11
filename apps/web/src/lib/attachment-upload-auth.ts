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

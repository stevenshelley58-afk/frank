/**
 * The chat boundary intentionally carries references, never File/Blob bytes.
 * Wave 2 prepares the client side; the existing text transport remains live.
 */
export interface ChatAttachmentRef {
  id: string;
  name: string;
  relativePath: string | null;
  size: number;
}

export interface ChatTurnInput {
  text: string;
  attachment_ids: string[];
  attachments: ChatAttachmentRef[];
}

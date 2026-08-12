import type { ChatTurnInput as ContractChatTurnInput } from '@frank/contracts';

export type ChatTurnInput = ContractChatTurnInput;

export interface ChatAttachmentRef {
  id: string;
  name: string;
  relativePath: string | null;
  size: number;
}

/** Local composer state. The API adapter converts it to the frozen wire contract. */
export interface ChatTurnDraft {
  text: string;
  attachments: ChatAttachmentRef[];
}

export function chatTurnInput(input: {
  conversationId: string;
  idempotencyKey: string;
  draft: ChatTurnDraft;
  model: string;
  thinking: 'off' | 'think' | 'deep';
}): ChatTurnInput {
  return {
    conversation_id: input.conversationId,
    idempotency_key: input.idempotencyKey,
    content: [{ type: 'text', text: input.draft.text }],
    attachment_ids: input.draft.attachments.map((attachment) => attachment.id),
    requested_capability: input.thinking === 'deep' ? 'Deep' : 'Auto',
    ...(input.model !== 'auto' ? { requested_model_alias: input.model } : {}),
  };
}

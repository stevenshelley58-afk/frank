/**
 * Turn input for the Hermes-backed turn stream (W2-1/W2-2).
 *
 * The wire body is now strictly `{ conversation_id, idempotency_key, profile,
 * session_key, message }`. Frank's database never sees the message text — the
 * words live in Hermes and stream back over SSE (`turn`/`text`/`tool`/
 * `done`/`error`). The old `content[]` / `attachment_ids` body 400s, so this
 * module no longer references the contracts package for the wire shape.
 */

export interface ChatTurnInput {
  conversation_id: string;
  idempotency_key: string;
  /** Hermes profile to talk to ("hub" unless a project profile is selected). */
  profile: string;
  /** Scopes Hermes memory to one conversation (stable across reloads). */
  session_key: string;
  /** The user's message. Passed to Hermes; never persisted by Frank. */
  message: string;
}

export interface ChatAttachmentRef {
  id: string;
  name: string;
  relativePath: string | null;
  size: number;
}

/** Local composer state. The API adapter converts it to the wire contract. */
export interface ChatTurnDraft {
  text: string;
  attachments: ChatAttachmentRef[];
}

export function chatTurnInput(input: {
  conversationId: string;
  idempotencyKey: string;
  message: string;
  profile?: string;
  sessionKey?: string;
}): ChatTurnInput;

/**
 * @deprecated Legacy draft-based call shape, kept only so frank-shell's
 * `send()` typechecks until the W2-2 hot-file replacement lands. The emitted
 * body is the new Hermes contract either way (profile "hub", session key =
 * conversation id); the legacy `attachment_ids` reads as `undefined` and is
 * never put on the wire.
 */
export function chatTurnInput(input: {
  conversationId: string;
  idempotencyKey: string;
  draft: ChatTurnDraft;
  model: string;
  thinking: 'off' | 'think' | 'deep';
}): ChatTurnInput & { attachment_ids?: string[] };

export function chatTurnInput(
  input:
    | {
        conversationId: string;
        idempotencyKey: string;
        message: string;
        profile?: string;
        sessionKey?: string;
      }
    | {
        conversationId: string;
        idempotencyKey: string;
        draft: ChatTurnDraft;
        model: string;
        thinking: 'off' | 'think' | 'deep';
      },
): ChatTurnInput {
  const message = 'message' in input ? input.message : input.draft.text;
  return {
    conversation_id: input.conversationId,
    idempotency_key: input.idempotencyKey,
    profile: 'hub',
    session_key: input.conversationId,
    message,
  };
}

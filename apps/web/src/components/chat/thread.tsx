'use client';

import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type MessageState,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { ChatMessageRow } from '@/lib/chat-api';
import { parseToolEventPayload } from '@/lib/chat-api';
import { MarkdownText } from './assistant-ui/markdown-text';
import { ToolFallback } from './assistant-ui/tool-fallback';

/**
 * The thread — an @assistant-ui/react surface (W2-2).
 *
 * frank-shell owns the conversation state (`messages` rows + a live
 * `streamingText`) and the composer; this component renders that state
 * through assistant-ui's external-store runtime and official components:
 * bubbles are `MessagePrimitive.Root`/`Parts`, reply text is markdown via
 * `MarkdownTextPrimitive`, and Hermes `tool` events surface as tool-call
 * parts rendered by the vendored official `ToolFallback`. Nothing here is
 * hand-built — bubbles, streaming, tool cards and markdown all come from
 * the library (the packet's W2-2 hard constraint).
 *
 * Sending stays in frank-shell (`send()` → SSE → setMessages / setStreamingText)
 * until the coordinator adopts the self-contained `FrankChat` surface
 * (components/chat/frank-chat.tsx); the runtime here is a render host fed
 * by props, so `onNew` is a no-op because the composer lives outside.
 */

interface ChatThreadProps {
  messages: ChatMessageRow[];
  /** Text arriving from the turn stream for a reply that has not landed yet. */
  streamingText: string | null;
  agentLabel: string;
  tint: string;
  projectName: (projectId: string) => string;
  onFollowDelegation: (projectId: string) => void;
}

export function ChatThread({
  messages,
  streamingText,
  agentLabel,
  tint,
  projectName: _projectName,
  onFollowDelegation: _onFollowDelegation,
}: ChatThreadProps) {
  const threadMessages = useMemo(
    () => toThreadMessages(messages, streamingText),
    [messages, streamingText],
  );

  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    isRunning: streamingText !== null,
    convertMessage: (message: ThreadMessageLike) => message,
    // The composer is hosted by frank-shell; sending flows through send().
    onNew: async () => {},
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="min-h-0 flex-1">
        <ThreadPrimitive.Viewport className="chat-scroll h-full overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-end gap-4 px-6 pb-4 pt-7">
            <ThreadPrimitive.Messages>
              {({ message }) => (
                <MessageRow message={message} agentLabel={agentLabel} tint={tint} />
              )}
            </ThreadPrimitive.Messages>
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Row → assistant-ui message mapping                                  */
/* ------------------------------------------------------------------ */

function toThreadMessages(messages: ChatMessageRow[], streamingText: string | null): ThreadMessageLike[] {
  const rows: ThreadMessageLike[] = [];
  for (const row of messages) {
    if (row.kind === 'user') {
      rows.push({
        role: 'user',
        id: row.id,
        createdAt: new Date(row.created_at),
        status: { type: 'complete', reason: 'stop' },
        content: [{ type: 'text', text: row.body }],
      });
    } else if (row.kind === 'agent') {
      rows.push({
        role: 'assistant',
        id: row.id,
        createdAt: new Date(row.created_at),
        status:
          row.meta?.state === 'failed'
            ? { type: 'incomplete', reason: 'error' }
            : { type: 'complete', reason: 'stop' },
        content: [{ type: 'text', text: row.body }],
      });
    } else if (row.kind === 'tool') {
      const tool = parseToolEventPayload(row.body);
      rows.push({
        role: 'assistant',
        id: row.id,
        createdAt: new Date(row.created_at),
        status: { type: 'complete', reason: 'stop' },
        content: tool
          ? [
              {
                type: 'tool-call',
                toolCallId: tool.call_id,
                toolName: tool.name,
                args: tool.arguments,
                argsText: tool.argumentsText ?? JSON.stringify(tool.arguments),
              },
            ]
          : [{ type: 'text', text: row.body }],
      });
    } else {
      // Legacy rows (working/thinking/delegation/receipt) have no meaning in
      // the Hermes-backed flow; render their body as a quiet system note.
      rows.push({
        role: 'system',
        id: row.id,
        createdAt: new Date(row.created_at),
        status: { type: 'complete', reason: 'stop' },
        content: [{ type: 'text', text: row.body || row.kind }],
      });
    }
  }
  if (streamingText !== null) {
    rows.push({
      role: 'assistant',
      id: 'streaming',
      createdAt: new Date(),
      status: { type: 'running' },
      content: [{ type: 'text', text: streamingText }],
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Role dispatch                                                       */
/* ------------------------------------------------------------------ */

function MessageRow({
  message,
  agentLabel,
  tint,
}: {
  message: MessageState;
  agentLabel: string;
  tint: string;
}) {
  if (message.role === 'user') return <UserMessage />;
  if (message.role === 'system') return <SystemNote message={message} />;
  return <AssistantMessage agentLabel={agentLabel} tint={tint} />;
}

/* ------------------------------------------------------------------ */
/* Bubbles — official MessagePrimitive composition only               */
/* ------------------------------------------------------------------ */

function UserMessage() {
  return (
    <MessagePrimitive.Root className="animate-msg-in flex max-w-[82%] flex-col items-end gap-1.5 self-end">
      <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted/80">
        Steve
      </span>
      <MessagePrimitive.Parts>
        {({ part }) =>
          part.type === 'text' ? (
            <div className="rounded-2xl rounded-tr-[4px] bg-ink px-[15px] py-3 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-white">
              {part.text}
            </div>
          ) : null
        }
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage({
  agentLabel,
  tint,
}: {
  agentLabel: string;
  tint: string;
}) {
  return (
    <MessagePrimitive.Root className="animate-msg-in flex flex-col gap-1.5 self-stretch">
      <span className="flex items-center gap-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted/80">
        <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: tint }} aria-hidden />
        {agentLabel}
      </span>
      <div className="text-[14px] leading-[1.62] text-ink">
        <MessagePrimitive.Parts>
          {({ part }) => {
            switch (part.type) {
              case 'text':
                return <MarkdownText />;
              case 'tool-call':
                // Registered tool UIs win; otherwise the official
                // ToolFallback renders the call (name, status, args, result).
                return part.toolUI ?? <ToolFallback {...part} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

/** Quiet note for legacy rows; keeps projectName/onFollowDelegation unused but in the contract. */
function SystemNote({ message }: { message: MessageState }) {
  const text = message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
  if (!text) return null;
  return (
    <MessagePrimitive.Root className="animate-msg-in self-stretch">
      <p className="text-[11.5px] leading-snug text-muted/80">{text}</p>
    </MessagePrimitive.Root>
  );
}

// Re-exported so type-only consumers can reference the row contract.
export type { ChatThreadProps };

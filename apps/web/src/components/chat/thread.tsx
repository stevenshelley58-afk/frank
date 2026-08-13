'use client';

import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type MessageState,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { ChatMessageRow } from '@/lib/chat-api';
import { parseToolEventPayload } from '@/lib/chat-api';
import { AssistantBubble, UserBubble } from './bubbles';
import { SystemCard } from './system-cards';

/**
 * The thread — an @assistant-ui/react host.
 *
 * frank-shell owns the conversation state (`messages` rows + a live
 * `streamingText`) and the composer; this component renders that state
 * through assistant-ui's external-store runtime and primitives. Rows map to
 * `ThreadMessageLike`s: user/agent rows become bubbles, tool rows become
 * assistant tool-call parts, and the older working/thinking/delegation/
 * receipt kinds ride through as system-role cards. The live reply is a
 * running assistant message with the accumulated text.
 *
 * Sending stays in frank-shell (`send()` → submitChatTurn SSE → setMessages /
 * setStreamingText), so the runtime here is a render-only host: `onNew` is a
 * no-op because the composer lives outside the thread.
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
  projectName,
  onFollowDelegation,
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
                <MessageRow
                  message={message}
                  agentLabel={agentLabel}
                  tint={tint}
                  projectName={projectName}
                  onFollowDelegation={onFollowDelegation}
                />
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
              },
            ]
          : [{ type: 'text', text: row.body }],
      });
    } else {
      // working / thinking / delegation / receipt — system cards. The row
      // rides in metadata.custom so the card renderer has the original shape.
      rows.push({
        role: 'system',
        id: row.id,
        createdAt: new Date(row.created_at),
        status: { type: 'complete', reason: 'stop' },
        content: [{ type: 'text', text: '' }],
        metadata: { custom: { row } },
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
  projectName,
  onFollowDelegation,
}: {
  message: MessageState;
  agentLabel: string;
  tint: string;
  projectName: (projectId: string) => string;
  onFollowDelegation: (projectId: string) => void;
}) {
  if (message.role === 'user') return <UserBubble message={message} />;
  if (message.role === 'assistant') {
    return <AssistantBubble message={message} agentLabel={agentLabel} tint={tint} />;
  }
  const row = message.metadata?.custom?.row as ChatMessageRow | undefined;
  if (!row) return null;
  return <SystemCard row={row} projectName={projectName} onFollowDelegation={onFollowDelegation} />;
}

// Re-exported so type-only consumers can reference the row contract.
export type { ChatThreadProps };

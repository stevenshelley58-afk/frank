'use client';

/**
 * FrankChat — the self-contained @assistant-ui/react chat surface (W2-2).
 *
 * Unlike `ChatThread` (a render host fed by frank-shell's props), this
 * component OWNS the conversation: the assistant-ui runtime holds the
 * message state, the composer submits through `onNew`, and every turn
 * streams straight from POST /v1/chat/turns (via the SSE bridge route)
 * into the runtime's message list. Bubbles, streaming, tool cards
 * (official ToolFallback) and markdown (MarkdownTextPrimitive) all come
 * from assistant-ui — nothing hand-built.
 *
 * Profile routing: defaults to 'hub'; pass the active project's profile
 * (same name) when a project is selected.
 *
 * Reload restore: Frank stores no message text, and the documented Hermes
 * history endpoint (GET /api/sessions/{id}/messages) is not addressable
 * from the web app (the Hermes session id is never exposed), so restore
 * degrades gracefully — the same `sessionKey` chains turns in the same
 * Hermes conversation and a "conversation continues" note explains why
 * the transcript is not replayed (see conversationRestoreNote in chat-api).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { conversationRestoreNote, parseToolEventPayload, streamChatTurn } from '@/lib/chat-api';
import type { ChatTurnInput } from '@/lib/chat-turn-input';
import type { ApiFetch } from '@/lib/api';
import { MarkdownText } from './assistant-ui/markdown-text';
import { ToolFallback } from './assistant-ui/tool-fallback';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface FrankChatProps {
  api: ApiFetch;
  /** Frank conversation id — also the default Hermes session key. */
  conversationId: string;
  /** Hermes profile: 'hub' unless a project profile is selected. */
  profile?: string;
  /** Scopes Hermes memory; defaults to the conversation id. */
  sessionKey?: string;
  /** True when this conversation existed before this page load (restore case). */
  restored?: boolean;
  agentLabel: string;
  tint: string;
  /** Optional label resolver for legacy delegation rows (unused in the Hermes flow). */
  projectName?: (projectId: string) => string;
  onFollowDelegation?: (projectId: string) => void;
  onTitleChange?: (title: string) => void;
  className?: string;
}

export function FrankChat({
  api,
  conversationId,
  profile = 'hub',
  sessionKey,
  restored = false,
  agentLabel,
  tint,
  className,
}: FrankChatProps) {
  const sessionKeyValue = sessionKey ?? conversationId;
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const restore = useMemo(() => (restored ? conversationRestoreNote(sessionKeyValue) : null), [restored, sessionKeyValue]);

  const appendAssistantDelta = useCallback(
    (update: (message: ThreadMessageLike) => ThreadMessageLike) => {
      setMessages((prev) => {
        // The running assistant message is always the last one.
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last.status?.type === 'running') {
          next[next.length - 1] = update(last);
        }
        return next;
      });
    },
    [],
  );

  const runTurn = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim();
      if (!text) return;
      if (isRunning) return;

      const idempotencyKey = crypto.randomUUID();
      const userMessage: ThreadMessageLike = {
        role: 'user',
        id: idempotencyKey,
        status: { type: 'complete', reason: 'stop' },
        content: [{ type: 'text', text }],
      };
      const assistantMessage: ThreadMessageLike = {
        role: 'assistant',
        id: `assistant:${idempotencyKey}`,
        status: { type: 'running' },
        content: [],
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsRunning(true);
      turnIdRef.current = null;

      const controller = new AbortController();
      abortRef.current = controller;
      let accumulated = '';

      const input: ChatTurnInput = {
        conversation_id: conversationId,
        idempotency_key: idempotencyKey,
        profile,
        session_key: sessionKeyValue,
        message: text,
      };

      try {
        await streamChatTurn(input, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'turn') {
              turnIdRef.current = String(event.data.turn_id ?? '');
            } else if (event.type === 'text') {
              accumulated += String(event.data.content ?? '');
              appendAssistantDelta((message) => ({
                ...message,
                content: [{ type: 'text', text: accumulated }],
              }));
            } else if (event.type === 'tool') {
              const tool = parseToolEventPayload(String(event.data.content ?? ''));
              if (tool) {
                appendAssistantDelta((message) => ({
                  ...message,
                  content: [
                    ...(Array.isArray(message.content) ? message.content : []),
                    {
                      type: 'tool-call',
                      toolCallId: tool.call_id,
                      toolName: tool.name,
                      args: tool.arguments,
                      argsText: tool.argumentsText ?? JSON.stringify(tool.arguments),
                    },
                  ],
                }));
              }
            } else if (event.type === 'error') {
              accumulated = accumulated || String(event.data.content ?? '');
            }
          },
        });
        appendAssistantDelta((message) => ({
          ...message,
          status: { type: 'complete', reason: 'stop' },
        }));
      } catch {
        if (!controller.signal.aborted) {
          appendAssistantDelta((message) => ({
            ...message,
            status: { type: 'incomplete', reason: 'error' },
            ...(accumulated ? { content: [{ type: 'text', text: accumulated }] } : {}),
          }));
        }
      } finally {
        setIsRunning(false);
        abortRef.current = null;
      }
    },
    [api, conversationId, profile, sessionKeyValue, appendAssistantDelta, isRunning],
  );

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const turnId = turnIdRef.current;
    turnIdRef.current = null;
    if (turnId) await api(`/v1/chat/turns/${turnId}/cancel`, { method: 'POST' }).catch(() => undefined);
    setMessages((prev) =>
      prev.map((message) =>
        message.status?.type === 'running'
          ? { ...message, status: { type: 'incomplete', reason: 'cancelled' } }
          : message,
      ),
    );
    setIsRunning(false);
  }, [api]);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (message: ThreadMessageLike) => message,
    setMessages: (next) => setMessages(next.slice()),
    onNew: runTurn,
    onCancel: cancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className={cn('flex h-full min-h-0 flex-col', className)}>
        <ThreadPrimitive.Viewport className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-end gap-4 px-6 pb-4 pt-7">
            {restore && (
              <p className="rounded-xl border border-line bg-card px-3.5 py-2.5 text-[11.5px] leading-snug text-muted">
                {restore.note}
              </p>
            )}
            <ThreadPrimitive.Messages>
              {({ message }) => <FrankMessageRow message={message} agentLabel={agentLabel} tint={tint} />}
            </ThreadPrimitive.Messages>
          </div>
        </ThreadPrimitive.Viewport>
        <Composer className="mx-auto w-full max-w-[760px] px-6 pb-5" />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Message rows — official MessagePrimitive composition only           */
/* ------------------------------------------------------------------ */

function FrankMessageRow({
  message,
  agentLabel,
  tint,
}: {
  message: { role: 'user' | 'assistant' | 'system' };
  agentLabel: string;
  tint: string;
}) {
  if (message.role === 'user') return <UserMessage />;
  if (message.role === 'system') return null;
  return <AssistantMessage agentLabel={agentLabel} tint={tint} />;
}

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

function AssistantMessage({ agentLabel, tint }: { agentLabel: string; tint: string }) {
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

/* ------------------------------------------------------------------ */
/* Composer — official ComposerPrimitive                               */
/* ------------------------------------------------------------------ */

function Composer({ className }: { className?: string }) {
  return (
    <ComposerPrimitive.Root className={cn('flex w-full flex-col gap-2', className)}>
      <div className="flex items-end gap-2 rounded-[18px] border border-line bg-card px-3.5 py-2.5 shadow-sm focus-within:border-accent">
        <ComposerPrimitive.Input
          placeholder="Message Frank…"
          className="max-h-32 min-h-10 w-full resize-none bg-transparent px-1 py-1.5 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-muted/70"
          rows={1}
          autoFocus
          enterKeyHint="send"
          aria-label="Message input"
        />
        <ComposerPrimitive.Cancel asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-3 text-[12px]">
            Stop
          </Button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full bg-accent px-3.5 text-[12px] font-semibold text-white hover:brightness-105"
          >
            Send
          </Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

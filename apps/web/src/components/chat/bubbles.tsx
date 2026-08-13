'use client';

import { useState } from 'react';
import { MessagePrimitive, type EnrichedPartState, type MessageState } from '@assistant-ui/react';
import { Markdown } from '@/components/markdown';

/**
 * Chat bubbles built on @assistant-ui/react primitives. Each bubble is a
 * `MessagePrimitive.Root` fed by `MessagePrimitive.Parts`, so streaming text
 * parts, tool-call parts and status flow through assistant-ui's part model —
 * no hand-rolled bubble/streaming/tool-card code.
 */

export function AgentLabel({ label, tint }: { label: string; tint: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted/80">
      <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: tint }} aria-hidden />
      {label}
    </span>
  );
}

export function UserBubble({ message }: { message: MessageState }) {
  return (
    <MessagePrimitive.Root className="animate-msg-in flex max-w-[82%] flex-col items-end gap-1.5 self-end">
      <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted/80">
        Steve
      </span>
      <MessagePrimitive.Parts>
        {({ part }) =>
          part.type === 'text' ? (
            <div className="whitespace-pre-wrap rounded-2xl rounded-tr-[4px] bg-ink px-[15px] py-3 text-[13.5px] leading-[1.55] text-white">
              {part.text}
            </div>
          ) : null
        }
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

export function AssistantBubble({
  message,
  agentLabel,
  tint,
}: {
  message: MessageState;
  agentLabel: string;
  tint: string;
}) {
  const running = message.status?.type === 'running';
  return (
    <MessagePrimitive.Root className="animate-msg-in flex flex-col gap-1.5 self-stretch">
      <AgentLabel label={agentLabel} tint={tint} />
      <div className="text-[14px] leading-[1.62] text-ink">
        <MessagePrimitive.Parts>
          {({ part }) => {
            switch (part.type) {
              case 'text':
                return running ? <StreamingText text={part.text} /> : <Markdown text={part.text} />;
              case 'tool-call':
                // Registered tool UIs (via makeAssistantToolUI) win; otherwise
                // the themed collapsible card below renders the call.
                return part.toolUI ?? <ToolCard part={part} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

/** Live reply: raw text plus the cursor. Markdown waits for the final bubble. */
function StreamingText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap">
      {text}
      <span className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] rounded-[2px] bg-accent align-baseline" />
    </div>
  );
}

/**
 * A tool invocation card — the W2-1 `tool` SSE event, surfaced through
 * assistant-ui's tool-call part. Shows the tool name and a collapsible,
 * pretty-printed argument view (never a raw JSON dump on the surface).
 */
function ToolCard({ part }: { part: Extract<EnrichedPartState, { type: 'tool-call' }> }) {
  const [open, setOpen] = useState(false);
  const running = part.status?.type === 'running';
  const args = JSON.stringify(part.args, null, 2);

  return (
    <div className="self-stretch overflow-hidden rounded-xl border border-line bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-hover"
      >
        {running ? (
          <span className="grid h-[15px] w-[15px] shrink-0 place-items-center">
            <span className="h-[11px] w-[11px] animate-spin rounded-full border-2 border-line border-t-running" aria-hidden />
          </span>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-muted"
            aria-hidden
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        )}
        <span className="flex-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
          Tool · {part.toolName}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          className={`text-muted/70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-line px-3.5 pb-3 pt-2.5">
          <p className="pb-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted/70">
            Arguments
          </p>
          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-ink2">
            {args}
          </pre>
        </div>
      )}
    </div>
  );
}

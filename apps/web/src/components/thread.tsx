'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/lib/frank';
import { IconBolt } from './icons';
import { Markdown } from './markdown';

interface ThreadProps {
  messages: ChatMessage[];
  typing: boolean;
  /** label for frank messages, e.g. "Frank · Central" or "lotfile-frank" */
  agentName: string;
}

/**
 * The message thread — the quiet Atlantic workspace, bottom-anchored.
 *
 * Frank speaks from blue-white cards, Steve answers in Atlantic ink, and
 * delegation receipts use the verified strip. The scroll region anchors to
 * the bottom: short threads sit flush against the composer with the empty
 * space above (outer scroller, inner column with margin-top:auto).
 * Auto-follows the tail with the 80px stick rule; messages slide in.
 */
export function Thread({ messages, typing, agentName }: ThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, typing]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="chat-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-5 md:px-7"
    >
      {/* inner column: pushes content to the bottom when shorter than viewport */}
      <div className="mt-auto flex flex-col gap-3.5">
        {messages.map((m, i) => (
          <MessageRow
            key={m.id}
            message={m}
            agentName={agentName}
            delay={i < 6 ? 0.02 + i * 0.06 : 0}
          />
        ))}
        {typing && <TypingBubble />}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  agentName,
  delay,
}: {
  message: ChatMessage;
  agentName: string;
  delay: number;
}) {
  if (message.from === 'mention') {
    return (
      <div
        className="mention-strip animate-msg-in flex items-center gap-2.5 self-stretch rounded-xl px-3.5 py-2.5 text-[12px] leading-snug text-ink2"
        style={{ animationDelay: `${delay}s` }}
      >
        <IconBolt size={14} className="shrink-0 text-acid" />
        <div>
          {(message.parts ?? []).map((p, i) =>
            p.strong ? <b key={i} className="text-ink">{p.text}</b> : <span key={i}>{p.text}</span>,
          )}
        </div>
      </div>
    );
  }

  if (message.from === 'steve') {
    return (
      <div
        className="msg-max animate-msg-in flex flex-col items-end gap-1.5 self-end"
        style={{ animationDelay: `${delay}s` }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Steve</span>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tr-[4px] bg-ink px-[15px] py-3 text-[13.5px] leading-[1.5] text-white shadow-sm">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div
      className="msg-max animate-msg-in flex flex-col gap-1.5 self-start"
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="flex items-center gap-2">
        <img
          src="/brand/mark-ink-256.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-4 w-4 select-none opacity-90"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted">
          {agentName}
        </span>
      </span>
      <div className="rounded-2xl rounded-tl-[4px] border border-line bg-card px-[15px] py-3 text-[13.5px] leading-[1.5] text-ink">
        <Markdown text={message.text} />
      </div>
    </div>
  );
}

/** Quiet three-dot "Frank is thinking…" bubble. */
function TypingBubble() {
  return (
    <div className="animate-msg-in flex flex-col gap-1.5 self-start">
      <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted">
        Frank is typing
      </span>
      <div className="flex w-max items-center gap-[5px] rounded-2xl rounded-tl-[4px] border border-line bg-card px-4 py-[13px]">
        <i className="typing-dot" />
        <i className="typing-dot" />
        <i className="typing-dot" />
      </div>
    </div>
  );
}

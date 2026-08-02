'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/lib/frank';
import { IconBolt } from './icons';

interface ThreadProps {
  messages: ChatMessage[];
  typing: boolean;
  /** label for frank messages, e.g. "Frank · Central" or "lotfile-frank" */
  agentName: string;
}

/**
 * The message thread — the conversation vault.
 *
 * Runs on the shell's dark ink surface (brand shell #10120f family):
 * Frank's words in pure white, Steve's in ink on raised ivory, delegation
 * strips in acid. Auto-follows the tail, messages slide in.
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
      className="chat-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-5 pt-5 md:px-7"
    >
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
        className="mention-strip animate-msg-in flex items-center gap-2.5 self-stretch rounded-xl px-3.5 py-2.5 text-[12px] leading-snug text-[#E9ECE3]"
        style={{ animationDelay: `${delay}s` }}
      >
        <IconBolt size={14} className="shrink-0 text-acid" />
        <div>
          {(message.parts ?? []).map((p, i) =>
            p.strong ? <b key={i} className="text-white">{p.text}</b> : <span key={i}>{p.text}</span>,
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
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/45">Steve</span>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tr-[4px] bg-[#F1EFE6] px-[15px] py-3 text-[13.5px] leading-[1.5] text-ink shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
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
          src="/brand/mark-ivory-256.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-4 w-4 select-none opacity-90"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-white/45">
          {agentName}
        </span>
      </span>
      <div className="whitespace-pre-wrap rounded-2xl rounded-tl-[4px] px-[15px] py-3 text-[13.5px] leading-[1.5] text-white">
        {message.text}
      </div>
    </div>
  );
}

/** Quiet three-dot "Frank is thinking…" bubble. */
function TypingBubble() {
  return (
    <div className="animate-msg-in flex flex-col gap-1.5 self-start">
      <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-white/45">
        Frank is typing
      </span>
      <div className="flex w-max items-center gap-[5px] rounded-2xl rounded-tl-[4px] border border-white/10 bg-white/[0.06] px-4 py-[13px]">
        <i className="typing-dot" />
        <i className="typing-dot" />
        <i className="typing-dot" />
      </div>
    </div>
  );
}

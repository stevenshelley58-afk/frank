'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/frank';
import type { Delegation } from '@/lib/use-delegations';
import { IconBolt, IconCheck, IconCopy, IconEdit, IconRefresh } from './icons';
import { Markdown } from './markdown';
import { DelegationCard } from './delegation-card';

interface ThreadProps {
  messages: ChatMessage[];
  typing: boolean;
  /** label for frank messages, e.g. "Frank · Central" or "lotfile-frank" */
  agentName: string;
  /** Server-derived delegations, oldest first — rendered below the messages. */
  delegations?: Delegation[];
  /** 'central' for the home room, 'room' for project rooms. */
  delegationView?: 'central' | 'room';
  /** ChatGPT-style affordances — omit to hide. */
  onRegenerate?: () => void;
  onEdit?: (message: ChatMessage) => void;
}

/**
 * The message thread — the quiet Atlantic workspace.
 *
 * Frank speaks from blue-white cards, Steve answers in Atlantic ink, and
 * delegation receipts use the verified strip. Auto-follows the tail;
 * messages slide in. Hover a message to reveal copy / regenerate / edit.
 */
export function Thread({ messages, typing, agentName, delegations, delegationView, onRegenerate, onEdit }: ThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, typing, delegations]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // The last frank message id — regenerate only lands on the latest reply.
  let lastFrankId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].from === 'frank') {
      lastFrankId = messages[i].id;
      break;
    }
  }

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
          isLastFrank={m.id === lastFrankId}
          typing={typing}
          onRegenerate={onRegenerate}
          onEdit={onEdit}
        />
      ))}
      {(delegations ?? []).map((d) => (
        <DelegationCard key={d.id} d={d} view={delegationView ?? 'central'} />
      ))}
      {typing && <TypingBubble />}
    </div>
  );
}

/** Small ghost action button — revealed on message hover. */
function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

function MessageRow({
  message,
  agentName,
  delay,
  isLastFrank,
  typing,
  onRegenerate,
  onEdit,
}: {
  message: ChatMessage;
  agentName: string;
  delay: number;
  isLastFrank: boolean;
  typing: boolean;
  onRegenerate?: () => void;
  onEdit?: (message: ChatMessage) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!message.text) return;
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      // Clipboard API can be unavailable in insecure contexts — degrade silently.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

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
        className="msg-max group animate-msg-in flex flex-col items-end gap-1.5 self-end"
        style={{ animationDelay: `${delay}s` }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Steve</span>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tr-[4px] bg-ink px-[15px] py-3 text-[13.5px] leading-[1.5] text-white shadow-sm">
          {message.text}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <ActionButton label="Copy message" onClick={copy}>
            {copied ? <IconCheck size={13} className="text-acid" /> : <IconCopy size={13} />}
          </ActionButton>
          {onEdit && !typing && (
            <ActionButton label="Edit message" onClick={() => onEdit(message)}>
              <IconEdit size={13} />
            </ActionButton>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="msg-max group animate-msg-in flex flex-col gap-1.5 self-start"
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
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <ActionButton label="Copy response" onClick={copy}>
          {copied ? <IconCheck size={13} className="text-acid" /> : <IconCopy size={13} />}
        </ActionButton>
        {onRegenerate && isLastFrank && !typing && (
          <ActionButton label="Regenerate response" onClick={onRegenerate}>
            <IconRefresh size={13} />
          </ActionButton>
        )}
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

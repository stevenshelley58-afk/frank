'use client';

import { useEffect, useRef, useState } from 'react';
import { Markdown } from '@/components/markdown';
import type { ChatMessageRow, DelegationMeta, WorkingMeta } from '@/lib/chat-api';

type TurnProof = {
  requested_model?: unknown;
  model?: unknown;
  model_provider?: unknown;
  expected_model?: unknown;
  model_mismatch?: unknown;
  harness?: unknown;
  pack_hash?: unknown;
};

interface ChatThreadProps {
  messages: ChatMessageRow[];
  /** Text arriving from the SSE bridge for a reply that has not landed yet. */
  streamingText: string | null;
  agentLabel: string;
  tint: string;
  projectName: (projectId: string) => string;
  onFollowDelegation: (projectId: string) => void;
}

/**
 * The thread. Bottom-anchored: a short conversation sits against the composer
 * with the empty space above it, the way a chat should feel.
 */
export function ChatThread({
  messages,
  streamingText,
  agentLabel,
  tint,
  projectName,
  onFollowDelegation,
}: ChatThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, streamingText]);

  return (
    <div
      ref={scrollerRef}
      onScroll={() => {
        const el = scrollerRef.current;
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="chat-scroll min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-end gap-4 px-6 pb-4 pt-7">
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            agentLabel={agentLabel}
            tint={tint}
            projectName={projectName}
            onFollowDelegation={onFollowDelegation}
          />
        ))}
        {streamingText !== null && (
          <div className="animate-msg-in flex flex-col gap-1.5 self-stretch">
            <AgentLabel label={agentLabel} tint={tint} />
            <div className="text-[14px] leading-[1.62] text-ink">
              {streamingText}
              <span className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] rounded-[2px] bg-accent align-baseline" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MessageRow({
  message,
  agentLabel,
  tint,
  projectName,
  onFollowDelegation,
}: {
  message: ChatMessageRow;
  agentLabel: string;
  tint: string;
  projectName: (projectId: string) => string;
  onFollowDelegation: (projectId: string) => void;
}) {
  if (message.kind === 'user') {
    return (
      <div className="animate-msg-in flex max-w-[82%] flex-col items-end gap-1.5 self-end">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted/80">
          Steve
        </span>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tr-[4px] bg-ink px-[15px] py-3 text-[13.5px] leading-[1.55] text-white">
          {message.body}
        </div>
      </div>
    );
  }

  if (message.kind === 'agent') {
    const proof = message.meta as TurnProof;
    return (
      <div className="animate-msg-in flex flex-col gap-1.5 self-stretch">
        <AgentLabel label={agentLabel} tint={tint} />
        <div className="text-[14px] leading-[1.62] text-ink">
          <Markdown text={message.body} />
        </div>
        <TurnProofCard proof={proof} />
      </div>
    );
  }

  if (message.kind === 'working') return <WorkingCard message={message} />;
  if (message.kind === 'thinking') return <ThinkingCard message={message} />;

  if (message.kind === 'delegation') {
    const meta = message.meta as DelegationMeta;
    const target = meta.to_project ?? meta.from_project ?? null;
    return (
      <div
        className="animate-msg-in flex items-center gap-2.5 self-stretch rounded-xl border border-line bg-card px-3.5 py-2.5"
        style={{ borderLeft: `3px solid ${tint}` }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className="flex-1 text-[12.5px] leading-snug text-ink2">{message.body}</span>
        {meta.inbound !== true && target !== null && (
          <button
            onClick={() => onFollowDelegation(target)}
            className="shrink-0 rounded-[7px] border border-line bg-shell px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors hover:border-accent"
            style={{ color: tint }}
          >
            Follow →
          </button>
        )}
        {target !== null && meta.inbound === true && (
          <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
            {projectName(target)}
          </span>
        )}
      </div>
    );
  }

  // receipt
  return (
    <div className="animate-msg-in flex items-start gap-2.5 self-stretch rounded-xl border border-success/30 bg-success/[0.06] px-3.5 py-2.5 text-[12.5px] leading-snug text-ink2">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-success">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>{message.body}</span>
    </div>
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A completed-turn receipt: it reports the terminal SSE facts only. */
function TurnProofCard({ proof }: { proof: TurnProof }) {
  const requested = text(proof.requested_model);
  const model = text(proof.model);
  const provider = text(proof.model_provider);
  const harness = text(proof.harness);
  const packHash = text(proof.pack_hash);
  const expected = text(proof.expected_model);
  const mismatch = proof.model_mismatch === true;

  if (!requested && !model && !harness && !packHash) return null;

  const actual = [model, provider].filter(Boolean).join(' · ');
  return (
    <div
      className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 font-mono text-[9.5px] ${
        mismatch ? 'border-warning/40 bg-warning/5 text-warning' : 'border-line bg-subtle text-muted'
      }`}
    >
      <span className="font-semibold uppercase tracking-[0.08em]">Route proof</span>
      {requested && <span>requested {requested}</span>}
      {actual && <span>ran {actual}</span>}
      {harness && <span>via {harness}</span>}
      {packHash && <span title={packHash}>pack {packHash.slice(0, 12)}</span>}
      {mismatch && <span className="font-semibold" role="status" aria-live="polite">Model mismatch{expected ? ` — expected ${expected}` : ''}</span>}
    </div>
  );
}

function AgentLabel({ label, tint }: { label: string; tint: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted/80">
      <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: tint }} aria-hidden />
      {label}
    </span>
  );
}

function WorkingCard({ message }: { message: ChatMessageRow }) {
  const meta = message.meta as WorkingMeta;
  const [open, setOpen] = useState(false);
  const steps = meta.steps ?? [];
  const done = meta.done === true;

  return (
    <div className="animate-msg-in self-stretch overflow-hidden rounded-xl border border-line bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-hover"
      >
        {done ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-success">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <Spinner />
        )}
        <span className="flex-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
          {meta.label ?? (done ? 'Done' : 'Working')}
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
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && steps.length > 0 && (
        <div className="border-t border-line px-3.5 pb-3 pt-2">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-2.5 py-1 font-mono text-[11.5px] ${
                s.state === 'pending' ? 'text-muted/70' : 'text-ink2'
              }`}
            >
              {s.state === 'done' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-success">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : s.state === 'run' ? (
                <Spinner size={11} />
              ) : (
                <span className="w-[11px] shrink-0" />
              )}
              <span>{s.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingCard({ message }: { message: ChatMessageRow }) {
  const [open, setOpen] = useState(false);
  const secs = typeof message.meta.secs === 'number' ? message.meta.secs : null;

  return (
    <div className="animate-msg-in self-stretch">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted/80 transition-colors hover:text-ink2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2z" />
        </svg>
        <span>{secs === null ? 'Thought' : `Thought for ${secs}s`}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="ml-[5px] border-l-2 border-line py-1 pl-3 text-[12.5px] italic leading-[1.6] text-muted">
          {message.body}
        </div>
      )}
    </div>
  );
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      className="shrink-0 animate-spin rounded-full border-2 border-line border-t-running"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

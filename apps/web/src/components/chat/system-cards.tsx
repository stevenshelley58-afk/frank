'use client';

import { useState } from 'react';
import type { ChatMessageRow, DelegationMeta, WorkingMeta } from '@/lib/chat-api';

/**
 * System cards for the non-bubble message kinds (working / thinking /
 * delegation / receipt). These are status rows, not chat bubbles: they ride
 * through the assistant-ui thread as `system`-role messages (the original row
 * is carried in `metadata.custom.row`) and render here, keeping their place
 * in the ordered thread without pretending to be assistant prose.
 */

export function SystemCard({
  row,
  projectName,
  onFollowDelegation,
}: {
  row: ChatMessageRow;
  projectName: (projectId: string) => string;
  onFollowDelegation: (projectId: string) => void;
}) {
  if (row.kind === 'working') return <WorkingCard message={row} />;
  if (row.kind === 'thinking') return <ThinkingCard message={row} />;
  if (row.kind === 'delegation') {
    return <DelegationCard message={row} projectName={projectName} onFollowDelegation={onFollowDelegation} />;
  }
  return <ReceiptCard message={row} />;
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

function DelegationCard({
  message,
  projectName,
  onFollowDelegation,
}: {
  message: ChatMessageRow;
  projectName: (projectId: string) => string;
  onFollowDelegation: (projectId: string) => void;
}) {
  const meta = message.meta as DelegationMeta;
  const target = meta.to_project ?? meta.from_project ?? null;
  return (
    <div
      className="animate-msg-in flex items-center gap-2.5 self-stretch rounded-xl border border-line bg-card px-3.5 py-2.5"
      style={{ borderLeft: '3px solid var(--color-accent)' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent">
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
      <span className="flex-1 text-[12.5px] leading-snug text-ink2">{message.body}</span>
      {meta.inbound !== true && target !== null && (
        <button
          onClick={() => onFollowDelegation(target)}
          className="shrink-0 rounded-[7px] border border-line bg-shell px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-accent transition-colors hover:border-accent"
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

function ReceiptCard({ message }: { message: ChatMessageRow }) {
  return (
    <div className="animate-msg-in flex items-start gap-2.5 self-stretch rounded-xl border border-success/30 bg-success/[0.06] px-3.5 py-2.5 text-[12.5px] leading-snug text-ink2">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-success">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>{message.body}</span>
    </div>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      className="shrink-0 animate-spin rounded-full border-2 border-line border-t-running"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

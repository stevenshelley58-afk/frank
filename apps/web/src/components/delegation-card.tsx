'use client';

import { actOnDelegation, type Delegation } from '@/lib/use-delegations';
import { IconBolt } from './icons';

/**
 * One delegation, rendered in a thread — server-derived, never appended to
 * the messages array. Proposals carry Send-it/No; running rows stream partial
 * text; finished rows show the receipt. Styling mirrors thread.tsx's
 * mention-strip + frank-card treatment (no new colours).
 */
export function DelegationCard({ d, view }: { d: Delegation; view: 'central' | 'room' }) {
  if (d.status === 'proposed') {
    return (
      <div className="animate-msg-in self-stretch rounded-xl border border-dashed border-[#b08a3e]/55 bg-[#b08a3e]/10 px-3.5 py-2.5 text-[12px] leading-snug text-ink2">
        <div className="flex items-center gap-2.5">
          <IconBolt size={14} className="shrink-0 text-[#b08a3e]" />
          <div className="min-w-0 flex-1">
            <b className="text-ink">Send to {d.agent}?</b>
            <div className="mt-0.5 text-ink2">{d.task}</div>
            {d.why && <div className="mt-0.5 text-muted">Why: {d.why}</div>}
          </div>
        </div>
        <div className="mt-2 flex gap-2 pl-[24px]">
          <button
            type="button"
            className="rounded-md bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-85"
            onClick={() => actOnDelegation(d.id, 'approve')}
          >
            Send it
          </button>
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted transition-colors hover:text-ink"
            onClick={() => actOnDelegation(d.id, 'reject')}
          >
            No
          </button>
        </div>
      </div>
    );
  }

  if (d.status === 'rejected') {
    return (
      <div className="animate-msg-in self-stretch rounded-xl border border-dashed border-line px-3.5 py-2 text-[12px] text-muted">
        Dismissed — {d.task}
      </div>
    );
  }

  if (d.status === 'running') {
    return (
      <div className="animate-msg-in self-stretch rounded-xl border border-line bg-card px-3.5 py-2.5 text-[12px] leading-snug text-ink2">
        <div className="flex items-center gap-2.5">
          <span className="typing-dot shrink-0 !bg-accent" />
          <div className="min-w-0 flex-1">
            <b className="text-ink">
              {view === 'central' ? `Running in ${d.toRoomName}` : 'From Central'}
            </b>
            <div className="mt-0.5 text-ink2">{d.task}</div>
            {d.partial && (
              <div className="mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap text-muted">
                {d.partial}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (d.status === 'error') {
    return (
      <div className="animate-msg-in self-stretch rounded-xl border border-[#c0563a]/55 bg-[#c0563a]/10 px-3.5 py-2.5 text-[12px] leading-snug text-ink2">
        <div className="flex items-center gap-2.5">
          <IconBolt size={14} className="shrink-0 text-[#c0563a]" />
          <div className="min-w-0 flex-1">
            <b className="text-ink">{d.agent} hit a snag</b>
            <div className="mt-0.5 text-ink2">{d.error}</div>
          </div>
        </div>
      </div>
    );
  }

  // done — the verified receipt strip.
  return (
    <div className="mention-strip animate-msg-in self-stretch px-3.5 py-2.5 text-[12px] leading-snug text-ink2">
      <div className="flex items-start gap-2.5">
        <IconBolt size={14} className="mt-0.5 shrink-0 text-acid" />
        <div className="min-w-0 flex-1">
          <b className="text-ink">
            Receipt from {d.agent}
          </b>
          <div className="mt-0.5 whitespace-pre-wrap text-ink2">{d.result}</div>
        </div>
      </div>
    </div>
  );
}

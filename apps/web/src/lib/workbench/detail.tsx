'use client';

/**
 * Workbench detail view (UI-07): raw event log + artifacts + receipt.
 *
 * Contract rule: "Raw events live in the detail view; chat gets handoff +
 * receipt only." This surface is the evidence drawer for a run.
 */

import { useEffect, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { LifecycleBadge, StreamStatusChip, WaitingLink } from './components';
import type { WorkbenchRunState } from './run-state';
import { deriveLifecycle, stepProgress } from './run-state';
import type { WorkbenchEvent, WorkbenchEventType } from './types';

const EVENT_TONE: Partial<Record<WorkbenchEventType, string>> = {
  completed: 'text-success',
  receipt_published: 'text-success',
  failed: 'text-[#DC2626]',
  timed_out: 'text-[#DC2626]',
  cancelled: 'text-muted/70',
  decision_requested: 'text-[#b45309]',
  paused: 'text-[#b45309]',
  stop_requested: 'text-[#DC2626]',
};

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(11, 19); // HH:MM:SS (UTC)
}

export function EventLog({ events, compact }: { events: WorkbenchEvent[]; compact?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div ref={wrapRef}>
      <ScrollArea className={compact ? 'h-56' : 'h-[420px]'}>
        <ol className="space-y-0.5 p-3 font-mono text-[11px] leading-relaxed" aria-label="Workbench event log">
          {events.map((e) => (
            <li key={e.seq} className="flex gap-2 rounded px-1 py-0.5 hover:bg-subtle">
              <span className="w-8 shrink-0 text-right text-muted/50">#{e.seq}</span>
              <span className="w-16 shrink-0 text-muted/70">{fmtClock(e.at)}</span>
              <span className={cn('shrink-0', EVENT_TONE[e.type] ?? 'text-ink2')}>{e.type}</span>
              <span className="min-w-0 truncate text-muted/80">
                {summarizePayload(e)}
              </span>
            </li>
          ))}
        </ol>
      </ScrollArea>
    </div>
  );
}

function summarizePayload(e: WorkbenchEvent): string {
  switch (e.type) {
    case 'step_updated':
      return `step ${e.payload.step} → ${e.payload.state}${e.payload.note ? ` — ${e.payload.note}` : ''}`;
    case 'decision_requested':
      return e.payload.question ?? 'decision requested';
    case 'artifact_registered':
      return e.payload.name ?? e.payload.id ?? 'artifact';
    case 'paused':
      return e.payload.reason ?? '';
    case 'stop_requested':
      return e.payload.reason ?? '';
    case 'failed':
      return e.payload.error ?? '';
    case 'plan_published': {
      const steps = e.payload.steps;
      if (Array.isArray(steps)) return `${steps.length} steps`;
      return typeof e.payload.total === 'number' ? `${e.payload.total} steps` : '';
    }
    default:
      return '';
  }
}

export function ArtifactsPanel({ state }: { state: WorkbenchRunState }) {
  if (state.artifacts.length === 0) {
    return <p className="px-4 py-3 text-[12px] text-muted">No artifacts registered yet.</p>;
  }
  return (
    <ul className="divide-y divide-line" aria-label="Registered artifacts">
      {state.artifacts.map((a) => (
        <li key={`${a.seq}-${a.id ?? a.name ?? ''}`} className="flex items-center gap-3 px-4 py-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-line bg-subtle font-mono text-[10px] uppercase text-muted">
            {(a.kind ?? 'file').slice(0, 3)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-ink">{a.name ?? a.id ?? 'artifact'}</p>
            {a.path && <p className="truncate font-mono text-[10.5px] text-muted">{a.path}</p>}
          </div>
          <span className="font-mono text-[10px] text-muted/60">#{a.seq}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReceiptPanel({ state }: { state: WorkbenchRunState }) {
  const receipt = state.receipt;
  if (!receipt) {
    return (
      <p className="px-4 py-3 text-[12px] text-muted">
        No receipt yet — published once the run completes.
      </p>
    );
  }
  return (
    <div className="space-y-3 p-4 text-[12.5px]">
      {receipt.summary && <ReceiptRow label="Summary" value={receipt.summary} />}
      {receipt.whatDone && <ReceiptRow label="What was done" value={receipt.whatDone} />}
      {receipt.found && <ReceiptRow label="What was found" value={receipt.found} />}
      {receipt.decisions && receipt.decisions.length > 0 && (
        <ReceiptRow label="Decisions" value={receipt.decisions} list />
      )}
      {receipt.assumptions && receipt.assumptions.length > 0 && (
        <ReceiptRow label="Assumptions" value={receipt.assumptions} list />
      )}
      {receipt.evidence && receipt.evidence.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">Evidence</p>
          <ul className="mt-1 space-y-0.5">
            {receipt.evidence.map((link, i) => (
              <li key={i} className="font-mono text-[11px] text-accent">
                {link}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(receipt.publishedAt || receipt.publishedBy) && (
        <p className="font-mono text-[10px] text-muted/70">
          Published{receipt.publishedBy ? ` by ${receipt.publishedBy}` : ''}
          {receipt.publishedAt ? ` at ${receipt.publishedAt}` : ''}
        </p>
      )}
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  list,
}: {
  label: string;
  value: string | string[];
  list?: boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted">{label}</p>
      {list && Array.isArray(value) ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink2">
          {value.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-ink2">{Array.isArray(value) ? value.join('; ') : value}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Full detail panel — header + raw events + artifacts + receipt        */
/* ------------------------------------------------------------------ */

export function WorkbenchDetailPanel({
  title,
  roomName,
  state,
  streamStatus,
  children,
}: {
  title: string;
  roomName: string;
  state: WorkbenchRunState;
  streamStatus: string;
  children?: React.ReactNode;
}) {
  const lifecycle = deriveLifecycle(state);
  const progress = stepProgress(state);
  const waiting = lifecycle === 'paused' && state.waiting;

  return (
    <section aria-label={`Workbench detail: ${title}`} className="rounded-xl border border-line bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="rounded-full border border-line bg-subtle px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
          {roomName}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{title}</h2>
        <Badge variant="secondary" className="h-6 font-mono text-[10px]">
          step {progress.current || '–'}/{progress.total ?? '–'}
        </Badge>
        <LifecycleBadge lifecycle={lifecycle} />
        <StreamStatusChip status={streamStatus} />
      </header>

      {waiting && state.waiting && (
        <div className="border-b border-line px-4 py-3">
          <WaitingLink waiting={state.waiting} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
          <p className="border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted">
            Raw event log ({state.events.length})
          </p>
          <EventLog events={state.events} />
        </div>
        <div className="min-w-0">
          <p className="border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted">
            Artifacts ({state.artifacts.length})
          </p>
          <ArtifactsPanel state={state} />
          <p className="border-y border-line px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted">
            Receipt
          </p>
          <ReceiptPanel state={state} />
        </div>
      </div>

      {children}
    </section>
  );
}

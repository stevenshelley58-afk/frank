'use client';

/**
 * Workbench surface primitives (UI-07).
 *
 * Design rules from the frozen contract + plan:
 *  - Running entry: room, task, step k/n, active step note, elapsed, Stop.
 *  - Waiting surface links the decision work item — it NEVER renders a
 *    second approval state machine (resolution lives on the work item via
 *    the command envelope).
 *  - Stop goes through the same-origin BFF with a command id + reason. We
 *    never fake a terminal state client-side; the backend's SSE events do that.
 *
 * All keyboard-accessible: every interactive element is a real <button> or
 * <a>; the list supports ArrowUp/ArrowDown/Home/End navigation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { WaitingDecision, WorkbenchLifecycle, WorkbenchRunState } from './run-state';

/* ------------------------------------------------------------------ */
/* Lifecycle badge                                                      */
/* ------------------------------------------------------------------ */

const LIFECYCLE_META: Record<string, { label: string; className: string }> = {
  provisioning: { label: 'provisioning', className: 'bg-accent/10 text-accent' },
  running: { label: 'running', className: 'bg-success/10 text-success' },
  paused: { label: 'waiting', className: 'bg-[#f59e0b]/10 text-[#b45309]' },
  stopping: { label: 'stopping', className: 'bg-[#f59e0b]/10 text-[#b45309]' },
  completed: { label: 'completed', className: 'bg-success/10 text-success' },
  failed: { label: 'failed', className: 'bg-[#DC2626]/10 text-[#DC2626]' },
  cancelled: { label: 'cancelled', className: 'bg-muted/10 text-muted/60' },
  timed_out: { label: 'timed out', className: 'bg-[#DC2626]/10 text-[#DC2626]' },
  unknown: { label: 'connecting…', className: 'bg-muted/20 text-muted' },
};

export function LifecycleBadge({ lifecycle }: { lifecycle: WorkbenchLifecycle | 'unknown' }) {
  const meta = LIFECYCLE_META[lifecycle] ?? LIFECYCLE_META.unknown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
        meta.className,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current',
          (lifecycle === 'running' || lifecycle === 'provisioning') && 'animate-pulse',
        )}
      />
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Step k/n                                                             */
/* ------------------------------------------------------------------ */

export function StepProgress({ current, total }: { current: number; total: number | null }) {
  return (
    <span className="font-mono text-[12px] tabular-nums text-ink2" aria-live="polite">
      step <b className="font-semibold">{current || '–'}</b>
      <span className="text-muted"> / {total ?? '–'}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stop button                                                          */
/* ------------------------------------------------------------------ */

export function StopWorkbenchButton({
  disabled,
  stopping,
  onStop,
}: {
  disabled?: boolean;
  stopping?: boolean;
  onStop: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const handle = useCallback(async () => {
    setPending(true);
    try {
      await onStop();
    } finally {
      setPending(false);
    }
  }, [onStop]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handle}
      disabled={disabled || pending || stopping}
      aria-label="Stop this workbench run"
      className={cn(
        'h-7 gap-1.5 border-[#DC2626]/30 px-2.5 text-[12px] text-[#DC2626]',
        'hover:bg-[#DC2626]/10 hover:text-[#DC2626] focus-visible:ring-[#DC2626]/40',
      )}
    >
      <span className="h-2 w-2 rounded-[3px] bg-current" aria-hidden />
      {pending || stopping ? 'Stopping…' : 'Stop'}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Running entry — the card row shown in the Running console           */
/*                                                                     */
/* A11y shape: the row is a plain list item. The two interactive       */
/* affordances are real buttons — "open details" (the title) and Stop —*/
/* so there are no nested interactive elements. List-level arrow-key   */
/* navigation moves focus across rows (see RunningList).               */
/* ------------------------------------------------------------------ */

export interface RunningEntryProps {
  roomName: string;
  taskTitle: string;
  state: WorkbenchRunState;
  lifecycle: WorkbenchLifecycle | 'unknown';
  progress: { current: number; total: number | null };
  elapsedLabel: string;
  isTerminal: boolean;
  selected?: boolean;
  onOpen?: () => void;
  onStop?: () => void | Promise<void>;
}

export function RunningEntry({
  roomName,
  taskTitle,
  state,
  lifecycle,
  progress,
  elapsedLabel,
  isTerminal,
  selected,
  onOpen,
  onStop,
}: RunningEntryProps) {
  const isWaiting = lifecycle === 'paused' && !isTerminal;
  return (
    <div
      role="listitem"
      data-selected={selected || undefined}
      aria-label={`Workbench ${taskTitle}, ${lifecycle}, step ${progress.current} of ${progress.total ?? 'unknown'}`}
      className={cn(
        'rounded-xl border bg-white px-4 py-3 transition-colors',
        selected ? 'border-accent/50' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-line bg-subtle px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
          {roomName}
        </span>
        <LifecycleBadge lifecycle={lifecycle} />
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted" aria-label={`Elapsed ${elapsedLabel}`}>
          {elapsedLabel}
        </span>
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              data-row-open
              className="block max-w-full truncate text-left text-[13px] font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
              aria-label={`Open details for ${taskTitle}`}
            >
              {taskTitle}
            </button>
          ) : (
            <p className="truncate text-[13px] font-medium text-ink">{taskTitle}</p>
          )}
          <div className="mt-1 flex items-center gap-3">
            <StepProgress current={progress.current} total={progress.total} />
            {state.activeStepNote && !isTerminal && (
              <span className="min-w-0 truncate text-[12px] text-muted" aria-live="polite">
                {state.activeStepNote}
              </span>
            )}
          </div>
          {isWaiting && state.waiting && <WaitingLink waiting={state.waiting} className="mt-2" />}
        </div>

        {onStop && !isTerminal && (
          <StopWorkbenchButton onStop={onStop} stopping={lifecycle === 'stopping'} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Waiting surface — links the decision work item, never a second       */
/* approval state machine.                                              */
/* ------------------------------------------------------------------ */

export function WaitingLink({ waiting, className }: { waiting: WaitingDecision; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/5 px-3 py-2',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-[#b45309]">
          Waiting on decision
        </span>
        {waiting.workItemId && (
          <a
            href={`/console/tasks?work=${encodeURIComponent(waiting.workItemId)}`}
            className="rounded font-mono text-[11px] font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open decision work item ${waiting.workItemId}`}
          >
            {waiting.workItemId}
          </a>
        )}
      </div>
      {waiting.question && <p className="mt-1 text-[12.5px] text-ink2">{waiting.question}</p>}
      {waiting.whyNow && <p className="mt-0.5 text-[11.5px] text-muted">Why now: {waiting.whyNow}</p>}
      <p className="mt-1 text-[10.5px] italic text-muted/70">
        Resolve it on the work item — the workbench stays paused.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List navigation — ArrowUp/Down/Home/End moves focus across the      */
/* row-open buttons; the list itself owns the keydown handler.         */
/* ------------------------------------------------------------------ */

export function useListNavigation(count: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (count === 0) return;
    if (active >= count) setActive(count - 1);
  }, [count, active]);

  const focusRow = useCallback((index: number) => {
    const el = containerRef.current?.querySelectorAll<HTMLElement>('[data-row-open]')[index];
    el?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return;
      let next = -1;
      switch (e.key) {
        case 'ArrowDown':
          next = Math.min(active + 1, count - 1);
          break;
        case 'ArrowUp':
          next = Math.max(active - 1, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = count - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      setActive(next);
      focusRow(next);
    },
    [count, active, focusRow],
  );

  return { active, setActive, onKeyDown, containerRef };
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1 text-[12px] text-muted">{body}</p>}
    </div>
  );
}

export function StreamStatusChip({ status }: { status: string }) {
  const live = status === 'open';
  const reconnecting = status === 'reconnecting' || status === 'connecting';
  return (
    <Badge
      variant="secondary"
      className={cn(
        'h-6 gap-1.5 font-mono text-[10px] uppercase tracking-wide',
        live && 'bg-success/10 text-success',
        reconnecting && 'bg-[#f59e0b]/10 text-[#b45309]',
        status === 'stopped' && 'bg-muted/10 text-muted',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', reconnecting && 'animate-pulse')} />
      {status}
    </Badge>
  );
}

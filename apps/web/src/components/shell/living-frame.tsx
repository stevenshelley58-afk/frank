'use client';

import { useEffect, useState } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { PendingDecision } from '@/lib/chat-api';
import type { TodayResponse } from '@/lib/api';
import type { FrameResponse, FrameRunning, FrameReceipt } from '@/lib/frame';
import type { CalendarEvent } from '@/lib/use-calendar';
import { clockTime, TIME_ZONE } from '@/lib/time';

/* ------------------------------------------------------------------ */

interface LivingFrameProps {
  desktopOpen: boolean;
  mobileOpen: boolean;
  decisions: PendingDecision[];
  frame: FrameResponse | null;
  frameError: string | null;
  today: TodayResponse | null;
  todayError: string | null;
  calendarEvents: CalendarEvent[];
  calendarStatus: 'connected' | 'not_connected' | 'error';
  calendarLoading: boolean;
  calendarError: string | null;
  projectName: (projectId: string) => string;
  onDesktopToggle: () => void;
  onMobileOpenChange: (open: boolean) => void;
  onOpenConversation: (id: string) => void;
  onResolve: (decision: PendingDecision, outcome: 'ready' | 'cancel') => void;
  onRetry: () => void;
  onRetryToday: () => void;
  activeChatId: string | null;
  activeChatStreaming: boolean;
  onStopActiveChat: () => void;
  onStopWorkbench: (id: string) => void;
  onStopMission: (id: string) => void;
}

/**
 * The living frame — a persistent, collapsible column of signals.
 *
 * It answers three questions without you asking: what is blocked on me, what is
 * running, what just finished. Collapsed it keeps only the counts, so quiet
 * costs 47px instead of going blind.
 */
export function LivingFrame(props: LivingFrameProps) {
  const {
  desktopOpen,
  mobileOpen,
  decisions,
  frame,
  frameError,
  today,
  todayError,
  calendarEvents,
  calendarStatus,
  calendarLoading,
  calendarError,
  projectName,
  onDesktopToggle,
  onMobileOpenChange,
  onOpenConversation,
  onResolve,
  onRetry,
  onRetryToday,
  activeChatId,
  activeChatStreaming,
  onStopActiveChat,
  onStopWorkbench,
  onStopMission,
  } = props;
  const running = frame?.running ?? [];
  const receipts = frame?.receipts ?? [];
  if (!desktopOpen) {
    return (
      <>
      <aside className="hidden w-[47px] shrink-0 flex-col border-l border-line bg-rail lg:flex">
        <div className="flex h-[54px] shrink-0 items-center justify-center border-b border-line">
          <button
            onClick={onDesktopToggle}
            aria-label="Expand the living frame"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m11 17-5-5 5-5" />
              <path d="m18 17-5-5 5-5" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col items-center gap-2 py-3">
          <MiniSignal label="Waiting on you" count={decisions.length} onClick={onDesktopToggle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </MiniSignal>
          <MiniSignal label="Running" pulse={running.length > 0} onClick={onDesktopToggle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </MiniSignal>
        </div>
      </aside>
      <LivingFrameMobileSheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <FrameContent props={props} />
      </LivingFrameMobileSheet>
      </>
    );
  }

  return (
    <>
    <aside className="hidden w-[318px] shrink-0 flex-col border-l border-line bg-rail lg:flex">
      <div className="flex h-[54px] shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/80">
          Living frame
        </span>
        <button
          onClick={onDesktopToggle}
          aria-label="Collapse the living frame"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m13 17 5-5-5-5" />
            <path d="m6 17 5-5-5-5" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {frameError && (
          <div role="status" className="rounded-[14px] border border-warning/30 bg-warning/5 px-3.5 py-3 text-[12px] text-warning">
            Living Frame is unavailable — {frameError}
            <button onClick={onRetry} className="ml-2 font-semibold underline">Retry</button>
          </div>
        )}
        <Card title="Waiting on you" count={decisions.length}>
          {decisions.length === 0 ? (
            <Empty>Nothing needs your decision.</Empty>
          ) : (
            decisions.map((d) => (
              <div key={d.id} className="border-b border-line py-2 last:border-b-0">
                <div className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[12.5px] font-semibold text-ink">{d.title}</b>
                    {d.whyNow !== '' && (
                      <span className="mt-px block truncate font-mono text-[9.5px] text-muted">
                        {d.whyNow}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => onResolve(d, 'ready')}
                    className="h-[26px] shrink-0 rounded-[7px] bg-accent px-2.5 text-[11px] font-semibold text-white transition-[filter] hover:brightness-110"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onResolve(d, 'cancel')}
                    title="Decline"
                    aria-label={`Decline ${d.title}`}
                    className="h-[26px] shrink-0 rounded-[7px] border border-line px-2 text-[11px] font-medium text-muted transition-colors hover:border-danger hover:text-danger"
                  >
                    No
                  </button>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card title="Running now" count={running.length}>
          {frame === null && !frameError ? (
            <Empty>Loading the authoritative frame…</Empty>
          ) : running.length === 0 ? (
            <Empty>Nothing mid-flight.</Empty>
          ) : (
            running.map((item) => <RunningRow key={`${item.kind}:${item.id}`} item={item} projectName={projectName} onOpenConversation={onOpenConversation} activeChatId={activeChatId} activeChatStreaming={activeChatStreaming} onStopActiveChat={onStopActiveChat} onStopWorkbench={onStopWorkbench} onStopMission={onStopMission} />)
          )}
        </Card>

        <Card title="Today">
          <TodayList today={today} todayError={todayError} calendarEvents={calendarEvents} calendarStatus={calendarStatus} calendarLoading={calendarLoading} calendarError={calendarError} onRetry={onRetryToday} />
        </Card>

        <Card title="Receipts">
          {frame === null && !frameError ? (
            <Empty>Loading the authoritative frame…</Empty>
          ) : receipts.length === 0 ? (
            <Empty>Nothing finished yet today.</Empty>
          ) : (
            receipts.slice(0, 4).map((receipt) => <ReceiptRow key={receipt.kind === 'chat' ? receipt.message_id : receipt.workbench_id} receipt={receipt} onOpenConversation={onOpenConversation} />)
          )}
        </Card>
      </div>
    </aside>
    <LivingFrameMobileSheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
      <FrameContent props={props} />
    </LivingFrameMobileSheet>
    </>
  );
}

/* ------------------------------------------------------------------ */

function LivingFrameMobileSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const close = () => {
    if (open) onOpenChange(false);
    window.setTimeout(() => document.getElementById('living-frame-trigger')?.focus(), 0);
  };

  if (!isMobile) return null;

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); else onOpenChange(true); }}>
        <SheetContent id="living-frame-sheet" side="right" aria-label="Living frame" className="flex flex-col w-[min(22rem,calc(100vw-1rem))] border-line bg-rail p-0">
          <SheetTitle className="sr-only">Living frame</SheetTitle>
          <SheetDescription className="sr-only">Current decisions, running work, today, and receipts.</SheetDescription>
          {children}
        </SheetContent>
      </Sheet>
  );
}

function FrameContent({ props }: { props: LivingFrameProps }) {
  const {
    decisions, frame, frameError, today, todayError, calendarEvents, calendarStatus,
    calendarLoading, calendarError, projectName, onOpenConversation, onResolve, onRetry,
    onRetryToday, activeChatId, activeChatStreaming, onStopActiveChat, onStopWorkbench,
    onStopMission,
  } = props;
  const running = frame?.running ?? [];
  const receipts = frame?.receipts ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {frameError && (
        <div role="status" className="rounded-[14px] border border-warning/30 bg-warning/5 px-3.5 py-3 text-[12px] text-warning">
          Living Frame is unavailable — {frameError}
          <button onClick={onRetry} className="ml-2 font-semibold underline">Retry</button>
        </div>
      )}
      <Card title="Waiting on you" count={decisions.length}>
        {decisions.length === 0 ? <Empty>Nothing needs your decision.</Empty> : decisions.map((decision) => (
          <div key={decision.id} className="border-b border-line py-2 last:border-b-0">
            <div className="flex items-center gap-2.5">
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[12.5px] font-semibold text-ink">{decision.title}</b>
                {decision.whyNow !== '' && <span className="mt-px block truncate font-mono text-[9.5px] text-muted">{decision.whyNow}</span>}
              </span>
              <button onClick={() => onResolve(decision, 'ready')} className="h-[26px] shrink-0 rounded-[7px] bg-accent px-2.5 text-[11px] font-semibold text-white transition-[filter] hover:brightness-110">Approve</button>
              <button onClick={() => onResolve(decision, 'cancel')} title="Decline" aria-label={`Decline ${decision.title}`} className="h-[26px] shrink-0 rounded-[7px] border border-line px-2 text-[11px] font-medium text-muted transition-colors hover:border-danger hover:text-danger">No</button>
            </div>
          </div>
        ))}
      </Card>
      <Card title="Running now" count={running.length}>
        {frame === null && !frameError ? <Empty>Loading the authoritative frame…</Empty> : running.length === 0 ? <Empty>Nothing mid-flight.</Empty> : running.map((item) => <RunningRow key={`${item.kind}:${item.id}`} item={item} projectName={projectName} onOpenConversation={onOpenConversation} activeChatId={activeChatId} activeChatStreaming={activeChatStreaming} onStopActiveChat={onStopActiveChat} onStopWorkbench={onStopWorkbench} onStopMission={onStopMission} />)}
      </Card>
      <Card title="Today"><TodayList today={today} todayError={todayError} calendarEvents={calendarEvents} calendarStatus={calendarStatus} calendarLoading={calendarLoading} calendarError={calendarError} onRetry={onRetryToday} /></Card>
      <Card title="Receipts">
        {frame === null && !frameError ? <Empty>Loading the authoritative frame…</Empty> : receipts.length === 0 ? <Empty>Nothing finished yet today.</Empty> : receipts.slice(0, 4).map((receipt) => <ReceiptRow key={receipt.kind === 'chat' ? receipt.message_id : receipt.workbench_id} receipt={receipt} onOpenConversation={onOpenConversation} />)}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RunningRow({ item, projectName, onOpenConversation, activeChatId, activeChatStreaming, onStopActiveChat, onStopWorkbench, onStopMission }: {
  item: FrameRunning;
  projectName: (projectId: string) => string;
  onOpenConversation: (id: string) => void;
  activeChatId: string | null;
  activeChatStreaming: boolean;
  onStopActiveChat: () => void;
  onStopWorkbench: (id: string) => void;
  onStopMission: (id: string) => void;
}) {
  const title = item.kind === 'chat' ? item.title : item.kind === 'mission' ? item.objective : `Workbench ${item.work_item_id}`;
  const sub = item.kind === 'chat' ? `${projectName(item.project_id)} · chat` : item.kind === 'mission' ? `${item.room_name} · ${item.state}` : `${item.state} · workbench`;
  const canOpen = item.kind === 'chat';
  const stop = item.kind === 'workbench' ? () => onStopWorkbench(item.id) : item.kind === 'mission' ? () => onStopMission(item.id) : item.id === activeChatId && activeChatStreaming ? onStopActiveChat : null;
  return <div className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0">
    <span className="animate-pip h-2 w-2 shrink-0 rounded-full bg-running" aria-hidden />
    <button disabled={!canOpen} onClick={() => canOpen && onOpenConversation(item.id)} className="min-w-0 flex-1 text-left disabled:cursor-default">
      <b className="block truncate text-[12.5px] font-semibold text-ink">{title}</b>
      <span className="mt-px block font-mono text-[9.5px] text-muted">{sub}</span>
    </button>
    {stop && <button onClick={stop} className="rounded border border-line px-2 py-1 text-[10px] text-muted hover:border-danger hover:text-danger">Stop</button>}
  </div>;
}

function ReceiptRow({ receipt, onOpenConversation }: { receipt: FrameReceipt; onOpenConversation: (id: string) => void }) {
  const title = receipt.kind === 'chat' ? receipt.body : receipt.summary;
  const sub = receipt.kind === 'chat' ? 'chat receipt' : `workbench · ${receipt.published_by}`;
  const open = () => {
    if (receipt.kind === 'chat') onOpenConversation(receipt.conversation_id);
    else {
      const query = receipt.room_id === null
        ? `workbenchId=${encodeURIComponent(receipt.workbench_id)}`
        : `roomId=${encodeURIComponent(receipt.room_id)}&workbenchId=${encodeURIComponent(receipt.workbench_id)}`;
      window.location.assign(`/console/workbench?${query}`);
    }
  };
  return <button onClick={open} className="flex w-full items-center gap-2.5 border-b border-line py-2 text-left last:border-b-0">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-success"><path d="M20 6 9 17l-5-5" /></svg>
    <span className="min-w-0 flex-1"><b className="block truncate text-[12.5px] font-semibold text-ink">{title}</b><span className="mt-px block font-mono text-[9.5px] text-muted">{sub}</span></span>
  </button>;
}

function TodayList({ today, todayError, calendarEvents, calendarStatus, calendarLoading, calendarError, onRetry }: {
  today: TodayResponse | null;
  todayError: string | null;
  calendarEvents: CalendarEvent[];
  calendarStatus: 'connected' | 'not_connected' | 'error';
  calendarLoading: boolean;
  calendarError: string | null;
  onRetry: () => void;
}) {
  const cards = (today?.sections ?? []).flatMap((s) => s.cards);
  const entries = [
    ...cards
      .filter((card) => card.state !== 'done' && card.state !== 'cancelled')
      .map((card) => ({
        id: `work-${card.id}`,
        title: card.title,
        detail: card.scheduled_for ? `${clockTime(card.scheduled_for, TIME_ZONE)} · ${card.state}` : `unscheduled · ${card.state}`,
        sortAt: card.scheduled_for ? Date.parse(card.scheduled_for) : Number.POSITIVE_INFINITY,
        kind: 'work' as const,
      })),
    ...calendarEvents.map((event) => ({
      id: `calendar-${event.id}`,
      title: event.title,
      detail: event.allDay ? 'all day' : clockTime(event.start, TIME_ZONE),
      sortAt: Number.isNaN(Date.parse(event.start)) ? Number.POSITIVE_INFINITY : Date.parse(event.start),
      kind: 'calendar' as const,
    })),
  ].sort((left, right) => left.sortAt - right.sortAt || left.title.localeCompare(right.title));

  const calendarCoverage = calendarLoading
    ? 'Checking calendar…'
    : calendarStatus === 'connected'
      ? `${calendarEvents.length} calendar event${calendarEvents.length === 1 ? '' : 's'} connected`
      : calendarStatus === 'not_connected'
        ? 'Calendar not connected'
        : `Calendar degraded${calendarError ? ` — ${calendarError}` : ''}`;

  if (todayError) {
    return <div><p className="text-[12px] text-warning">Today is unavailable — {todayError}</p><p className="mt-1 font-mono text-[9.5px] text-muted/80">{calendarCoverage}</p><button onClick={onRetry} className="mt-1 text-[11px] font-semibold underline">Retry</button></div>;
  }
  if (today === null) return <Empty>Loading the day…</Empty>;
  return (
    <>
      {entries.slice(0, 4).map((entry) => (
        <div key={entry.id} className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0">
          {entry.kind === 'calendar' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4285F4]" title="Calendar" />}
          <span className="min-w-0 flex-1"><b className="block truncate text-[12.5px] font-semibold text-ink">{entry.title}</b><span className="mt-px block font-mono text-[9.5px] text-muted">{entry.detail}</span></span>
        </div>
      ))}
      {entries.length === 0 && <Empty>Clear board — nothing tracked for today.</Empty>}
      <p className="pt-2 font-mono text-[9.5px] text-muted/80">{calendarCoverage}</p>
    </>
  );
}

function Card({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-line bg-shell px-3.5 pb-2 pt-3">
      <h2 className="mb-1 flex items-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted/80">
        {title}
        {count !== undefined && <span className="ml-auto text-muted">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[12px] text-muted/80">{children}</p>;
}

function MiniSignal({
  label,
  count,
  pulse = false,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  pulse?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="relative grid h-[33px] w-[33px] place-items-center rounded-[10px] text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className="absolute -right-1 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-lg bg-accent px-1 font-mono text-[9px] font-bold text-white">
          {count}
        </span>
      )}
      {pulse && (
        <span className="animate-pip absolute -right-0.5 -top-0.5 h-[9px] w-[9px] rounded-full bg-running" />
      )}
    </button>
  );
}

'use client';

import type { Conversation, PendingDecision } from '@/lib/chat-api';
import type { TodayResponse } from '@/lib/api';

/* ------------------------------------------------------------------ */

interface LivingFrameProps {
  open: boolean;
  decisions: PendingDecision[];
  running: Conversation[];
  today: TodayResponse | null;
  receipts: Array<{ id: string; title: string; sub: string; conversationId: string | null }>;
  projectName: (projectId: string) => string;
  onToggle: () => void;
  onOpenConversation: (id: string) => void;
  onResolve: (decision: PendingDecision, outcome: 'ready' | 'cancel') => void;
}

/**
 * The living frame — a persistent, collapsible column of signals.
 *
 * It answers three questions without you asking: what is blocked on me, what is
 * running, what just finished. Collapsed it keeps only the counts, so quiet
 * costs 47px instead of going blind.
 */
export function LivingFrame({
  open,
  decisions,
  running,
  today,
  receipts,
  projectName,
  onToggle,
  onOpenConversation,
  onResolve,
}: LivingFrameProps) {
  if (!open) {
    return (
      <aside className="hidden w-[47px] shrink-0 flex-col border-l border-line bg-rail lg:flex">
        <div className="flex h-[54px] shrink-0 items-center justify-center border-b border-line">
          <button
            onClick={onToggle}
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
          <MiniSignal label="Waiting on you" count={decisions.length} onClick={onToggle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </MiniSignal>
          <MiniSignal label="Running" pulse={running.length > 0} onClick={onToggle}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </MiniSignal>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden w-[318px] shrink-0 flex-col border-l border-line bg-rail lg:flex">
      <div className="flex h-[54px] shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/80">
          Living frame
        </span>
        <button
          onClick={onToggle}
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
          {running.length === 0 ? (
            <Empty>Nothing mid-flight.</Empty>
          ) : (
            running.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenConversation(c.id)}
                className="flex w-full items-center gap-2.5 border-b border-line py-2 text-left last:border-b-0"
              >
                <span className="animate-pip h-2 w-2 shrink-0 rounded-full bg-running" aria-hidden />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[12.5px] font-semibold text-ink">{c.title}</b>
                  <span className="mt-px block font-mono text-[9.5px] text-muted">
                    {projectName(c.project_id)} · working
                  </span>
                </span>
              </button>
            ))
          )}
        </Card>

        <Card title="Today">
          <TodayList today={today} />
        </Card>

        <Card title="Receipts">
          {receipts.length === 0 ? (
            <Empty>Nothing finished yet today.</Empty>
          ) : (
            receipts.slice(0, 4).map((r) => (
              <button
                key={r.id}
                onClick={() => r.conversationId && onOpenConversation(r.conversationId)}
                className="flex w-full items-center gap-2.5 border-b border-line py-2 text-left last:border-b-0"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-success">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[12.5px] font-semibold text-ink">{r.title}</b>
                  <span className="mt-px block font-mono text-[9.5px] text-muted">{r.sub}</span>
                </span>
              </button>
            ))
          )}
        </Card>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function TodayList({ today }: { today: TodayResponse | null }) {
  const cards = (today?.sections ?? []).flatMap((s) => s.cards);
  const open = cards.filter((c) => c.state !== 'done' && c.state !== 'cancelled').slice(0, 4);

  if (today === null) return <Empty>Warming up…</Empty>;
  if (open.length === 0) return <Empty>Clear board — nothing tracked for today.</Empty>;

  return (
    <>
      {open.map((c) => (
        <div key={c.id} className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0">
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[12.5px] font-semibold text-ink">{c.title}</b>
            <span className="mt-px block font-mono text-[9.5px] text-muted">{c.state}</span>
          </span>
        </div>
      ))}
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

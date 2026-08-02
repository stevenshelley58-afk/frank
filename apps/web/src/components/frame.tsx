'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Room } from '@/lib/rooms';
import { PROJECT_ROOMS } from '@/lib/rooms';
import { useDelegations } from '@/lib/delegation';
import { useHarnesses } from '@/lib/use-harnesses';
import { briefFromToday } from '@/lib/frank';
import { useCalendar } from '@/lib/use-calendar';
import { useData, useToast } from './providers';
import { clockTime, TIME_ZONE } from '@/lib/time';
import { IconPin, IconPlus } from './icons';

/* ------------------------------------------------------------------ */
/* Living frame — ambient world-state around the chat (D2/D5/D10).     */
/* Central gets the full widget set; project rooms get a scoped frame. */
/* ------------------------------------------------------------------ */

export function FrameColumn({ room }: { room: Room }) {
  return (
    <div className="frame-scroll flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4">
      {room.isHome ? <CentralFrame /> : <ScopedFrame room={room} />}
    </div>
  );
}

/* ---------------------------- central ----------------------------- */

function CentralFrame() {
  const { push } = useToast();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const remove = (id: string) => setHidden((prev) => new Set(prev).add(id));
  const comingSoon = () => push('info', 'New widgets (Brain, Email, Todo…) land in a later session.');

  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-1 pb-3">
        <b className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-muted/80">
          Living frame
        </b>
        <button
          onClick={comingSoon}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-accent transition-opacity hover:opacity-70"
        >
          <IconPlus size={12} /> widget
        </button>
      </div>

      {!hidden.has('brief') && (
        <Widget title="Frank's brief" pinned onRemove={() => remove('brief')}>
          <BriefBody />
        </Widget>
      )}

      {!hidden.has('waiting') && (
        <Widget title="Waiting on you" onRemove={() => remove('waiting')}>
          {/* TODO(approvals): the approval queue wires in a later session. */}
          <p className="text-[12.5px] leading-relaxed text-muted">
            Nothing needs your approval.
          </p>
        </Widget>
      )}

      {!hidden.has('today') && (
        <Widget title="Today" onRemove={() => remove('today')}>
          <TodayBody />
        </Widget>
      )}

      {!hidden.has('pulse') && (
        <Widget title="Projects pulse" onRemove={() => remove('pulse')}>
          <div>
            {PROJECT_ROOMS.map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center gap-2.5 py-[7px] ${i > 0 ? 'border-t border-line/70' : ''}`}
              >
                <span
                  className="h-[9px] w-[9px] shrink-0 rounded-[3px] ring-1 ring-ink/10"
                  style={{ background: r.tint }}
                />
                <b className="text-[12px] font-semibold text-ink">{r.name}</b>
                <small className="ml-auto text-[10px] text-muted/70">{r.pulse}</small>
              </div>
            ))}
          </div>
        </Widget>
      )}

      {!hidden.has('harness') && (
        <Widget title="Harness" onRemove={() => remove('harness')}>
          <HarnessBody />
        </Widget>
      )}

      {!hidden.has('running') && (
        <Widget title="Running" onRemove={() => remove('running')}>
          <RunningBody />
        </Widget>
      )}

      <button
        onClick={comingSoon}
        className="mt-1 flex w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-3 text-[11px] tracking-[0.06em] text-muted transition-all duration-200 hover:-translate-y-px hover:border-accent/50 hover:text-accent"
      >
        <IconPlus size={12} /> Add a widget — Brain, Email, Todo…
      </button>
    </>
  );
}

function BriefBody() {
  const { today, work, loading } = useData();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const brief = briefFromToday(today);
  const recent = work?.items[0];

  let clock = '--:--';
  let weekday = '—';
  try {
    const d = new Date(now);
    clock = new Intl.DateTimeFormat('en-AU', {
      timeZone: TIME_ZONE,
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
    weekday = new Intl.DateTimeFormat('en-AU', {
      timeZone: TIME_ZONE,
      weekday: 'short',
    }).format(d);
  } catch {
    /* zone not resolvable — keep the dashes */
  }

  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted/70">
        <span className="text-accent">{clock}</span> · {weekday} · Melbourne
      </div>
      {loading ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Pulling the board from the cell…
        </p>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ink2">{brief.body}</p>
      )}
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink2">
        <b className="text-ink">One thing today:</b> {brief.oneThing}
      </p>
      {recent && (
        <p className="mt-2 border-t border-line/70 pt-2 font-mono text-[10px] uppercase tracking-[0.06em] text-muted/70">
          recent · <span className="text-muted">{recent.title.slice(0, 34)}</span>
        </p>
      )}
    </div>
  );
}

function TodayBody() {
  const { today, loading } = useData();
  const { events: calEvents, status: calStatus } = useCalendar(24);

  if (loading) {
    return <p className="text-[12.5px] text-muted">Reading the day…</p>;
  }

  const cards = (today?.sections ?? []).flatMap((s) => s.cards);

  // Merge calendar events into the timeline
  type TimelineEntry = { id: string; time: string; label: string; kind: 'work' | 'cal' };
  const entries: TimelineEntry[] = [];

  for (const c of cards) {
    entries.push({
      id: c.id,
      time: c.scheduled_for ? clockTime(c.scheduled_for, TIME_ZONE) : '·',
      label: c.title,
      kind: 'work',
    });
  }

  for (const e of calEvents) {
    const start = e.allDay ? null : new Date(e.start);
    const timeStr = e.allDay
      ? 'all day'
      : start
        ? new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(start)
        : '·';
    entries.push({
      id: 'cal-' + e.id,
      time: timeStr,
      label: e.title,
      kind: 'cal',
    });
  }

  // Sort: time-based entries first (by parsed hour), then unscheduled
  entries.sort((a, b) => {
    const aNum = a.time === '·' || a.time === 'all day' ? 99 : parseInt(a.time) || 0;
    const bNum = b.time === '·' || b.time === 'all day' ? 99 : parseInt(b.time) || 0;
    return aNum - bNum;
  });

  if (entries.length === 0) {
    return (
      <div>
        <p className="text-[12.5px] text-muted">Clear day — nothing scheduled.</p>
        {calStatus === 'not_connected' && (
          <p className="mt-2 text-[11px] text-muted/60">
            Connect Google Calendar to see meetings here.
          </p>
        )}
      </div>
    );
  }

  const shown = entries.slice(0, 8);
  const rest = entries.length - shown.length;

  return (
    <div>
      {shown.map((e, i) => (
        <div
          key={e.id}
          className={'flex items-center gap-2.5 py-1.5 text-[12px]' + (i > 0 ? ' border-t border-line/70' : '')}
        >
          <span className="w-11 shrink-0 font-mono text-[11px] text-accent">
            {e.time}
          </span>
          {e.kind === 'cal' && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4285F4]" title="Calendar" />
          )}
          <span className={'min-w-0 flex-1 leading-snug ' + (e.kind === 'cal' ? 'text-ink' : 'text-ink2')}>
            {e.label}
          </span>
          {e.kind === 'cal' && (
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-[#4285F4]/70">cal</span>
          )}
        </div>
      ))}
      {rest > 0 && (
        <p className="mt-1 border-t border-line/70 pt-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted/70">
          +{rest} more
        </p>
      )}
      {calStatus === 'connected' && calEvents.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wide text-muted/50">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4285F4]" /> {calEvents.length} calendar event{calEvents.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

/* ------------------------- scoped (project) ----------------------- */

function ScopedFrame({ room }: { room: Room }) {
  const { push } = useToast();
  const comingSoon = () => push('info', 'Scoped widgets for this room land in a later session.');

  return (
    <>
      <div className="flex shrink-0 items-center justify-between px-1 pb-3">
        <b className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-muted/80">
          {room.name} frame
        </b>
        <button
          onClick={comingSoon}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-accent transition-opacity hover:opacity-70"
        >
          <IconPlus size={12} /> widget
        </button>
      </div>

      <Widget title={`${room.name} brief`} pinned onRemove={comingSoon}>
        <p className="text-[12.5px] leading-relaxed text-ink2">
          {room.agent} is on point. Writes stay inside {room.name} — anything shared goes through
          Central with your approval.
        </p>
      </Widget>

      <Widget title="Agents here" onRemove={comingSoon}>
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
            style={{ background: room.tint }}
          >
            {room.initials}
          </span>
          <b className="text-[12px] font-semibold text-ink">{room.agent}</b>
          <small className="ml-auto text-[10px] text-muted/70">orchestrator</small>
        </div>
      </Widget>

      <button
        onClick={comingSoon}
        className="mt-1 flex w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-3 text-[11px] tracking-[0.06em] text-muted transition-all duration-200 hover:-translate-y-px hover:border-accent/50 hover:text-accent"
      >
        <IconPlus size={12} /> Add a widget — Files, Dates…
      </button>
    </>
  );
}

/* --------------------------- harness widget ----------------------- */

function HarnessBody() {
  const { providers, routes, loading } = useHarnesses();
  if (loading) {
    return <p className="text-[12.5px] text-muted">Probing harnesses…</p>;
  }
  return (
    <div>
      {providers.map((p, i) => (
        <div
          key={p.id}
          className={`flex items-center gap-2.5 py-[7px] ${i > 0 ? "border-t border-line/70" : ""}`}
        >
          <span
            className={`h-[9px] w-[9px] shrink-0 rounded-full ${p.healthy ? "bg-[#3f7d5c]" : "bg-[#c0563a]"}`}
          />
          <b className="text-[12px] font-semibold text-ink">{p.label}</b>
          <small className="ml-auto text-[10px] text-muted/70">
            {p.healthy ? "healthy" : "down"}
          </small>
        </div>
      ))}
      <p className="mt-1.5 border-t border-line/70 pt-2 text-[11px] leading-snug text-muted">
        Rooms: {Object.entries(routes).map(([room, r]) => (
          <span key={room} className="mr-2">
            <span className="text-ink2">{room}</span> · {r}
          </span>
        ))}
      </p>
    </div>
  );
}

/* --------------------------- running widget ----------------------- */

function RunningBody() {
  const items = useDelegations();
  if (items.length === 0) {
    return (
      <p className="text-[12.5px] leading-relaxed text-muted">
        Nothing running. Delegate work from Central with an @room handle.
      </p>
    );
  }
  return (
    <div>
      {items.slice(0, 8).map((d, i) => (
        <div
          key={d.id}
          className={`flex items-start gap-2.5 py-[7px] ${i > 0 ? "border-t border-line/70" : ""}`}
        >
          <span
            className="mt-[3px] h-[9px] w-[9px] shrink-0 rounded-[3px] ring-1 ring-ink/10"
            style={{ background: d.tint }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <b className="text-[12px] font-semibold text-ink">{d.agent}</b>
              <StatusDot status={d.status} />
            </div>
            <p className="mt-0.5 truncate text-[11.5px] leading-snug text-ink2" title={d.task}>
              {d.task}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: "running" | "done" | "error" }) {
  if (status === "running") {
    return (
      <span className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-accent">
        <span className="typing-dot" /> running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-[#c0563a]">
        error
      </span>
    );
  }
  return (
    <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-[#3f7d5c]">
      done
    </span>
  );
}

/* ------------------------------ widget ---------------------------- */

function Widget({
  title,
  pinned,
  onRemove,
  children,
}: {
  title: string;
  pinned?: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`mb-3 shrink-0 rounded-[14px] border bg-white px-[15px] py-3.5 shadow-[0_1px_2px_rgba(28,25,23,0.03)] transition-colors duration-200 hover:border-ink/15 ${
        pinned ? 'border-accent/35' : 'border-line'
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        {pinned && <IconPin size={11} className="text-accent" />}
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          {title}
        </h3>
        <button
          onClick={onRemove}
          title="Remove widget"
          aria-label={`Remove ${title}`}
          className="ml-auto rounded-md px-1.5 py-0.5 text-[13px] leading-none text-muted/60 transition-colors hover:bg-hover hover:text-ink"
        >
          ×
        </button>
      </div>
      <div>{children}</div>
    </div>
  );
}

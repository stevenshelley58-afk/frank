'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type CalendarState = { status: 'connected' | 'not_connected' | 'error'; count?: number; message?: string; error?: string };

export function ToolsConsole() {
  const [calendar, setCalendar] = useState<CalendarState | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/calendar?hours=24');
      setCalendar(await response.json() as CalendarState);
    } catch { setCalendar({ status: 'error', error: 'Calendar endpoint is unreachable.' }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const calendarLabel = !calendar ? 'checking' : calendar.status === 'connected' ? 'connected' : calendar.status === 'not_connected' ? 'not connected' : 'degraded';
  const calendarClass = calendar?.status === 'connected' ? 'border-success/30 bg-success/10 text-success' : calendar?.status === 'error' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-line bg-subtle text-muted';
  return <div className="mx-auto max-w-4xl px-6 py-10">
    <div className="mb-8"><p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Capability surface</p><h1 className="mt-1 font-display text-xl font-bold text-ink">Tools &amp; Connectors</h1><p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">Only web-facing integrations with a real endpoint or owning Console surface are listed. This page does not invent pause, retry, or credential controls.</p></div>
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-card p-4"><div className="flex flex-wrap items-center gap-2"><h2 className="flex-1 text-[14px] font-semibold text-ink">Google Calendar</h2><span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${calendarClass}`}>{calendarLabel}</span><button onClick={load} className="rounded-lg border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-ink2 hover:border-accent/40">Recheck</button></div><p className="mt-2 text-[12px] text-muted">{calendar?.status === 'connected' ? `${calendar.count ?? 0} event(s) returned by the next-24-hours connector probe.` : calendar?.message ?? calendar?.error ?? 'Probing /api/calendar.'}</p></section>
      <Connector title="Room channels" detail="Telegram bindings are managed per room through the existing channel API. Binding status is derived from live binding records, not guessed." href="/console/channels" action="Open Channels" />
      <Connector title="Room files & previews" detail="Folder bindings, artifacts, and preview publication are exposed through the room workbench API." href="/console/files" action="Open Room Files" />
      <Connector title="Harness providers" detail="The provider registry exposes health, reported model, mismatch warnings, and room route selection." href="/console/agent" action="Open Harness & Gateway" />
      <section className="rounded-xl border border-dashed border-line bg-subtle p-4"><div className="flex items-center gap-2"><h2 className="flex-1 text-[14px] font-semibold text-ink">Gmail and Google Tasks</h2><span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">not exposed</span></div><p className="mt-2 text-[12px] text-muted">Connector code exists in the workspace, but no web route reports its connection state or supports an action. It is deliberately not represented as available.</p></section>
    </div>
  </div>;
}

function Connector({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return <section className="rounded-xl border border-line bg-card p-4"><div className="flex flex-wrap items-center gap-2"><h2 className="flex-1 text-[14px] font-semibold text-ink">{title}</h2><span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">surface available</span><Link href={href} className="text-[12px] font-medium text-accent hover:underline">{action} →</Link></div><p className="mt-2 text-[12px] text-muted">{detail}</p></section>;
}

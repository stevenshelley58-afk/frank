'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Live calendar events for the Living Frame Today widget. */

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  calendarId: string;
}

interface CalendarResponse {
  status: 'connected' | 'not_connected' | 'error';
  events: CalendarEvent[];
  message?: string;
  error?: string;
}

export function useCalendar(hours = 24): {
  events: CalendarEvent[];
  status: CalendarResponse['status'];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [status, setStatus] = useState<CalendarResponse['status']>('not_connected');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar?hours=${hours}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as CalendarResponse | null;
      if (!res.ok || data?.status === 'error') {
        throw new Error(data?.error ?? data?.message ?? `Calendar request failed (${res.status}).`);
      }
      if (mounted.current) {
        setStatus(data?.status ?? 'error');
        setEvents(data?.events ?? []);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) {
        setStatus('error');
        setEvents([]);
        setError(err instanceof Error ? err.message : 'Calendar could not be loaded.');
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const refresh = async () => { if (alive) await load(); };
    void refresh();
    const t = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { alive = false; mounted.current = false; window.clearInterval(t); };
  }, [load]);

  return { events, status, loading, error, refresh: load };
}

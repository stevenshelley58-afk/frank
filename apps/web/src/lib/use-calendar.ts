'use client';

import { useEffect, useState } from 'react';

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
} {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [status, setStatus] = useState<CalendarResponse['status']>('not_connected');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/calendar?hours=${hours}`);
        const data = (await res.json()) as CalendarResponse;
        if (!alive) return;
        setStatus(data.status);
        setEvents(data.events ?? []);
      } catch {
        if (alive) setStatus('error');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [hours]);

  return { events, status, loading };
}

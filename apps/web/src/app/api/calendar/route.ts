/**
 * GET /api/calendar — Google Calendar events for the Living Frame.
 * Uses @frank/google-connectors function-based API.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CalendarEventWire {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}

function isConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Math.min(parseInt(searchParams.get('hours') ?? '24', 10), 72);

  if (!isConfigured()) {
    return NextResponse.json({
      status: 'not_connected',
      events: [],
      message: 'Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.',
    });
  }

  try {
    const { listEvents } = await import('@frank/google-connectors');

    const now = new Date();
    const timeMax = new Date(now.getTime() + hours * 3_600_000);

    const result = await listEvents({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const events: CalendarEventWire[] = (result.events ?? []).map((e) => ({
      id: e.id,
      title: e.summary || '(no title)',
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
    }));

    return NextResponse.json({
      status: 'connected',
      events,
      count: events.length,
      range: { start: now.toISOString(), end: timeMax.toISOString() },
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', events: [], error: String(err) },
      { status: 502 },
    );
  }
}

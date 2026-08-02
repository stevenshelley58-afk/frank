/**
 * Google Calendar connector — full bidirectional read/write.
 * listEvents, createEvent, updateEvent, deleteEvent, freeBusy, watchEvents.
 */
import { google, type calendar_v3 } from "googleapis";
import { getAuthClient } from "./auth.js";
import { toConnectorError } from "./errors.js";
import {
  type CalendarEvent,
  type CalendarEventAttendee,
  type CreateEventParams,
  type DeleteEventParams,
  type FreeBusyCalendar,
  type FreeBusyParams,
  type FreeBusyResult,
  type ListEventsParams,
  type ListEventsResult,
  type PushChannel,
  type UpdateEventParams,
  type WatchEventsParams,
} from "./types.js";

const DEFAULT_CALENDAR = "primary";

function calendarClient() {
  return google.calendar({ version: "v3" });
}

function isDateOnly(value: string): boolean {
  // Date-only values are "YYYY-MM-DD" with no time component.
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function eventDateTime(value: string, timeZone: string | undefined, forceAllDay: boolean | undefined) {
  const allDay = forceAllDay ?? isDateOnly(value);
  return allDay
    ? { date: value.slice(0, 10) }
    : timeZone !== undefined
      ? { dateTime: value, timeZone }
      : { dateTime: value };
}

function mapAttendee(a: calendar_v3.Schema$EventAttendee): CalendarEventAttendee {
  const out: CalendarEventAttendee = {
    email: a.email ?? "",
  };
  const withOptionals = out as { -readonly [K in keyof CalendarEventAttendee]: CalendarEventAttendee[K] };
  if (a.displayName !== undefined && a.displayName !== null) withOptionals.displayName = a.displayName;
  if (a.responseStatus !== undefined && a.responseStatus !== null) {
    withOptionals.responseStatus = a.responseStatus as NonNullable<CalendarEventAttendee["responseStatus"]>;
  }
  if (a.organizer === true) withOptionals.organizer = true;
  if (a.self === true) withOptionals.self = true;
  return withOptionals;
}

function mapEvent(e: calendar_v3.Schema$Event, calendarId: string): CalendarEvent {
  const start = e.start?.dateTime ?? e.start?.date ?? "";
  const end = e.end?.dateTime ?? e.end?.date ?? "";
  const allDay = e.start?.date !== undefined && e.start?.date !== null;

  const base: CalendarEvent = {
    id: e.id ?? "",
    calendarId,
    summary: e.summary ?? "",
    start,
    end,
    allDay,
    attendees: (e.attendees ?? []).map((a): CalendarEventAttendee => mapAttendee(a)),
  };

  const o = base as { -readonly [K in keyof CalendarEvent]: CalendarEvent[K] };
  if (e.description !== undefined && e.description !== null) o.description = e.description;
  if (e.location !== undefined && e.location !== null) o.location = e.location;
  if (e.status !== undefined && e.status !== null) o.status = e.status as NonNullable<CalendarEvent["status"]>;
  if (e.start?.timeZone !== undefined && e.start?.timeZone !== null) o.timeZone = e.start.timeZone;
  if (e.htmlLink !== undefined && e.htmlLink !== null) o.htmlLink = e.htmlLink;
  if (e.hangoutLink !== undefined && e.hangoutLink !== null) o.hangoutLink = e.hangoutLink;
  if (e.organizer?.email !== undefined && e.organizer?.email !== null) {
    const organizer: { name?: string; address: string } = { address: e.organizer.email };
    if (e.organizer.displayName !== undefined && e.organizer.displayName !== null) {
      organizer.name = e.organizer.displayName;
    }
    o.organizer = organizer;
  }
  if (e.etag !== undefined && e.etag !== null) o.etag = e.etag;
  if (e.created !== undefined && e.created !== null) o.created = e.created;
  if (e.updated !== undefined && e.updated !== null) o.updated = e.updated;
  return base;
}

export async function listEvents(params: ListEventsParams = {}): Promise<ListEventsResult> {
  const calendarId = params.calendarId ?? DEFAULT_CALENDAR;
  const singleEvents = params.singleEvents ?? true;
  try {
    const calendar = calendarClient();
    const res = await calendar.events.list({
      auth: await getAuthClient(),
      calendarId,
      timeMin: params.timeMin ?? new Date().toISOString(),
      ...(params.timeMax !== undefined ? { timeMax: params.timeMax } : {}),
      ...(params.query !== undefined ? { q: params.query } : {}),
      ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
      ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
      ...(params.includeCancelled !== undefined ? { showDeleted: params.includeCancelled } : {}),
      singleEvents,
      ...(singleEvents ? { orderBy: params.orderBy ?? "startTime" } : {}),
    });

    const events = (res.data.items ?? []).map((e): CalendarEvent => mapEvent(e, calendarId));
    const result: ListEventsResult = { events };
    const o = result as { -readonly [K in keyof ListEventsResult]: ListEventsResult[K] };
    if (res.data.nextPageToken !== undefined && res.data.nextPageToken !== null) o.nextPageToken = res.data.nextPageToken;
    if (res.data.nextSyncToken !== undefined && res.data.nextSyncToken !== null) o.syncToken = res.data.nextSyncToken;
    return result;
  } catch (error) {
    throw toConnectorError(error, "calendar", "listEvents");
  }
}

export async function createEvent(params: CreateEventParams): Promise<CalendarEvent> {
  const calendarId = params.calendarId ?? DEFAULT_CALENDAR;
  try {
    const calendar = calendarClient();
    const requestBody: calendar_v3.Schema$Event = {
      summary: params.summary,
      start: eventDateTime(params.start, params.timeZone, params.allDay),
      end: eventDateTime(params.end, params.timeZone, params.allDay),
    };
    if (params.description !== undefined) requestBody.description = params.description;
    if (params.location !== undefined) requestBody.location = params.location;
    if (params.attendees !== undefined && params.attendees.length > 0) {
      requestBody.attendees = params.attendees.map((email) => ({ email }));
    }

    const res = await calendar.events.insert({
      auth: await getAuthClient(),
      calendarId,
      requestBody,
      ...(params.sendUpdates !== undefined ? { sendUpdates: params.sendUpdates } : {}),
    });
    return mapEvent(res.data, calendarId);
  } catch (error) {
    throw toConnectorError(error, "calendar", "createEvent");
  }
}

export async function updateEvent(params: UpdateEventParams): Promise<CalendarEvent> {
  const calendarId = params.calendarId ?? DEFAULT_CALENDAR;
  try {
    const calendar = calendarClient();
    const requestBody: calendar_v3.Schema$Event = {};
    if (params.summary !== undefined) requestBody.summary = params.summary;
    if (params.description !== undefined) requestBody.description = params.description;
    if (params.location !== undefined) requestBody.location = params.location;
    if (params.start !== undefined) requestBody.start = eventDateTime(params.start, params.timeZone, params.allDay);
    if (params.end !== undefined) requestBody.end = eventDateTime(params.end, params.timeZone, params.allDay);
    if (params.attendees !== undefined) {
      requestBody.attendees = params.attendees.map((email) => ({ email }));
    }

    const headers =
      params.ifMatchEtag !== undefined ? { headers: { "If-Match": params.ifMatchEtag } } : undefined;

    const res = await calendar.events.patch({
      auth: await getAuthClient(),
      calendarId,
      eventId: params.eventId,
      requestBody,
      ...(params.sendUpdates !== undefined ? { sendUpdates: params.sendUpdates } : {}),
      ...(headers !== undefined ? headers : {}),
    });
    return mapEvent(res.data, calendarId);
  } catch (error) {
    throw toConnectorError(error, "calendar", "updateEvent");
  }
}

export async function deleteEvent(params: DeleteEventParams): Promise<void> {
  const calendarId = params.calendarId ?? DEFAULT_CALENDAR;
  try {
    const calendar = calendarClient();
    await calendar.events.delete({
      auth: await getAuthClient(),
      calendarId,
      eventId: params.eventId,
      ...(params.sendUpdates !== undefined ? { sendUpdates: params.sendUpdates } : {}),
    });
  } catch (error) {
    throw toConnectorError(error, "calendar", "deleteEvent");
  }
}

export async function queryFreeBusy(params: FreeBusyParams): Promise<FreeBusyResult> {
  const calendarIds = params.calendarIds ?? [DEFAULT_CALENDAR];
  try {
    const calendar = calendarClient();
    const res = await calendar.freebusy.query({
      auth: await getAuthClient(),
      requestBody: {
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        ...(params.timeZone !== undefined ? { timeZone: params.timeZone } : {}),
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const rawCalendars = res.data.calendars ?? {};
    const calendars: FreeBusyCalendar[] = calendarIds.map((id): FreeBusyCalendar => {
      const entry = rawCalendars[id];
      return {
        calendarId: id,
        busy: (entry?.busy ?? []).map((b) => ({ start: b.start ?? "", end: b.end ?? "" })),
        errors: (entry?.errors ?? []).map((e) => e.reason ?? "unknown"),
      };
    });
    return { calendars };
  } catch (error) {
    throw toConnectorError(error, "calendar", "queryFreeBusy");
  }
}

export async function watchEvents(params: WatchEventsParams): Promise<PushChannel> {
  const calendarId = params.calendarId ?? DEFAULT_CALENDAR;
  const channelId = params.channelId ?? crypto.randomUUID();
  try {
    const calendar = calendarClient();
    const body: calendar_v3.Schema$Channel = {
      id: channelId,
      type: "web_hook",
      address: params.address,
    };
    if (params.channelToken !== undefined) body.token = params.channelToken;
    if (params.expirationMs !== undefined) body.expiration = String(params.expirationMs);

    // A sync token scopes the watch to changes since that point.
    const listOpts =
      params.syncToken !== undefined
        ? { syncToken: params.syncToken }
        : {};

    const res = await calendar.events.watch({
      auth: await getAuthClient(),
      calendarId,
      requestBody: body,
      ...listOpts,
    });

    const channel: PushChannel = {
      id: res.data.id ?? channelId,
      resourceId: res.data.resourceId ?? "",
      resourceUri: res.data.resourceUri ?? "",
    };
    const o = channel as { -readonly [K in keyof PushChannel]: PushChannel[K] };
    if (res.data.expiration !== undefined && res.data.expiration !== null) {
      o.expiration = new Date(Number(res.data.expiration)).toISOString();
    }
    return channel;
  } catch (error) {
    throw toConnectorError(error, "calendar", "watchEvents");
  }
}

/**
 * Shared types for @frank/google-connectors.
 *
 * These are Frank-facing projections of Google API resources — only the
 * fields Frank's backend/web app actually consume, with stable names and
 * ISO-8601 dates. The raw googleapis shapes never leak past the connector.
 */

/** A wall-clock ("floating") or zoned date-time as an ISO-8601 string. */
export type DateTime = string;

/** An email address with an optional display name. */
export interface EmailAddress {
  readonly name?: string;
  readonly address: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Discriminator for typed errors thrown by every connector function. */
export type GoogleConnectorErrorCode =
  | "config"
  | "auth"
  | "not_found"
  | "rate_limited"
  | "permission"
  | "upstream"
  | "invalid_request";

/**
 * The single error type every connector function may throw. Callers switch on
 * `code` to decide whether to retry, surface a permission prompt, etc.
 */
export class GoogleConnectorError extends Error {
  readonly code: GoogleConnectorErrorCode;
  /** Underlying HTTP status from the Google API, when available. */
  readonly status?: number;
  /** The originating Google API surface, for logging. */
  readonly surface: "calendar" | "gmail" | "tasks" | "auth";

  constructor(params: {
    code: GoogleConnectorErrorCode;
    message: string;
    surface: GoogleConnectorError["surface"];
    status?: number;
    cause?: unknown;
  }) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause });
    this.name = "GoogleConnectorError";
    this.code = params.code;
    this.surface = params.surface;
    if (params.status !== undefined) this.status = params.status;
  }
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarEventAttendee {
  readonly email: string;
  readonly displayName?: string;
  readonly responseStatus?: "needsAction" | "accepted" | "declined" | "tentative";
  readonly organizer?: boolean;
  readonly self?: boolean;
}

export interface CalendarEvent {
  readonly id: string;
  readonly calendarId: string;
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  /** RFC-5545 status. */
  readonly status?: "confirmed" | "tentative" | "cancelled";
  /** ISO start; date-only for all-day events. */
  readonly start: DateTime;
  /** ISO end; date-only for all-day events. */
  readonly end: DateTime;
  readonly allDay: boolean;
  readonly timeZone?: string;
  readonly htmlLink?: string;
  readonly hangoutLink?: string;
  readonly attendees: readonly CalendarEventAttendee[];
  readonly organizer?: EmailAddress;
  /** Opaque sync version — pass back on update for optimistic concurrency. */
  readonly etag?: string;
  readonly created?: DateTime;
  readonly updated?: DateTime;
}

export interface ListEventsParams {
  /** Calendar to read; defaults to "primary". */
  calendarId?: string;
  /** Inclusive lower bound (ISO). Defaults to now. */
  timeMin?: DateTime;
  /** Exclusive upper bound (ISO). */
  timeMax?: DateTime;
  /** Free-text filter over summary/description/attendees. */
  query?: string;
  maxResults?: number;
  /** Continuation token from a previous page. */
  pageToken?: string;
  /** Include cancelled events (default false). */
  includeCancelled?: boolean;
  /** Expand recurring events into instances (default true). */
  singleEvents?: boolean;
  /** Sort order when singleEvents is true. */
  orderBy?: "startTime" | "updated";
}

export interface ListEventsResult {
  readonly events: readonly CalendarEvent[];
  readonly nextPageToken?: string;
  /** Sync token for incremental push/poll sync. */
  readonly syncToken?: string;
}

export interface CreateEventParams {
  calendarId?: string;
  summary: string;
  /** ISO date-time or date-only (all-day). */
  start: DateTime;
  end: DateTime;
  description?: string;
  location?: string;
  timeZone?: string;
  attendees?: readonly string[];
  /** Whether start/end are date-only (all-day). Default inferred. */
  allDay?: boolean;
  /** Send update notifications to attendees. */
  sendUpdates?: "all" | "externalOnly" | "none";
}

export interface UpdateEventParams {
  calendarId?: string;
  eventId: string;
  summary?: string;
  start?: DateTime;
  end?: DateTime;
  description?: string;
  location?: string;
  timeZone?: string;
  attendees?: readonly string[];
  allDay?: boolean;
  /** Optimistic-concurrency etag from a prior read. */
  ifMatchEtag?: string;
  sendUpdates?: "all" | "externalOnly" | "none";
}

export interface DeleteEventParams {
  calendarId?: string;
  eventId: string;
  sendUpdates?: "all" | "externalOnly" | "none";
}

export interface FreeBusyParams {
  /** Calendars to query; defaults to ["primary"]. */
  calendarIds?: readonly string[];
  timeMin: DateTime;
  timeMax: DateTime;
  timeZone?: string;
}

export interface FreeBusyInterval {
  readonly start: DateTime;
  readonly end: DateTime;
}

export interface FreeBusyCalendar {
  readonly calendarId: string;
  readonly busy: readonly FreeBusyInterval[];
  readonly errors: readonly string[];
}

export interface FreeBusyResult {
  readonly calendars: readonly FreeBusyCalendar[];
}

/** A push-notification channel registration for calendar sync. */
export interface PushChannel {
  readonly id: string;
  readonly resourceId: string;
  readonly resourceUri: string;
  readonly expiration?: DateTime;
}

export interface WatchEventsParams {
  calendarId?: string;
  /** HTTPS endpoint Google POSTs notifications to. */
  address: string;
  /** Caller-chosen channel id; generated if omitted. */
  channelId?: string;
  /** Opaque token echoed back in notifications. */
  channelToken?: string;
  /** Epoch-ms expiry; defaults to ~7 days (Google max for calendar). */
  expirationMs?: number;
  /** Sync token to resume from (from listEvents / a prior watch). */
  syncToken?: string;
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

export interface EmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
  readonly snippet?: string;
  readonly from?: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly cc: readonly EmailAddress[];
  readonly bcc: readonly EmailAddress[];
  readonly subject: string;
  readonly date?: DateTime;
  /** Best-effort plain-text body. */
  readonly textBody?: string;
  /** Best-effort HTML body. */
  readonly htmlBody?: string;
  readonly unread: boolean;
  readonly isStarred: boolean;
}

export interface EmailMessageSummary {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
  readonly snippet?: string;
}

export interface ListEmailParams {
  /** Gmail label id to constrain to (e.g. "INBOX"). */
  labelIds?: readonly string[];
  maxResults?: number;
  pageToken?: string;
  /** Include spam/trash (default false). */
  includeSpamTrash?: boolean;
}

export interface ListEmailResult {
  readonly messages: readonly EmailMessageSummary[];
  readonly nextPageToken?: string;
  readonly resultSizeEstimate: number;
}

export interface SearchEmailParams {
  /** Gmail search operators, e.g. "from:foo is:unread newer_than:7d". */
  query: string;
  maxResults?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
}

export interface SearchEmailResult {
  readonly messages: readonly EmailMessageSummary[];
  readonly nextPageToken?: string;
  readonly resultSizeEstimate: number;
}

export interface GetEmailParams {
  id: string;
  /** "full" returns parsed parts; "metadata" returns headers only. */
  format?: "full" | "metadata";
}

export interface DraftEmailParams {
  to: readonly string[];
  subject: string;
  /** Plain-text body. */
  body: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  /** Optional HTML alternative. */
  htmlBody?: string;
  /** Message-Id to reply to (sets In-Reply-To/References). */
  replyToMessageId?: string;
}

export interface SendEmailParams {
  to: readonly string[];
  subject: string;
  body: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  htmlBody?: string;
  replyToMessageId?: string;
}

export interface SendEmailResult {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
}

export interface ModifyEmailLabelsParams {
  id: string;
  addLabelIds?: readonly string[];
  removeLabelIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface Task {
  readonly id: string;
  readonly tasklistId: string;
  readonly title: string;
  readonly notes?: string;
  readonly status: "needsAction" | "completed";
  readonly completed: boolean;
  readonly due?: DateTime;
  readonly updated?: DateTime;
  readonly webLink?: string;
  /** Parent task id when nested. */
  readonly parent?: string;
  readonly position?: string;
}

export interface TaskList {
  readonly id: string;
  readonly title: string;
  readonly updated?: DateTime;
}

export interface ListTasksParams {
  /** Task list id; defaults to "@default". */
  tasklist?: string;
  maxResults?: number;
  pageToken?: string;
  /** Only return tasks due before this date. */
  dueMax?: DateTime;
  /** Only return tasks due after this date. */
  dueMin?: DateTime;
  /** Filter by completion state. */
  showCompleted?: boolean;
  showHidden?: boolean;
}

export interface ListTasksResult {
  readonly tasks: readonly Task[];
  readonly nextPageToken?: string;
}

export interface CreateTaskParams {
  tasklist?: string;
  title: string;
  notes?: string;
  due?: DateTime;
  /** Insert as a child of this task. */
  parent?: string;
}

export interface UpdateTaskParams {
  tasklist?: string;
  taskId: string;
  title?: string;
  notes?: string;
  due?: DateTime;
}

export interface CompleteTaskParams {
  tasklist?: string;
  taskId: string;
}

export interface DeleteTaskParams {
  tasklist?: string;
  taskId: string;
}

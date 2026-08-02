/**
 * @frank/google-connectors
 *
 * Google Workspace connectors for Frank OS — Calendar, Gmail, and Tasks.
 * Every export is a standalone async function that handles auth internally and
 * throws GoogleConnectorError (switch on `.code`) on failure. No classes, no
 * lifecycle for the caller to manage.
 *
 * Config (env): see auth.ts. OAuth refresh token is the normal path; service
 * account + impersonation is supported for server-to-server use.
 */

// Auth & config
export {
  getAuthClient,
  resetAuthCache,
  type AuthClient,
  type GoogleConnectorConfig,
} from "./auth.js";

// Shared types + the single error type every function throws
export {
  GoogleConnectorError,
  type CalendarEvent,
  type CalendarEventAttendee,
  type CompleteTaskParams,
  type CreateEventParams,
  type CreateTaskParams,
  type DateTime,
  type DeleteEventParams,
  type DeleteTaskParams,
  type DraftEmailParams,
  type EmailAddress,
  type EmailMessage,
  type EmailMessageSummary,
  type FreeBusyCalendar,
  type FreeBusyInterval,
  type FreeBusyParams,
  type FreeBusyResult,
  type GetEmailParams,
  type GoogleConnectorErrorCode,
  type ListEmailParams,
  type ListEmailResult,
  type ListEventsParams,
  type ListEventsResult,
  type ListTasksParams,
  type ListTasksResult,
  type ModifyEmailLabelsParams,
  type PushChannel,
  type SearchEmailParams,
  type SearchEmailResult,
  type SendEmailParams,
  type SendEmailResult,
  type Task,
  type TaskList,
  type UpdateEventParams,
  type UpdateTaskParams,
  type WatchEventsParams,
} from "./types.js";

// Calendar — full bidirectional read/write
export {
  createEvent,
  deleteEvent,
  listEvents,
  queryFreeBusy,
  updateEvent,
  watchEvents,
} from "./calendar.js";

// Gmail — full bidirectional
export {
  draftEmail,
  getEmail,
  listEmail,
  modifyEmailLabels,
  searchEmail,
  sendEmail,
} from "./gmail.js";

// Tasks — lightweight projection (Plane is source of truth)
export {
  completeTask,
  createTask,
  deleteTask,
  listTaskLists,
  listTasks,
  reopenTask,
  updateTask,
} from "./tasks.js";

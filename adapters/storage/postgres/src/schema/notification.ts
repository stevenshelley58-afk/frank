/**
 * Notification context — FRANK-§11.2 ("Notification, Channel, Delivery,
 * Preference, Escalation"), NOTIFY-001/002, FRANK-§4.9.
 *
 * Two tables carry the load and the split matters: `notification` is *what
 * happened*, `notification_delivery` is *each attempt to tell someone*. Merging
 * them would mean a notification sent to two channels is two notifications, so
 * marking it read on the phone would not mark it read in the browser, and an
 * escalation would duplicate the event rather than escalate it.
 *
 * `dedupe_key` is unique per cell. FRANK-§4.9 requires notifications to be
 * quiet-hours aware and non-repeating; a retried automation that recomputes the
 * same alert must update one row, not add a second.
 */

import { sql } from 'drizzle-orm';
import { index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { actorKindEnum, dataClassEnum, domain, durableRecordColumns } from './shared.js';
import { workItem } from './work.js';

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'action_required', 'critical'] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const notificationSeverityEnum = domain.enum(
  'notification_severity',
  NOTIFICATION_SEVERITIES,
);

export const NOTIFICATION_STATES = [
  'pending',
  'suppressed',
  'delivered',
  'read',
  'acknowledged',
  'dismissed',
  'escalated',
  'failed',
] as const;

export type NotificationState = (typeof NOTIFICATION_STATES)[number];

export const notificationStateEnum = domain.enum('notification_state', NOTIFICATION_STATES);

export const NOTIFICATION_CHANNELS = [
  'in_app',
  'push',
  'email',
  'sms',
  'webhook',
  'desktop',
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const notificationChannelEnum = domain.enum('notification_channel', NOTIFICATION_CHANNELS);

export const DELIVERY_STATES = [
  'queued',
  'sending',
  'delivered',
  'failed',
  'suppressed',
  'expired',
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const deliveryStateEnum = domain.enum('delivery_state', DELIVERY_STATES);

export const notification = domain.table(
  'notification',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    /** Logical event family, e.g. `work.blocked`, `budget.threshold_reached`. */
    kind: text('kind').notNull(),
    severity: notificationSeverityEnum('severity').notNull().default('info'),
    state: notificationStateEnum('state').notNull().default('pending'),

    recipientKind: actorKindEnum('recipient_kind').notNull(),
    recipientId: text('recipient_id').notNull(),

    title: text('title').notNull(),
    /**
     * FRANK-§15.7 and FRANK-§12.4 ("Personal payloads are minimized; large or
     * sensitive data is referenced by protected URI"). The body is a short,
     * already-minimized summary; anything sensitive is behind `subject_*`.
     */
    body: text('body'),
    dataClass: dataClassEnum('data_class').notNull().default('internal'),

    /** What the notification is about, so the client can deep-link (FRANK-§3.8). */
    subjectKind: text('subject_kind'),
    subjectId: text('subject_id'),
    workItemId: uuid('work_item_id').references(() => workItem.id, { onDelete: 'cascade' }),
    deepLink: text('deep_link'),

    /** FRANK-§4.9: recomputing the same alert updates one row. */
    dedupeKey: text('dedupe_key').notNull(),

    /** FRANK-§4.9 quiet hours: hold until this instant, then deliver. */
    notBeforeAt: timestamp('not_before_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true, mode: 'date' }),

    /** FRANK-§11.2 `Escalation`: unacknowledged critical alerts escalate. */
    escalateAfterSeconds: integer('escalate_after_seconds'),
    escalatedAt: timestamp('escalated_at', { withTimezone: true, mode: 'date' }),

    correlationId: text('correlation_id').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('notification_dedupe_uidx').on(t.cellId, t.dedupeKey),
    index('notification_recipient_idx').on(t.cellId, t.recipientKind, t.recipientId, t.state),
    index('notification_pending_idx')
      .on(t.cellId, t.notBeforeAt)
      .where(sql`${t.state} = 'pending'`),
    index('notification_work_item_idx').on(t.workItemId),
  ],
);

/** FRANK-§11.2 `Delivery`. One row per channel attempt, with its own receipt. */
export const notificationDelivery = domain.table(
  'notification_delivery',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notification.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum('channel').notNull(),
    state: deliveryStateEnum('state').notNull().default('queued'),
    /** FRANK-§13.5: an external side effect carries an idempotency key. */
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'date' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
    /** Provider receipt, referenced not copied (FRANK-§11.5). */
    providerReceiptRef: text('provider_receipt_ref'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    uniqueIndex('notification_delivery_idem_uidx').on(t.cellId, t.channel, t.idempotencyKey),
    index('notification_delivery_notification_idx').on(t.notificationId),
  ],
);

/** FRANK-§11.2 `Preference`. Per recipient, per kind, per channel. */
export const notificationPreference = domain.table(
  'notification_preference',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    recipientKind: actorKindEnum('recipient_kind').notNull(),
    recipientId: text('recipient_id').notNull(),
    /** `*` matches every kind; a specific kind overrides the wildcard. */
    notificationKind: text('notification_kind').notNull().default('*'),
    channel: notificationChannelEnum('channel').notNull(),
    enabled: integer('enabled').notNull().default(1),
    minimumSeverity: notificationSeverityEnum('minimum_severity').notNull().default('info'),
    /** `{ timezone: 'Australia/Melbourne', windows: [{ from: '22:00', to: '07:00' }] }`. */
    quietHours: jsonb('quiet_hours').$type<Record<string, unknown>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    uniqueIndex('notification_preference_uidx').on(
      t.cellId,
      t.recipientKind,
      t.recipientId,
      t.notificationKind,
      t.channel,
    ),
  ],
);

export type NotificationRow = typeof notification.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;

/**
 * Autonomous room and mission records.
 *
 * A room is the durable policy boundary for one long-lived objective. A
 * mission is one bounded execution programme inside that room and is rooted
 * in a canonical work item. Neither record replaces WorkItem or Run: they add
 * objective, fence, budget, and planned-work context around those aggregates.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { dataClassEnum, domain, durableRecordColumns } from './shared.js';
import { workItem } from './work.js';

/** Room lifecycle is separate from the operational `paused` gate. */
export const ROOM_STATES = ['active', 'completed', 'failed', 'cancelled'] as const;

export type RoomState = (typeof ROOM_STATES)[number];

export const roomStateEnum = domain.enum('room_state', ROOM_STATES);

/**
 * Operating-system and policy scopes applied to every mission in a room.
 * Concrete mount and capability records remain canonical elsewhere; this is
 * the immutable-at-dispatch declaration a mission is evaluated against.
 */
export interface RoomFence {
  readonly readScopes: readonly string[];
  readonly writeScopes: readonly string[];
  readonly sharedWritesRequireApproval: boolean;
  readonly egressAllowlist?: readonly string[];
}

/** Aggregate ceiling inherited by missions created inside a room. */
export interface RoomBudget {
  readonly spendLimit?: { readonly amount: string; readonly currency: string };
  readonly tokenLimit?: number;
  readonly attemptLimit?: number;
  readonly maxConcurrentMissions?: number;
}

export const room = domain.table(
  'room',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    /** Stable, human-meaningful identity within one cell, e.g. `central`. */
    identity: text('identity').notNull(),
    /** The outcome this autonomous room exists to pursue. */
    objective: text('objective').notNull(),
    fence: jsonb('fence').$type<RoomFence>().notNull(),
    state: roomStateEnum('state').notNull().default('active'),
    budget: jsonb('budget').$type<RoomBudget>().notNull(),
    /** Independent operational gate; pausing does not falsify lifecycle state. */
    paused: boolean('paused').notNull().default(false),
    dataClass: dataClassEnum('data_class').notNull().default('private'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('room_id_cell_uidx').on(t.id, t.cellId),
    uniqueIndex('room_cell_identity_uidx').on(t.cellId, t.identity),
    index('room_state_idx').on(t.cellId, t.state, t.paused, t.updatedAt),
    check('room_identity_not_blank', sql`length(btrim(${t.identity})) > 0`),
    check('room_objective_not_blank', sql`length(btrim(${t.objective})) > 0`),
    check('room_fence_is_object', sql`jsonb_typeof(${t.fence}) = 'object'`),
    check('room_budget_is_object', sql`jsonb_typeof(${t.budget}) = 'object'`),
    check('room_version_positive', sql`${t.version} >= 1`),
    check('room_paused_only_active', sql`not ${t.paused} or ${t.state} = 'active'`),
  ],
);

/** The mission states requested by the autonomous execution contract. */
export const MISSION_STATES = [
  'planning',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const;

export type MissionState = (typeof MISSION_STATES)[number];

export const missionStateEnum = domain.enum('mission_state', MISSION_STATES);

/**
 * The graph is versioned by its producer and intentionally stored as JSONB:
 * nodes may reference work items, runs, or future plan-step contracts without
 * coupling this migration to any one planner's private representation.
 */
export type PlannedWorkGraph = Readonly<Record<string, unknown>>;

export const mission = domain.table(
  'mission',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    rootWorkItemId: uuid('root_work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'restrict' }),
    /** Command-level replay protection; unique within the owning cell. */
    idempotencyKey: text('idempotency_key').notNull(),

    objective: text('objective').notNull(),
    plannedWorkGraph: jsonb('planned_work_graph').$type<PlannedWorkGraph>().notNull(),
    state: missionStateEnum('state').notNull().default('planning'),

    /** Hard runner ceilings. Usage is recorded by canonical cost/run records. */
    spendLimit: numeric('spend_limit', { precision: 24, scale: 8 }).notNull(),
    spendCurrency: text('spend_currency').notNull().default('USD'),
    tokenLimit: integer('token_limit').notNull(),
    wallClockLimitSeconds: integer('wall_clock_limit_seconds').notNull(),
    attemptLimit: integer('attempt_limit').notNull(),

    /** Once true, schedulers may finish active work but must admit no new work. */
    stopNewWork: boolean('stop_new_work').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    error: text('error'),
    dataClass: dataClassEnum('data_class').notNull().default('private'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('mission_cell_idempotency_uidx').on(t.cellId, t.idempotencyKey),
    uniqueIndex('mission_root_work_item_uidx').on(t.cellId, t.rootWorkItemId),
    index('mission_room_state_idx').on(t.cellId, t.roomId, t.state, t.updatedAt),
    index('mission_runnable_idx').on(t.cellId, t.state, t.stopNewWork, t.updatedAt),
    check('mission_objective_not_blank', sql`length(btrim(${t.objective})) > 0`),
    check('mission_idempotency_key_not_blank', sql`length(btrim(${t.idempotencyKey})) > 0`),
    check(
      'mission_planned_work_graph_is_object',
      sql`jsonb_typeof(${t.plannedWorkGraph}) = 'object'`,
    ),
    check(
      'mission_spend_limit_non_negative',
      sql`${t.spendLimit} >= 0 and ${t.spendLimit} <> 'NaN'::numeric`,
    ),
    check('mission_spend_currency_not_blank', sql`length(btrim(${t.spendCurrency})) > 0`),
    check('mission_token_limit_non_negative', sql`${t.tokenLimit} >= 0`),
    check('mission_wall_clock_limit_positive', sql`${t.wallClockLimitSeconds} >= 1`),
    check('mission_attempt_limit_positive', sql`${t.attemptLimit} >= 1`),
    check('mission_version_positive', sql`${t.version} >= 1`),
    check(
      'mission_started_before_finished',
      sql`${t.startedAt} is null or ${t.finishedAt} is null or ${t.startedAt} <= ${t.finishedAt}`,
    ),
    check(
      'mission_terminal_finished_paired',
      sql`(${t.state} in ('completed', 'failed', 'cancelled')) = (${t.finishedAt} is not null)`,
    ),
    check(
      'mission_terminal_stops_new_work',
      sql`${t.state} not in ('completed', 'failed', 'cancelled') or ${t.stopNewWork}`,
    ),
  ],
);

export type RoomRow = typeof room.$inferSelect;
export type NewRoomRow = typeof room.$inferInsert;
export type MissionRow = typeof mission.$inferSelect;
export type NewMissionRow = typeof mission.$inferInsert;

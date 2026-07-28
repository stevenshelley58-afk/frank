/**
 * Work context — WORK-001..006, FRANK-§11.2 ("WorkItem, Dependency, Assignment,
 * Checklist, Recurrence, Comment, StateTransition"), FRANK-§11.3.
 *
 * WORK-002 enumerates what a work item must support and each clause maps to
 * something here:
 *
 *   owner         -> `owner_kind` / `owner_id`
 *   collaborators -> `work_item_assignment`
 *   status        -> `state` (see `src/work-state.ts`)
 *   priority      -> `priority`
 *   dates         -> `scheduled_for_at`/`scheduled_for_timezone`, `due_at`/`due_timezone`,
 *                    `started_at`, `completed_at`
 *   dependencies  -> `work_item_dependency`
 *   context       -> `why_now`, `project_id`, `goal_ids`, `parent_id`
 *   source        -> `work_item_source_ref`
 *   policy        -> `policy_ref`
 *   artifacts     -> `work_item_artifact`
 *   history       -> `work_item_transition`
 *
 * WORK-006 ("why now", "definition of done", "next safe action") is three
 * columns, not a rendering concern: if they are computed at read time they can
 * be absent, and the requirement is that they always exist.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { WORK_STATES } from '../work-state.js';
import type { VersionedRef } from './shared.js';
import { actorKindEnum, dataClassEnum, domain, durableRecordColumns } from './shared.js';
import { source } from './source.js';

/** FRANK-§11.3 `WorkItem.kind`, verbatim. */
export const WORK_KINDS = [
  'task',
  'decision',
  'bug',
  'milestone',
  'follow_up',
  'routine',
  'agent_job',
] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export const workKindEnum = domain.enum('work_kind', WORK_KINDS);

/** FRANK-§11.3 `WorkItem.priority`, verbatim. */
export const WORK_PRIORITIES = ['none', 'low', 'normal', 'high', 'critical'] as const;

export type WorkPriority = (typeof WORK_PRIORITIES)[number];

export const workPriorityEnum = domain.enum('work_priority', WORK_PRIORITIES);

/**
 * The work state enum. Values come from `src/work-state.ts`, which is also what
 * seeds `work_state_transition` and what the trigger consults — one definition,
 * three enforcement points.
 */
export const workStateEnum = domain.enum('work_state', WORK_STATES);

/**
 * WORK-004's explicit transition table.
 *
 * This is a lookup table, not a check constraint, because FRANK-§11.1 offers
 * exactly that choice ("Enumerations enforced by schema or lookup tables") and a
 * table can be inspected, joined against to render legal next actions in the UI,
 * and amended by a migration with a visible diff. A `CHECK` containing 40
 * hand-written pairs can do none of those things.
 *
 * Seeded in migration `0001` from {@link legalTransitionPairs}. The
 * `work_state_machine_guard` trigger on `work_item` rejects any UPDATE whose
 * `(OLD.state, NEW.state)` is absent from here, and `work_item_transition`
 * carries a composite foreign key onto it, so an illegal transition cannot be
 * written even by a direct SQL session.
 */
export const workStateTransition = domain.table(
  'work_state_transition',
  {
    fromState: workStateEnum('from_state').notNull(),
    toState: workStateEnum('to_state').notNull(),
    /** Human-readable rationale, surfaced by the UI as the action label. */
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromState, t.toState] }),
    check('work_state_transition_no_self', sql`${t.fromState} <> ${t.toState}`),
  ],
);

export const workItem = domain.table(
  'work_item',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    kind: workKindEnum('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),

    state: workStateEnum('state').notNull().default('inbox'),
    priority: workPriorityEnum('priority').notNull().default('none'),

    /** WORK-003: the owner is a typed actor, so delegation does not change identity. */
    ownerKind: actorKindEnum('owner_kind').notNull(),
    ownerId: text('owner_id').notNull(),

    projectId: uuid('project_id'),
    /** FRANK-§11.3 `goalIds`. Array column; goals are a Slice 4 context. */
    goalIds: jsonb('goal_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    parentId: uuid('parent_id'),

    /** FRANK-§11.3 `policyRef`. Every item names the policy version it runs under. */
    policyRef: jsonb('policy_ref').$type<VersionedRef>().notNull(),

    /**
     * WORK-005: "Repeating work must use recurrence rules and idempotency keys,
     * not copied ad hoc tasks."
     *
     * `recurrence_rule` is an RFC 5545 RRULE string; `recurrence_timezone` is the
     * IANA zone the rule is evaluated in (FRANK-§11.1). `occurrence_key` is the
     * per-occurrence idempotency key — unique per (cell, series), so a retried
     * or daylight-saving-doubled expansion produces one row, which is exactly
     * WORK-005's acceptance evidence.
     */
    recurrenceSeriesId: uuid('recurrence_series_id'),
    recurrenceRule: text('recurrence_rule'),
    recurrenceTimezone: text('recurrence_timezone'),
    occurrenceKey: text('occurrence_key'),

    /** FRANK-§11.1: UTC instant plus explicit IANA zone for human scheduling. */
    scheduledForAt: timestamp('scheduled_for_at', { withTimezone: true, mode: 'date' }),
    scheduledForTimezone: text('scheduled_for_timezone'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    dueTimezone: text('due_timezone'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),

    /** WORK-006, all three, stored not derived. */
    whyNow: text('why_now'),
    definitionOfDone: jsonb('definition_of_done')
      .$type<Array<{ id: string; statement: string; verification: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    nextSafeAction: text('next_safe_action'),

    /** FRANK-§2.3. Strictest class among the item's sources and content. */
    dataClass: dataClassEnum('data_class').notNull().default('private'),

    /** FRANK-§11.1 optimistic concurrency; FRANK-§12.3 `expected_version`. */
    version: integer('version').notNull().default(1),
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'work_item_parent_fk',
    }).onDelete('restrict'),
    index('work_item_state_idx').on(t.cellId, t.state, t.priority),
    index('work_item_owner_idx').on(t.cellId, t.ownerKind, t.ownerId, t.state),
    index('work_item_due_idx').on(t.cellId, t.dueAt),
    index('work_item_scheduled_idx').on(t.cellId, t.scheduledForAt),
    index('work_item_project_idx').on(t.cellId, t.projectId),
    // WORK-005: one row per intended occurrence, however many times the
    // expansion runs.
    uniqueIndex('work_item_occurrence_uidx')
      .on(t.cellId, t.recurrenceSeriesId, t.occurrenceKey)
      .where(sql`${t.occurrenceKey} is not null`),
    check('work_item_no_self_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    check('work_item_version_positive', sql`${t.version} >= 1`),
    // FRANK-§11.1: a zoned timestamp without its zone is not a zoned timestamp.
    check(
      'work_item_scheduled_zone_paired',
      sql`(${t.scheduledForAt} is null) = (${t.scheduledForTimezone} is null)`,
    ),
    check('work_item_due_zone_paired', sql`(${t.dueAt} is null) = (${t.dueTimezone} is null)`),
    check(
      'work_item_recurrence_zone_paired',
      sql`(${t.recurrenceRule} is null) = (${t.recurrenceTimezone} is null)`,
    ),
  ],
);

/**
 * WORK-002 "collaborators" and WORK-003 delegation.
 *
 * A separate table rather than a JSONB array because assignment carries its own
 * lifecycle — accepted, revoked, who did it and when — and because
 * "everything assigned to agent X" is a query the Today view runs constantly.
 */
export const workItemAssignment = domain.table(
  'work_item_assignment',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'cascade' }),
    assigneeKind: actorKindEnum('assignee_kind').notNull(),
    assigneeId: text('assignee_id').notNull(),
    /** `collaborator` | `delegate` | `reviewer` | `watcher`. */
    role: text('role').notNull().default('collaborator'),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' }).notNull(),
    assignedBy: text('assigned_by').notNull(),
    /** WORK-003: revocation is recorded, not deleted, so history survives. */
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedBy: text('revoked_by'),
  },
  (t) => [
    uniqueIndex('work_item_assignment_uidx')
      .on(t.workItemId, t.assigneeKind, t.assigneeId, t.role)
      .where(sql`${t.revokedAt} is null`),
    index('work_item_assignment_assignee_idx').on(t.cellId, t.assigneeKind, t.assigneeId),
  ],
);

export const DEPENDENCY_KINDS = ['blocks', 'relates_to', 'duplicates', 'caused_by'] as const;

export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export const dependencyKindEnum = domain.enum('dependency_kind', DEPENDENCY_KINDS);

/**
 * FRANK-§11.3: "`WorkItem` dependencies must form an acyclic graph unless a
 * record explicitly models a recurring loop."
 *
 * The database enforces the two cheap parts — no self-dependency, no duplicate
 * edge. Full acyclicity is enforced in `WorkItemRepository.addDependency`, which
 * runs a recursive reachability query inside the same transaction as the insert.
 * A `CHECK` cannot express reachability, and a trigger doing a recursive CTE on
 * every insert would be a surprising place to put that cost; `allows_cycle`
 * exists for the "explicitly models a recurring loop" escape the spec names, and
 * the repository refuses to create a cycle unless the edge closing it sets it.
 */
export const workItemDependency = domain.table(
  'work_item_dependency',
  {
    cellId: text('cell_id').notNull(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'cascade' }),
    dependsOnId: uuid('depends_on_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'restrict' }),
    kind: dependencyKindEnum('kind').notNull().default('blocks'),
    /** FRANK-§11.3's "unless a record explicitly models a recurring loop". */
    allowsCycle: boolean('allows_cycle').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workItemId, t.dependsOnId, t.kind] }),
    index('work_item_dependency_reverse_idx').on(t.dependsOnId),
    check('work_item_dependency_no_self', sql`${t.workItemId} <> ${t.dependsOnId}`),
  ],
);

/** WORK-002 "source": the link back to the immutable capture envelope. */
export const workItemSourceRef = domain.table(
  'work_item_source_ref',
  {
    cellId: text('cell_id').notNull(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'restrict' }),
    /** `origin` when this source caused the item to exist, `evidence` otherwise. */
    relation: text('relation').notNull().default('origin'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workItemId, t.sourceId, t.relation] }),
    index('work_item_source_ref_source_idx').on(t.sourceId),
  ],
);

/** WORK-002 "artifacts"; FRANK-§6.8 artifact refs. Blobs stay in object storage. */
export const workItemArtifact = domain.table(
  'work_item_artifact',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    uri: text('uri').notNull(),
    sha256: text('sha256').notNull(),
    mediaType: text('media_type'),
    dataClass: dataClassEnum('data_class').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    uniqueIndex('work_item_artifact_uidx').on(t.workItemId, t.kind, t.sha256),
    index('work_item_artifact_item_idx').on(t.workItemId),
  ],
);

/**
 * WORK-002 "history" and WORK-004 "valid transitions are audited".
 *
 * The composite foreign key onto `work_state_transition` is the second of the
 * three enforcement points: even if the trigger on `work_item` were dropped, an
 * illegal pair could not be recorded here, so the history can never claim a
 * transition the state machine does not permit.
 */
export const workItemTransition = domain.table(
  'work_item_transition',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'cascade' }),
    /** Monotonic per item, starting at 1. */
    seq: integer('seq').notNull(),
    fromState: workStateEnum('from_state').notNull(),
    toState: workStateEnum('to_state').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    /** FRANK-§12.3: an action carries a reason. */
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** WORK-004: the audit entry that recorded this transition (FRANK-§11.5). */
    auditEntryId: uuid('audit_entry_id'),
    correlationId: text('correlation_id').notNull(),
    /** Version of the item *after* the transition. */
    resultingVersion: integer('resulting_version').notNull(),
  },
  (t) => [
    uniqueIndex('work_item_transition_seq_uidx').on(t.workItemId, t.seq),
    index('work_item_transition_item_idx').on(t.workItemId, t.occurredAt),
    foreignKey({
      columns: [t.fromState, t.toState],
      foreignColumns: [workStateTransition.fromState, workStateTransition.toState],
      name: 'work_item_transition_legal_fk',
    }).onDelete('restrict'),
  ],
);

/** FRANK-§11.2 `Comment`. */
export const workItemComment = domain.table(
  'work_item_comment',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'cascade' }),
    authorKind: actorKindEnum('author_kind').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    dataClass: dataClassEnum('data_class').notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('work_item_comment_item_idx').on(t.workItemId, t.createdAt)],
);

export type WorkItemRow = typeof workItem.$inferSelect;
export type NewWorkItemRow = typeof workItem.$inferInsert;
export type WorkItemTransitionRow = typeof workItemTransition.$inferSelect;

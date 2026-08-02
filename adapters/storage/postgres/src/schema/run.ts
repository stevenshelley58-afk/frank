/**
 * Run context — FRANK-§7.3 ("Durable run state"), FRANK-§11.2 ("Run,
 * RunTransition").
 *
 * A run is one execution of an agent assignment against a work item. The
 * `WorkItem` state machine (work-state.ts) governs the *work*; this governs
 * the *execution*. A work item may produce many runs (retry, recovery,
 * rework); each run carries its own lifecycle, actor, policy decision, and
 * evidence trail.
 *
 * FRANK-§7.3: "Every transition records actor, time, reason, policy decision,
 * correlation, and evidence." That sentence is the column list of
 * `run_transition`.
 */

import { sql } from 'drizzle-orm';
import {
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

import { RUN_STATES } from '../run-state.js';
import type { VersionedRef } from './shared.js';
import { actorKindEnum, dataClassEnum, domain, durableRecordColumns, policyResultEnum } from './shared.js';
import { workItem } from './work.js';

/** FRANK-§7.3 run states, verbatim. */
export const runStateEnum = domain.enum('run_state', RUN_STATES);

/**
 * FRANK-§7.3's explicit transition table.
 *
 * Same rationale as `work_state_transition`: a lookup table, not a check
 * constraint, because FRANK-§11.1 offers exactly that choice and a table can
 * be inspected, joined against, and amended with a visible diff.
 *
 * Seeded in migration `0002` from {@link legalRunTransitionPairs}. The
 * `run_state_machine_guard` trigger on `run` rejects any UPDATE whose
 * `(OLD.state, NEW.state)` is absent from here.
 */
export const runStateTransition = domain.table(
  'run_state_transition',
  {
    fromState: runStateEnum('from_state').notNull(),
    toState: runStateEnum('to_state').notNull(),
    /** Human-readable rationale, surfaced by the UI as the action label. */
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromState, t.toState] }),
    check('run_state_transition_no_self', sql`${t.fromState} <> ${t.toState}`),
  ],
);

/**
 * The durable run record — FRANK-§7.3.
 *
 * One row per agent execution attempt. Linked to a work item (the thing being
 * done) and optionally to a predecessor run (retry / recovery chain). The
 * state column is guarded by a database trigger; the transition history is
 * append-only in `run_transition`.
 */
export const run = domain.table(
  'run',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    state: runStateEnum('state').notNull().default('received'),

    /** The work item this run executes. */
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItem.id, { onDelete: 'restrict' }),

    /**
     * Retry / recovery chain. A run created as a retry of a failed run links
     * back to it. FRANK-§7.3: "Failed → Queued: retry permitted" — the new
     * run's `predecessor_run_id` points at the failed one.
     */
    predecessorRunId: uuid('predecessor_run_id'),

    /** The actor executing this run (agent, agent_team, or service). */
    executorKind: actorKindEnum('executor_kind').notNull(),
    executorId: text('executor_id').notNull(),

    /**
     * The harness adapter driving execution (e.g. `goose`, `hermes`, `codex`).
     * FRANK-§6.2: harnesses are swappable; the run records which one was used.
     */
    harness: text('harness').notNull(),

    /** FRANK-§6.9: the policy version this run was authorized under. */
    policyRef: jsonb('policy_ref').$type<VersionedRef>().notNull(),

    /** FRANK-§6.9: the policy decision that authorized this run. */
    policyResult: policyResultEnum('policy_result').notNull().default('allow'),

    /** FRANK-§7.4: the context pack this run was assembled with (hash ref). */
    contextPackRef: jsonb('context_pack_ref').$type<VersionedRef>(),

    /** FRANK-§2.3: strictest data class among the run's inputs. */
    dataClass: dataClassEnum('data_class').notNull().default('private'),

    /** FRANK-§11.1 optimistic concurrency. */
    version: integer('version').notNull().default(1),

    /** When execution actually began (entered `running`). */
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    /** When the run reached a terminal state. */
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),

    /**
     * FRANK-§7.3: "Workflow-version rules define which running revisions may
     * continue, migrate, or finish under their original contract." The
     * workflow definition version this run was created under.
     */
    workflowVersion: text('workflow_version').notNull().default('1'),
  },
  (t) => [
    foreignKey({
      columns: [t.predecessorRunId],
      foreignColumns: [t.id],
      name: 'run_predecessor_fk',
    }).onDelete('restrict'),
    index('run_state_idx').on(t.cellId, t.state),
    index('run_work_item_idx').on(t.cellId, t.workItemId, t.state),
    index('run_executor_idx').on(t.cellId, t.executorKind, t.executorId, t.state),
    check('run_no_self_predecessor', sql`${t.predecessorRunId} is null or ${t.predecessorRunId} <> ${t.id}`),
    check('run_version_positive', sql`${t.version} >= 1`),
    check(
      'run_started_before_finished',
      sql`${t.startedAt} is null or ${t.finishedAt} is null or ${t.startedAt} <= ${t.finishedAt}`,
    ),
  ],
);

/**
 * FRANK-§7.3: "Every transition records actor, time, reason, policy decision,
 * correlation, and evidence."
 *
 * Append-only (enforced by trigger in migration `0002`). The composite foreign
 * key onto `run_state_transition` is the second enforcement point: even if the
 * trigger on `run` were dropped, an illegal pair could not be recorded here.
 */
export const runTransition = domain.table(
  'run_transition',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    /** Monotonic per run, starting at 1. */
    seq: integer('seq').notNull(),
    fromState: runStateEnum('from_state').notNull(),
    toState: runStateEnum('to_state').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    /** FRANK-§12.3: an action carries a reason. */
    reason: text('reason'),
    /** FRANK-§6.9: the policy decision that authorized this transition. */
    policyResult: policyResultEnum('policy_result').notNull().default('allow'),
    /** FRANK-§7.3: evidence is a versioned ref to an artifact or audit entry. */
    evidenceRef: jsonb('evidence_ref').$type<VersionedRef>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** WORK-004 / FRANK-§7.3: the audit entry that recorded this transition. */
    auditEntryId: uuid('audit_entry_id'),
    /** FRANK-§19.1: correlation id of the request that caused this transition. */
    correlationId: text('correlation_id').notNull(),
    /** Version of the run *after* the transition. */
    resultingVersion: integer('resulting_version').notNull(),
  },
  (t) => [
    uniqueIndex('run_transition_seq_uidx').on(t.runId, t.seq),
    index('run_transition_run_idx').on(t.runId, t.occurredAt),
    index('run_transition_cell_state_idx').on(t.cellId, t.toState, t.occurredAt),
    foreignKey({
      columns: [t.fromState, t.toState],
      foreignColumns: [runStateTransition.fromState, runStateTransition.toState],
      name: 'run_transition_legal_fk',
    }).onDelete('restrict'),
  ],
);

export type RunRow = typeof run.$inferSelect;
export type NewRunRow = typeof run.$inferInsert;
export type RunTransitionRow = typeof runTransition.$inferSelect;

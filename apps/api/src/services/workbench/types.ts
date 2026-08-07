/**
 * Workbench record types — master plan §4.2 ("Minimum workbench record").
 *
 * A workbench is EXECUTION DETAIL, never task state (master plan §3.1): the
 * work item stays the canonical task and approval state, and every workbench
 * transition corresponds to a work-item transition, audit entry, and outbox
 * event performed by the caller (WB-05 owns that wiring). This module is the
 * TypeScript mirror of migration `0004_workbench.sql` the way `run-state.ts`
 * mirrors `0002_run_state_machine.sql` — and the drift test in
 * `workbench.test.ts` keeps the two agreeing.
 *
 * ## No separate task state machine
 *
 * `WorkbenchState` is intentionally NOT a transition machine. GOV-01
 * (docs/plans/DECISIONS.md) resolved that the master plan's execution states
 * map onto the WORK-004 work-item states, and this module encodes that mapping
 * in {@link WORKBENCH_TO_WORK_ITEM_STATE}:
 *
 *   provisioning -> blocked      running -> active      waiting -> waiting
 *   verifying    -> reviewing    done -> completed
 *   failed       -> failed       cancelled -> cancelled
 *   queued       -> (stays where the delegation left it; the front door
 *                   transitions the work item when the run is claimed)
 */

/** Master plan §4.2 task definition — what a run needs to be reproducible. */
export interface WorkbenchMount {
  readonly source: string;
  readonly path: string;
  /** §3.2 mount modes. `staged` = copy-in; writes land via a decision item. */
  readonly mode: 'ro' | 'rw' | 'staged';
}

export interface WorkbenchHarnessSpec {
  readonly adapter: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface WorkbenchLeash {
  readonly wallClockSec?: number;
  readonly tokenBudget?: number;
  readonly spendCapUsd?: number;
}

export interface WorkbenchNetwork {
  readonly egressAllowlist?: readonly string[];
}

export interface WorkbenchTaskDef {
  readonly instruction: string;
  readonly mounts?: readonly WorkbenchMount[];
  readonly harness?: WorkbenchHarnessSpec;
  readonly skills?: readonly string[];
  readonly leash?: WorkbenchLeash;
  readonly network?: WorkbenchNetwork;
}

/**
 * Workbench execution states — migration 0004's `workbench_state` enum, in
 * lifecycle order. Terminal states: done, failed, cancelled.
 */
export const WORKBENCH_STATES = [
  'queued',
  'provisioning',
  'running',
  'waiting',
  'verifying',
  'done',
  'failed',
  'cancelled',
] as const;

export type WorkbenchState = (typeof WORKBENCH_STATES)[number];

export const TERMINAL_WORKBENCH_STATES: readonly WorkbenchState[] = [
  'done',
  'failed',
  'cancelled',
];

export function isTerminalWorkbenchState(state: WorkbenchState): boolean {
  return (TERMINAL_WORKBENCH_STATES as readonly string[]).includes(state);
}

/** Master plan §3.4 plan step states. */
export const WORKBENCH_PLAN_STEP_STATES = [
  'pending',
  'doing',
  'done',
  'failed',
  'skipped',
] as const;

export type WorkbenchPlanStepState = (typeof WORKBENCH_PLAN_STEP_STATES)[number];

/**
 * Master plan §4.2 minimum append-only event types. Semantics are fixed; the
 * SQL enum `workbench_event_type` carries exactly this list.
 */
export const WORKBENCH_EVENT_TYPES = [
  'workbench_created',
  'provisioning_started',
  'provisioned',
  'plan_published',
  'step_updated',
  'decision_requested',
  'paused',
  'resumed',
  'artifact_registered',
  'receipt_published',
  'stop_requested',
  'timed_out',
  'failed',
  'cancelled',
  'completed',
] as const;

export type WorkbenchEventType = (typeof WORKBENCH_EVENT_TYPES)[number];

/**
 * GOV-01 mapping: which WORK-004 work-item state each workbench state
 * corresponds to. `undefined` means the workbench state carries no work-item
 * transition of its own (queueing is front-door bookkeeping; the claim path
 * performs the item transition when it moves the workbench out of `queued`).
 */
export const WORKBENCH_TO_WORK_ITEM_STATE: Readonly<
  Partial<Record<WorkbenchState, string>>
> = {
  provisioning: 'blocked',
  running: 'active',
  waiting: 'waiting',
  verifying: 'reviewing',
  done: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export interface WorkbenchPlanStep {
  readonly seq: number;
  readonly step: string;
  readonly state: WorkbenchPlanStepState;
  readonly note: string | null;
  readonly updatedAt: Date;
}

export interface WorkbenchEvent {
  readonly seq: number;
  readonly type: WorkbenchEventType;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface WorkbenchArtifact {
  readonly id: string;
  readonly path: string;
  readonly kind: string;
  readonly previewUrl: string | null;
  readonly createdAt: Date;
}

/**
 * FS-05: a full artifact row as read for the preview backend — superset of
 * {@link WorkbenchArtifact} carrying the owning workbench plus the optional
 * content-hash/media-type columns.
 */
export interface ArtifactDetail {
  readonly id: string;
  readonly workbenchId: string;
  readonly path: string;
  readonly kind: string;
  readonly previewUrl: string | null;
  readonly sha256: string | null;
  readonly mediaType: string | null;
  readonly createdAt: Date;
}

/**
 * FS-05 room Files entry: an artifact plus enough workbench context for the
 * room surface (which run produced it, how far along that run is).
 */
export interface RoomArtifact extends ArtifactDetail {
  readonly workbenchState: string;
}

export interface WorkbenchReceipt {
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly evidence: readonly unknown[];
  readonly publishedAt: Date;
  readonly publishedBy: string;
}

/** The persisted workbench row (migration 0004's `workbench` table). */
export interface WorkbenchRecord {
  readonly id: string;
  readonly cellId: string;
  readonly workItemId: string;
  readonly roomId: string | null;
  readonly idempotencyKey: string;
  readonly taskDef: WorkbenchTaskDef;
  readonly state: WorkbenchState;
  readonly attempts: number;
  readonly claimedBy: string | null;
  readonly claimedAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly lastError: string | null;
  readonly containerId: string | null;
  readonly scheduleCron: string | null;
  readonly scheduleTimezone: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A reconstructed run snapshot — workbench row plus everything appended to it.
 * WB-01's verify gate: "Create, read, append events, and reconstruct a run
 * snapshot from Postgres."
 */
export interface WorkbenchSnapshot {
  readonly workbench: WorkbenchRecord;
  readonly plan: readonly WorkbenchPlanStep[];
  readonly events: readonly WorkbenchEvent[];
  readonly artifacts: readonly WorkbenchArtifact[];
  readonly receipt: WorkbenchReceipt | null;
}

export interface CreateWorkbenchInput {
  readonly id: string;
  readonly cellId: string;
  readonly workItemId: string;
  readonly roomId?: string;
  /** The delegation command envelope's command_id (FRANK-§12.3). */
  readonly idempotencyKey: string;
  readonly taskDef: WorkbenchTaskDef;
  readonly createdBy: string;
  readonly now: Date;
  readonly schedule?: { cron: string; tz: string };
}

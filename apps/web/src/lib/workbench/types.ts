/**
 * Workbench wire types — frozen contract.
 *
 * Source of truth: docs/plans/WORKBENCH_API_CONTRACT.md (frozen by AG-0
 * 2026-08-06). Changes require an ADR-class note + AG-0 sign-off — do NOT
 * drift from the contract here; if the contract is wrong, raise it, don't
 * silently "fix" the types.
 *
 * Contract gaps (shapes the contract does not pin) are marked `GAP:` and
 * kept permissive so a real backend response still parses.
 */

/* ------------------------------------------------------------------ */
/* SSE event union (fixed list, contract §SSE event envelope)          */
/* ------------------------------------------------------------------ */

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

export function isWorkbenchEventType(value: unknown): value is WorkbenchEventType {
  return typeof value === 'string' && (WORKBENCH_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Step states for `step_updated` (plan §3.4: "Step states are `pending`,
 * `doing`, `done`, `failed`, or `skipped`."). The contract example shows
 * `state: "doing"`.
 */
export const STEP_STATES = ['pending', 'doing', 'done', 'failed', 'skipped'] as const;
export type StepState = (typeof STEP_STATES)[number];

export interface StepUpdatedPayload {
  step: number;
  state: StepState;
  note?: string;
}

/** GAP: contract does not pin the plan_published payload shape. We accept a
 * `steps` array or a `total` count so step `k/n` can be derived either way. */
export interface PlanPublishedPayload {
  steps?: Array<{ title?: string; note?: string } | string>;
  total?: number;
}

/**
 * GAP: contract pins the POST /v1/workbenches/:id/decisions *request* body
 * (`{ question, whyNow, nextSafeAction, evidence[] }`) and says the event
 * `decision_requested` is appended; we assume the event payload mirrors the
 * body plus the created decision work item's id.
 */
export interface DecisionRequestedPayload {
  workItemId?: string;
  question?: string;
  whyNow?: string;
  nextSafeAction?: string;
  evidence?: unknown[];
}

export interface PausedPayload {
  reason?: string;
}

export interface ResumedPayload {
  reason?: string;
}

/** GAP: artifact record shape is not pinned by the contract. */
export interface ArtifactRegisteredPayload {
  id?: string;
  name?: string;
  kind?: string;
  url?: string;
  path?: string;
}

/**
 * Receipt contents follow plan §3.4: what was done, what was found,
 * decisions taken, assumptions made, evidence links.
 * GAP: exact receipt wire shape is not pinned by the contract.
 */
export interface WorkbenchReceipt {
  workbenchId?: string;
  workItemId?: string;
  whatDone?: string;
  found?: string;
  decisions?: string[];
  assumptions?: string[];
  evidence?: string[];
  completedAt?: string;
}

export interface ReceiptPublishedPayload {
  receipt?: WorkbenchReceipt;
}

export interface StopRequestedPayload {
  reason?: string;
}

export interface FailedPayload {
  error?: string;
}

/** Fallback payload for events whose shape the contract leaves open. */
export interface GenericPayload {
  [key: string]: unknown;
}

interface Envelope<T> {
  /** monotonically increasing per workbench; the dedupe key (UI-07 rule). */
  seq: number;
  type: WorkbenchEventType;
  /** ISO-8601 timestamp. */
  at: string;
  payload: T;
}

/** Typed event union over the contract's fixed event list. */
export type WorkbenchEvent =
  | (Envelope<GenericPayload> & { type: 'workbench_created' })
  | (Envelope<GenericPayload> & { type: 'provisioning_started' })
  | (Envelope<GenericPayload> & { type: 'provisioned' })
  | (Envelope<PlanPublishedPayload> & { type: 'plan_published' })
  | (Envelope<StepUpdatedPayload> & { type: 'step_updated' })
  | (Envelope<DecisionRequestedPayload> & { type: 'decision_requested' })
  | (Envelope<PausedPayload> & { type: 'paused' })
  | (Envelope<ResumedPayload> & { type: 'resumed' })
  | (Envelope<ArtifactRegisteredPayload> & { type: 'artifact_registered' })
  | (Envelope<ReceiptPublishedPayload> & { type: 'receipt_published' })
  | (Envelope<StopRequestedPayload> & { type: 'stop_requested' })
  | (Envelope<GenericPayload> & { type: 'timed_out' })
  | (Envelope<FailedPayload> & { type: 'failed' })
  | (Envelope<GenericPayload> & { type: 'cancelled' })
  | (Envelope<GenericPayload> & { type: 'completed' });

/** Events that end a run (used to freeze the elapsed clock + disable Stop). */
export const TERMINAL_EVENT_TYPES: ReadonlySet<WorkbenchEventType> = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

/**
 * Parse an SSE `data:` payload into a single WorkbenchEvent envelope.
 * Throws on anything that is not a contract-shaped envelope.
 */
export function parseWorkbenchEvent(raw: unknown): WorkbenchEvent {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('workbench event: not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.seq !== 'number' || !isWorkbenchEventType(obj.type) || typeof obj.at !== 'string') {
    throw new Error('workbench event: missing seq/type/at');
  }
  return {
    seq: obj.seq,
    type: obj.type,
    at: obj.at,
    payload: (obj.payload ?? {}) as never,
  } as WorkbenchEvent;
}

/* ------------------------------------------------------------------ */
/* Workbench record shapes                                             */
/* ------------------------------------------------------------------ */

/**
 * GAP: the contract does not pin a workbench `state` enum. Derived from the
 * event vocabulary; unknown backend values are tolerated as `string`.
 */
export type WorkbenchLifecycle =
  | 'provisioning'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/**
 * GET /v1/workbenches/:id → "Record + plan + latest receipt. Includes
 * `workItemId`, `state`, `version`." Everything else is a GAP: permissive
 * fields keep the UI working no matter exactly how the record is shaped.
 */
export interface WorkbenchRecord {
  id: string;
  workItemId?: string | null;
  state?: string;
  version?: number;
  roomId?: string | null;
  /** GAP: task title source is not pinned — accept a def object or string. */
  task?: { id?: string; title?: string; goal?: string } | string | null;
  plan?: unknown;
  receipt?: WorkbenchReceipt | null;
  createdAt?: string;
  created_at?: string;
}

/** GET /v1/rooms/:roomId/workbenches — GAP: list item shape not pinned. */
export type WorkbenchSummary = WorkbenchRecord;

/** Extract a human task title from the permissive record shape. */
export function workbenchTaskTitle(wb: WorkbenchRecord): string {
  const task = wb.task;
  if (typeof task === 'string' && task.trim()) return task;
  if (task && typeof task === 'object') return task.title || task.goal || '';
  return '';
}

/** POST /v1/workbenches/:id/stop body (contract: `{ reason }`). */
export interface StopWorkbenchBody {
  reason: string;
}

export const WORKBENCH_API = {
  listForRoom: (roomId: string) => `/v1/rooms/${encodeURIComponent(roomId)}/workbenches`,
  get: (id: string) => `/v1/workbenches/${encodeURIComponent(id)}`,
  events: (id: string) => `/v1/workbenches/${encodeURIComponent(id)}/events`,
  stop: (id: string) => `/v1/workbenches/${encodeURIComponent(id)}/stop`,
} as const;

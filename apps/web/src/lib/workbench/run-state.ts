/**
 * Workbench event fold — pure functions over the frozen contract's SSE
 * stream. This is the single source of truth for "what does the UI show
 * right now", shared by the live SSE hook and the mock dev surface.
 *
 * UI-07 rules implemented here:
 *  - snapshot first, then live events;
 *  - dedupe on `seq` (reconnect replays must never duplicate);
 *  - events stay ordered by `seq`.
 */

import {
  type ArtifactRegisteredPayload,
  type DecisionRequestedPayload,
  type StepState,
  type WorkbenchEvent,
  type WorkbenchLifecycle,
  type WorkbenchReceipt,
  TERMINAL_EVENT_TYPES,
} from './types';

export type { WorkbenchLifecycle };

export interface PlanStepView {
  index: number;
  title?: string;
  state: StepState;
  note?: string;
}

export interface WaitingDecision {
  workItemId?: string;
  question?: string;
  whyNow?: string;
  nextSafeAction?: string;
  /** seq of the decision_requested event, for provenance. */
  seq: number;
  at: string;
}

export interface WorkbenchRunState {
  /** All accepted events, ordered by seq, deduped. */
  events: WorkbenchEvent[];
  /** seq of the last accepted event (resume cursor for Last-Event-ID). */
  lastSeq: number | null;
  /** seqs seen so far — the dedupe set. */
  seenSeqs: ReadonlySet<number>;
  /** total steps from plan_published; null until the plan lands. */
  totalSteps: number | null;
  planSteps: PlanStepView[];
  /** index of the step currently `doing` (1-based, matching payload.step). */
  activeStep: number | null;
  activeStepNote?: string;
  /** latest receipt, if published. */
  receipt: WorkbenchReceipt | null;
  artifacts: Array<ArtifactRegisteredPayload & { seq: number; at: string }>;
  /** Open decision request, if the run is waiting on a human. */
  waiting: WaitingDecision | null;
  paused: boolean;
  /** terminal event type if the run ended, else null. */
  terminal: WorkbenchEvent['type'] | null;
  /** first event timestamp — anchor for elapsed time. */
  startedAt: string | null;
  /** last event timestamp. */
  lastAt: string | null;
  /** true once a snapshot (or first event) has been applied. */
  hydrated: boolean;
}

export function emptyRunState(): WorkbenchRunState {
  return {
    events: [],
    lastSeq: null,
    seenSeqs: new Set<number>(),
    totalSteps: null,
    planSteps: [],
    activeStep: null,
    activeStepNote: undefined,
    receipt: null,
    artifacts: [],
    waiting: null,
    paused: false,
    terminal: null,
    startedAt: null,
    lastAt: null,
    hydrated: false,
  };
}

export interface FoldResult {
  state: WorkbenchRunState;
  /** true when at least one event was accepted (not deduped away). */
  accepted: number;
  /** true when at least one event was dropped as a duplicate. */
  duplicates: number;
}

function applyEvent(state: WorkbenchRunState, event: WorkbenchEvent): WorkbenchRunState {
  const next: WorkbenchRunState = {
    ...state,
    events: [...state.events, event],
    seenSeqs: new Set(state.seenSeqs).add(event.seq),
    lastSeq:
      state.lastSeq === null || event.seq > state.lastSeq ? event.seq : state.lastSeq,
    lastAt: event.at,
    startedAt: state.startedAt ?? event.at,
    hydrated: true,
  };

  switch (event.type) {
    case 'plan_published': {
      const payload = event.payload;
      const steps = payload.steps;
      if (Array.isArray(steps)) {
        next.planSteps = steps.map((s, i) => ({
          index: i + 1,
          title: typeof s === 'string' ? s : s.title,
          state: 'pending',
        }));
        next.totalSteps = steps.length;
      } else if (typeof payload.total === 'number' && payload.total > 0) {
        next.totalSteps = payload.total;
        next.planSteps = Array.from({ length: payload.total }, (_, i) => ({
          index: i + 1,
          state: 'pending' as StepState,
        }));
      }
      break;
    }
    case 'step_updated': {
      const { step, state: stepState, note } = event.payload;
      if (next.planSteps.length > 0 && step >= 1 && step <= next.planSteps.length) {
        next.planSteps = next.planSteps.map((s) =>
          s.index === step ? { ...s, state: stepState, note: note ?? s.note } : s,
        );
      }
      if (stepState === 'doing') {
        next.activeStep = step;
        if (note !== undefined) next.activeStepNote = note;
      } else if (next.activeStep === step && note !== undefined) {
        next.activeStepNote = note;
      }
      break;
    }
    case 'decision_requested': {
      const payload = event.payload as DecisionRequestedPayload;
      next.waiting = {
        workItemId: payload.workItemId,
        question: payload.question,
        whyNow: payload.whyNow,
        nextSafeAction: payload.nextSafeAction,
        seq: event.seq,
        at: event.at,
      };
      break;
    }
    case 'paused':
      next.paused = true;
      break;
    case 'resumed':
      next.paused = false;
      next.waiting = null;
      break;
    case 'artifact_registered':
      next.artifacts = [...state.artifacts, { ...event.payload, seq: event.seq, at: event.at }];
      break;
    case 'receipt_published':
      if (event.payload.receipt) next.receipt = event.payload.receipt;
      break;
    default:
      break;
  }

  if (TERMINAL_EVENT_TYPES.has(event.type)) {
    next.terminal = event.type;
    next.paused = false;
  }

  return next;
}

/**
 * Fold new events into run state with seq-dedupe.
 *
 * `base` may already contain a snapshot's worth of events; any incoming
 * event whose `seq` was already seen is dropped (this is what makes
 * refresh/reconnect duplicate-free). Unknown/out-of-band `type` values are
 * also dropped rather than crashing the surface.
 */
export function foldEvents(base: WorkbenchRunState, incoming: WorkbenchEvent[]): FoldResult {
  let state = base;
  let accepted = 0;
  let duplicates = 0;
  for (const event of incoming) {
    if (typeof event?.seq !== 'number') continue;
    if (state.seenSeqs.has(event.seq)) {
      duplicates += 1;
      continue;
    }
    state = applyEvent(state, event);
    accepted += 1;
  }
  return { state, accepted, duplicates };
}

/** Replace state with a snapshot's full ordered event list (reconnect). */
export function applySnapshot(incoming: WorkbenchEvent[]): FoldResult {
  const ordered = [...incoming].sort((a, b) => a.seq - b.seq);
  return foldEvents(emptyRunState(), ordered);
}

/** Lifecycle derived purely from the event stream (no backend enum needed). */
export function deriveLifecycle(state: WorkbenchRunState): WorkbenchLifecycle | 'unknown' {
  if (state.terminal === 'completed') return 'completed';
  if (state.terminal === 'failed') return 'failed';
  if (state.terminal === 'cancelled') return 'cancelled';
  if (state.terminal === 'timed_out') return 'timed_out';
  if (!state.hydrated) return 'unknown';
  if (state.waiting || state.paused) return 'paused';
  const types = state.events.map((e) => e.type);
  if (types.includes('stop_requested')) return 'stopping';
  if (types.includes('provisioned')) return 'running';
  if (types.includes('provisioning_started')) return 'provisioning';
  return 'provisioning';
}

/** "step k/n" — k = highest step seen so far (doing or done), n = total. */
export function stepProgress(state: WorkbenchRunState): { current: number; total: number | null } {
  let highest = 0;
  for (const s of state.planSteps) {
    if (s.state === 'doing' || s.state === 'done') highest = Math.max(highest, s.index);
  }
  if (highest === 0 && state.activeStep !== null) highest = state.activeStep;
  return { current: highest, total: state.totalSteps };
}

/** Elapsed ms anchor: from first event until terminal, else until `now`. */
export function elapsedMs(state: WorkbenchRunState, now: number): number | null {
  if (!state.startedAt) return null;
  const start = Date.parse(state.startedAt);
  if (Number.isNaN(start)) return null;
  const end = state.terminal && state.lastAt ? Date.parse(state.lastAt) : now;
  return Math.max(0, end - start);
}

/** mm:ss / h:mm:ss formatter for the elapsed display. */
export function formatElapsed(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * The `Run` state machine — FRANK-§7.3 ("Durable run state").
 *
 * §7.3: "Every transition records actor, time, reason, policy decision,
 * correlation, and evidence." The state diagram is normative and printed
 * verbatim in the spec as a Mermaid stateDiagram-v2. This module transcribes
 * it into executable form.
 *
 * ## Scope: execution lifecycle, not work lifecycle
 *
 * This machine governs a *run* — one execution of an agent assignment against
 * a work item. It is distinct from the `WorkItem` state machine
 * (`work-state.ts`, WORK-004 / FRANK-§11.3), which governs the *work* from
 * inbox to done. A single work item may produce many runs (retries, recovery,
 * rework); each run has its own lifecycle here.
 *
 * The deployment tail (Ready → Merged → ReadyToDeploy → Promoting → Verifying
 * → Released → Completed, with the DeploymentFailed → Recovering →
 * ReleaseReverted → CompletedWithRecovery branch) is part of §7.3's diagram
 * and is transcribed faithfully. Slice 1 does not exercise it — runs stop at
 * `ready` — but the states and transitions exist so the schema is complete
 * from day one and a future slice does not need a migration to add them.
 *
 * ## Where enforcement lives
 *
 * Three layers, same as WORK-004, for the same reason:
 *
 *   1. `run_state_transition` — a lookup table seeded from
 *      {@link LEGAL_RUN_TRANSITIONS} (FRANK-§11.1);
 *   2. a `BEFORE UPDATE` trigger on `run` that rejects any `(OLD.state,
 *      NEW.state)` absent from that table;
 *   3. this module, so the application gets a typed error before the round
 *      trip.
 */

/**
 * FRANK-§7.3, in the order the diagram introduces them. Order is the
 * intake-to-outcome lifecycle order and is used verbatim for the PostgreSQL
 * enum, so `ORDER BY state` is meaningful within a cell.
 *
 * 25 states. The Mermaid diagram is the source of truth; this array is a
 * faithful transcription. `completed_with_recovery` is deliberately distinct
 * from `completed` — §7.3: "CompletedWithRecovery is visibly different from a
 * successful release; it preserves the failed intended outcome and incident
 * link."
 */
export const RUN_STATES = [
  'received',
  'clarifying',
  'planned',
  'queued',
  'running',
  'paused',
  'interrupted',
  'waiting',
  'blocked',
  'reviewing',
  'reworking',
  'ready',
  'merged',
  'ready_to_deploy',
  'promoting',
  'verifying',
  'deployment_failed',
  'recovering',
  'released',
  'release_reverted',
  'completed',
  'completed_with_recovery',
  'partially_completed',
  'failed',
  'cancelled',
] as const;

export type RunState = (typeof RUN_STATES)[number];

/**
 * States from which no transition is legal. A finished run is not re-opened;
 * a retry creates a new run linked to the same work item (FRANK-§7.3:
 * "Failed → Queued: retry permitted" creates a *new* run from `failed`, but
 * terminal outcomes have no outgoing edges).
 *
 * `failed` is deliberately *not* terminal: §7.3 gives it `failed → queued`.
 * `released` is not terminal: it flows to `completed`.
 */
export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'completed',
  'completed_with_recovery',
  'partially_completed',
  'cancelled',
];

/**
 * The legal transition table, transcribed edge-by-edge from §7.3's Mermaid
 * diagram. `from -> to[]`.
 *
 * Notable encodings:
 *
 *   * `running` fans out to eight targets — it is the hub of execution;
 *   * `blocked` can reach `running` and `failed` but NOT `cancelled` — the
 *     diagram omits that edge deliberately (a blocked run is either unblocked
 *     or fails; cancellation of blocked work is a work-item concern, not a
 *     run concern);
 *   * `failed → queued` is the retry path — a new run starts from `queued`,
 *     the failed run stays in `failed` as the audit record;
 *   * `deployment_failed` has exactly one exit (`recovering`); there is no
 *     shortcut to `cancelled` because the deployment tail is policy-gated;
 *   * self-transitions are absent everywhere.
 */
export const LEGAL_RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  received: ['clarifying', 'planned'],
  clarifying: ['planned'],
  planned: ['queued'],
  queued: ['running'],
  running: ['paused', 'interrupted', 'waiting', 'blocked', 'reviewing', 'failed', 'partially_completed', 'cancelled'],
  paused: ['running', 'cancelled'],
  interrupted: ['running', 'cancelled'],
  waiting: ['running', 'failed', 'cancelled'],
  blocked: ['running', 'failed'],
  reviewing: ['reworking', 'ready'],
  reworking: ['reviewing'],
  ready: ['merged', 'ready_to_deploy', 'completed', 'cancelled'],
  merged: ['ready_to_deploy'],
  ready_to_deploy: ['promoting', 'cancelled'],
  promoting: ['verifying', 'deployment_failed'],
  verifying: ['released', 'deployment_failed'],
  deployment_failed: ['recovering'],
  recovering: ['release_reverted'],
  released: ['completed'],
  release_reverted: ['completed_with_recovery'],
  completed: [],
  completed_with_recovery: [],
  partially_completed: [],
  failed: ['queued'],
  cancelled: [],
};

const RUN_STATE_SET: ReadonlySet<string> = new Set<string>(RUN_STATES);

/** Thrown when a transition is not in {@link LEGAL_RUN_TRANSITIONS}. */
export class IllegalRunTransitionError extends Error {
  readonly from: RunState;
  readonly to: RunState;
  readonly runId: string | undefined;

  constructor(from: RunState, to: RunState, runId?: string) {
    const allowed = LEGAL_RUN_TRANSITIONS[from];
    const detail =
      allowed.length === 0
        ? `"${from}" is terminal; create a new run instead of re-opening it`
        : `legal targets from "${from}" are [${allowed.join(', ')}]`;
    super(
      `Illegal run transition "${from}" -> "${to}"${
        runId === undefined ? '' : ` on ${runId}`
      }: ${detail} (FRANK-§7.3).`,
    );
    this.name = 'IllegalRunTransitionError';
    this.from = from;
    this.to = to;
    this.runId = runId;
  }
}

/** Thrown when a value is not in the run state vocabulary at all. */
export class UnknownRunStateError extends Error {
  constructor(value: string) {
    super(
      `${JSON.stringify(value)} is not a run state. ` +
        `Known states: [${RUN_STATES.join(', ')}] (FRANK-§7.3).`,
    );
    this.name = 'UnknownRunStateError';
  }
}

/** True when `value` is one of the stored run states. */
export function isRunState(value: string): value is RunState {
  return RUN_STATE_SET.has(value);
}

/**
 * Map an inbound state name to its stored form. Unlike work items, run states
 * have no aliases — §7.3 spells each state once. Throws on anything outside
 * the vocabulary (FRANK-§2.3 fail-closed).
 */
export function normalizeRunState(value: string): RunState {
  if (isRunState(value)) return value;
  throw new UnknownRunStateError(value);
}

/** True when `from -> to` is legal. Self-transitions are not legal. */
export function canRunTransition(from: RunState, to: RunState): boolean {
  return LEGAL_RUN_TRANSITIONS[from].includes(to);
}

/** Throw {@link IllegalRunTransitionError} unless `from -> to` is legal. */
export function assertRunTransition(from: RunState, to: RunState, runId?: string): void {
  if (!canRunTransition(from, to)) {
    throw new IllegalRunTransitionError(from, to, runId);
  }
}

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

/** Every legal `(from, to)` pair, in stable order. Seeds `run_state_transition`. */
export function legalRunTransitionPairs(): ReadonlyArray<readonly [RunState, RunState]> {
  const pairs: Array<readonly [RunState, RunState]> = [];
  for (const from of RUN_STATES) {
    for (const to of LEGAL_RUN_TRANSITIONS[from]) {
      pairs.push([from, to]);
    }
  }
  return pairs;
}

/** Every `(from, to)` pair that must be rejected. The complement of the above. */
export function illegalRunTransitionPairs(): ReadonlyArray<readonly [RunState, RunState]> {
  const pairs: Array<readonly [RunState, RunState]> = [];
  for (const from of RUN_STATES) {
    for (const to of RUN_STATES) {
      if (!canRunTransition(from, to)) pairs.push([from, to]);
    }
  }
  return pairs;
}

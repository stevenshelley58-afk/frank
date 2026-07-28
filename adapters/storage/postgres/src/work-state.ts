/**
 * The `WorkItem` state machine — WORK-004, FRANK-§11.3, FRANK-§11.2 ("StateTransition").
 *
 * WORK-004: "Waiting, blocked, scheduled, active, reviewing, completed,
 * cancelled, and failed states must be explicit. Invalid transitions are
 * rejected and valid transitions are audited."
 *
 * ## Reconciling two state vocabularies
 *
 * The specification names the work states twice and the two lists differ:
 *
 *   FRANK-§11.3 (normative aggregate) — inbox, planned, ready, active, waiting,
 *                                       blocked, reviewing, done, cancelled
 *   WORK-004    (requirement row)     — waiting, blocked, scheduled, active,
 *                                       reviewing, completed, cancelled, failed
 *
 * §11.3 has an intake lifecycle (`inbox`, `planned`, `ready`) that WORK-004 does
 * not mention. WORK-004 has `scheduled` and `failed`, which §11.3 does not
 * contain — `failed` in particular cannot be folded into `cancelled` without
 * losing the difference between "we stopped this" and "this broke", and every
 * run-bearing item (`agent_job`) needs it.
 *
 * Resolution, and this is the one place a judgement call was needed:
 *
 *   * the enum is the **union** — neither list is a superset, and dropping
 *     either would make a requirement unimplementable;
 *   * where the two lists disagree only on spelling — §11.3 `done` versus
 *     WORK-004 `completed` — §11.3 wins, because §11.3 is labelled "normative"
 *     and prints a literal TypeScript union while WORK-004 states the concept in
 *     prose. Two enum members meaning "finished" would be strictly worse than
 *     one;
 *   * `completed` is kept addressable as an alias (see {@link normalizeWorkState})
 *     so WORK-004's vocabulary can be used verbatim at the API boundary without
 *     a second state existing in the database.
 *
 * ## Where enforcement lives
 *
 * WORK-004 says invalid transitions are *rejected*, not "rejected by the service
 * layer". So the legal set is enforced three times, on purpose:
 *
 *   1. `work_state_transition` — a real lookup table seeded from
 *      {@link LEGAL_WORK_TRANSITIONS} (FRANK-§11.1: "Enumerations enforced by
 *      schema or lookup tables, not arbitrary strings");
 *   2. a `BEFORE UPDATE` trigger on `work_item` that fails the statement when
 *      `(OLD.state, NEW.state)` is absent from that table — so a psql session, a
 *      migration script, or a future service that forgets the repository cannot
 *      write an illegal state;
 *   3. this module, so the application gets a typed error with a useful message
 *      before it spends a round trip.
 *
 * Layer 3 alone would be the mistake the requirement is warning about.
 */

/**
 * FRANK-§11.3 ∪ WORK-004. Order is the intake-to-outcome lifecycle order and is
 * used verbatim for the PostgreSQL enum, so `ORDER BY state` is meaningful.
 */
export const WORK_STATES = [
  'inbox',
  'planned',
  'ready',
  'scheduled',
  'waiting',
  'blocked',
  'active',
  'reviewing',
  'done',
  'cancelled',
  'failed',
] as const;

export type WorkState = (typeof WORK_STATES)[number];

/**
 * States from which no transition is legal. A terminal item is re-opened by
 * creating a successor item that links back, not by mutating history — that is
 * what keeps WORK-003's "reassignment retains history" true for outcomes too.
 *
 * `failed` is deliberately *not* terminal: a failed agent job is retried, and
 * WORK-005's retry semantics need somewhere to go.
 */
export const TERMINAL_WORK_STATES: readonly WorkState[] = ['done', 'cancelled'];

/**
 * The legal transition table. `from -> to[]`.
 *
 * Rules encoded here:
 *
 *   * nothing reaches `done` except `active` or `reviewing` — work cannot be
 *     completed from the inbox, which is the invariant that makes "completed"
 *     mean "someone or something did it";
 *   * `cancelled` is reachable from every non-terminal state, because the owner
 *     can always stop work (FRANK-§4.14 OPS-003);
 *   * `failed` is reachable only from states where execution was actually under
 *     way (`active`, `reviewing`, `waiting`, `blocked`), for the same reason;
 *   * self-transitions are absent. `active -> active` is a no-op, and recording
 *     one would put a meaningless row in the audited history.
 */
export const LEGAL_WORK_TRANSITIONS: Readonly<Record<WorkState, readonly WorkState[]>> = {
  inbox: ['planned', 'ready', 'scheduled', 'waiting', 'blocked', 'cancelled'],
  planned: ['ready', 'scheduled', 'waiting', 'blocked', 'cancelled'],
  ready: ['scheduled', 'active', 'waiting', 'blocked', 'cancelled'],
  scheduled: ['ready', 'active', 'waiting', 'blocked', 'cancelled'],
  waiting: ['ready', 'scheduled', 'active', 'blocked', 'cancelled', 'failed'],
  blocked: ['ready', 'scheduled', 'active', 'waiting', 'cancelled', 'failed'],
  active: ['reviewing', 'waiting', 'blocked', 'done', 'cancelled', 'failed'],
  reviewing: ['active', 'waiting', 'blocked', 'done', 'cancelled', 'failed'],
  done: [],
  cancelled: [],
  failed: ['ready', 'scheduled', 'active', 'cancelled'],
};

/**
 * WORK-004 spells the finished state "completed"; FRANK-§11.3 spells it "done".
 * Accepted at the boundary, normalized to one stored value.
 */
const WORK_STATE_ALIASES: Readonly<Record<string, WorkState>> = {
  completed: 'done',
  complete: 'done',
};

const WORK_STATE_SET: ReadonlySet<string> = new Set<string>(WORK_STATES);

/** Thrown when a transition is not in {@link LEGAL_WORK_TRANSITIONS}. */
export class IllegalWorkTransitionError extends Error {
  readonly from: WorkState;
  readonly to: WorkState;
  readonly workItemId: string | undefined;

  constructor(from: WorkState, to: WorkState, workItemId?: string) {
    const allowed = LEGAL_WORK_TRANSITIONS[from];
    const detail =
      allowed.length === 0
        ? `"${from}" is terminal; create a successor work item instead of re-opening it`
        : `legal targets from "${from}" are [${allowed.join(', ')}]`;
    super(
      `Illegal work item transition "${from}" -> "${to}"${
        workItemId === undefined ? '' : ` on ${workItemId}`
      }: ${detail} (WORK-004).`,
    );
    this.name = 'IllegalWorkTransitionError';
    this.from = from;
    this.to = to;
    this.workItemId = workItemId;
  }
}

/** Thrown when a value is not in the state vocabulary at all. */
export class UnknownWorkStateError extends Error {
  constructor(value: string) {
    super(
      `${JSON.stringify(value)} is not a work item state. ` +
        `Known states: [${WORK_STATES.join(', ')}] (WORK-004, FRANK-§11.3).`,
    );
    this.name = 'UnknownWorkStateError';
  }
}

/** True when `value` is one of the stored states. Does not accept aliases. */
export function isWorkState(value: string): value is WorkState {
  return WORK_STATE_SET.has(value);
}

/**
 * Map an inbound state name to its stored form, resolving WORK-004's
 * `completed` to §11.3's `done`. Throws on anything outside the vocabulary —
 * FRANK-§2.3's fail-closed rule applied to enumerations.
 */
export function normalizeWorkState(value: string): WorkState {
  if (isWorkState(value)) return value;
  const alias = WORK_STATE_ALIASES[value];
  if (alias !== undefined) return alias;
  throw new UnknownWorkStateError(value);
}

/** True when `from -> to` is legal. Self-transitions are not legal. */
export function canTransition(from: WorkState, to: WorkState): boolean {
  return LEGAL_WORK_TRANSITIONS[from].includes(to);
}

/** Throw {@link IllegalWorkTransitionError} unless `from -> to` is legal. */
export function assertTransition(from: WorkState, to: WorkState, workItemId?: string): void {
  if (!canTransition(from, to)) {
    throw new IllegalWorkTransitionError(from, to, workItemId);
  }
}

export function isTerminalWorkState(state: WorkState): boolean {
  return TERMINAL_WORK_STATES.includes(state);
}

/** Every legal `(from, to)` pair, in stable order. Seeds `work_state_transition`. */
export function legalTransitionPairs(): ReadonlyArray<readonly [WorkState, WorkState]> {
  const pairs: Array<readonly [WorkState, WorkState]> = [];
  for (const from of WORK_STATES) {
    for (const to of LEGAL_WORK_TRANSITIONS[from]) {
      pairs.push([from, to]);
    }
  }
  return pairs;
}

/** Every `(from, to)` pair that must be rejected. The complement of the above. */
export function illegalTransitionPairs(): ReadonlyArray<readonly [WorkState, WorkState]> {
  const pairs: Array<readonly [WorkState, WorkState]> = [];
  for (const from of WORK_STATES) {
    for (const to of WORK_STATES) {
      if (!canTransition(from, to)) pairs.push([from, to]);
    }
  }
  return pairs;
}

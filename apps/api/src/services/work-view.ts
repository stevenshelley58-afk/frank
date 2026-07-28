/**
 * WORK-006 projection — "All work must expose 'why now', 'definition of done',
 * and 'next safe action'."
 *
 * ## Why this is computed rather than read straight through
 *
 * The three columns exist in `adapters/storage/postgres` and are nullable there,
 * because a row can be written by a path that does not know what to put in them.
 * WORK-006's acceptance evidence is "UI and API contract tests", and a contract
 * test against a nullable field proves nothing: `null` satisfies
 * `string | null`.
 *
 * So the wire schema makes all three required and non-null, and this module is
 * where a missing value becomes an explicit statement rather than an absence.
 * `whyNowFor` on an item with no stored `why_now` returns "no reason was
 * recorded when this was created" — which is *information*, and is the honest
 * answer, and is visibly worse than a real one so it does not survive review.
 *
 * ## "Next safe action" means safe, not next
 *
 * The important word is `safe`. The action offered is derived from the WORK-004
 * transition table, so it is always a legal transition, and each carries a
 * `safety` sentence saying what it cannot do. A "next action" that the state
 * machine would reject is not an action, and one whose consequences are not
 * stated is not safe — it is just next.
 */

import { LEGAL_WORK_TRANSITIONS, isTerminalWorkState } from '@frank/adapter-postgres';
import type { WorkState } from '@frank/adapter-postgres';

import type { WorkItemRecord } from './store.js';

export interface WorkGuidance {
  readonly whyNow: string;
  readonly definitionOfDone: ReadonlyArray<{
    readonly id: string;
    readonly statement: string;
    readonly verification: string;
  }>;
  readonly nextSafeAction: {
    readonly label: string;
    readonly command: string | null;
    readonly safety: string;
  };
}

/**
 * The command name for a transition. One name per target state, so a client
 * calls `/commands/start` rather than posting a state string — FRANK-§12.2's
 * "`POST /{resources}/{id}/commands/{command}` — Explicit state transition".
 *
 * A verb, not a state, because a command is something you do and the server owns
 * the mapping from doing to becoming. It is also what stops a client from
 * inventing a transition by naming a state the table does not permit.
 */
export const TRANSITION_COMMANDS: Readonly<Record<string, WorkState>> = {
  plan: 'planned',
  ready: 'ready',
  schedule: 'scheduled',
  start: 'active',
  wait: 'waiting',
  block: 'blocked',
  review: 'reviewing',
  complete: 'done',
  cancel: 'cancelled',
  fail: 'failed',
};

const COMMAND_FOR_STATE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TRANSITION_COMMANDS).map(([command, state]) => [state, command]),
);

/** Plain-language label per command. FRANK-§3.1's design direction. */
const COMMAND_LABELS: Readonly<Record<string, string>> = {
  plan: 'Plan this',
  ready: 'Mark ready to start',
  schedule: 'Schedule it',
  start: 'Start work',
  wait: 'Mark as waiting on something',
  block: 'Mark as blocked',
  review: 'Send for review',
  complete: 'Mark complete',
  cancel: 'Cancel this',
  fail: 'Record that this failed',
};

/**
 * What each command cannot do. Shown to the user next to the action.
 *
 * These are claims the system can actually keep in Slice 1: every one of these
 * commands is a state change inside the cell with an audit entry and no external
 * side effect, which is why they are all `internal_reversible` in the FRANK-§7.6
 * mapping and why none of them needs a standing authorization.
 */
const COMMAND_SAFETY: Readonly<Record<string, string>> = {
  plan: 'Changes only this item’s state. Nothing is sent, spent, or deleted.',
  ready: 'Changes only this item’s state. Nothing is sent, spent, or deleted.',
  schedule: 'Changes only this item’s state. Nothing is sent, spent, or deleted.',
  start: 'Records that work began. No external system is contacted.',
  wait: 'Records that this is waiting. Nothing is sent, spent, or deleted.',
  block: 'Records a blockage and emits work.blocked. No external system is contacted.',
  review: 'Moves this into review. No change is promoted and nothing is published.',
  complete:
    'Records completion and emits work.completed. Terminal: reopening means creating a successor item, so history is never rewritten.',
  cancel:
    'Stops this item. Terminal and audited; the history and any linked sources are retained.',
  fail: 'Records a failure so it can be retried. Nothing is deleted.',
};

/** The command a state suggests as the natural next step, when there is one. */
const PREFERRED_NEXT: Readonly<Record<WorkState, WorkState | null>> = {
  inbox: 'planned',
  planned: 'ready',
  ready: 'active',
  scheduled: 'active',
  waiting: 'ready',
  blocked: 'ready',
  active: 'reviewing',
  reviewing: 'done',
  done: null,
  cancelled: null,
  failed: 'ready',
};

const STATE_REASONS: Readonly<Record<WorkState, string>> = {
  inbox: 'This was captured and has not been triaged yet.',
  planned: 'This is planned but has no start commitment yet.',
  ready: 'This is ready to start and nothing is blocking it.',
  scheduled: 'This is scheduled and its time is approaching.',
  waiting: 'This is waiting on something outside your control.',
  blocked: 'This is blocked and needs the blockage cleared before it can move.',
  active: 'Work is under way on this right now.',
  reviewing: 'This is finished and waiting for a review decision.',
  done: 'This is complete. It appears here only for context.',
  cancelled: 'This was cancelled. It appears here only for context.',
  failed: 'This failed and can be retried once the cause is understood.',
};

export function whyNowFor(item: WorkItemRecord, now: Date): string {
  if (item.whyNow !== null && item.whyNow.trim().length > 0) return item.whyNow;

  const parts = [STATE_REASONS[item.state]];
  if (item.dueAt !== null) {
    const hours = Math.round((item.dueAt.getTime() - now.getTime()) / 3_600_000);
    parts.push(
      hours < 0
        ? `It was due ${formatHours(-hours)} ago.`
        : `It is due in ${formatHours(hours)}.`,
    );
  }
  if (item.priority === 'critical' || item.priority === 'high') {
    parts.push(`Its priority is ${item.priority}.`);
  }
  return parts.join(' ');
}

function formatHours(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? '' : 's'}`;
  return `${String(Math.round(hours / 24))} days`;
}

/**
 * WORK-006's "definition of done".
 *
 * When the item has none stored, the substitute is a single criterion that says
 * so and names its own verification. It reads badly on purpose: an item whose
 * definition of done is "somebody should write one" is an item that shows up in
 * review as incomplete, which is the correct outcome and better than a blank
 * field that looks finished.
 */
export function definitionOfDoneFor(item: WorkItemRecord): WorkGuidance['definitionOfDone'] {
  if (item.definitionOfDone.length > 0) return item.definitionOfDone;
  return [
    {
      id: 'dod-unset',
      statement: `No definition of done was recorded for "${item.title}".`,
      verification:
        'Set one before completing this item; WORK-006 requires every work item to state how it will be verified.',
    },
  ];
}

export function nextSafeActionFor(item: WorkItemRecord): WorkGuidance['nextSafeAction'] {
  if (isTerminalWorkState(item.state)) {
    return {
      label: 'No further action',
      command: null,
      safety: `"${item.state}" is terminal. Reopening is done by creating a successor item that links back, so the history of this one is never rewritten (WORK-003).`,
    };
  }

  const preferred = PREFERRED_NEXT[item.state];
  const legal = LEGAL_WORK_TRANSITIONS[item.state];
  const target = preferred !== null && legal.includes(preferred) ? preferred : legal[0];

  if (target === undefined) {
    return {
      label: 'No further action',
      command: null,
      safety: `No legal transition exists from "${item.state}".`,
    };
  }

  const command = COMMAND_FOR_STATE[target];
  if (command === undefined) {
    return {
      label: `Move to ${target}`,
      command: null,
      safety: 'No command is exposed for this transition in Slice 1.',
    };
  }

  // A stored `next_safe_action` overrides the derived label but never the
  // command or the safety statement: those are facts about the state machine,
  // and a free-text column must not be able to offer an action the machine would
  // reject.
  const label =
    item.nextSafeAction !== null && item.nextSafeAction.trim().length > 0
      ? item.nextSafeAction
      : (COMMAND_LABELS[command] ?? `Move to ${target}`);

  return {
    label,
    command,
    safety: COMMAND_SAFETY[command] ?? 'Changes only this item’s state.',
  };
}

export function guidanceFor(item: WorkItemRecord, now: Date): WorkGuidance {
  return {
    whyNow: whyNowFor(item, now),
    definitionOfDone: definitionOfDoneFor(item),
    nextSafeAction: nextSafeActionFor(item),
  };
}

/**
 * FRANK-§12.2: "GET /{resources}/{id} — … and available commands."
 *
 * Every legal transition from the item's current state, as a command a client
 * can call. Derived from the same table the database trigger consults, so the
 * list can never offer something the write path would reject.
 */
export function availableCommandsFor(
  item: WorkItemRecord,
): ReadonlyArray<{ command: string; toState: WorkState; label: string }> {
  return LEGAL_WORK_TRANSITIONS[item.state]
    .map((toState) => {
      const command = COMMAND_FOR_STATE[toState];
      if (command === undefined) return undefined;
      return { command, toState, label: COMMAND_LABELS[command] ?? `Move to ${toState}` };
    })
    .filter((entry): entry is { command: string; toState: WorkState; label: string } =>
      entry !== undefined,
    );
}

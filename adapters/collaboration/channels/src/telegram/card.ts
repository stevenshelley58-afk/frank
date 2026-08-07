/**
 * CH-04 — render a Frank `DecisionRequest` as Telegram card IR
 * (channels-ui `ChannelNode`s; the SDK's `renderTelegram` turns the IR into
 * the Bot API payload, enforcing `TELEGRAM_LIMITS` via `truncateText`).
 *
 * The card is a projection of Frank's canonical decision work item
 * (ADR-022): room, requested action, why now, next safe action, and material
 * evidence. It never decides anything; tapping a button relays an untrusted
 * proposal to Frank, which validates actor + work item + expected version
 * before any state changes.
 *
 * ## IR construction rules (verified against channels-telegram 0.7.3)
 *
 * `ChannelNode` is `{ type, props, key? }` — JSX convention:
 *   - children live in `props.children` (never a top-level `children`);
 *   - text nodes carry their string in `props.value`;
 *   - `field` reads `props.label` + children; `divider` takes no children;
 *   - `button` binds via `props.onClick = { id }` (the ActionRegistry-stamped
 *     id) or `props.value`; the telegram renderer turns that into
 *     `callback_data`.
 */

import type { DecisionRequest } from '@frank/contracts';

import type { ChannelNode } from '@copilotkit/channels';

/** The registered decision-card component's name (M12: registered component ⇒ restart-safe action dispatch). */
export const DECISION_CARD_COMPONENT = 'FrankDecisionCard';

/** A button the card presents. `actionId` is the registered action (ActionRegistry) the tap dispatches. */
export interface DecisionCardButton {
  actionId: string;
  label: string;
  /** FRANK command verb the button proposes ('ready' | 'cancel'). */
  verb: string;
}

/**
 * Evidence lines are plain text projections of Frank evidence; the card caps
 * them so the message budget is bounded regardless of the work item's history.
 */
export const MAX_EVIDENCE_LINES = 5;

/* ------------------------------------------------------------------ */
/* IR node helpers (the only place that knows the channels-ui shape)  */
/* ------------------------------------------------------------------ */

function text(value: string): ChannelNode {
  return { type: 'text', props: { value } };
}

function container(type: string, children: ChannelNode[]): ChannelNode {
  return { type, props: { children } };
}

function field(label: string, value: string): ChannelNode {
  return { type: 'field', props: { label, children: [text(value)] } };
}

/* ------------------------------------------------------------------ */
/* card rendering                                                     */
/* ------------------------------------------------------------------ */

/**
 * Render the decision card as IR for state `state`:
 *   - `'pending'`  — the live card with Approve/Deny buttons.
 *   - `'resolved'` — the same context with a terminal footer, no buttons
 *     (nothing left to tap; re-taps cannot exist).
 *   - `'expired'`  — the same context with an expiry footer, no buttons.
 *
 * `footerText`, when given, replaces the default state footer (the listener
 * uses it to say "approved by …" / "already resolved").
 */
export function renderDecisionCardIR(
  request: DecisionRequest,
  state: 'pending' | 'resolved' | 'expired',
  buttons: readonly DecisionCardButton[],
  footerText?: string,
): ChannelNode[] {
  const c = request.content;
  const evidenceLines = blocksToEvidenceLines(c.blocks).slice(0, MAX_EVIDENCE_LINES);

  const fields: ChannelNode[] = [];
  fields.push(field('Action', requestedActionLabel(request)));
  const why = whyNowOf(request);
  if (why) fields.push(field('Why now', why));
  const next = nextSafeActionOf(request);
  if (next) fields.push(field('Next safe action', next));

  const children: ChannelNode[] = [
    container('header', [text(truncateTitle(c.title))]),
    container('section', fields),
  ];

  if (evidenceLines.length > 0) {
    children.push(
      container('section', [
        text('Evidence'),
        ...evidenceLines.map((line) => text(`• ${line}`)),
      ]),
    );
  }

  if (state === 'pending') {
    children.push(
      container(
        'actions',
        buttons.map((b) => ({
          type: 'button',
          props: { onClick: { id: b.actionId }, children: [text(b.label)] },
        })),
      ),
    );
  } else {
    const footer =
      footerText ??
      (state === 'resolved' ? '✓ Resolved in Frank' : '⏱ Offer expired — no action was taken');
    children.push({ type: 'divider', props: {} });
    children.push(text(footer));
  }

  return [container('message', children)];
}

/** Props persisted for the registered component (restart-safe re-render). */
export interface DecisionCardProps {
  requestId: string;
  roomId: string;
  title: string;
  actionLabel: string;
  whyNow?: string;
  nextSafeAction?: string;
  evidence: string[];
  buttons: { actionId: string; label: string; verb: string }[];
  /** Terminal footer when the card is no longer actionable. */
  footer?: string;
}

/** Extract card props from a `DecisionRequest` (single source of truth). */
export function decisionCardPropsFromRequest(request: DecisionRequest): DecisionCardProps {
  const props: DecisionCardProps = {
    requestId: request.requestId,
    roomId: request.roomId,
    title: request.content.title,
    actionLabel: requestedActionLabel(request),
    evidence: blocksToEvidenceLines(request.content.blocks).slice(0, MAX_EVIDENCE_LINES),
    buttons: request.content.actions.map((a) => ({
      actionId: a.actionId,
      label: a.label,
      verb: a.verb,
    })),
  };
  const why = whyNowOf(request);
  if (why) props.whyNow = why;
  const next = nextSafeActionOf(request);
  if (next) props.nextSafeAction = next;
  return props;
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

/** Human-facing label for the requested action (first action wins; decisions offer Approve/Deny pairs). */
function requestedActionLabel(request: DecisionRequest): string {
  const first = request.content.actions[0];
  if (!first) return request.content.title;
  const verbs = request.content.actions.map((a) => a.verb);
  if (verbs.includes('ready') && verbs.includes('cancel')) {
    return `${request.content.title} — approve or deny`;
  }
  return first.label;
}

/** WORK-006 guidance lives in the content blocks as `why_now:` / `next_safe_action:` lines. */
function whyNowOf(request: DecisionRequest): string | undefined {
  return labeledBlock(request, 'why_now');
}

function nextSafeActionOf(request: DecisionRequest): string | undefined {
  return labeledBlock(request, 'next_safe_action');
}

function labeledBlock(request: DecisionRequest, label: string): string | undefined {
  const prefix = `${label}:`;
  for (const block of request.content.blocks) {
    const t = block.text.trim();
    if (t.toLowerCase().startsWith(prefix.toLowerCase())) {
      return t.slice(prefix.length).trim();
    }
  }
  return undefined;
}

/** Evidence lines = content blocks that are not guidance labels. */
export function blocksToEvidenceLines(blocks: readonly { kind: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const t = block.text.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (lower.startsWith('why_now:') || lower.startsWith('next_safe_action:')) continue;
    out.push(t);
  }
  return out;
}

/** Titles are short by contract; clamp defensively. */
function truncateTitle(title: string): string {
  return title.length > 200 ? `${title.slice(0, 199)}…` : title;
}

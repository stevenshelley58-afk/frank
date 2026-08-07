/**
 * CH-03/CH-04 — render a Frank decision as Telegram message content.
 *
 * Produces the two things `sendMessage` needs: an HTML body (parse_mode HTML)
 * and the inline keyboard. This is a DIRECT projection of the DecisionRequest
 * (not a round-trip through the generic ChannelNode IR), so the adapter stays
 * self-contained and unit-testable without the SDK runtime (M12 isolation).
 *
 * Authority posture: the card is a projection of canonical Frank state. The
 * buttons carry opaque callback data that maps back to a durable registration;
 * tapping one never decides anything — resolution flows through the command
 * envelope (CH-04).
 */

import type { DecisionRequest } from '@frank/contracts';

import { MAX_EVIDENCE_LINES, blocksToEvidenceLines } from './card.js';

export interface RenderedDecisionCard {
  /** HTML body for parse_mode=HTML. */
  html: string;
  /** One inline-keyboard row per action (Approve / Deny). */
  buttons: Array<{ text: string; callbackData: string }>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

/**
 * Render the decision card for a given lifecycle state:
 *   'pending'  — live card with buttons
 *   'resolved' — terminal footer, no buttons
 *   'expired'  — expiry footer, no buttons
 */
export function renderDecisionCard(
  request: DecisionRequest,
  state: 'pending' | 'resolved' | 'expired',
  /** Callback-data prefix for this registration; buttons append the verb. */
  callbackPrefix: string,
  footerText?: string,
): RenderedDecisionCard {
  const c = request.content;
  const lines: string[] = [];

  lines.push(`<b>${escapeHtml(c.title)}</b>`);

  const why = labeledBlock(request, 'why_now');
  const next = labeledBlock(request, 'next_safe_action');
  if (why) lines.push(`<b>Why now:</b> ${escapeHtml(why)}`);
  if (next) lines.push(`<b>Next safe action:</b> ${escapeHtml(next)}`);

  const evidence = blocksToEvidenceLines(c.blocks).slice(0, MAX_EVIDENCE_LINES);
  if (evidence.length > 0) {
    lines.push('<b>Evidence:</b>');
    for (const ev of evidence) lines.push(`• ${escapeHtml(ev)}`);
  }

  const buttons: RenderedDecisionCard['buttons'] = [];

  if (state === 'pending') {
    for (const action of c.actions) {
      buttons.push({
        text: action.label,
        // callback_data must stay <= 64 bytes; the registration id is short and
        // the verb is one of a fixed set, so this is safe in practice.
        callbackData: `${callbackPrefix}:${action.verb}`,
      });
    }
  } else {
    const footer =
      footerText ??
      (state === 'resolved' ? '✓ Resolved in Frank' : '⏱ Offer expired — no action was taken');
    lines.push(`\n${escapeHtml(footer)}`);
  }

  return { html: lines.join('\n'), buttons };
}

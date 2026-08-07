/**
 * CH-04 unit tests — decision card IR + secret hygiene.
 *
 * Pure logic: no database, no SDK transport. Asserts the IR shape the
 * telegram renderer consumes (verified against channels-telegram 0.7.3):
 * children in `props.children`, text in `props.value`, buttons bound via
 * `props.onClick.id`, and the card's three lifecycle states.
 */

import { describe, expect, it } from 'vitest';

import type { DecisionRequest } from '@frank/contracts';

import {
  DECISION_CARD_COMPONENT,
  MAX_EVIDENCE_LINES,
  blocksToEvidenceLines,
  decisionCardPropsFromRequest,
  renderDecisionCardIR,
} from './card.js';
import {
  REDACTED_PLACEHOLDER,
  createRedactingConsole,
  redactLine,
  redactSecret,
} from '../secrets.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */

function decisionRequest(overrides?: Partial<DecisionRequest>): DecisionRequest {
  return {
    requestId: 'req_1',
    cellId: 'cell_1',
    roomId: 'room:ops',
    workItemId: 'wi_1',
    expectedVersion: 4,
    content: {
      schema: 'frank.channel-content/v1',
      contentId: 'content_1',
      cellId: 'cell_1',
      roomId: 'room:ops',
      workItemId: 'wi_1',
      title: 'Deploy preview to frank.fail',
      blocks: [
        { kind: 'text', text: 'why_now: release window closes tonight' },
        { kind: 'text', text: 'next_safe_action: approve the preview deploy' },
        { kind: 'text', text: 'diff touches 3 files, tests green' },
      ],
      actions: [
        {
          actionId: 'act_approve',
          label: 'Approve',
          verb: 'ready',
          targetObjectId: 'wi_1',
          targetObjectType: 'work_item',
        },
        {
          actionId: 'act_deny',
          label: 'Deny',
          verb: 'cancel',
          targetObjectId: 'wi_1',
          targetObjectType: 'work_item',
        },
      ],
      createdAt: '2026-08-07T00:00:00Z',
    },
    createdAt: '2026-08-07T00:00:00Z',
    ...overrides,
  };
}

type AnyNode = {
  type: string;
  props: { children?: unknown; value?: string; label?: string; onClick?: { id?: string } };
};

function childrenOf(node: AnyNode): AnyNode[] {
  const c = node.props?.children;
  return Array.isArray(c) ? (c as AnyNode[]) : [];
}

function collectText(node: AnyNode): string {
  if (node.type === 'text') return node.props.value ?? '';
  return childrenOf(node).map(collectText).join('');
}

function findNodes(root: AnyNode[], type: string): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (n.type === type) out.push(n);
      walk(childrenOf(n));
    }
  };
  walk(root);
  return out;
}

/* ------------------------------------------------------------------ */
/* card IR                                                            */
/* ------------------------------------------------------------------ */

describe('renderDecisionCardIR', () => {
  it('wraps everything in a single message node', () => {
    const ir = renderDecisionCardIR(decisionRequest(), 'pending', [
      { actionId: 'act_approve', label: 'Approve', verb: 'ready' },
    ]);
    expect(ir).toHaveLength(1);
    expect(ir[0]!.type).toBe('message');
  });

  it('pending state renders title, fields, evidence, and buttons', () => {
    const req = decisionRequest();
    const ir = renderDecisionCardIR(req, 'pending', [
      { actionId: 'act_approve', label: 'Approve', verb: 'ready' },
      { actionId: 'act_deny', label: 'Deny', verb: 'cancel' },
    ]) as AnyNode[];

    expect(collectText(ir[0]!)).toContain('Deploy preview to frank.fail');

    const fields = findNodes(ir, 'field');
    const labels = fields.map((f) => f.props.label);
    expect(labels).toContain('Action');
    expect(labels).toContain('Why now');
    expect(labels).toContain('Next safe action');

    const buttons = findNodes(ir, 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.props.onClick?.id)).toEqual(['act_approve', 'act_deny']);
    expect(collectText(ir[0]!)).toContain('diff touches 3 files');
  });

  it('guidance blocks (why_now / next_safe_action) are not evidence lines', () => {
    const lines = blocksToEvidenceLines(decisionRequest().content.blocks);
    expect(lines).toEqual(['diff touches 3 files, tests green']);
  });

  it('evidence is capped at MAX_EVIDENCE_LINES', () => {
    const req = decisionRequest();
    req.content.blocks = Array.from({ length: 12 }, (_, i) => ({
      kind: 'text' as const,
      text: `evidence line ${i}`,
    }));
    const props = decisionCardPropsFromRequest(req);
    expect(props.evidence).toHaveLength(MAX_EVIDENCE_LINES);
  });

  it('resolved state drops buttons and adds the default terminal footer', () => {
    const ir = renderDecisionCardIR(decisionRequest(), 'resolved', []) as AnyNode[];
    expect(findNodes(ir, 'button')).toHaveLength(0);
    expect(findNodes(ir, 'divider')).toHaveLength(1);
    expect(collectText(ir[0]!)).toContain('Resolved in Frank');
  });

  it('expired state renders the expiry footer and a custom footer wins', () => {
    const expired = renderDecisionCardIR(decisionRequest(), 'expired', []) as AnyNode[];
    expect(collectText(expired[0]!)).toContain('expired');

    const custom = renderDecisionCardIR(decisionRequest(), 'resolved', [], 'Approved by Steven') as AnyNode[];
    expect(collectText(custom[0]!)).toContain('Approved by Steven');
    expect(collectText(custom[0]!)).not.toContain('Resolved in Frank');
  });

  it('action label reads approve-or-deny when both verbs are offered', () => {
    const props = decisionCardPropsFromRequest(decisionRequest());
    expect(props.actionLabel).toContain('approve or deny');
  });

  it('exposes the registered component name', () => {
    expect(DECISION_CARD_COMPONENT).toBe('FrankDecisionCard');
  });
});

/* ------------------------------------------------------------------ */
/* CH-05 secret hygiene                                               */
/* ------------------------------------------------------------------ */

describe('secret redaction (CH-05)', () => {
  const TOKEN = '123456789:AAEhBP0av7pQbX0Y2k3j4d5e6f7g8h9i0j1';

  it('redactLine masks telegram bot tokens', () => {
    const line = `booting with token ${TOKEN} on telegram`;
    const out = redactLine(line);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain(REDACTED_PLACEHOLDER);
  });

  it('redactSecret never returns the secret', () => {
    expect(redactSecret(TOKEN)).not.toContain(TOKEN.slice(10));
    expect(redactSecret('short')).toBe('****');
  });

  it('createRedactingConsole scrubs every string argument', () => {
    const captured: unknown[][] = [];
    const sink = {
      log: (...a: unknown[]) => captured.push(a),
      info: (...a: unknown[]) => captured.push(a),
      warn: (...a: unknown[]) => captured.push(a),
      error: (...a: unknown[]) => captured.push(a),
    };
    const console_ = createRedactingConsole(sink);
    console_.info(`token=${TOKEN}`, { unrelated: 1 });
    expect(captured).toHaveLength(1);
    expect(String(captured[0]![0])).not.toContain(TOKEN);
    expect(captured[0]![1]).toEqual({ unrelated: 1 });
  });
});

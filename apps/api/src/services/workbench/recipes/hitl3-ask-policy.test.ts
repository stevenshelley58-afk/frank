/**
 * HITL-03 — ask less, record assumptions.
 *
 * Master plan §8F HITL-03: the recipe and harness guidance must ask the human
 * ONLY when the path is irreversible, destructive, spend-gated, cross-fence,
 * or explicitly policy-gated. Reversible assumptions go into the receipt's
 * `assumptions[]` array instead of pausing the run.
 *
 * Proven here at the recipe/protocol layer (the decision seam of HITL-01/02
 * is NOT touched):
 *   1. buildHeadlessInstruction carries the full WHEN-TO-ASK policy — all five
 *      ask-triggers and the "otherwise record the assumption and proceed"
 *      directive.
 *   2. A representative task that makes ONLY reversible assumptions runs to a
 *      done receipt with assumptions[] populated and creates ZERO decision
 *      work items — no pause, no `decision_requested`/`paused` events.
 */

import { describe, expect, it } from 'vitest';

import type { AgentHarnessAdapter } from '@frank/contracts';

import { HarnessExecutor } from '../harness-executor.js';
import {
  ASK_POLICY_TRIGGERS,
  PROTOCOL_MARKERS,
  buildHeadlessInstruction,
  parseHarnessText,
} from './headless-protocol.js';
import { GooseHeadlessHarnessAdapter } from './goose-headless.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from '../types.js';

/* --------------------------------------------------------------- fixtures --- */

/** A task whose every open question has a cheap, reversible default. */
const TASK_DEF: WorkbenchTaskDef = {
  instruction:
    'Summarize the support export and pick a tone for the summary. ' +
    'Do NOT send or publish anything; write the summary under /workspace/out.',
  mounts: [{ source: '/srv/data', path: '/mnt/data', mode: 'ro' }],
  harness: { adapter: 'goose' },
  skills: [],
  leash: { wallClockSec: 600 },
  network: { egressAllowlist: [] },
};

/**
 * Transcript of a run that honors HITL-03: tone and date-range choices are
 * reversible, so the agent ASSUMES them (receipt `assumptions[]`) and never
 * asks. No irreversible/destructive/spend-gated/cross-fence/policy-gated
 * action occurs, so no decision is requested.
 */
const TRANSCRIPT = `preamble
${PROTOCOL_MARKERS.planBegin}
1. Load the support export from /mnt/data
2. Summarize it in a neutral tone
3. Write the summary under /workspace/out
${PROTOCOL_MARKERS.planEnd}
working
${PROTOCOL_MARKERS.stepPrefix} 1 done
${PROTOCOL_MARKERS.stepPrefix} 2 done
${PROTOCOL_MARKERS.stepPrefix} 3 done
${PROTOCOL_MARKERS.artifactPrefix} /workspace/out/summary.md document
${PROTOCOL_MARKERS.receiptBegin}
{"summary":"Support export summarized.","assumptions":["tone: neutral (reversible — rewrite is cheap)","date range: last 30 days (reversible — re-run widens it)"],"evidence":["/workspace/out/summary.md"]}
${PROTOCOL_MARKERS.receiptEnd}`;

function makeRecord(): WorkbenchRecord {
  const now = new Date('2026-08-08T10:00:00.000Z');
  return {
    id: 'wb-hitl3',
    cellId: 'cell-test',
    workItemId: 'wi-hitl3',
    roomId: null,
    idempotencyKey: 'key-hitl3',
    taskDef: TASK_DEF,
    state: 'provisioning',
    attempts: 1,
    claimedBy: 'runner-1',
    claimedAt: now,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    containerId: null,
    scheduleCron: null,
    scheduleTimezone: null,
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

function scriptedAdapter(): AgentHarnessAdapter {
  const gooseStub = {
    status: async () => ({ healthy: true, version: '1.45.0', sessions: 0 }),
    startSession: async () => ({
      id: 'goose-session', harness: 'Goose', roomId: '', createdAt: new Date().toISOString(),
    }),
    sendMessage: async function* () {
      yield { type: 'text' as const, content: TRANSCRIPT };
      yield { type: 'done' as const, content: '' };
    },
    stopSession: async () => {},
    switchModel: async () => {},
    listProviders: async () => [],
    name: 'Goose',
  };
  return new GooseHeadlessHarnessAdapter({ goose: gooseStub as never });
}

/**
 * Recording store standing in for WorkbenchStore. It additionally records any
 * decision-request call — under HITL-03 a reversible-assumption run must
 * never make one.
 */
class RecordingStore {
  stateChanges: string[] = [];
  events: string[] = [];
  planSteps = 0;
  artifacts: string[] = [];
  receiptSummary = '';
  receiptAssumptions: string[] = [];
  decisionRequests = 0;

  async setState(_id: string, state: string) {
    this.stateChanges.push(state);
    return null;
  }
  async appendEvent(_id: string, type: string) {
    this.events.push(type);
    return 1;
  }
  async publishPlan(_id: string, steps: unknown[]) {
    this.planSteps = steps.length;
  }
  async updatePlanStep() {
    return true;
  }
  async registerArtifact(_id: string, artifact: { path: string }) {
    this.artifacts.push(artifact.path);
  }
  async publishReceipt(
    _id: string,
    receipt: { summary: string; assumptions: readonly string[] },
  ) {
    this.receiptSummary = receipt.summary;
    this.receiptAssumptions = [...receipt.assumptions];
  }
  /** The HITL-01 seam would surface here; HITL-03 says this run never calls it. */
  async requestDecision() {
    this.decisionRequests += 1;
    return { decisionWorkItemId: 'should-not-happen', workbenchState: 'waiting' as const };
  }
}

/* ------------------------------------------------------------------ policy --- */

describe('HITL-03 WHEN-TO-ASK policy in the headless instruction', () => {
  it('enumerates exactly the five ask-triggers', () => {
    const instruction = buildHeadlessInstruction(TASK_DEF);
    expect(instruction).toContain('WHEN TO ASK');
    for (const trigger of ASK_POLICY_TRIGGERS) {
      expect(instruction).toContain(trigger);
    }
    expect(ASK_POLICY_TRIGGERS).toEqual([
      'irreversible',
      'destructive',
      'spend-gated',
      'cross-fence',
      'policy-gated',
    ]);
  });

  it('directs reversible assumptions into the receipt instead of a pause', () => {
    const instruction = buildHeadlessInstruction(TASK_DEF);
    expect(instruction).toContain('assumption');
    expect(instruction).toContain('"assumptions"');
    expect(instruction).toContain('proceed');
    // Asking outside the five triggers is explicitly a violation.
    expect(instruction).toContain('protocol violation');
  });

  it('leaves the marker grammar unchanged', () => {
    expect(PROTOCOL_MARKERS).toEqual({
      planBegin: 'FRANK_PLAN_BEGIN',
      planEnd: 'FRANK_PLAN_END',
      stepPrefix: 'FRANK_STEP',
      artifactPrefix: 'FRANK_ARTIFACT',
      receiptBegin: 'FRANK_RECEIPT_BEGIN',
      receiptEnd: 'FRANK_RECEIPT_END',
    });
  });
});

/* ------------------------------------------------- reversible-assumption --- */

describe('HITL-03 reversible-assumption task creates zero decision work items', () => {
  it('runs to a done receipt with assumptions[] populated and no decision', async () => {
    const store = new RecordingStore();
    const executor = new HarnessExecutor({
      adapter: scriptedAdapter(),
      store: store as never,
      executorId: 'hitl3-test',
      now: () => new Date('2026-08-08T10:01:00.000Z'),
      log: () => {},
    });

    const outcome = await executor.execute(makeRecord());

    // The run completes — it never paused for a human.
    expect(outcome).toEqual({ kind: 'done' });

    // Reversible assumptions live in the receipt, not in a decision item.
    expect(store.receiptSummary).toBe('Support export summarized.');
    expect(store.receiptAssumptions).toHaveLength(2);
    expect(store.receiptAssumptions).toEqual([
      'tone: neutral (reversible — rewrite is cheap)',
      'date range: last 30 days (reversible — re-run widens it)',
    ]);

    // ZERO decision work items: the seam was never called, and no
    // decision_requested/paused events were appended.
    expect(store.decisionRequests).toBe(0);
    expect(store.events).not.toContain('decision_requested');
    expect(store.events).not.toContain('paused');
    expect(store.stateChanges).toEqual(['running']);

    // The published receipt is the durable record of what was assumed.
    const parsed = parseHarnessText(TRANSCRIPT);
    expect(parsed.receipt?.assumptions).toEqual(store.receiptAssumptions);
  });
});

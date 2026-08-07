/**
 * WB-10 — harness-swap proof.
 *
 * Master plan §3.3: "The same task definition must be runnable under at least
 * two harness adapters before the harness abstraction is considered proven."
 *
 * This test executes the SAME task def through:
 *   1. GooseHeadlessHarnessAdapter (ACP/WebSocket, stubbed GooseAdapter), and
 *   2. CliHeadlessHarnessAdapter (single-shot subprocess, scripted stdout),
 * each driving a real HarnessExecutor + recording store, and asserts the two
 * produce EQUIVALENT Frank-level outputs: same plan step count, same artifact
 * paths, same receipt summary, same terminal outcome, and the same durable
 * event sequence. The internal event streams differ (different harnesses), but
 * everything the runner persists through the AgentHarnessAdapter contract is
 * identical — that is the abstraction being proven.
 */

import { describe, expect, it } from 'vitest';

import type { AgentHarnessAdapter } from '@frank/contracts';

import { HarnessExecutor } from '../harness-executor.js';
import { GooseHeadlessHarnessAdapter } from '../recipes/goose-headless.js';
import { CliHeadlessHarnessAdapter } from '../recipes/cli-headless.js';
import { PROTOCOL_MARKERS } from '../recipes/headless-protocol.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from '../types.js';

/* --------------------------------------------------------------- fixtures --- */

/** The SAME task def runs under both adapters (WB-10 requirement). */
const TASK_DEF: WorkbenchTaskDef = {
  instruction: 'Produce a comparison sheet from the raw export.',
  mounts: [{ source: '/srv/data', path: '/mnt/data', mode: 'ro' }],
  harness: { adapter: 'goose' },
  skills: [],
  leash: { wallClockSec: 600 },
  network: { egressAllowlist: [] },
};

/** One transcript honoring the publication protocol (both adapters emit it). */
const TRANSCRIPT = `preamble
${PROTOCOL_MARKERS.planBegin}
1. Load the raw export
2. Build the comparison sheet
3. Verify the totals
${PROTOCOL_MARKERS.planEnd}
working
${PROTOCOL_MARKERS.stepPrefix} 1 doing
${PROTOCOL_MARKERS.stepPrefix} 1 done loaded
${PROTOCOL_MARKERS.stepPrefix} 2 done
${PROTOCOL_MARKERS.stepPrefix} 3 done verified
${PROTOCOL_MARKERS.artifactPrefix} /workspace/out/comparison.html document
${PROTOCOL_MARKERS.receiptBegin}
{"summary":"Comparison sheet produced.","assumptions":["export was valid"],"evidence":["/workspace/out/comparison.html"]}
${PROTOCOL_MARKERS.receiptEnd}`;

function makeRecord(adapterName: string): WorkbenchRecord {
  const now = new Date('2026-08-07T14:00:00.000Z');
  return {
    id: `wb-swap-${adapterName}`,
    cellId: 'cell-test',
    workItemId: 'wi-swap',
    roomId: null,
    idempotencyKey: `key-swap-${adapterName}`,
    taskDef: { ...TASK_DEF, harness: { adapter: adapterName } },
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

/* ------------------------------------------------------------ goose (stub) --- */

function gooseAdapter(): AgentHarnessAdapter {
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

/* --------------------------------------------------------------- cli (fake) --- */

function cliAdapter(): AgentHarnessAdapter {
  // Scripted spawner: no real binary; stdout is the protocol transcript.
  const spawner = {
    async spawn() {
      const lines = TRANSCRIPT.split('\n');
      return {
        async *stdoutLines() {
          for (const line of lines) yield line;
        },
        async kill() {},
        async wait() {
          return 0;
        },
      };
    },
  };
  return new CliHeadlessHarnessAdapter({ command: 'fake-cli', spawner });
}

/* -------------------------------------------------------- recording store --- */

class RecordingStore {
  stateChanges: string[] = [];
  events: string[] = [];
  planSteps = 0;
  artifacts: string[] = [];
  receiptSummary = '';

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
  async publishReceipt(_id: string, receipt: { summary: string }) {
    this.receiptSummary = receipt.summary;
  }
}

async function runWith(adapter: AgentHarnessAdapter, name: string) {
  const store = new RecordingStore();
  const executor = new HarnessExecutor({
    adapter,
    store: store as never,
    executorId: 'swap-test',
    now: () => new Date('2026-08-07T14:01:00.000Z'),
    log: () => {},
  });
  const outcome = await executor.execute(makeRecord(name));
  return { outcome, store };
}

/* ------------------------------------------------------------------ proof --- */

describe('WB-10 harness-swap proof (same task def, two adapters)', () => {
  it('goose and cli produce equivalent plan/artifact/receipt/outcome', async () => {
    const goose = await runWith(gooseAdapter(), 'goose');
    const cli = await runWith(cliAdapter(), 'cli');

    // Both reach a terminal done outcome.
    expect(goose.outcome).toEqual({ kind: 'done' });
    expect(cli.outcome).toEqual({ kind: 'done' });

    // Equivalent plan (same step count).
    expect(goose.store.planSteps).toBe(3);
    expect(cli.store.planSteps).toBe(goose.store.planSteps);

    // Equivalent artifacts (same paths).
    expect(cli.store.artifacts).toEqual(goose.store.artifacts);
    expect(goose.store.artifacts).toEqual(['/workspace/out/comparison.html']);

    // Equivalent receipt summary.
    expect(cli.store.receiptSummary).toBe(goose.store.receiptSummary);
    expect(goose.store.receiptSummary).toBe('Comparison sheet produced.');

    // Equivalent durable event sequence (the runner's persisted contract).
    expect(cli.store.events).toEqual(goose.store.events);
    expect(goose.store.events).toEqual([
      'resumed',
      'plan_published',
      'step_updated',
      'step_updated',
      'step_updated',
      'step_updated',
      'artifact_registered',
      'receipt_published',
    ]);

    // Same state machine path.
    expect(cli.store.stateChanges).toEqual(goose.store.stateChanges);
    expect(goose.store.stateChanges).toEqual(['running']);
  });

  it('both adapters report their distinct descriptors (swappable, not identical)', async () => {
    const gooseDesc = await gooseAdapter().descriptor();
    const cliDesc = await cliAdapter().descriptor();

    expect(gooseDesc.id).toBe('goose');
    expect(gooseDesc.acp.supported).toBe(true);

    expect(cliDesc.id).toBe('cli');
    expect(cliDesc.acp.supported).toBe(false);
    expect(cliDesc.cancellationStrength).toBe('process');
  });
});

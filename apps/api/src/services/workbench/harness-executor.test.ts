/**
 * WB-04 unit tests — no Goose, no database.
 *
 *  - headless-protocol: the instruction builder is self-contained; the
 *    parser inverts the publication protocol (plan, steps, artifacts,
 *    receipt) and rejects half-publications.
 *  - harness-executor: a TRIVIAL task def reaches a receipt through an
 *    injected AgentHarnessAdapter (scripted fake) — proving the runner path
 *    needs only the §6.2 contract, never Goose internals.
 *  - goose-headless adapter bridge: shape checks against the contracts'
 *    AgentHarnessAdapter with a stub GooseAdapter (constructor-level only;
 *    no WebSocket traffic in unit tests).
 */
import { describe, expect, it } from 'vitest';

import type { AgentHarnessAdapter, HarnessEvent } from '@frank/contracts';

import { HarnessExecutor } from './harness-executor.js';
import {
  GooseHeadlessHarnessAdapter,
  PROTOCOL_MARKERS,
  buildHeadlessInstruction,
  parseHarnessText,
} from './recipes/goose-headless.js';
import type { WorkbenchRecord, WorkbenchTaskDef } from './types.js';

function taskDef(overrides?: Partial<WorkbenchTaskDef>): WorkbenchTaskDef {
  return {
    instruction: 'Summarize the standup notes into five bullets.',
    mounts: [{ source: '/srv/notes', path: '/mnt/notes', mode: 'ro' }],
    harness: { adapter: 'goose' },
    skills: [],
    leash: { wallClockSec: 600 },
    network: { egressAllowlist: [] },
    ...overrides,
  };
}

function record(def: WorkbenchTaskDef, id = 'wb-harness-1'): WorkbenchRecord {
  const now = new Date('2026-08-07T12:00:00.000Z');
  return {
    id,
    cellId: 'cell-test',
    workItemId: 'wi-1',
    roomId: null,
    idempotencyKey: 'key-h1',
    taskDef: def,
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

const TRANSCRIPT = `Some preamble chatter.
${PROTOCOL_MARKERS.planBegin}
1. Read the notes
2. Draft five bullets
3. Verify against the notes
${PROTOCOL_MARKERS.planEnd}
Working...
${PROTOCOL_MARKERS.stepPrefix} 1 doing
${PROTOCOL_MARKERS.stepPrefix} 1 done read all notes
${PROTOCOL_MARKERS.stepPrefix} 2 doing
${PROTOCOL_MARKERS.stepPrefix} 2 done
${PROTOCOL_MARKERS.stepPrefix} 3 done verified
${PROTOCOL_MARKERS.artifactPrefix} /workspace/out/bullets.md document
${PROTOCOL_MARKERS.receiptBegin}
{"summary":"Five bullets written.","assumptions":["notes were complete"],"evidence":["/workspace/out/bullets.md"]}
${PROTOCOL_MARKERS.receiptEnd}`;

/* ------------------------------------------------------------- protocol --- */

describe('headless publication protocol', () => {
  it('builds a self-contained standalone instruction', () => {
    const text = buildHeadlessInstruction(taskDef());
    expect(text).toContain('Summarize the standup notes');
    expect(text).toContain('/mnt/notes (ro)');
    expect(text).toContain('read-only, do not attempt writes');
    expect(text).toContain('wall-clock limit: 600');
    // Every marker of the publication contract is present.
    for (const marker of [
      PROTOCOL_MARKERS.planBegin,
      PROTOCOL_MARKERS.planEnd,
      PROTOCOL_MARKERS.stepPrefix,
      PROTOCOL_MARKERS.artifactPrefix,
      PROTOCOL_MARKERS.receiptBegin,
      PROTOCOL_MARKERS.receiptEnd,
    ]) {
      expect(text).toContain(marker);
    }
  });

  it('parses plan, step updates, artifacts, and receipt from a transcript', () => {
    const output = parseHarnessText(TRANSCRIPT);
    expect(output.plan.map((p) => p.step)).toEqual([
      'Read the notes',
      'Draft five bullets',
      'Verify against the notes',
    ]);
    expect(output.stepUpdates).toHaveLength(5);
    expect(output.stepUpdates[0]).toEqual({ seq: 1, state: 'doing', note: null });
    expect(output.stepUpdates[1]).toEqual({ seq: 1, state: 'done', note: 'read all notes' });
    expect(output.artifacts).toEqual([{ path: '/workspace/out/bullets.md', kind: 'document' }]);
    expect(output.receipt?.summary).toBe('Five bullets written.');
    expect(output.receipt?.assumptions).toEqual(['notes were complete']);
  });

  it('rejects artifacts outside /workspace and invalid step states', () => {
    const output = parseHarnessText(
      `${PROTOCOL_MARKERS.artifactPrefix} /etc/passwd secret\n` +
        `${PROTOCOL_MARKERS.stepPrefix} 1 exploded\n` +
        `${PROTOCOL_MARKERS.stepPrefix} 2 done ok`,
    );
    expect(output.artifacts).toEqual([]);
    expect(output.stepUpdates).toEqual([{ seq: 2, state: 'done', note: 'ok' }]);
  });

  it('returns an empty receipt when none was published', () => {
    expect(parseHarnessText('just chatter').receipt).toBeNull();
    expect(parseHarnessText('').plan).toEqual([]);
  });
});

/* ------------------------------------------------------ harness executor --- */

/** A scripted AgentHarnessAdapter — the runner's only harness dependency. */
class FakeHarnessAdapter {
  startedWith: unknown = null;
  prompts: string[] = [];
  events: HarnessEvent[] = [];
  closed = false;

  async descriptor() {
    return {
      id: 'fake', label: 'Fake', blurb: 'test', version: '0.0.1',
      acp: { supported: false, versions: [] }, toolProtocols: ['native'],
      supportedModels: [], subscriptionAuth: false, contextLimits: {},
      budgetReporting: false, workspaceModes: ['isolated'],
      cleanupGuarantee: 'best-effort', osRequirements: [],
      resumeGuarantee: 'none', checkpointPortability: 'native-only',
      eventReplay: 'none', cancellationStrength: 'cooperative',
      maxDataClass: 'internal',
    };
  }
  async health() {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }
  async capacity() {
    return { maxConcurrentSessions: 1, activeSessions: 0, accepting: true };
  }
  async usage(window: '1h' | '24h' | '7d' | '30d') {
    const none = 0;
    const usage = { window, totalSessions: none, totalTurns: none, errors: none } as Record<
      string,
      number | '1h' | '24h' | '7d' | '30d'
    >;
    usage['totalTokensIn'] = none;
    usage['totalTokensOut'] = none;
    return usage;
  }
  async start(input: { runId: string }) {
    this.startedWith = input;
    return {
      id: `session-${input.runId}`,
      nativeSessionId: 'native-1',
      harness: 'fake',
      runId: input.runId,
      createdAt: new Date().toISOString(),
      resumed: false,
    };
  }
  async resume() {
    throw new Error('unsupported');
  }
  async inspect(sessionId: string) {
    const none = 0;
    const turnsCompleted = none;
    return { sessionId, status: 'active' as const, turnsCompleted, tokensUsed: turnsCompleted };
  }
  async *prompt(input: { sessionId: string; content: string }): AsyncIterable<HarnessEvent> {
    this.prompts.push(input.content);
    for (const event of this.events) yield event;
  }
  async checkpoint(input: { runId: string }) {
    return {
      checkpointId: `${input.runId}-fake`, runId: input.runId, runRevision: 0,
      planState: {}, sourceRefs: [], artifactDigests: [], completedReceipts: [],
      pendingEffects: [], cumulativeSpendUsd: 0, eventCursor: '',
      remainingBudget: { maxSpend: 0, currency: 'USD' }, policyRevision: 'x',
      createdAt: new Date().toISOString(),
    };
  }
  async steer() {}
  async interrupt() {}
  async cancel() {}
  async kill() {}
  async collect() {
    return [];
  }
  async close() {
    this.closed = true;
  }
}

/** Recording store fake for the executor's persistence calls. */
class RecordingStore {
  stateChanges: { id: string; state: string }[] = [];
  events: { id: string; type: string }[] = [];
  plans: { id: string; steps: number }[] = [];
  stepUpdates: { id: string; seq: number; state: string }[] = [];
  artifacts: { id: string; path: string }[] = [];
  receipts: { id: string; summary: string }[] = [];

  async setState(id: string, state: string) {
    this.stateChanges.push({ id, state });
    return null;
  }
  async appendEvent(id: string, type: string) {
    this.events.push({ id, type });
    return 1;
  }
  async publishPlan(id: string, steps: unknown[]) {
    if (steps.length < 3 || steps.length > 10) {
      throw new Error(`workbench plan must have 3 to 10 steps, got ${steps.length}`);
    }
    this.plans.push({ id, steps: steps.length });
  }
  async updatePlanStep(id: string, seq: number, state: string) {
    this.stepUpdates.push({ id, seq, state });
    return true;
  }
  async registerArtifact(id: string, artifact: { path: string }) {
    this.artifacts.push({ id, path: artifact.path });
  }
  async publishReceipt(id: string, receipt: { summary: string }) {
    this.receipts.push({ id, summary: receipt.summary });
  }
}

describe('HarnessExecutor (fake adapter, no Goose)', () => {
  it('a trivial task def reaches a receipt through the adapter alone', async () => {
    const adapter = new FakeHarnessAdapter();
    adapter.events = [{ type: 'text', content: TRANSCRIPT }];
    const store = new RecordingStore();

    const executor = new HarnessExecutor({
      adapter: adapter as never,
      store: store as never,
      executorId: 'harness-test',
      now: () => new Date('2026-08-07T12:01:00.000Z'),
      log: () => {},
    });

    const outcome = await executor.execute(record(taskDef()));

    expect(outcome).toEqual({ kind: 'done' });
    // The adapter was the only harness surface touched.
    expect(adapter.startedWith).toMatchObject({ runId: 'wb-harness-1', workspacePath: '/workspace' });
    expect(adapter.prompts).toHaveLength(1);
    expect(adapter.prompts[0]).toContain(PROTOCOL_MARKERS.planBegin); // standalone instruction
    expect(adapter.closed).toBe(true);

    // Publication duties persisted in order.
    expect(store.stateChanges.map((c) => c.state)).toEqual(['running']);
    expect(store.plans).toEqual([{ id: 'wb-harness-1', steps: 3 }]);
    expect(store.stepUpdates).toHaveLength(5);
    expect(store.artifacts.map((a) => a.path)).toEqual(['/workspace/out/bullets.md']);
    expect(store.receipts.map((r) => r.summary)).toEqual(['Five bullets written.']);
    expect(store.events.map((e) => e.type)).toEqual([
      'resumed',
      'plan_published',
      'step_updated',
      'step_updated',
      'step_updated',
      'step_updated',
      'step_updated',
      'artifact_registered',
      'receipt_published',
    ]);
  });

  it('fails the run when the agent publishes no receipt', async () => {
    const adapter = new FakeHarnessAdapter();
    adapter.events = [
      {
        type: 'text',
        content: `${PROTOCOL_MARKERS.planBegin}\n1. a\n2. b\n3. c\n${PROTOCOL_MARKERS.planEnd}`,
      },
    ];
    const store = new RecordingStore();

    const executor = new HarnessExecutor({
      adapter: adapter as never,
      store: store as never,
      executorId: 'harness-test',
      log: () => {},
    });

    const outcome = await executor.execute(record(taskDef(), 'wb-no-receipt'));
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.error).toContain('no receipt');
  });

  it('fails the run when the harness streams an error event', async () => {
    const adapter = new FakeHarnessAdapter();
    adapter.events = [
      { type: 'text', content: TRANSCRIPT },
      { type: 'error', content: 'model overloaded' },
    ];
    const store = new RecordingStore();

    const executor = new HarnessExecutor({
      adapter: adapter as never,
      store: store as never,
      executorId: 'harness-test',
      log: () => {},
    });

    const outcome = await executor.execute(record(taskDef(), 'wb-harness-error'));
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.error).toContain('model overloaded');
    // The receipt still landed — publication is best-effort durable even on failure.
    expect(store.receipts).toHaveLength(1);
  });

  it('fails when the published plan violates the 3-to-10 step rule', async () => {
    const adapter = new FakeHarnessAdapter();
    adapter.events = [
      {
        type: 'text',
        content:
          `${PROTOCOL_MARKERS.planBegin}\n1. a\n2. b\n${PROTOCOL_MARKERS.planEnd}\n` +
          `${PROTOCOL_MARKERS.receiptBegin}\n{"summary":"x","assumptions":[],"evidence":[]}\n${PROTOCOL_MARKERS.receiptEnd}`,
      },
    ];
    const store = new RecordingStore();

    const executor = new HarnessExecutor({
      adapter: adapter as never,
      store: store as never,
      executorId: 'harness-test',
      log: () => {},
    });

    const outcome = await executor.execute(record(taskDef(), 'wb-bad-plan'));
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.error).toContain('plan rejected');
  });
});

/* ------------------------------------------------------- adapter bridge --- */

describe('GooseHeadlessHarnessAdapter (contract shape)', () => {
  it('implements AgentHarnessAdapter with a goose descriptor', async () => {
    // Stub GooseAdapter — constructor only, no network.
    const gooseStub = {
      status: async () => ({ healthy: true, version: '1.45.0', sessions: 0 }),
      startSession: async () => ({
        id: 's1', harness: 'Goose', roomId: 'r', createdAt: new Date().toISOString(),
      }),
      sendMessage: async function* () {
        yield { type: 'done' as const, content: '' };
      },
      stopSession: async () => {},
      switchModel: async () => {},
      listProviders: async () => [],
      name: 'Goose',
    };

    const adapter: AgentHarnessAdapter = new GooseHeadlessHarnessAdapter({
      goose: gooseStub as never,
    });

    const descriptor = await adapter.descriptor();
    expect(descriptor.id).toBe('goose');
    expect(descriptor.acp.supported).toBe(true);

    const session = await adapter.start({
      runId: 'wb-bridge',
      cellId: 'cell-test',
      workspacePath: '/workspace',
      contextPack: {} as never,
      systemPrompt: 'sp',
      now: new Date().toISOString(),
    });
    expect(session.harness).toBe('goose');
    expect(session.runId).toBe('wb-bridge');

    const events: HarnessEvent[] = [];
    for await (const event of adapter.prompt({ sessionId: 's1', content: 'go' })) {
      events.push(event);
    }
    expect(events.map((e) => e.type)).toEqual(['done']);

    await adapter.kill({ sessionId: 's1', reason: 'test', now: new Date().toISOString() });
    await adapter.close(
      { sessionId: 's1', runId: 'wb-bridge', cleanup: true, now: new Date().toISOString() },
      new Date().toISOString(),
    );

    await expect(
      adapter.resume({
        runId: 'wb-bridge',
        cellId: 'cell-test',
        nativeSessionId: 's1',
        now: new Date().toISOString(),
      }),
    ).rejects.toThrow(/unsupported/);
  });
});

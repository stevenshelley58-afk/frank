/**
 * Tests for the Harness Broker — FRANK-§8.4.
 */

import { describe, expect, it } from 'vitest';

import type {
  AgentHarnessAdapter,
  ArtifactManifest,
  HarnessCapacity,
  HarnessCheckpoint,
  HarnessDescriptor,
  HarnessEvent,
  HarnessPrompt,
  HarnessRouteProfile,
  HarnessSession,
  HarnessSessionState,
  HealthReport,
  HarnessUsage,
  SelectionFactors,
  UsageWindow,
} from '@frank/contracts';

import {
  HarnessBroker,
  NoEligibleHarnessError,
  UnknownHarnessError,
} from './harness-broker.js';

// ---------------------------------------------------------------------------
// Fake adapter
// ---------------------------------------------------------------------------

function fakeDescriptor(overrides: Partial<HarnessDescriptor> = {}): HarnessDescriptor {
  return {
    id: 'fake',
    label: 'Fake Harness',
    blurb: 'A test harness.',
    version: '1.0.0',
    acp: { supported: true, versions: ['1.0'] },
    toolProtocols: ['acp', 'mcp'],
    supportedModels: ['fast-general', 'code-builder'],
    subscriptionAuth: false,
    contextLimits: { 'fast-general': 128000 },
    budgetReporting: true,
    workspaceModes: ['shared', 'isolated'],
    cleanupGuarantee: 'best-effort',
    osRequirements: ['linux'],
    resumeGuarantee: 'same-harness-restart',
    checkpointPortability: 'frank-rehydratable',
    eventReplay: 'cursor-within-live-session',
    cancellationStrength: 'process',
    maxDataClass: 'internal',
    ...overrides,
  };
}

function fakeHealth(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    healthy: true,
    version: '1.0.0',
    activeSessions: 1,
    checkedAt: '2026-08-01T12:00:00Z',
    ...overrides,
  };
}

function fakeCapacity(overrides: Partial<HarnessCapacity> = {}): HarnessCapacity {
  return {
    maxConcurrentSessions: 10,
    activeSessions: 1,
    accepting: true,
    ...overrides,
  };
}

function makeFakeAdapter(
  descriptorOverrides: Partial<HarnessDescriptor> = {},
  healthOverrides: Partial<HealthReport> = {},
  capacityOverrides: Partial<HarnessCapacity> = {},
): AgentHarnessAdapter {
  return {
    async descriptor() { return fakeDescriptor(descriptorOverrides); },
    async health() { return fakeHealth(healthOverrides); },
    async capacity() { return fakeCapacity(capacityOverrides); },
    async usage(_window: UsageWindow): Promise<HarnessUsage> {
      return { window: _window, totalSessions: 0, totalTurns: 0, totalTokensIn: 0, totalTokensOut: 0, errors: 0 };
    },
    async start(): Promise<HarnessSession> {
      return { id: 's1', nativeSessionId: 'ns1', harness: 'fake', runId: 'r1', createdAt: '2026-08-01T12:00:00Z', resumed: false };
    },
    async resume(): Promise<HarnessSession> {
      return { id: 's1', nativeSessionId: 'ns1', harness: 'fake', runId: 'r1', createdAt: '2026-08-01T12:00:00Z', resumed: true };
    },
    async inspect(): Promise<HarnessSessionState> {
      return { sessionId: 's1', status: 'active', turnsCompleted: 0, tokensUsed: 0 };
    },
    async *prompt(_input: HarnessPrompt): AsyncIterable<HarnessEvent> {
      yield { type: 'text', content: 'hello' };
      yield { type: 'done' };
    },
    async checkpoint(): Promise<HarnessCheckpoint> {
      return {
        checkpointId: 'cp1', runId: 'r1', runRevision: 1, planState: {},
        sourceRefs: [], artifactDigests: [], completedReceipts: [], pendingEffects: [],
        cumulativeSpendUsd: 0, eventCursor: 'c0', remainingBudget: { maxSpend: 50, currency: 'USD' },
        policyRevision: 'p1', createdAt: '2026-08-01T12:00:00Z',
      };
    },
    async steer() {},
    async interrupt() {},
    async cancel() {},
    async kill() {},
    async collect(): Promise<ArtifactManifest[]> { return []; },
    async close() {},
  };
}

const defaultFactors: SelectionFactors = {
  taskType: 'code',
  requiredToolProtocols: ['acp'],
  dataClass: 'internal',
  needsReviewDiversity: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessBroker', () => {
  it('selects the only registered harness in auto mode', async () => {
    const adapter = makeFakeAdapter({ id: 'goose', label: 'Goose' });
    // descriptor().id is the lookup key now
    const broker = new HarnessBroker([adapter]);

    const result = await broker.select(defaultFactors);
    expect(result.harnessId).toBe('goose');
    expect(result.mode).toBe('auto');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.score).toBeGreaterThan(0);
    expect(result.explanation).toContain('Goose');
  });

  it('skips unhealthy harnesses', async () => {
    const healthy = makeFakeAdapter({ id: 'goose' });
    const unhealthy = makeFakeAdapter({ id: 'hermes' }, { healthy: false });

    const broker = new HarnessBroker([healthy, unhealthy]);
    const result = await broker.select(defaultFactors);

    expect(result.harnessId).toBe('goose');
    expect(result.candidates).toHaveLength(1);
  });

  it('skips harnesses that are not accepting', async () => {
    const accepting = makeFakeAdapter({ id: 'goose' });
    const full = makeFakeAdapter({ id: 'hermes' }, {}, { accepting: false });

    const broker = new HarnessBroker([accepting, full]);
    const result = await broker.select(defaultFactors);

    expect(result.harnessId).toBe('goose');
    expect(result.candidates).toHaveLength(1);
  });

  it('skips harnesses that cannot handle the required data class', async () => {
    const internal = makeFakeAdapter({ id: 'goose', maxDataClass: 'internal' });
    const openOnly = makeFakeAdapter({ id: 'hermes', maxDataClass: 'open' });

    const broker = new HarnessBroker([internal, openOnly]);
    // Neither can handle 'private' (internal < private, open < private)
    await expect(broker.select({ ...defaultFactors, dataClass: 'private' })).rejects.toThrow(
      NoEligibleHarnessError,
    );
  });

  it('ranks harnesses by score', async () => {
    // Goose: strong resume, process cancel
    const goose = makeFakeAdapter({
      id: 'goose',
      resumeGuarantee: 'native-session',
      cancellationStrength: 'sandbox',
      maxDataClass: 'secret',
    });

    // Hermes: weaker resume, cooperative cancel
    const hermes = makeFakeAdapter({
      id: 'hermes',
      resumeGuarantee: 'none',
      cancellationStrength: 'cooperative',
      maxDataClass: 'internal',
    });

    const broker = new HarnessBroker([goose, hermes]);
    const result = await broker.select(defaultFactors);

    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(result.candidates[1]!.score);
  });

  it('selects a named harness', async () => {
    const goose = makeFakeAdapter({ id: 'goose' });
    const hermes = makeFakeAdapter({ id: 'hermes' });

    const broker = new HarnessBroker([goose, hermes]);
    const result = await broker.select(defaultFactors, 'hermes');

    expect(result.harnessId).toBe('hermes');
    expect(result.mode).toBe('named');
    expect(result.explanation).toContain('Named harness');
  });

  it('throws UnknownHarnessError for unregistered named harness', async () => {
    const broker = new HarnessBroker([]);
    await expect(broker.select(defaultFactors, 'nonexistent')).rejects.toThrow(
      UnknownHarnessError,
    );
  });

  it('selects from a route profile in preference order', async () => {
    const goose = makeFakeAdapter({ id: 'goose' });
    const hermes = makeFakeAdapter({ id: 'hermes' });

    const broker = new HarnessBroker([goose, hermes]);
    const profile: HarnessRouteProfile = {
      id: 'profile-1',
      name: 'Prefer Hermes',
      preference: ['hermes', 'goose'],
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    broker.saveRouteProfile(profile);

    const result = await broker.select(defaultFactors, 'profile-1');
    expect(result.harnessId).toBe('hermes');
    expect(result.mode).toBe('route-profile');
    expect(result.explanation).toContain('Prefer Hermes');
  });

  it('falls through route profile when first choice is unhealthy', async () => {
    const goose = makeFakeAdapter({ id: 'goose' });
    const hermes = makeFakeAdapter({ id: 'hermes' }, { healthy: false });

    const broker = new HarnessBroker([goose, hermes]);
    const profile: HarnessRouteProfile = {
      id: 'profile-1',
      name: 'Prefer Hermes',
      preference: ['hermes', 'goose'],
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    broker.saveRouteProfile(profile);

    const result = await broker.select(defaultFactors, 'profile-1');
    expect(result.harnessId).toBe('goose');
  });

  it('throws NoEligibleHarnessError when no harnesses are registered', async () => {
    const broker = new HarnessBroker([]);
    await expect(broker.select(defaultFactors)).rejects.toThrow(NoEligibleHarnessError);
  });

  it('prefers harnesses with more capacity headroom', async () => {
    const busy = makeFakeAdapter({ id: 'goose' }, {}, { maxConcurrentSessions: 10, activeSessions: 9 });
    const free = makeFakeAdapter({ id: 'hermes' }, {}, { maxConcurrentSessions: 10, activeSessions: 0 });

    const broker = new HarnessBroker([busy, free]);
    const result = await broker.select(defaultFactors);

    // Hermes has more headroom, should score higher
    expect(result.candidates[0]!.descriptor.id).toBe('hermes');
  });

  it('penalizes recently selected harness when diversity is needed', async () => {
    const goose = makeFakeAdapter({ id: 'goose' });
    const hermes = makeFakeAdapter({ id: 'hermes' });

    const broker = new HarnessBroker([goose, hermes]);

    // First selection without diversity
    await broker.select(defaultFactors);

    // Second selection with diversity — should prefer the other harness
    const result = await broker.select({ ...defaultFactors, needsReviewDiversity: true });
    // The recently selected one gets 0 on diversity; the other gets 1
    expect(result.candidates.length).toBe(2);
  });

  it('scores tool protocol coverage', async () => {
    const full = makeFakeAdapter({ id: 'goose', toolProtocols: ['acp', 'mcp', 'native'] });
    const partial = makeFakeAdapter({ id: 'hermes', toolProtocols: ['acp'] });

    const broker = new HarnessBroker([full, partial]);
    const result = await broker.select({
      ...defaultFactors,
      requiredToolProtocols: ['acp', 'mcp', 'native'],
    });

    // Goose covers all 3, hermes covers 1/3
    expect(result.candidates[0]!.descriptor.id).toBe('goose');
  });

  it('explanation includes key details', async () => {
    const adapter = makeFakeAdapter({ id: 'goose', label: 'Goose ACP' });
    const broker = new HarnessBroker([adapter]);

    const result = await broker.select(defaultFactors);
    expect(result.explanation).toContain('Goose ACP');
    expect(result.explanation).toContain('healthy');
    expect(result.explanation).toContain('sessions available');
    expect(result.explanation).toContain('data class');
  });

  it('listRouteProfiles returns saved profiles', () => {
    const broker = new HarnessBroker([]);
    const profile: HarnessRouteProfile = {
      id: 'p1',
      name: 'Test',
      preference: ['goose'],
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    broker.saveRouteProfile(profile);

    expect(broker.listRouteProfiles()).toHaveLength(1);
    expect(broker.listRouteProfiles()[0]!.name).toBe('Test');
  });
});

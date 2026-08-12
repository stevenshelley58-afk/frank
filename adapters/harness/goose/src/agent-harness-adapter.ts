/** Thin bridge from the legacy Goose ACP client to FRANK's kernel harness port. */
import { randomUUID } from 'node:crypto';
import type {
  AgentHarnessAdapter,
  ArtifactManifest,
  CancelHarnessRun,
  CheckpointHarnessRun,
  CloseHarnessRun,
  CollectHarnessArtifacts,
  HarnessCapacity,
  HarnessCheckpoint,
  HarnessDescriptor,
  HarnessEvent,
  HarnessPrompt,
  HarnessSession,
  HarnessSessionState,
  HarnessUsage,
  HealthReport,
  InterruptHarnessRun,
  KillHarnessRun,
  ResumeHarnessRun,
  StartHarnessRun,
  SteerHarnessRun,
  UsageWindow,
} from '@frank/contracts';
import { GooseAdapter } from './goose-adapter.js';
import type { ProviderConfig, SessionHandle } from './types.js';

export class GooseAgentHarnessAdapter implements AgentHarnessAdapter {
  readonly #sessions = new Map<string, SessionHandle>();
  #turns = 0;
  #errors = 0;
  #tokensIn = 0;
  #tokensOut = 0;

  constructor(
    readonly legacy: GooseAdapter,
    readonly defaultProvider?: ProviderConfig,
    readonly maxConcurrentSessions = 8,
  ) {}

  async descriptor(): Promise<HarnessDescriptor> {
    const providers = await this.legacy.listProviders();
    return {
      id: 'goose', label: 'Goose', blurb: 'Goose over ACP', version: '1.45.0',
      acp: { supported: true, versions: ['1'] }, toolProtocols: ['acp', 'mcp', 'native'],
      supportedModels: providers.map((provider) => provider.model), subscriptionAuth: true,
      contextLimits: {}, budgetReporting: false, workspaceModes: ['shared'],
      cleanupGuarantee: 'best-effort', osRequirements: ['linux'], resumeGuarantee: 'none',
      checkpointPortability: 'frank-rehydratable', eventReplay: 'none',
      cancellationStrength: 'process', maxDataClass: 'private',
    };
  }

  async health(): Promise<HealthReport> {
    const status = await this.legacy.status();
    return { healthy: status.healthy, checkedAt: new Date().toISOString(), ...(status.version ? { version: status.version } : {}), ...(status.sessions === undefined ? {} : { activeSessions: status.sessions }) };
  }

  async capacity(): Promise<HarnessCapacity> {
    const activeSessions = this.#sessions.size;
    return { maxConcurrentSessions: this.maxConcurrentSessions, activeSessions, accepting: activeSessions < this.maxConcurrentSessions };
  }

  async usage(window: UsageWindow): Promise<HarnessUsage> {
    return { window, totalSessions: this.#sessions.size, totalTurns: this.#turns, totalTokensIn: this.#tokensIn, totalTokensOut: this.#tokensOut, errors: this.#errors };
  }

  async start(input: StartHarnessRun): Promise<HarnessSession> {
    const provider = input.provider ? { provider: input.provider.provider, model: input.provider.model, ...(input.provider.apiKey ? { apiKey: input.provider.apiKey } : {}), ...(input.provider.baseUrl ? { baseUrl: input.provider.baseUrl } : {}) } : this.defaultProvider;
    const handle = await this.legacy.startSession({ roomId: input.runId, workspacePath: input.workspacePath, systemPrompt: input.systemPrompt, ...(provider ? { provider } : {}) });
    this.#sessions.set(handle.id, handle);
    return { id: handle.id, nativeSessionId: handle.id, harness: 'goose', runId: input.runId, createdAt: handle.createdAt, resumed: false };
  }

  async resume(_input: ResumeHarnessRun): Promise<HarnessSession> { throw new Error('Goose session resume is not available through the current ACP bridge.'); }

  async inspect(sessionId: string): Promise<HarnessSessionState> {
    return { sessionId, status: this.#sessions.has(sessionId) ? 'active' : 'closed', turnsCompleted: this.#turns, tokensUsed: this.#tokensIn + this.#tokensOut };
  }

  async *prompt(input: HarnessPrompt): AsyncIterable<HarnessEvent> {
    const handle = this.#sessions.get(input.sessionId);
    if (!handle) throw new Error(`Goose session ${input.sessionId} not found.`);
    this.#tokensIn += approximateTokens(input.content);
    try {
      for await (const chunk of this.legacy.sendMessage(handle, input.content)) {
        if (chunk.type === 'text') { this.#tokensOut += approximateTokens(chunk.content); yield { type: 'text', content: chunk.content }; }
        else if (chunk.type === 'tool_call') yield { type: 'tool_call', toolName: chunk.toolName ?? 'unknown', toolArgs: chunk.toolArgs ?? {}, callId: randomUUID() };
        else if (chunk.type === 'tool_result') yield { type: 'tool_result', callId: randomUUID(), content: chunk.content, isError: false };
        else if (chunk.type === 'error') { this.#errors += 1; yield { type: 'error', content: chunk.content, code: 'goose_acp_error' }; }
        else if (chunk.type === 'done') { this.#turns += 1; yield { type: 'done' }; }
      }
    } catch (error) {
      this.#errors += 1;
      throw error;
    }
  }

  async checkpoint(input: CheckpointHarnessRun): Promise<HarnessCheckpoint> {
    return { checkpointId: randomUUID(), runId: input.runId, runRevision: 0, planState: {}, sourceRefs: [], artifactDigests: [], completedReceipts: [], pendingEffects: [], cumulativeSpendUsd: 0, eventCursor: '0', remainingBudget: { maxSpend: 0, currency: 'USD' }, policyRevision: 'unknown', createdAt: input.now };
  }

  async steer(_input: SteerHarnessRun): Promise<void> { throw new Error('Goose steering is not available through the current ACP bridge.'); }
  async interrupt(input: InterruptHarnessRun): Promise<void> { await this.stop(input.sessionId); }
  async cancel(input: CancelHarnessRun): Promise<void> { await this.stop(input.sessionId); }
  async kill(input: KillHarnessRun): Promise<void> { await this.stop(input.sessionId); }
  async collect(_input: CollectHarnessArtifacts): Promise<ArtifactManifest[]> { return []; }
  async close(input: CloseHarnessRun, _cleanupDeadline: string): Promise<void> { await this.stop(input.sessionId); }

  private async stop(sessionId: string): Promise<void> {
    const handle = this.#sessions.get(sessionId);
    if (!handle) return;
    await this.legacy.stopSession(handle);
    this.#sessions.delete(sessionId);
  }
}

function approximateTokens(value: string): number { return Math.ceil(value.length / 4); }

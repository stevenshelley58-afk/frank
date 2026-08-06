/**
 * Goose headless recipe — WB-04.
 *
 * The RUNNER never imports this file or any Goose code: it depends only on
 * the AgentHarnessAdapter contract (packages/contracts/src/harness.ts) via
 * `harness-executor.ts`. This recipe is the Goose-specific half:
 *
 *   - {@link GooseHeadlessHarnessAdapter} bridges the room-oriented
 *     GooseAdapter (adapters/harness/goose) to the contracts'
 *     AgentHarnessAdapter surface the runner consumes. One workbench run ==
 *     one Goose ACP session (`goose serve`, JSON-RPC over WebSocket).
 *   - The publication protocol (standalone instruction, 3-10 step plan,
 *     step updates, artifact registration, receipt) lives harness-agnostic
 *     in `headless-protocol.ts` and is re-exported here for convenience.
 *
 * ## agentapi mapping for non-ACP CLIs
 *
 * Goose is driven over ACP (JSON-RPC over WebSocket via `goose serve`).
 * A non-ACP CLI harness (codex, claude-code, agentapi-style single-shot
 * binaries) implements the SAME AgentHarnessAdapter surface with a
 * subprocess backend instead of a WebSocket:
 *
 *   start()     -> spawn the CLI process in workspacePath with the system
 *                  prompt materialized as a prompt file / first argv; the
 *                  returned HarnessSession.nativeSessionId is the pid/tag.
 *   prompt()    -> write the content to the process stdin (interactive CLI)
 *                  or spawn one turn per prompt (single-shot CLI), mapping
 *                  stdout lines to HarnessEvent{text}; tool traces become
 *                  tool_call/tool_result events.
 *   resume()    -> same-harness-restart only: re-spawn with the session's
 *                  saved prompt file (non-ACP CLIs have no portable session).
 *   kill()      -> SIGKILL the process (cancellationStrength 'process').
 *   close()     -> reap the process, remove the prompt file if cleanup.
 *
 * Because the publication protocol is plain text in the transcript,
 * parseHarnessText (headless-protocol.ts) works unchanged for both
 * transports — that is the point of keeping it transport-neutral.
 */

import { GooseAdapter } from '@frank/adapter-harness-goose';
import type { SessionHandle, StreamChunk } from '@frank/adapter-harness-goose';

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

// The protocol is harness-agnostic; re-exported so a recipe consumer gets one
// import for the whole Goose binding.
export {
  PROTOCOL_MARKERS,
  buildHeadlessInstruction,
  parseHarnessText,
} from './headless-protocol.js';
export type {
  HarnessRunOutput,
  ParsedArtifact,
  ParsedReceipt,
  ParsedStepUpdate,
} from './headless-protocol.js';

export interface GooseHeadlessAdapterOptions {
  readonly goose: GooseAdapter;
  /** Provider passed through to Goose sessions when the task def names none. */
  readonly defaultProvider?: { provider: string; model: string };
}

/**
 * Bridges the room-oriented GooseAdapter to the contracts'
 * AgentHarnessAdapter. Sessions map 1:1 (workbench run -> Goose session);
 * the GooseAdapter's roomId carries the run id since headless runs have no
 * room.
 */
export class GooseHeadlessHarnessAdapter implements AgentHarnessAdapter {
  constructor(private readonly options: GooseHeadlessAdapterOptions) {}

  async descriptor(): Promise<HarnessDescriptor> {
    return {
      id: 'goose',
      label: 'Goose',
      blurb: 'Goose headless via ACP (goose serve) — one session per workbench run.',
      version: '1.45.0',
      acp: { supported: true, versions: ['0.1'] },
      toolProtocols: ['acp', 'native'],
      supportedModels: [],
      subscriptionAuth: true,
      contextLimits: {},
      budgetReporting: false,
      workspaceModes: ['isolated'],
      cleanupGuarantee: 'best-effort',
      osRequirements: ['docker'],
      resumeGuarantee: 'same-harness-restart',
      checkpointPortability: 'frank-rehydratable',
      eventReplay: 'none',
      cancellationStrength: 'process',
      maxDataClass: 'internal',
    };
  }

  async health(): Promise<HealthReport> {
    const status = await this.options.goose.status();
    const report: HealthReport = {
      healthy: status.healthy,
      checkedAt: new Date().toISOString(),
    };
    if (status.version !== undefined) report.version = status.version;
    if (status.sessions !== undefined) report.activeSessions = status.sessions;
    if (!status.healthy) report.detail = 'goose serve unreachable';
    return report;
  }

  async capacity(): Promise<HarnessCapacity> {
    const status = await this.options.goose.status();
    return {
      maxConcurrentSessions: 8,
      activeSessions: status.sessions ?? 0,
      accepting: status.healthy,
    };
  }

  async usage(window: UsageWindow): Promise<HarnessUsage> {
    // Goose exposes no usage ledger; report zeros honestly rather than
    // guessing (FRANK-§18.1: no fabricated telemetry).
    const none = 0;
    const usage: HarnessUsage = {
      window,
      totalSessions: none,
      totalTurns: none,
      errors: none,
    } as HarnessUsage;
    // Goose reports no token accounting; keep the shape complete.
    (usage as { totalTokensIn: number }).totalTokensIn = none;
    (usage as { totalTokensOut: number }).totalTokensOut = none;
    return usage;
  }

  async start(input: StartHarnessRun): Promise<HarnessSession> {
    const provider = input.provider ?? this.options.defaultProvider;
    // ProviderConfig is a superset of StartHarnessRun.provider — spread it
    // through whole rather than field-by-field.
    const gooseProvider = provider === undefined ? undefined : { ...provider };
    const handle: SessionHandle = await this.options.goose.startSession({
      roomId: input.runId,
      workspacePath: input.workspacePath,
      systemPrompt: input.systemPrompt,
      ...(gooseProvider !== undefined ? { provider: gooseProvider } : {}),
    });
    return {
      id: handle.id,
      nativeSessionId: handle.id,
      harness: 'goose',
      runId: input.runId,
      createdAt: handle.createdAt,
      resumed: false,
    };
  }

  async resume(_input: ResumeHarnessRun): Promise<HarnessSession> {
    // Goose ACP sessions do not survive a server restart; FRANK rehydrates
    // via checkpoint + fresh session instead (descriptor resumeGuarantee).
    throw new Error('goose headless: resume unsupported — rehydrate via checkpoint');
  }

  async inspect(sessionId: string): Promise<HarnessSessionState> {
    const turnsCompleted = 0;
    return {
      sessionId,
      status: 'active',
      turnsCompleted,
      tokensUsed: turnsCompleted,
      lastActivityAt: new Date().toISOString(),
      detail: 'goose exposes no session introspection over ACP',
    };
  }

  async *prompt(input: HarnessPrompt): AsyncIterable<HarnessEvent> {
    for await (const chunk of this.options.goose.sendMessage(this.handleFor(input.sessionId), input.content)) {
      yield mapChunk(chunk);
    }
  }

  async checkpoint(input: CheckpointHarnessRun): Promise<HarnessCheckpoint> {
    // No native checkpoint; the FRANK-rehydratable shape is assembled from
    // the durable workbench record itself (plan + events live in Postgres).
    return {
      checkpointId: `${input.runId}-goose`,
      runId: input.runId,
      runRevision: 0,
      planState: {},
      sourceRefs: [],
      artifactDigests: [],
      completedReceipts: [],
      pendingEffects: [],
      cumulativeSpendUsd: 0,
      eventCursor: '',
      remainingBudget: { maxSpend: 0, currency: 'USD' },
      policyRevision: 'unknown',
      createdAt: input.now,
    };
  }

  async steer(input: SteerHarnessRun): Promise<void> {
    // Steer = a follow-up prompt on the same session.
    for await (const _chunk of this.options.goose.sendMessage(
      this.handleFor(input.sessionId),
      input.instruction,
    )) {
      // drain the stream
    }
  }

  async interrupt(_input: InterruptHarnessRun): Promise<void> {
    // ACP exposes no mid-turn interrupt; cancellation is cooperative.
  }

  async cancel(input: CancelHarnessRun): Promise<void> {
    await this.kill(input);
  }

  async kill(input: KillHarnessRun): Promise<void> {
    await this.options.goose.stopSession(this.handleFor(input.sessionId));
  }

  async collect(_input: CollectHarnessArtifacts): Promise<ArtifactManifest[]> {
    // Artifacts are registered by the agent through the marker protocol,
    // not scraped here; nothing to collect out-of-band.
    return [];
  }

  async close(input: CloseHarnessRun): Promise<void> {
    // Workspace teardown is the provisioner's job (WB-03); here we only
    // close the session.
    await this.options.goose.stopSession(this.handleFor(input.sessionId));
  }

  private handleFor(sessionId: string): SessionHandle {
    return { id: sessionId, harness: 'Goose', roomId: '', createdAt: new Date().toISOString() };
  }
}

function mapChunk(chunk: StreamChunk): HarnessEvent {
  switch (chunk.type) {
    case 'text':
      return { type: 'text', content: chunk.content };
    case 'tool_call':
      return {
        type: 'tool_call',
        toolName: chunk.toolName ?? 'unknown',
        toolArgs: chunk.toolArgs ?? {},
        callId: '',
      };
    case 'tool_result':
      return { type: 'tool_result', callId: '', content: chunk.content, isError: false };
    case 'error':
      return { type: 'error', content: chunk.content };
    case 'done':
      return { type: 'done' };
  }
}

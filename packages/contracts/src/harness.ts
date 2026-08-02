/**
 * `schema://frank.harness/v1` — FRANK-§6.2.
 *
 * The harness adapter contract. Every agent harness (Goose, Hermes, Codex,
 * Claude Code, Qoder, future) implements {@link AgentHarnessAdapter}. FRANK's
 * control plane talks to assignments through this seam alone — the harness
 * underneath is hot-swappable per room or globally.
 *
 * FRANK has exactly one durable execution authority: the Agent Kernel plus its
 * Workflow Service. Harnesses may plan and execute inside a bounded assignment,
 * but their native schedulers, cron loops, durable job databases, global memory,
 * approval systems, direct tool routers, and autonomous child-agent creation are
 * disabled or isolated from product authority.
 */

import type { IsoDateTime } from './common.js';
import type { DataClass } from './classification.js';
import type { ContextPack } from './context-pack.js';

// ---------------------------------------------------------------------------
// Capability enums — §6.2
// ---------------------------------------------------------------------------

/** Whether and how a harness can resume a session after interruption. */
export type ResumeGuarantee =
  | 'none'
  | 'native-session'
  | 'same-harness-restart';

/** Whether checkpoints are portable across harnesses. */
export type CheckpointPortability = 'native-only' | 'frank-rehydratable';

/** Event replay capability for cursor-based continuation. */
export type EventReplay =
  | 'none'
  | 'cursor-within-live-session'
  | 'durable-cursor';

/** How strongly a cancellation is enforced. */
export type CancellationStrength = 'cooperative' | 'process' | 'sandbox';

/** Workspace isolation modes the harness supports. */
export type WorkspaceMode = 'shared' | 'isolated' | 'sandboxed' | 'microvm';

// ---------------------------------------------------------------------------
// Descriptor — §6.2
// ---------------------------------------------------------------------------

/** What a harness declares about itself. Immutable per adapter instance. */
export interface HarnessDescriptor {
  /** Stable id: 'goose', 'hermes', 'codex', 'claude-code', 'qoder'. */
  id: string;
  /** Human-readable label for the UI. */
  label: string;
  /** One-line description. */
  blurb: string;
  /** Semantic version of the harness software. */
  version: string;

  /** ACP protocol support. */
  acp: {
    supported: boolean;
    /** Supported ACP protocol versions. */
    versions: string[];
  };

  /** Tool protocols the harness can consume. */
  toolProtocols: Array<'mcp' | 'acp' | 'native'>;

  /** Model/provider ids the harness can drive. */
  supportedModels: string[];

  /** Subscription authentication support (e.g. ACP subscriptions). */
  subscriptionAuth: boolean;

  /** Context window limits by model alias. */
  contextLimits: Record<string, number>;

  /** Whether the harness reports token/cost usage. */
  budgetReporting: boolean;

  /** Rate limits, if declared. */
  rateLimits?: {
    requestsPerMinute: number;
    tokensPerMinute?: number;
    resetWindowSeconds: number;
  };

  /** Workspace isolation modes. */
  workspaceModes: WorkspaceMode[];

  /** Cleanup guarantees on session close. */
  cleanupGuarantee: 'best-effort' | 'guaranteed' | 'sandbox-destroyed';

  /** Operating system requirements. */
  osRequirements: string[];

  // §6.2 explicit capability enums
  resumeGuarantee: ResumeGuarantee;
  checkpointPortability: CheckpointPortability;
  eventReplay: EventReplay;
  cancellationStrength: CancellationStrength;

  /** Privacy: the strictest data class this harness may process. */
  maxDataClass: DataClass;
}

// ---------------------------------------------------------------------------
// Health, capacity, usage
// ---------------------------------------------------------------------------

export interface HealthReport {
  healthy: boolean;
  /** Harness software version, if known. */
  version?: string;
  /** Active session count. */
  activeSessions?: number;
  /** Last successful health check. */
  checkedAt: IsoDateTime;
  /** Human-readable detail when unhealthy. */
  detail?: string;
}

export interface HarnessCapacity {
  /** Max concurrent sessions the harness can sustain. */
  maxConcurrentSessions: number;
  /** Currently active sessions. */
  activeSessions: number;
  /** Whether the harness can accept new sessions right now. */
  accepting: boolean;
  /** Queue depth if the harness queues requests. */
  queueDepth?: number;
}

export type UsageWindow = '1h' | '24h' | '7d' | '30d';

export interface HarnessUsage {
  window: UsageWindow;
  totalSessions: number;
  totalTurns: number;
  totalTokensIn: number;
  totalTokensOut: number;
  /** Estimated cost in USD, if the harness reports it. */
  estimatedCostUsd?: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** Input to start a new harness session for an assignment. */
export interface StartHarnessRun {
  /** FRANK run (assignment) id. */
  runId: string;
  cellId: string;
  /** Workspace path the harness operates in. */
  workspacePath: string;
  /** The signed context pack for this assignment. */
  contextPack: ContextPack;
  /** System prompt assembled from the context pack. */
  systemPrompt: string;
  /** Provider/model configuration. */
  provider?: {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };
  now: IsoDateTime;
}

/** Input to resume an existing session. */
export interface ResumeHarnessRun {
  runId: string;
  cellId: string;
  /** The harness-native session id to resume. */
  nativeSessionId: string;
  /** Checkpoint to resume from, if FRANK-rehydratable. */
  checkpoint?: HarnessCheckpoint;
  now: IsoDateTime;
}

/** An opaque handle to a live harness session. */
export interface HarnessSession {
  /** FRANK-assigned session id. */
  id: string;
  /** Harness-native session id (opaque). */
  nativeSessionId: string;
  harness: string;
  runId: string;
  createdAt: IsoDateTime;
  /** Whether the session was resumed rather than started fresh. */
  resumed: boolean;
}

/** State of a session as reported by the harness. */
export interface HarnessSessionState {
  sessionId: string;
  status: 'active' | 'idle' | 'suspended' | 'closed' | 'error';
  turnsCompleted: number;
  tokensUsed: number;
  estimatedCostUsd?: number;
  lastActivityAt?: IsoDateTime;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Prompting and events
// ---------------------------------------------------------------------------

/** A prompt to send to the harness. */
export interface HarnessPrompt {
  sessionId: string;
  content: string;
  /** Whether to stream the response. */
  stream?: boolean;
}

/** Events streamed back from the harness during a prompt. */
export type HarnessEvent =
  | { type: 'text'; content: string }
  | {
      type: 'tool_call';
      toolName: string;
      toolArgs: Record<string, unknown>;
      callId: string;
    }
  | { type: 'tool_result'; callId: string; content: string; isError: boolean }
  | { type: 'thinking'; content: string }
  | { type: 'error'; content: string; code?: string }
  | { type: 'done'; usage?: TurnUsage };

export interface TurnUsage {
  tokensIn: number;
  tokensOut: number;
  /** Model that produced this turn. */
  model: string;
}

// ---------------------------------------------------------------------------
// Checkpoint, steer, interrupt, cancel, kill
// ---------------------------------------------------------------------------

/**
 * A FRANK-rehydratable checkpoint — §6.2.
 *
 * Contains everything needed to rebuild a minimal context pack and start a
 * replacement assignment on a different harness. This is rehydration, not a
 * claim that another harness continues the same hidden state.
 */
export interface HarnessCheckpoint {
  checkpointId: string;
  runId: string;
  /** Canonical run revision at checkpoint time. */
  runRevision: number;
  /** Plan and dependency state, serialized. */
  planState: Record<string, unknown>;
  /** Source references the agent was working with. */
  sourceRefs: string[];
  /** Accepted artifact digests. */
  artifactDigests: string[];
  /** Repository commit at checkpoint time. */
  repositoryCommit?: string;
  /** Completed tool invocation receipts. */
  completedReceipts: string[];
  /** Pending or outcome-unknown side-effect ledger entries. */
  pendingEffects: string[];
  /** Cumulative spend in USD. */
  cumulativeSpendUsd: number;
  /** Normalized event cursor for replay. */
  eventCursor: string;
  /** Remaining budget. */
  remainingBudget: { maxSpend: number; currency: string };
  /** Policy revision at checkpoint time. */
  policyRevision: string;
  createdAt: IsoDateTime;
}

export interface CheckpointHarnessRun {
  sessionId: string;
  runId: string;
  reason: string;
  now: IsoDateTime;
}

export interface SteerHarnessRun {
  sessionId: string;
  /** New or amended instructions. */
  instruction: string;
  now: IsoDateTime;
}

export interface InterruptHarnessRun {
  sessionId: string;
  reason: string;
  now: IsoDateTime;
}

export interface CancelHarnessRun {
  sessionId: string;
  reason: string;
  now: IsoDateTime;
}

export interface KillHarnessRun {
  sessionId: string;
  reason: string;
  now: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Artifact collection and close
// ---------------------------------------------------------------------------

export interface CollectHarnessArtifacts {
  sessionId: string;
  runId: string;
}

export interface ArtifactManifest {
  artifactId: string;
  kind: 'code' | 'document' | 'log' | 'test' | 'config' | 'other';
  path: string;
  sha256: string;
  sizeBytes: number;
  createdAt: IsoDateTime;
}

export interface CloseHarnessRun {
  sessionId: string;
  runId: string;
  /** Whether to clean up the workspace. */
  cleanup: boolean;
  now: IsoDateTime;
}

// ---------------------------------------------------------------------------
// The adapter contract — §6.2
// ---------------------------------------------------------------------------

/**
 * The full harness adapter contract. Every agent harness implements this.
 *
 * FRANK maps Codex, Claude Code, Qoder, Goose, Hermes, and future agents to
 * this contract and tests process loss at each event boundary.
 */
export interface AgentHarnessAdapter {
  /** Declare what this harness is and can do. */
  descriptor(): Promise<HarnessDescriptor>;

  /** Live health probe. */
  health(): Promise<HealthReport>;

  /** Current capacity. */
  capacity(): Promise<HarnessCapacity>;

  /** Usage over a time window. */
  usage(window: UsageWindow): Promise<HarnessUsage>;

  /** Start a new session for an assignment. */
  start(input: StartHarnessRun): Promise<HarnessSession>;

  /** Resume an existing session. */
  resume(input: ResumeHarnessRun): Promise<HarnessSession>;

  /** Inspect a session's current state. */
  inspect(sessionId: string): Promise<HarnessSessionState>;

  /** Send a prompt and stream back events. */
  prompt(input: HarnessPrompt, afterCursor?: string): AsyncIterable<HarnessEvent>;

  /** Create a checkpoint. */
  checkpoint(input: CheckpointHarnessRun): Promise<HarnessCheckpoint>;

  /** Steer the session with new instructions. */
  steer(input: SteerHarnessRun): Promise<void>;

  /** Interrupt the current turn. */
  interrupt(input: InterruptHarnessRun): Promise<void>;

  /** Cancel the session cooperatively. */
  cancel(input: CancelHarnessRun): Promise<void>;

  /** Kill the session forcefully. */
  kill(input: KillHarnessRun): Promise<void>;

  /** Collect artifacts produced by the session. */
  collect(input: CollectHarnessArtifacts): Promise<ArtifactManifest[]>;

  /** Close the session and clean up. */
  close(input: CloseHarnessRun, cleanupDeadline: IsoDateTime): Promise<void>;
}

// ---------------------------------------------------------------------------
// Harness selection — §8.4
// ---------------------------------------------------------------------------

/** Factors the Harness Broker scores when selecting a harness. */
export interface SelectionFactors {
  /** Task type: 'code', 'research', 'review', 'general', etc. */
  taskType: string;
  /** Primary repository language, if applicable. */
  repoLanguage?: string;
  /** Required tool protocols. */
  requiredToolProtocols: Array<'mcp' | 'acp' | 'native'>;
  /** Required data class ceiling. */
  dataClass: DataClass;
  /** Whether independent review diversity is needed. */
  needsReviewDiversity: boolean;
  /** Preferred workspace mode. */
  preferredWorkspaceMode?: WorkspaceMode;
}

/** A scored candidate for harness selection. */
export interface HarnessCandidate {
  descriptor: HarnessDescriptor;
  health: HealthReport;
  capacity: HarnessCapacity;
  /** Composite score computed by the broker. Higher is better. */
  score: number;
  /** Human-readable explanation of the score. */
  explanation: string;
}

/** The broker's selection decision. */
export interface HarnessSelection {
  /** The selected harness id. */
  harnessId: string;
  /** All scored candidates, best first. */
  candidates: HarnessCandidate[];
  /** Plain-language explanation of why this harness was chosen. */
  explanation: string;
  /** Whether the selection was automatic or user-directed. */
  mode: 'auto' | 'named' | 'route-profile';
}

/** A saved route profile — §8.4. */
export interface HarnessRouteProfile {
  id: string;
  name: string;
  /** Ordered preference list of harness ids. */
  preference: string[];
  /** Optional task-type overrides. */
  taskTypeOverrides?: Record<string, string>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

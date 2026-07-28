/**
 * The domain store port.
 *
 * `apps/api` is a composition root (FRANK-§17.1) and may wire adapters directly,
 * so this interface is not there to keep PostgreSQL replaceable — ADR-003 says
 * PostgreSQL *is* canonical truth and does not intend to replace it.
 *
 * It exists for two narrower reasons:
 *
 *   1. **UX-004 has to be testable without a database.** The requirement is that
 *      the API boundary acknowledges durability in under 500 ms *even when
 *      downstream enrichment is stalled*. That is a claim about the shape of the
 *      request path — that it awaits the transaction and nothing else — and a
 *      claim about shape is best proven where the transaction's own latency
 *      cannot mask it. `test/fake-store.ts` implements this interface;
 *      `capture-latency.integration.test.ts` measures the real one. Both are
 *      needed and neither is sufficient (see `vitest.config.ts`).
 *   2. **It names the transaction boundaries.** Every method here is one
 *      transaction. `capture` is one transaction. `transitionWork` is one
 *      transaction. There is no method that could be two, which keeps ADR-004's
 *      "domain mutation and outbox entry commit together" a property of the
 *      interface rather than of each implementation's discipline.
 *
 * Nothing in this file imports a database driver. `postgres-store.ts` does.
 */

import type { DataClass, TrustLabel } from '@frank/contracts';
import type { WorkState } from '@frank/adapter-postgres';

export interface ActorRef {
  readonly kind: 'user' | 'agent' | 'agent_team' | 'external_system' | 'service';
  readonly id: string;
}

/* ------------------------------------------------------------------ capture --- */

export interface CaptureCommand {
  readonly cellId: string;
  /** FRANK-§12.1 idempotency key from the request. */
  readonly requestIdempotencyKey: string;
  readonly kind: 'text' | 'voice';
  readonly text: string;
  readonly title: string | undefined;
  readonly originUri: string | undefined;
  readonly mediaType: string;
  readonly dataClass: DataClass;
  readonly trust: TrustLabel;
  readonly actor: ActorRef;
  readonly correlationId: string;
  readonly channel: string;
  readonly now: Date;
  /** FRANK-§6.9 decision recorded on the audit entry (FRANK-§11.5). */
  readonly policyVersion: string;
  readonly policyResult: 'allow' | 'allow_with_limits' | 'hold_for_review' | 'deny';
}

export interface CaptureRecord {
  readonly sourceId: string;
  readonly sourceVersionId: string | null;
  readonly workItemId: string | null;
  readonly captureEventId: string;
  readonly contentHash: string;
  readonly replayed: boolean;
  readonly replayReason: 'request' | 'content' | null;
  readonly emittedEventIds: readonly string[];
  readonly auditEntryId: string | null;
}

/* --------------------------------------------------------------------- work --- */

export interface WorkListQuery {
  readonly cellId: string;
  readonly state: WorkState | undefined;
  readonly ownerId: string | undefined;
  readonly cursor: string | undefined;
  readonly limit: number;
  readonly sort: 'created_at' | 'updated_at' | 'due_at' | 'priority';
  readonly order: 'asc' | 'desc';
}

export interface WorkItemRecord {
  readonly id: string;
  readonly cellId: string;
  readonly kind: 'task' | 'decision' | 'bug' | 'milestone' | 'follow_up' | 'routine' | 'agent_job';
  readonly title: string;
  readonly description: string | null;
  readonly state: WorkState;
  readonly priority: 'none' | 'low' | 'normal' | 'high' | 'critical';
  readonly owner: ActorRef;
  readonly dataClass: DataClass;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly dueAt: Date | null;
  readonly scheduledForAt: Date | null;
  readonly whyNow: string | null;
  readonly nextSafeAction: string | null;
  readonly definitionOfDone: ReadonlyArray<{
    readonly id: string;
    readonly statement: string;
    readonly verification: string;
  }>;
  readonly policyRef: { readonly ref: string; readonly version: string };
  readonly provenance: {
    readonly method: string;
    readonly producer: string;
    readonly correlationId: string | null;
  };
  readonly sourceIds: readonly string[];
}

export interface WorkListResult {
  readonly items: readonly WorkItemRecord[];
  readonly nextCursor: string | null;
  /** When the underlying data was read. Feeds the UX-007 freshness envelope. */
  readonly asOf: Date;
}

export interface WorkTransitionCommand {
  readonly cellId: string;
  readonly workItemId: string;
  readonly toState: string;
  readonly expectedVersion: number | undefined;
  readonly reason: string | undefined;
  readonly actor: ActorRef;
  readonly correlationId: string;
  readonly now: Date;
  readonly policyVersion: string;
  readonly policyResult: 'allow' | 'allow_with_limits' | 'hold_for_review' | 'deny';
}

export interface WorkTransitionRecord {
  readonly workItemId: string;
  readonly fromState: WorkState;
  readonly toState: WorkState;
  readonly version: number;
  readonly auditEntryId: string;
  readonly emittedEventIds: readonly string[];
}

export interface WorkTransitionRow {
  readonly seq: number;
  readonly fromState: WorkState;
  readonly toState: WorkState;
  readonly actor: ActorRef;
  readonly reason: string | null;
  readonly occurredAt: Date;
  readonly auditEntryId: string | null;
  readonly resultingVersion: number;
}

/* --------------------------------------------------------------- provenance --- */

export interface SourceEnvelopeRecord {
  readonly id: string;
  readonly relation: string;
  readonly kind: string;
  readonly originUri: string | null;
  readonly contentHash: string;
  readonly rawArtifactUri: string;
  readonly rawArtifactSha256: string;
  readonly dataClass: DataClass;
  readonly trust: TrustLabel;
  readonly lifecycle: string;
  readonly capturedAt: Date;
  readonly capturedBy: ActorRef;
  readonly currentVersionId: string | null;
  readonly versions: ReadonlyArray<{
    readonly id: string;
    readonly versionNo: number;
    readonly contentHash: string;
    readonly recordedAt: Date;
    readonly reason: string;
  }>;
  readonly captureEvents: ReadonlyArray<{
    readonly id: string;
    readonly requestIdempotencyKey: string;
    readonly channel: string;
    readonly acceptedAt: Date;
    readonly replayCount: number;
    readonly correlationId: string;
  }>;
}

export interface AuditEntryRecord {
  readonly id: string;
  readonly seq: number;
  readonly action: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly actor: ActorRef;
  readonly policyVersion: string | null;
  readonly policyDecision: 'allow' | 'allow_with_limits' | 'hold_for_review' | 'deny' | null;
  readonly occurredAt: Date;
  readonly entryHash: string;
  readonly prevChainHash: string;
  readonly chainHash: string;
}

export interface CostReceiptRecord {
  readonly id: string;
  readonly category: string;
  /** Decimal string. FIN-002: never a float on the wire. */
  readonly amount: string;
  readonly currency: string;
  readonly attributionState: 'attributed' | 'partial' | 'unattributed';
  readonly occurredAt: Date;
  readonly usageReceiptRef: string | null;
  readonly providerId: string | null;
  readonly modelRef: string | null;
}

export interface ProvenanceChain {
  readonly workItem: WorkItemRecord;
  readonly sources: readonly SourceEnvelopeRecord[];
  readonly auditEntries: readonly AuditEntryRecord[];
  readonly costReceipts: readonly CostReceiptRecord[];
  /** Recomputed from the returned entries, never read as a stored boolean. */
  readonly chainVerified: boolean;
  readonly chainVerificationDetail: string;
  readonly asOf: Date;
}

/* ------------------------------------------------------------------- health --- */

export interface StoreHealth {
  readonly reachable: boolean;
  readonly latencyMs: number;
  readonly detail: string;
  readonly observedAt: Date;
  /** ADR-004 backlog. Feeds the OPS-004 `degraded` determination. */
  readonly outbox: {
    readonly pending: number;
    readonly publishing: number;
    readonly published: number;
    readonly quarantined: number;
  } | null;
}

/* -------------------------------------------------------------------- port --- */

export class WorkItemNotFound extends Error {
  constructor(id: string) {
    super(`work item ${id} not found`);
    this.name = 'WorkItemNotFound';
  }
}

export class VersionConflict extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) {
    super(`expected version ${expected}, found ${actual}`);
    this.name = 'VersionConflict';
    this.expected = expected;
    this.actual = actual;
  }
}

export class IllegalTransition extends Error {
  readonly from: string;
  readonly to: string;
  constructor(from: string, to: string, detail: string) {
    super(detail);
    this.name = 'IllegalTransition';
    this.from = from;
    this.to = to;
  }
}

export interface DomainStore {
  /**
   * UX-004. One transaction: source envelope, source version, triage work item,
   * capture ledger row, audit entry, and outbox events. Returns when that
   * transaction has committed and not one moment later.
   */
  capture(command: CaptureCommand): Promise<CaptureRecord>;

  listWork(query: WorkListQuery): Promise<WorkListResult>;
  getWork(cellId: string, id: string): Promise<WorkItemRecord | undefined>;
  workHistory(cellId: string, id: string): Promise<readonly WorkTransitionRow[]>;
  transitionWork(command: WorkTransitionCommand): Promise<WorkTransitionRecord>;
  provenanceFor(cellId: string, workItemId: string): Promise<ProvenanceChain | undefined>;
  health(): Promise<StoreHealth>;
  close(): Promise<void>;
}

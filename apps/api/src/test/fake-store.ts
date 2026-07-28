/**
 * An in-memory {@link DomainStore} for the tests that must not need a database.
 *
 * Its purpose is narrow and worth stating so it is not mistaken for a general
 * test double: it exists so the **shape** of the request path can be tested
 * independently of how fast PostgreSQL happens to be.
 *
 * UX-004's claim is "acknowledge durability in under 500 ms at the API boundary
 * **even when downstream enrichment is delayed**". The interesting half of that
 * sentence is the second half, and proving it needs a store whose latency is
 * known and an enrichment handler that never resolves. With both controlled, a
 * capture that returns fast proves the enrichment path is off the request path
 * and nothing else — which is exactly the claim.
 *
 * The real measurement against real PostgreSQL is in
 * `capture-latency.integration.test.ts`. Neither test replaces the other:
 * a fake store can always be fast, and a fast real measurement does not by
 * itself prove the decoupling (it might just mean enrichment was quick).
 *
 * {@link FakeDomainStore.captureDelayMs} lets a test give the "transaction" a
 * deliberate cost, so the assertion is about the *difference* between the
 * transaction's time and the response's time rather than about an absolute
 * number that would only measure the machine.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { WorkState } from '@frank/adapter-postgres';
import { assertTransition } from '@frank/adapter-postgres';

import type {
  CaptureCommand,
  CaptureRecord,
  DomainStore,
  ProvenanceChain,
  StoreHealth,
  WorkItemRecord,
  WorkListQuery,
  WorkListResult,
  WorkTransitionCommand,
  WorkTransitionRecord,
  WorkTransitionRow,
} from '../services/store.js';
import { IllegalTransition, VersionConflict, WorkItemNotFound } from '../services/store.js';

interface StoredSource {
  id: string;
  kind: string;
  contentHash: string;
  dataClass: WorkItemRecord['dataClass'];
  trust: string;
  capturedAt: Date;
  capturedBy: { kind: 'user' | 'agent' | 'service'; id: string };
  captureEventId: string;
  requestIdempotencyKey: string;
  channel: string;
  correlationId: string;
  workItemId: string | null;
}

export interface FakeDomainStoreOptions {
  /** Simulated transaction cost, in milliseconds. */
  readonly captureDelayMs?: number;
  /** When true, `capture` rejects. Used to test the failure path. */
  readonly failCapture?: boolean;
  readonly databaseReachable?: boolean;
}

export class FakeDomainStore implements DomainStore {
  captureDelayMs: number;
  failCapture: boolean;
  databaseReachable: boolean;

  readonly #items = new Map<string, WorkItemRecord>();
  readonly #history = new Map<string, WorkTransitionRow[]>();
  readonly #sources = new Map<string, StoredSource>();
  readonly #byRequestKey = new Map<string, string>();
  readonly #byContentHash = new Map<string, string>();
  #closed = false;

  constructor(options: FakeDomainStoreOptions = {}) {
    this.captureDelayMs = options.captureDelayMs ?? 0;
    this.failCapture = options.failCapture ?? false;
    this.databaseReachable = options.databaseReachable ?? true;
  }

  async capture(command: CaptureCommand): Promise<CaptureRecord> {
    if (this.captureDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.captureDelayMs));
    }
    if (this.failCapture) throw new Error('simulated transaction failure');

    const contentHash = `sha256:${createHash('sha256').update(command.text, 'utf8').digest('hex')}`;

    // Replay 1: the same request idempotency key.
    const byRequest = this.#byRequestKey.get(`${command.cellId}|${command.requestIdempotencyKey}`);
    if (byRequest !== undefined) {
      const existing = this.#sources.get(byRequest);
      if (existing !== undefined) {
        return {
          sourceId: existing.id,
          sourceVersionId: null,
          workItemId: existing.workItemId,
          captureEventId: existing.captureEventId,
          contentHash: existing.contentHash,
          replayed: true,
          replayReason: 'request',
          emittedEventIds: [],
          auditEntryId: null,
        };
      }
    }

    // Replay 2: the same bytes from the same origin.
    const byContent = this.#byContentHash.get(`${command.cellId}|${contentHash}`);
    if (byContent !== undefined) {
      const existing = this.#sources.get(byContent);
      if (existing !== undefined) {
        return {
          sourceId: existing.id,
          sourceVersionId: null,
          workItemId: existing.workItemId,
          captureEventId: randomUUID(),
          contentHash,
          replayed: true,
          replayReason: 'content',
          emittedEventIds: [],
          auditEntryId: null,
        };
      }
    }

    const sourceId = randomUUID();
    const workItemId = randomUUID();
    const captureEventId = randomUUID();

    this.#items.set(workItemId, {
      id: workItemId,
      cellId: command.cellId,
      kind: 'task',
      title: command.title ?? command.text.slice(0, 100),
      description: null,
      state: 'inbox',
      priority: 'none',
      owner: { kind: command.actor.kind, id: command.actor.id },
      dataClass: command.dataClass,
      version: 1,
      createdAt: command.now,
      updatedAt: command.now,
      startedAt: null,
      completedAt: null,
      dueAt: null,
      scheduledForAt: null,
      whyNow: 'Captured content is awaiting triage',
      nextSafeAction: 'Classify and route this capture',
      definitionOfDone: [],
      policyRef: { ref: 'frank.operating-policy', version: command.policyVersion },
      provenance: {
        method: 'capture',
        producer: 'apps/api',
        correlationId: command.correlationId,
      },
      sourceIds: [sourceId],
    });

    this.#sources.set(sourceId, {
      id: sourceId,
      kind: command.kind,
      contentHash,
      dataClass: command.dataClass,
      trust: command.trust,
      capturedAt: command.now,
      capturedBy: command.actor as StoredSource['capturedBy'],
      captureEventId,
      requestIdempotencyKey: command.requestIdempotencyKey,
      channel: command.channel,
      correlationId: command.correlationId,
      workItemId,
    });
    this.#byRequestKey.set(`${command.cellId}|${command.requestIdempotencyKey}`, sourceId);
    this.#byContentHash.set(`${command.cellId}|${contentHash}`, sourceId);

    return {
      sourceId,
      sourceVersionId: randomUUID(),
      workItemId,
      captureEventId,
      contentHash,
      replayed: false,
      replayReason: null,
      emittedEventIds: [randomUUID(), randomUUID()],
      auditEntryId: randomUUID(),
    };
  }

  async listWork(query: WorkListQuery): Promise<WorkListResult> {
    const all = [...this.#items.values()]
      .filter((item) => item.cellId === query.cellId)
      .filter((item) => query.state === undefined || item.state === query.state)
      .filter((item) => query.ownerId === undefined || item.owner.id === query.ownerId)
      .sort((a, b) =>
        query.order === 'desc'
          ? b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id)
          : a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id),
      );

    const page = all.slice(0, query.limit);
    return {
      items: page,
      nextCursor: all.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      asOf: new Date(),
    };
  }

  async getWork(cellId: string, id: string): Promise<WorkItemRecord | undefined> {
    const item = this.#items.get(id);
    return item !== undefined && item.cellId === cellId ? item : undefined;
  }

  async workHistory(_cellId: string, id: string): Promise<readonly WorkTransitionRow[]> {
    return this.#history.get(id) ?? [];
  }

  async transitionWork(command: WorkTransitionCommand): Promise<WorkTransitionRecord> {
    const item = this.#items.get(command.workItemId);
    if (item === undefined || item.cellId !== command.cellId) {
      throw new WorkItemNotFound(command.workItemId);
    }
    if (command.expectedVersion !== undefined && command.expectedVersion !== item.version) {
      throw new VersionConflict(command.expectedVersion, item.version);
    }

    const toState = command.toState as WorkState;
    try {
      // The real state machine, not a copy: a fake that permitted a transition
      // the database rejects would make the tests agree with the wrong thing.
      assertTransition(item.state, toState, command.workItemId);
    } catch (error) {
      throw new IllegalTransition(item.state, toState, (error as Error).message);
    }

    const updated: WorkItemRecord = {
      ...item,
      state: toState,
      version: item.version + 1,
      updatedAt: command.now,
      startedAt: toState === 'active' && item.startedAt === null ? command.now : item.startedAt,
      completedAt: toState === 'done' ? command.now : item.completedAt,
    };
    this.#items.set(item.id, updated);

    const history = this.#history.get(item.id) ?? [];
    const auditEntryId = randomUUID();
    history.push({
      seq: history.length + 1,
      fromState: item.state,
      toState,
      actor: command.actor,
      reason: command.reason ?? null,
      occurredAt: command.now,
      auditEntryId,
      resultingVersion: updated.version,
    });
    this.#history.set(item.id, history);

    return {
      workItemId: item.id,
      fromState: item.state,
      toState,
      version: updated.version,
      auditEntryId,
      emittedEventIds: [randomUUID()],
    };
  }

  async provenanceFor(cellId: string, workItemId: string): Promise<ProvenanceChain | undefined> {
    const item = await this.getWork(cellId, workItemId);
    if (item === undefined) return undefined;

    const sources = item.sourceIds
      .map((id) => this.#sources.get(id))
      .filter((source): source is StoredSource => source !== undefined)
      .map((source) => ({
        id: source.id,
        relation: 'origin',
        kind: source.kind,
        originUri: null,
        contentHash: source.contentHash,
        rawArtifactUri: `frank-object://${cellId}/sources/${source.contentHash}`,
        rawArtifactSha256: source.contentHash,
        dataClass: source.dataClass,
        trust: source.trust as ProvenanceChain['sources'][number]['trust'],
        lifecycle: 'active',
        capturedAt: source.capturedAt,
        capturedBy: source.capturedBy,
        currentVersionId: null,
        versions: [],
        captureEvents: [
          {
            id: source.captureEventId,
            requestIdempotencyKey: source.requestIdempotencyKey,
            channel: source.channel,
            acceptedAt: source.capturedAt,
            replayCount: 0,
            correlationId: source.correlationId,
          },
        ],
      }));

    return {
      workItem: item,
      sources,
      auditEntries: [],
      costReceipts: [],
      chainVerified: true,
      chainVerificationDetail: 'in-memory store keeps no audit chain',
      asOf: new Date(),
    };
  }

  async health(): Promise<StoreHealth> {
    return {
      reachable: this.databaseReachable,
      latencyMs: 1,
      detail: this.databaseReachable
        ? 'in-memory store'
        : 'in-memory store is simulating an outage',
      observedAt: new Date(),
      outbox: null,
    };
  }

  /** Mirrors the Postgres store's optional method so the health service finds it. */
  async outboxCounts(): Promise<{
    pending: number;
    publishing: number;
    published: number;
    quarantined: number;
  }> {
    return { pending: 0, publishing: 0, published: 0, quarantined: 0 };
  }

  async close(): Promise<void> {
    this.#closed = true;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Seed an item directly. Used by tests that need a specific state. */
  seed(item: WorkItemRecord): void {
    this.#items.set(item.id, item);
  }
}

/**
 * The PostgreSQL implementation of {@link DomainStore} — ADR-003, ADR-004.
 *
 * ## The one place in this app that knows about SQL
 *
 * `apps/api` sits in the `app` layer, which FRANK-§17.2 permits to depend on
 * adapters ("Apps depend on modules and shared packages" and, being composition
 * roots, wire adapters). This file is the whole of that dependency: every other
 * module in `apps/api` takes a {@link DomainStore} and could not name a table if
 * it wanted to.
 *
 * `drizzle-orm` appears in this app's `dependencies` and that is a deliberate,
 * narrow choice rather than an oversight. `tools/lint/provider-sdks.json` denies
 * provider SDKs to the `contracts` and `domain-module` layers, not to apps, for
 * the reason FRANK-§17.2 gives: adapters and composition roots are where
 * provider coupling belongs. The alternative — adding read methods to
 * `adapters/storage/postgres` — would have been equally legal and is the better
 * long-term home for these queries; it is not done here because that package is
 * another workstream's and a read model built for one consumer should prove
 * itself before it is promoted into a shared adapter.
 *
 * ## Writes go through the adapter's repositories, never through raw SQL
 *
 * Every mutation below calls `CaptureService` or `WorkItemRepository` inside
 * `withTransaction`. Those classes take a `FrankTransaction` and refuse a pool
 * handle, which is how ADR-004's "domain mutation and outbox entry commit in one
 * transaction" is enforced by the type checker rather than by this file
 * remembering. Only reads are hand-written here.
 */

import { createHash } from 'node:crypto';

import { and, asc, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';

import {
  AuditRepository,
  CaptureService,
  CostRepository,
  IllegalWorkTransitionError,
  OptimisticConcurrencyError,
  OutboxRepository,
  WorkItemRepository,
  WorkItemNotFoundError,
  createDatabase,
  schema,
  withTransaction,
} from '@frank/adapter-postgres';
import type { FrankDatabase, FrankDatabaseHandle, WorkState } from '@frank/adapter-postgres';
import type { DataClass, TrustLabel } from '@frank/contracts';

import type {
  ActorRef,
  AuditEntryRecord,
  CaptureCommand,
  CaptureRecord,
  CostReceiptRecord,
  DomainStore,
  ProvenanceChain,
  SourceEnvelopeRecord,
  StoreHealth,
  WorkItemRecord,
  WorkListQuery,
  WorkListResult,
  WorkTransitionCommand,
  WorkTransitionRecord,
  WorkTransitionRow,
} from './store.js';
import { IllegalTransition, VersionConflict, WorkItemNotFound } from './store.js';

/**
 * Where the raw captured bytes live.
 *
 * ADR-003: "PostgreSQL and S3-compatible object storage own canonical business
 * truth"; the source table stores a URI and a digest, never the payload. Slice 1
 * has no object store deployed (SeaweedFS is Workstream 3), so this returns a
 * content-addressed URI in the scheme the object store will serve, and the row
 * records the digest that will verify the bytes when they land there.
 *
 * That is a real gap and it is named rather than papered over: until the object
 * store exists, the *bytes* of a text capture are not retrievable, though the
 * envelope, its hash, its audit entry, and its work item all are. The Slice 1
 * exit gate is the provenance *chain*, which this satisfies; retrieving the
 * payload is a Slice 3 concern that arrives with the object store.
 */
function artifactUriFor(cellId: string, contentHash: string): string {
  const digest = contentHash.startsWith('sha256:') ? contentHash.slice('sha256:'.length) : contentHash;
  return `frank-object://${cellId}/sources/sha256/${digest.slice(0, 2)}/${digest}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface PostgresDomainStoreOptions {
  readonly connectionString: string;
  readonly applicationName?: string;
  readonly poolSize?: number;
  readonly statementTimeoutMs?: number;
}

export class PostgresDomainStore implements DomainStore {
  readonly #handle: FrankDatabaseHandle;
  readonly #db: FrankDatabase;
  readonly #audit = new AuditRepository();
  readonly #outbox = new OutboxRepository();
  readonly #work: WorkItemRepository;
  readonly #capture: CaptureService;
  readonly #cost = new CostRepository();

  constructor(options: PostgresDomainStoreOptions) {
    this.#handle = createDatabase({
      connectionString: options.connectionString,
      applicationName: options.applicationName ?? 'frank-api',
      ...(options.poolSize === undefined ? {} : { max: options.poolSize }),
      ...(options.statementTimeoutMs === undefined
        ? {}
        : { statementTimeoutMs: options.statementTimeoutMs }),
    });
    this.#db = this.#handle.db;
    this.#work = new WorkItemRepository(this.#audit, this.#outbox);
    this.#capture = new CaptureService(this.#audit, this.#outbox, this.#work);
  }

  /** Raw DB handle for brain routes (raw SQL, not yet in DomainStore port). */
  get db(): FrankDatabase {
    return this.#db;
  }

  /* ---------------------------------------------------------------- capture --- */

  /**
   * UX-004's durable write.
   *
   * One `withTransaction`. Nothing after it except assembling the response —
   * no enrichment, no publish, no notification. `services/enrichment.ts` is
   * called by the *route*, after this resolves, without an `await`.
   */
  async capture(command: CaptureCommand): Promise<CaptureRecord> {
    const contentHash = `sha256:${sha256Hex(command.text)}`;
    const artifactUri = artifactUriFor(command.cellId, contentHash);
    const actorRef = `${command.actor.kind}/${command.actor.id}`;

    const result = await withTransaction(this.#db, async (tx) => {
      const captured = await this.#capture.captureInTransaction(tx, {
        cellId: command.cellId,
        requestIdempotencyKey: command.requestIdempotencyKey,
        kind: command.kind === 'voice' ? 'voice' : 'text',
        contentHash,
        rawArtifactUri: artifactUri,
        rawArtifactSha256: contentHash,
        rawArtifactBytes: BigInt(Buffer.byteLength(command.text, 'utf8')),
        mediaType:
          command.kind === 'voice' ? 'text/plain; profile=voice-transcript' : 'text/plain',
        originUri: command.originUri,
        capturedBy: { kind: command.actor.kind, id: command.actor.id },
        capturedAt: command.now,
        observedAt: command.now,
        dataClass: command.dataClass,
        trust: command.trust,
        rightsPolicy: { ref: 'personal-capture', version: '1.0.0' },
        retentionPolicy: { ref: 'source-default', version: '1.0.0' },
        provenance: {
          method: 'capture',
          producer: 'apps/api',
          correlationId: command.correlationId,
        },
        channel: command.channel,
        correlationId: command.correlationId,
        createTriageItem: true,
        triageTitle: command.title ?? defaultTriageTitle(command),
        policyRef: { ref: 'frank.operating-policy', version: command.policyVersion },
        now: command.now,
      });
      return captured;
    });

    // The audit entry id is not returned by CaptureService, and reading it back
    // would be a second round trip on the UX-004 path. It is resolved lazily by
    // the provenance walk instead, where latency does not matter.
    void actorRef;

    return {
      sourceId: result.sourceId,
      sourceVersionId: result.sourceVersionId,
      workItemId: result.workItemId,
      captureEventId: result.captureEventId,
      contentHash,
      replayed: result.replayed,
      replayReason: result.replayReason,
      emittedEventIds: result.eventIds,
      auditEntryId: null,
    };
  }

  /* ------------------------------------------------------------------- work --- */

  async listWork(query: WorkListQuery): Promise<WorkListResult> {
    const conditions = [eq(schema.workItem.cellId, query.cellId)];
    if (query.state !== undefined) conditions.push(eq(schema.workItem.state, query.state));
    if (query.ownerId !== undefined) conditions.push(eq(schema.workItem.ownerId, query.ownerId));

    // Cursor pagination on the primary key (FRANK-§12.1). `id` is a UUIDv7, so
    // ordering by it is ordering by creation time, and a keyset cursor cannot
    // skip or duplicate a row the way an OFFSET can when rows are inserted
    // between pages.
    if (query.cursor !== undefined) {
      conditions.push(
        query.order === 'desc'
          ? lt(schema.workItem.id, query.cursor)
          : gt(schema.workItem.id, query.cursor),
      );
    }

    const direction = query.order === 'desc' ? desc : asc;
    const sortColumn = {
      created_at: schema.workItem.createdAt,
      updated_at: schema.workItem.updatedAt,
      due_at: schema.workItem.dueAt,
      priority: schema.workItem.priority,
    }[query.sort];

    const rows = await this.#db
      .select()
      .from(schema.workItem)
      .where(and(...conditions))
      // `id` is the tiebreaker so the ordering is total; a non-total order makes
      // a keyset cursor ambiguous and quietly loses rows.
      .orderBy(direction(sortColumn), direction(schema.workItem.id))
      .limit(query.limit + 1);

    const asOf = new Date();
    const page = rows.slice(0, query.limit);
    const sourceIds = await this.#sourceIdsFor(page.map((row) => row.id));

    return {
      items: page.map((row) => toWorkItemRecord(row, sourceIds.get(row.id) ?? [])),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
      asOf,
    };
  }

  async getWork(cellId: string, id: string): Promise<WorkItemRecord | undefined> {
    const row = await this.#work.findById(this.#db, cellId, id);
    if (row === undefined) return undefined;
    const sourceIds = await this.#sourceIdsFor([id]);
    return toWorkItemRecord(row, sourceIds.get(id) ?? []);
  }

  async workHistory(cellId: string, id: string): Promise<readonly WorkTransitionRow[]> {
    const rows = await this.#db
      .select()
      .from(schema.workItemTransition)
      .where(
        and(
          eq(schema.workItemTransition.cellId, cellId),
          eq(schema.workItemTransition.workItemId, id),
        ),
      )
      .orderBy(asc(schema.workItemTransition.seq));

    return rows.map((row) => ({
      seq: row.seq,
      fromState: row.fromState,
      toState: row.toState,
      actor: { kind: row.actorKind, id: row.actorId },
      reason: row.reason,
      occurredAt: row.occurredAt,
      auditEntryId: row.auditEntryId,
      resultingVersion: row.resultingVersion,
    }));
  }

  async transitionWork(command: WorkTransitionCommand): Promise<WorkTransitionRecord> {
    try {
      const result = await withTransaction(this.#db, (tx) =>
        this.#work.transition(tx, {
          workItemId: command.workItemId,
          cellId: command.cellId,
          expectedVersion: command.expectedVersion,
          toState: command.toState,
          actor: { kind: command.actor.kind, id: command.actor.id },
          reason: command.reason,
          correlationId: command.correlationId,
          now: command.now,
          policyVersion: command.policyVersion,
          policyDecision: command.policyResult,
        }),
      );
      return {
        workItemId: result.workItemId,
        fromState: result.fromState,
        toState: result.toState,
        version: result.version,
        auditEntryId: result.auditEntryId,
        emittedEventIds: [result.eventId],
      };
    } catch (error) {
      // The adapter's typed errors become this port's typed errors, so the route
      // layer maps to a problem detail without knowing which storage raised it.
      if (error instanceof OptimisticConcurrencyError) {
        throw new VersionConflict(error.expectedVersion, error.actualVersion);
      }
      if (error instanceof IllegalWorkTransitionError) {
        throw new IllegalTransition(error.from, error.to, error.message);
      }
      if (error instanceof WorkItemNotFoundError) {
        throw new WorkItemNotFound(command.workItemId);
      }
      throw error;
    }
  }

  /* ------------------------------------------------------------ provenance --- */

  /**
   * The Slice 1 exit gate.
   *
   * Five reads, deliberately sequential rather than one join: the shapes are
   * one-to-many in both directions, and a single flattened query would return
   * the work item once per (source × version × capture event) row and have to be
   * un-flattened in JavaScript anyway. Provenance is not on a latency path.
   */
  async provenanceFor(cellId: string, workItemId: string): Promise<ProvenanceChain | undefined> {
    const item = await this.getWork(cellId, workItemId);
    if (item === undefined) return undefined;

    const refs = await this.#db
      .select({
        sourceId: schema.workItemSourceRef.sourceId,
        relation: schema.workItemSourceRef.relation,
      })
      .from(schema.workItemSourceRef)
      .where(
        and(
          eq(schema.workItemSourceRef.cellId, cellId),
          eq(schema.workItemSourceRef.workItemId, workItemId),
        ),
      );

    const sourceIds = refs.map((ref) => ref.sourceId);
    const relationOf = new Map(refs.map((ref) => [ref.sourceId, ref.relation]));

    const sources: SourceEnvelopeRecord[] = [];
    if (sourceIds.length > 0) {
      const sourceRows = await this.#db
        .select()
        .from(schema.source)
        .where(and(eq(schema.source.cellId, cellId), inArray(schema.source.id, sourceIds)));

      const versionRows = await this.#db
        .select()
        .from(schema.sourceVersion)
        .where(inArray(schema.sourceVersion.sourceId, sourceIds))
        .orderBy(asc(schema.sourceVersion.versionNo));

      const captureRows = await this.#db
        .select()
        .from(schema.captureEvent)
        .where(inArray(schema.captureEvent.sourceId, sourceIds))
        .orderBy(asc(schema.captureEvent.acceptedAt));

      for (const row of sourceRows) {
        sources.push({
          id: row.id,
          relation: relationOf.get(row.id) ?? 'evidence',
          kind: row.kind,
          originUri: row.originUri,
          contentHash: row.contentHash,
          rawArtifactUri: row.rawArtifactUri,
          rawArtifactSha256: row.rawArtifactSha256,
          dataClass: row.dataClass as DataClass,
          trust: row.trust as TrustLabel,
          lifecycle: row.lifecycle,
          capturedAt: row.capturedAt,
          capturedBy: { kind: row.capturedByKind, id: row.capturedById },
          currentVersionId: row.currentVersionId,
          versions: versionRows
            .filter((version) => version.sourceId === row.id)
            .map((version) => ({
              id: version.id,
              versionNo: version.versionNo,
              contentHash: version.contentHash,
              recordedAt: version.recordedAt,
              reason: version.reason,
            })),
          captureEvents: captureRows
            .filter((event) => event.sourceId === row.id)
            .map((event) => ({
              id: event.id,
              requestIdempotencyKey: event.requestIdempotencyKey,
              channel: event.channel,
              acceptedAt: event.acceptedAt,
              replayCount: event.replayCount,
              correlationId: event.correlationId,
            })),
        });
      }
    }

    // Audit entries covering the work item and every source in the chain.
    const auditRows = await this.#db
      .select()
      .from(schema.auditEntry)
      .where(
        and(
          eq(schema.auditEntry.cellId, cellId),
          or(
            and(
              eq(schema.auditEntry.targetKind, 'work_item'),
              eq(schema.auditEntry.targetId, workItemId),
            ),
            sourceIds.length === 0
              ? sql`false`
              : and(
                  eq(schema.auditEntry.targetKind, 'source'),
                  inArray(schema.auditEntry.targetId, sourceIds),
                ),
          ),
        ),
      )
      .orderBy(asc(schema.auditEntry.seq));

    const auditEntries: AuditEntryRecord[] = auditRows.map((row) => ({
      id: row.id,
      seq: Number(row.seq),
      action: row.action,
      targetKind: row.targetKind,
      targetId: row.targetId,
      actor: { kind: row.actorKind, id: row.actorId },
      policyVersion: row.policyVersion,
      policyDecision: row.policyDecision,
      occurredAt: row.occurredAt,
      entryHash: row.entryHash,
      prevChainHash: row.prevChainHash,
      chainHash: row.chainHash,
    }));

    // FRANK-§11.5's chain is verified by *recomputation*, not by reading a
    // stored flag. Verifying only the entries in this walk needs the chain hash
    // of the entry immediately before the first of them, which is exactly what
    // `AuditRepository.verify` asks for.
    const chain = await this.#verifyChainSegment(cellId, auditEntries);

    const costRows = await this.#db
      .select()
      .from(schema.costEvent)
      .where(
        and(eq(schema.costEvent.cellId, cellId), eq(schema.costEvent.workItemId, workItemId)),
      )
      .orderBy(asc(schema.costEvent.occurredAt));

    const costReceipts: CostReceiptRecord[] = costRows.map((row) => ({
      id: row.id,
      category: row.category,
      // `numeric` arrives as a string from `pg` and stays one (FIN-002).
      amount: row.amount,
      currency: row.currency,
      attributionState: row.attributionState,
      occurredAt: row.occurredAt,
      usageReceiptRef: row.usageReceiptRef,
      providerId: row.providerId,
      modelRef: row.modelRef,
    }));

    return {
      workItem: item,
      sources,
      auditEntries,
      costReceipts,
      chainVerified: chain.verified,
      chainVerificationDetail: chain.detail,
      asOf: new Date(),
    };
  }

  async #verifyChainSegment(
    cellId: string,
    entries: readonly AuditEntryRecord[],
  ): Promise<{ verified: boolean; detail: string }> {
    const first = entries[0];
    if (first === undefined) {
      return { verified: true, detail: 'no audit entries in this chain segment' };
    }
    const fromSeq = BigInt(first.seq);
    const toSeq = BigInt(entries[entries.length - 1]?.seq ?? first.seq);

    const priorRows =
      fromSeq === 1n
        ? []
        : await this.#db
            .select({ chainHash: schema.auditEntry.chainHash })
            .from(schema.auditEntry)
            .where(
              and(
                eq(schema.auditEntry.cellId, cellId),
                eq(schema.auditEntry.seq, fromSeq - 1n),
              ),
            )
            .limit(1);

    const startingChainHash = priorRows[0]?.chainHash;
    const result = await this.#audit.verify(this.#db, {
      cellId,
      fromSeq,
      toSeq,
      ...(startingChainHash === undefined ? {} : { startingChainHash }),
    });

    return result.ok
      ? { verified: true, detail: `recomputed ${String(toSeq - fromSeq + 1n)} entries at read time` }
      : {
          verified: false,
          detail: `audit chain verification failed: ${result.failure} at seq ${String(result.atSeq)} — ${result.detail}`,
        };
  }

  /* ----------------------------------------------------------------- health --- */

  async health(): Promise<StoreHealth> {
    const started = process.hrtime.bigint();
    try {
      await this.#db.execute(sql`select 1`);
      const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      return {
        reachable: true,
        latencyMs,
        detail: 'canonical database responded',
        observedAt: new Date(),
        outbox: null,
      };
    } catch (error) {
      const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      return {
        reachable: false,
        latencyMs,
        // The driver's message can carry a connection string. Never propagate it.
        detail: 'canonical database did not respond',
        observedAt: new Date(),
        outbox: null,
      };
    } finally {
      void 0;
    }
  }

  /** ADR-004 backlog counters, for the OPS-004 `degraded` determination. */
  async outboxCounts(cellId: string): Promise<StoreHealth['outbox']> {
    return this.#outbox.counts(this.#db, cellId);
  }

  /** Exposed for the cost repository; unused in Slice 1 routes but wired. */
  get costRepository(): CostRepository {
    return this.#cost;
  }

  async close(): Promise<void> {
    await this.#handle.close();
  }

  async #sourceIdsFor(workItemIds: readonly string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (workItemIds.length === 0) return map;
    const rows = await this.#db
      .select({
        workItemId: schema.workItemSourceRef.workItemId,
        sourceId: schema.workItemSourceRef.sourceId,
      })
      .from(schema.workItemSourceRef)
      .where(inArray(schema.workItemSourceRef.workItemId, [...workItemIds]));
    for (const row of rows) {
      const existing = map.get(row.workItemId);
      if (existing === undefined) map.set(row.workItemId, [row.sourceId]);
      else existing.push(row.sourceId);
    }
    return map;
  }
}

function defaultTriageTitle(command: CaptureCommand): string {
  const firstLine = command.text.split('\n', 1)[0] ?? '';
  const trimmed = firstLine.trim();
  if (trimmed.length === 0) return `Triage ${command.kind} capture`;
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}

type WorkRow = typeof schema.workItem.$inferSelect;

function toWorkItemRecord(row: WorkRow, sourceIds: readonly string[]): WorkItemRecord {
  return {
    id: row.id,
    cellId: row.cellId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    state: row.state as WorkState,
    priority: row.priority,
    owner: { kind: row.ownerKind, id: row.ownerId },
    dataClass: row.dataClass as DataClass,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    dueAt: row.dueAt,
    scheduledForAt: row.scheduledForAt,
    whyNow: row.whyNow,
    nextSafeAction: row.nextSafeAction,
    definitionOfDone: row.definitionOfDone,
    policyRef: row.policyRef,
    provenance: {
      method: row.provenance.method,
      producer: row.provenance.producer,
      correlationId: row.provenance.correlationId ?? null,
    },
    sourceIds,
  };
}

/** Re-exported so the composition root does not import the adapter directly. */
export type { ActorRef };

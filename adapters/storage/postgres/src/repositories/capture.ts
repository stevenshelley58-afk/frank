/**
 * Idempotent capture — UX-003, UX-004, FRANK-§10.2, FRANK-§12.1, ADR-004.
 *
 * The Slice 1 exit gate: **replaying the same capture produces one source and
 * one work item.**
 *
 * ## How the guarantee is actually made
 *
 * Not by "check whether it exists, then insert". That is a race: two concurrent
 * replays both see nothing and both insert. The guarantee comes from two unique
 * indexes and `INSERT ... ON CONFLICT DO NOTHING RETURNING`, which is atomic —
 * exactly one of N concurrent identical captures gets a row back, and the rest
 * get an empty result and take the replay path.
 *
 *   `capture_event_request_uidx`  (cell_id, request_idempotency_key)
 *   `source_capture_idem_uidx`    (cell_id, capture_idempotency_key)
 *
 * Two indexes because there are two different replays (see `capture-key.ts`):
 * the same request arriving twice, and two different requests carrying the same
 * bytes from the same origin.
 *
 * ## What a replay must not do
 *
 * A replay emits **no events**. It must not, or a retried capture would produce
 * a second `frank.source.captured.v1` and every downstream consumer would do its
 * work twice. Consumers have inbox tables (FRANK-§12.4) as a second line of
 * defence, but emitting a duplicate and relying on consumers to drop it converts
 * a producer-side invariant into a distributed hope.
 *
 * A replay also does not write an audit entry for a capture that did not happen.
 * It does increment `capture_event.replay_count`, so the fact that a retry
 * occurred is still visible.
 */

import { and, eq } from 'drizzle-orm';

import type { DataClass, TrustLabel } from '@frank/contracts';

import type { FrankDatabase, FrankTransaction } from '../db.js';
import { captureIdempotencyKey } from '../capture-key.js';
import { EVENT_TYPES, buildEventEnvelope, eventSource } from '../events.js';
import { newId } from '../ids.js';
import { captureEvent, source, sourceVersion } from '../schema/source.js';
import type { SourceKind } from '../schema/source.js';
import type { ActorKind, Provenance, VersionedRef } from '../schema/shared.js';
import { workItemSourceRef } from '../schema/work.js';
import { AuditRepository } from './audit.js';
import { OutboxRepository } from './outbox.js';
import { WorkItemRepository } from './work.js';

export interface CaptureInput {
  readonly cellId: string;
  /** FRANK-§12.1 idempotency key from the action endpoint. */
  readonly requestIdempotencyKey: string;
  readonly kind: SourceKind;
  /** SHA-256 of the raw bytes, `sha256:`-prefixed. */
  readonly contentHash: string;
  /** ADR-003: the bytes live in object storage; this is the reference. */
  readonly rawArtifactUri: string;
  readonly rawArtifactSha256: string;
  readonly rawArtifactBytes?: bigint | undefined;
  readonly mediaType?: string | undefined;
  readonly originUri?: string | undefined;
  readonly externalProviderId?: string | undefined;
  readonly externalAccountId?: string | undefined;
  readonly externalId?: string | undefined;
  readonly authorRefs?: ReadonlyArray<{ kind: string; id: string }> | undefined;
  readonly capturedBy: { kind: ActorKind; id: string };
  readonly capturedAt: Date;
  readonly sourceCreatedAt?: Date | undefined;
  readonly observedAt?: Date | undefined;
  /** FRANK-§2.3. Both axes, neither defaulted. */
  readonly dataClass: DataClass;
  readonly trust: TrustLabel;
  readonly rightsPolicy: VersionedRef;
  readonly retentionPolicy: VersionedRef;
  readonly provenance: Provenance;
  readonly channel: string;
  readonly correlationId: string;
  /** UX-003: capture creates a triage item. Set false for connector backfills. */
  readonly createTriageItem?: boolean | undefined;
  readonly triageTitle?: string | undefined;
  readonly policyRef: VersionedRef;
  readonly now: Date;
}

export interface CaptureResult {
  readonly sourceId: string;
  readonly sourceVersionId: string | null;
  readonly workItemId: string | null;
  readonly captureEventId: string;
  /** True when this call returned an existing capture rather than creating one. */
  readonly replayed: boolean;
  /** Which key matched, when replayed. Useful in tests and in the capture log. */
  readonly replayReason: 'request' | 'content' | null;
  readonly eventIds: readonly string[];
}

export class CaptureService {
  readonly #audit: AuditRepository;
  readonly #outbox: OutboxRepository;
  readonly #work: WorkItemRepository;

  constructor(
    audit = new AuditRepository(),
    outbox = new OutboxRepository(),
    work = new WorkItemRepository(audit, outbox),
  ) {
    this.#audit = audit;
    this.#outbox = outbox;
    this.#work = work;
  }

  /** Convenience wrapper that opens the transaction. */
  async capture(db: FrankDatabase, input: CaptureInput): Promise<CaptureResult> {
    return db.transaction((tx) => this.captureInTransaction(tx, input));
  }

  async captureInTransaction(tx: FrankTransaction, input: CaptureInput): Promise<CaptureResult> {
    /* ---- replay 1: the same request ------------------------------------- */
    const existingRequest = await tx
      .select()
      .from(captureEvent)
      .where(
        and(
          eq(captureEvent.cellId, input.cellId),
          eq(captureEvent.requestIdempotencyKey, input.requestIdempotencyKey),
        ),
      )
      .for('update')
      .limit(1);

    const priorRequest = existingRequest[0];
    if (priorRequest !== undefined) {
      await tx
        .update(captureEvent)
        .set({ replayCount: priorRequest.replayCount + 1 })
        .where(eq(captureEvent.id, priorRequest.id));

      return {
        sourceId: priorRequest.sourceId,
        sourceVersionId: null,
        workItemId: priorRequest.workItemId,
        captureEventId: priorRequest.id,
        replayed: true,
        replayReason: 'request',
        eventIds: [],
      };
    }

    /* ---- replay 2: the same bytes from the same origin -------------------- */
    const idempotencyKey = captureIdempotencyKey({
      cellId: input.cellId,
      kind: input.kind,
      contentHash: input.contentHash,
      originUri: input.originUri,
      externalProviderId: input.externalProviderId,
      externalAccountId: input.externalAccountId,
      externalId: input.externalId,
    });

    const sourceId = newId();
    const observedAt = input.observedAt ?? input.capturedAt;
    const actorRef = `${input.capturedBy.kind}/${input.capturedBy.id}`;

    const insertedSource = await tx
      .insert(source)
      .values({
        id: sourceId,
        cellId: input.cellId,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: actorRef,
        updatedBy: actorRef,
        provenance: input.provenance,
        kind: input.kind,
        originUri: input.originUri ?? null,
        authorRefs: [...(input.authorRefs ?? [])],
        capturedByKind: input.capturedBy.kind,
        capturedById: input.capturedBy.id,
        capturedAt: input.capturedAt,
        sourceCreatedAt: input.sourceCreatedAt ?? null,
        observedAt,
        dataClass: input.dataClass,
        trust: input.trust,
        rightsPolicy: input.rightsPolicy,
        retentionPolicy: input.retentionPolicy,
        contentHash: input.contentHash,
        captureIdempotencyKey: idempotencyKey,
        rawArtifactUri: input.rawArtifactUri,
        rawArtifactSha256: input.rawArtifactSha256,
        rawArtifactBytes: input.rawArtifactBytes ?? null,
        mediaType: input.mediaType ?? null,
        externalProviderId: input.externalProviderId ?? null,
        externalAccountId: input.externalAccountId ?? null,
        externalId: input.externalId ?? null,
        lifecycle: 'active',
        version: 1,
      })
      .onConflictDoNothing({ target: [source.cellId, source.captureIdempotencyKey] })
      .returning({ id: source.id });

    const created = insertedSource[0];

    if (created === undefined) {
      // Someone already captured these bytes from this origin. Record that this
      // request arrived — the capture ledger should show every attempt — but
      // create no source, no work item, and no events.
      const existing = await tx
        .select({ id: source.id })
        .from(source)
        .where(
          and(
            eq(source.cellId, input.cellId),
            eq(source.captureIdempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      const existingSource = existing[0];
      if (existingSource === undefined) {
        throw new Error(
          `source insert conflicted on capture_idempotency_key but no row matched it; the unique index and the conflict target disagree (cell ${input.cellId}).`,
        );
      }

      const originItems = await tx
        .select({ workItemId: workItemSourceRef.workItemId })
        .from(workItemSourceRef)
        .where(
          and(
            eq(workItemSourceRef.sourceId, existingSource.id),
            eq(workItemSourceRef.relation, 'origin'),
          ),
        )
        .limit(1);

      const captureEventId = newId();
      await tx.insert(captureEvent).values({
        id: captureEventId,
        cellId: input.cellId,
        requestIdempotencyKey: input.requestIdempotencyKey,
        sourceId: existingSource.id,
        workItemId: originItems[0]?.workItemId ?? null,
        channel: input.channel,
        acceptedAt: input.now,
        capturedByKind: input.capturedBy.kind,
        capturedById: input.capturedBy.id,
        correlationId: input.correlationId,
        replayCount: 1,
      });

      return {
        sourceId: existingSource.id,
        sourceVersionId: null,
        workItemId: originItems[0]?.workItemId ?? null,
        captureEventId,
        replayed: true,
        replayReason: 'content',
        eventIds: [],
      };
    }

    /* ---- first capture: source, version, triage item, audit, events ------ */
    const sourceVersionId = newId();
    await tx.insert(sourceVersion).values({
      id: sourceVersionId,
      cellId: input.cellId,
      sourceId,
      versionNo: 1,
      contentHash: input.contentHash,
      rawArtifactUri: input.rawArtifactUri,
      rawArtifactSha256: input.rawArtifactSha256,
      rawArtifactBytes: input.rawArtifactBytes ?? null,
      mediaType: input.mediaType ?? null,
      observedAt,
      recordedAt: input.now,
      recordedBy: actorRef,
      reason: 'initial',
    });

    await tx
      .update(source)
      .set({ currentVersionId: sourceVersionId })
      .where(eq(source.id, sourceId));

    let workItemId: string | null = null;
    if (input.createTriageItem !== false) {
      const item = await this.#work.create(tx, {
        cellId: input.cellId,
        kind: 'task',
        title: input.triageTitle ?? `Triage ${input.kind} capture`,
        state: 'inbox',
        ownerKind: input.capturedBy.kind,
        ownerId: input.capturedBy.id,
        policyRef: input.policyRef,
        provenance: input.provenance,
        actor: input.capturedBy,
        correlationId: input.correlationId,
        now: input.now,
        dataClass: input.dataClass,
        whyNow: 'Captured content is awaiting triage',
        nextSafeAction: 'Classify and route this capture',
      });
      workItemId = item.id;

      await tx.insert(workItemSourceRef).values({
        cellId: input.cellId,
        workItemId,
        sourceId,
        relation: 'origin',
        createdAt: input.now,
      });
    }

    const captureEventId = newId();
    await tx.insert(captureEvent).values({
      id: captureEventId,
      cellId: input.cellId,
      requestIdempotencyKey: input.requestIdempotencyKey,
      sourceId,
      workItemId,
      channel: input.channel,
      acceptedAt: input.now,
      capturedByKind: input.capturedBy.kind,
      capturedById: input.capturedBy.id,
      correlationId: input.correlationId,
      replayCount: 0,
    });

    await this.#audit.append(tx, {
      cellId: input.cellId,
      occurredAt: input.now,
      actorKind: input.capturedBy.kind,
      actorId: input.capturedBy.id,
      action: 'source.captured',
      targetKind: 'source',
      targetId: sourceId,
      correlationId: input.correlationId,
      dataClass: input.dataClass,
      afterHash: input.contentHash,
      // FRANK-§11.5: referenced and bounded, never a copy of the content.
      changeRedacted: {
        kind: input.kind,
        trust: input.trust,
        dataClass: input.dataClass,
        contentHash: input.contentHash,
        rawArtifactUri: input.rawArtifactUri,
      },
    });

    const eventIds: string[] = [];

    const capturedEvent = buildEventEnvelope({
      type: EVENT_TYPES.sourceCaptured,
      source: eventSource('source', sourceId),
      cellId: input.cellId,
      actorId: actorRef,
      correlationId: input.correlationId,
      // FRANK-§12.4: the event carries the classification of what it references.
      classification: input.dataClass,
      subject: `source/${sourceId}`,
      occurredAt: input.now,
      idempotencyKey,
      data: {
        sourceId,
        sourceVersionId,
        kind: input.kind,
        contentHash: input.contentHash,
        // Referenced by protected URI, not inlined (FRANK-§12.4).
        rawArtifactUri: input.rawArtifactUri,
        trust: input.trust,
      },
    });
    eventIds.push(
      await this.#outbox.enqueue(tx, capturedEvent, {
        aggregateKind: 'source',
        aggregateId: sourceId,
        createdAt: input.now,
      }),
    );

    const acceptedEvent = buildEventEnvelope({
      type: EVENT_TYPES.captureAccepted,
      source: eventSource('capture', captureEventId),
      cellId: input.cellId,
      actorId: actorRef,
      correlationId: input.correlationId,
      classification: input.dataClass,
      subject: `capture_event/${captureEventId}`,
      occurredAt: input.now,
      data: { captureEventId, sourceId, workItemId, channel: input.channel },
    });
    eventIds.push(
      await this.#outbox.enqueue(tx, acceptedEvent, {
        aggregateKind: 'capture_event',
        aggregateId: captureEventId,
        createdAt: input.now,
      }),
    );

    return {
      sourceId,
      sourceVersionId,
      workItemId,
      captureEventId,
      replayed: false,
      replayReason: null,
      eventIds,
    };
  }
}

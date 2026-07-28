/**
 * Event envelope construction and outbox mapping — FRANK-§6.7, FRANK-§12.4,
 * FRANK-§12.5, ADR-004, ADR-017.
 *
 * `EventEnvelope` is owned by `@frank/contracts` and is not redefined here; this
 * module builds instances of it and maps them onto `outbox_event` rows in both
 * directions. The round trip is asserted in `events.test.ts` with no database,
 * because a lossy mapping would mean the published event differs from the event
 * the domain committed — a divergence that only shows up at a consumer.
 *
 * FRANK-§12.5: "Event names shown above are logical names; wire types include
 * namespace and version, for example `frank.run.started.v1`." {@link eventType}
 * builds those, and {@link EVENT_TYPES} names the Slice 1 subset of the
 * FRANK-§12.5 catalogue that this package emits.
 */

import type { DataClass, EventEnvelope } from '@frank/contracts';

import { newId } from './ids.js';
import type { NewOutboxEventRow, OutboxEventRow } from './schema/outbox.js';

/**
 * The Slice 1 slice of the FRANK-§12.5 catalogue.
 *
 * Only the families this package's repositories actually emit are listed. An
 * event name that is not here is a name nothing produces, and a catalogue that
 * lists unproduced events teaches consumers to subscribe to silence.
 */
export const EVENT_TYPES = {
  captureAccepted: 'frank.capture.accepted.v1',
  captureFailed: 'frank.capture.failed.v1',
  sourceCaptured: 'frank.source.captured.v1',
  sourceVersioned: 'frank.source.versioned.v1',
  sourceTombstoned: 'frank.source.tombstoned.v1',
  workCreated: 'frank.work.created.v1',
  workStateChanged: 'frank.work.state_changed.v1',
  workAssigned: 'frank.work.assigned.v1',
  workBlocked: 'frank.work.blocked.v1',
  workCompleted: 'frank.work.completed.v1',
  usageRecorded: 'frank.usage.recorded.v1',
  budgetThresholdReached: 'frank.budget.threshold_reached.v1',
} as const;

export type FrankEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/** Schema pattern from `event-envelope.v1.schema.json`. */
const EVENT_TYPE_RE = /^frank\.[a-z0-9]+(\.[a-z0-9_-]+)*\.v[0-9]+$/;
const EVENT_SOURCE_RE = /^frank:\/\/[a-z0-9-]+(\/[A-Za-z0-9._-]+)*$/;

export interface BuildEnvelopeInput<TData extends Record<string, unknown>> {
  readonly type: string;
  /** `frank://<context>/<aggregate-id>` — FRANK-§6.7. */
  readonly source: string;
  readonly cellId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
  readonly classification: DataClass;
  readonly subject?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly occurredAt: Date;
  readonly data: TData;
  /** Defaults to a fresh UUIDv7. Supplied only by replay tooling. */
  readonly id?: string | undefined;
}

/**
 * Build a FRANK-§6.7 envelope.
 *
 * `dataschema` is derived from `type` rather than accepted as a parameter:
 * ADR-017 pins consumers to a schema by version, and letting a caller pass a
 * `dataschema` that disagrees with its `type` is how a consumer ends up
 * validating the wrong shape.
 */
export function buildEventEnvelope<TData extends Record<string, unknown>>(
  input: BuildEnvelopeInput<TData>,
): EventEnvelope<TData> {
  if (!EVENT_TYPE_RE.test(input.type)) {
    throw new TypeError(
      `${JSON.stringify(input.type)} is not a versioned FRANK event type (expected e.g. "frank.work.state_changed.v1") — ADR-017.`,
    );
  }
  if (!EVENT_SOURCE_RE.test(input.source)) {
    throw new TypeError(
      `${JSON.stringify(input.source)} is not a FRANK event source (expected e.g. "frank://work/01J...").`,
    );
  }

  const envelope: EventEnvelope<TData> = {
    specversion: '1.0',
    type: input.type,
    source: input.source,
    id: input.id ?? newId(),
    time: input.occurredAt.toISOString(),
    dataschema: dataSchemaRefFor(input.type),
    datacontenttype: 'application/json',
    cellid: input.cellId,
    actorid: input.actorId,
    correlationid: input.correlationId,
    classification: input.classification,
    data: input.data,
    ...(input.subject === undefined ? {} : { subject: input.subject }),
    ...(input.causationId === undefined ? {} : { causationid: input.causationId }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencykey: input.idempotencyKey }),
  };

  return envelope;
}

/** `frank.work.state_changed.v1` -> `schema://frank.work.state_changed/v1`. */
export function dataSchemaRefFor(type: string): string {
  const lastDot = type.lastIndexOf('.');
  const name = type.slice(0, lastDot);
  const version = type.slice(lastDot + 1);
  return `schema://${name}/${version}`;
}

/** Build `frank://<context>/<id>`. */
export function eventSource(context: string, aggregateId: string): string {
  return `frank://${context}/${aggregateId}`;
}

export interface OutboxRowOptions {
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly createdAt: Date;
  /** Earliest publication attempt; defaults to `createdAt`. */
  readonly availableAt?: Date | undefined;
}

/**
 * Project an envelope onto an `outbox_event` row.
 *
 * `status` and `attempts` take their column defaults rather than being set here:
 * they are publisher state, and a domain transaction that set them would be
 * asserting something about publication it cannot know.
 */
export function envelopeToOutboxRow(
  envelope: EventEnvelope,
  options: OutboxRowOptions,
): NewOutboxEventRow {
  return {
    id: envelope.id,
    specversion: envelope.specversion,
    type: envelope.type,
    source: envelope.source,
    time: new Date(envelope.time),
    dataschema: envelope.dataschema,
    datacontenttype: envelope.datacontenttype,
    cellId: envelope.cellid,
    actorId: envelope.actorid,
    correlationId: envelope.correlationid,
    classification: envelope.classification,
    data: envelope.data,
    aggregateKind: options.aggregateKind,
    aggregateId: options.aggregateId,
    availableAt: options.availableAt ?? options.createdAt,
    createdAt: options.createdAt,
    ...(envelope.subject === undefined ? {} : { subject: envelope.subject }),
    ...(envelope.causationid === undefined ? {} : { causationId: envelope.causationid }),
    ...(envelope.idempotencykey === undefined ? {} : { idempotencyKey: envelope.idempotencykey }),
  };
}

/**
 * Recover the envelope from a stored row.
 *
 * Nullable columns become absent properties rather than `null`: the contract
 * declares them optional, and `exactOptionalPropertyTypes` means `null` is not a
 * legal value for them. A publisher that emitted `"subject": null` would produce
 * an event that fails its own JSON Schema.
 */
export function outboxRowToEnvelope(row: OutboxEventRow): EventEnvelope {
  return {
    specversion: '1.0',
    type: row.type,
    source: row.source,
    id: row.id,
    time: row.time.toISOString(),
    dataschema: row.dataschema,
    datacontenttype: 'application/json',
    cellid: row.cellId,
    actorid: row.actorId,
    correlationid: row.correlationId,
    classification: row.classification,
    data: row.data,
    ...(row.subject === null ? {} : { subject: row.subject }),
    ...(row.causationId === null ? {} : { causationid: row.causationId }),
    ...(row.idempotencyKey === null ? {} : { idempotencykey: row.idempotencyKey }),
  };
}

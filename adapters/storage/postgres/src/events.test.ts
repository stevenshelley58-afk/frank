/**
 * FRANK-§6.7 envelope construction and the ADR-004 outbox mapping.
 *
 * The envelope shape itself is owned by `@frank/contracts` and validated against
 * `schemas/event-envelope.v1.schema.json` by the repository's
 * `contracts:validate` gate. What is tested here is that this package produces
 * instances conforming to that shape, and that projecting one into an
 * `outbox_event` row and back is lossless — a lossy mapping would mean the
 * event a consumer receives differs from the event the domain committed.
 */

import { describe, expect, it } from 'vitest';

import type { EventEnvelope } from '@frank/contracts';

import {
  EVENT_TYPES,
  buildEventEnvelope,
  dataSchemaRefFor,
  envelopeToOutboxRow,
  eventSource,
  outboxRowToEnvelope,
} from './events.js';
import { isUuidV7 } from './ids.js';
import type { OutboxEventRow } from './schema/outbox.js';

const occurredAt = new Date('2026-07-28T12:00:00.000Z');

function build(overrides: Partial<Parameters<typeof buildEventEnvelope>[0]> = {}) {
  return buildEventEnvelope({
    type: EVENT_TYPES.workStateChanged,
    source: eventSource('work', '01920000-0000-7000-8000-000000000001'),
    cellId: 'cell-steven',
    actorId: 'user/steven',
    correlationId: 'run-789',
    classification: 'private',
    subject: 'work_item/01920000-0000-7000-8000-000000000001',
    occurredAt,
    data: { workItemId: '01920000-0000-7000-8000-000000000001', from: 'active', to: 'done' },
    ...overrides,
  });
}

describe('buildEventEnvelope', () => {
  it('produces every required FRANK-§6.7 context attribute', () => {
    const envelope = build();
    expect(envelope.specversion).toBe('1.0');
    expect(envelope.type).toBe('frank.work.state_changed.v1');
    expect(envelope.source).toBe('frank://work/01920000-0000-7000-8000-000000000001');
    expect(isUuidV7(envelope.id)).toBe(true);
    expect(envelope.time).toBe('2026-07-28T12:00:00.000Z');
    expect(envelope.dataschema).toBe('schema://frank.work.state_changed/v1');
    expect(envelope.datacontenttype).toBe('application/json');
    expect(envelope.cellid).toBe('cell-steven');
    expect(envelope.actorid).toBe('user/steven');
    expect(envelope.correlationid).toBe('run-789');
    expect(envelope.classification).toBe('private');
  });

  it('derives `dataschema` from `type` so the two cannot disagree (ADR-017)', () => {
    expect(dataSchemaRefFor('frank.run.started.v1')).toBe('schema://frank.run.started/v1');
    expect(dataSchemaRefFor('frank.build.change.ready.v1')).toBe('schema://frank.build.change.ready/v1');
    // There is no parameter to pass a conflicting one.
    expect(Object.keys(build())).not.toContain('dataschemaOverride');
  });

  it('omits optional attributes rather than setting them to null', () => {
    // `exactOptionalPropertyTypes` and the JSON Schema both forbid null here.
    const envelope = build({ subject: undefined, causationId: undefined, idempotencyKey: undefined });
    expect('subject' in envelope).toBe(false);
    expect('causationid' in envelope).toBe(false);
    expect('idempotencykey' in envelope).toBe(false);
  });

  it('carries causation and idempotency when supplied', () => {
    const envelope = build({ causationId: 'evt-previous', idempotencyKey: 'idem-1' });
    expect(envelope.causationid).toBe('evt-previous');
    expect(envelope.idempotencykey).toBe('idem-1');
  });

  it('mints a fresh UUIDv7 id per event', () => {
    const ids = new Set(Array.from({ length: 100 }, () => build().id));
    expect(ids.size).toBe(100);
  });

  it('rejects an unversioned or malformed event type (ADR-017)', () => {
    for (const bogus of ['work.state_changed', 'frank.work.state_changed', 'frank.Work.v1', 'v1', '']) {
      expect(() => build({ type: bogus }), bogus).toThrow(/versioned FRANK event type/);
    }
  });

  it('rejects a malformed source', () => {
    for (const bogus of ['work/123', 'http://work/123', 'frank:/work/123', '']) {
      expect(() => build({ source: bogus }), bogus).toThrow(/FRANK event source/);
    }
  });

  it('accepts every name in the Slice 1 catalogue', () => {
    for (const type of Object.values(EVENT_TYPES)) {
      expect(() => build({ type })).not.toThrow();
    }
  });
});

describe('EVENT_TYPES', () => {
  it('uses the FRANK-§12.5 wire form: namespace, logical name, version', () => {
    for (const type of Object.values(EVENT_TYPES)) {
      expect(type).toMatch(/^frank\.[a-z0-9]+(\.[a-z0-9_-]+)*\.v[0-9]+$/);
    }
  });

  it('covers the Slice 1 families FRANK-§12.5 requires', () => {
    const names = Object.values(EVENT_TYPES);
    expect(names).toContain('frank.capture.accepted.v1');
    expect(names).toContain('frank.source.captured.v1');
    expect(names).toContain('frank.work.created.v1');
    expect(names).toContain('frank.work.state_changed.v1');
    expect(names).toContain('frank.work.blocked.v1');
    expect(names).toContain('frank.work.completed.v1');
    expect(names).toContain('frank.usage.recorded.v1');
  });
});

describe('outbox projection', () => {
  const options = {
    aggregateKind: 'work_item',
    aggregateId: '01920000-0000-7000-8000-000000000001',
    createdAt: occurredAt,
  };

  it('maps every envelope attribute onto its own column', () => {
    const envelope = build({ causationId: 'evt-previous', idempotencyKey: 'idem-1' });
    const row = envelopeToOutboxRow(envelope, options);

    expect(row.id).toBe(envelope.id);
    expect(row.type).toBe(envelope.type);
    expect(row.source).toBe(envelope.source);
    expect(row.time?.toISOString()).toBe(envelope.time);
    expect(row.subject).toBe(envelope.subject);
    expect(row.dataschema).toBe(envelope.dataschema);
    expect(row.cellId).toBe(envelope.cellid);
    expect(row.actorId).toBe(envelope.actorid);
    expect(row.correlationId).toBe(envelope.correlationid);
    expect(row.causationId).toBe(envelope.causationid);
    expect(row.classification).toBe(envelope.classification);
    expect(row.idempotencyKey).toBe(envelope.idempotencykey);
    expect(row.data).toEqual(envelope.data);
  });

  it('does not set publisher state, which the domain transaction cannot know', () => {
    const row = envelopeToOutboxRow(build(), options);
    expect(row.status).toBeUndefined();
    expect(row.attempts).toBeUndefined();
    expect(row.publishedAt).toBeUndefined();
  });

  it('defaults `availableAt` to the creation time', () => {
    expect(envelopeToOutboxRow(build(), options).availableAt).toBe(occurredAt);
  });

  it('round-trips losslessly, including the optional attributes', () => {
    const envelope = build({ causationId: 'evt-previous', idempotencyKey: 'idem-1' });
    expect(outboxRowToEnvelope(asStoredRow(envelope))).toEqual(envelope);
  });

  it('round-trips losslessly when the optional attributes are absent', () => {
    const envelope = build({ subject: undefined, causationId: undefined, idempotencyKey: undefined });
    const recovered = outboxRowToEnvelope(asStoredRow(envelope));
    expect(recovered).toEqual(envelope);
    expect('subject' in recovered).toBe(false);
    expect('causationid' in recovered).toBe(false);
    expect('idempotencykey' in recovered).toBe(false);
  });

  it('turns a null column back into an absent property, not a null value', () => {
    const stored = { ...asStoredRow(build()), subject: null, causationId: null, idempotencyKey: null };
    const recovered = outboxRowToEnvelope(stored);
    expect('subject' in recovered).toBe(false);
    expect(JSON.stringify(recovered)).not.toContain('null');
  });

  /** Simulate a database round trip: nullable columns come back as `null`. */
  function asStoredRow(envelope: EventEnvelope): OutboxEventRow {
    const row = envelopeToOutboxRow(envelope, options);
    return {
      id: row.id,
      sequence: 1n,
      specversion: '1.0',
      type: row.type,
      source: row.source,
      time: row.time,
      subject: row.subject ?? null,
      dataschema: row.dataschema,
      datacontenttype: 'application/json',
      cellId: row.cellId,
      actorId: row.actorId,
      correlationId: row.correlationId,
      causationId: row.causationId ?? null,
      classification: row.classification,
      idempotencyKey: row.idempotencyKey ?? null,
      data: row.data,
      aggregateKind: row.aggregateKind,
      aggregateId: row.aggregateId,
      status: 'pending',
      attempts: 0,
      availableAt: row.availableAt,
      lastError: null,
      quarantinedAt: null,
      publishedAt: null,
      createdAt: row.createdAt,
    };
  }
});

/**
 * `schema://frank.event/v1` — FRANK-§6.7.
 *
 * CloudEvents-compatible envelope with explicit schema version, cell scope,
 * correlation, causation, classification, and idempotency. A transaction writes
 * domain state and the outbox event together (ADR-004).
 *
 * Field names are lowercase without separators because CloudEvents context
 * attributes are; this is the one contract in the package that does not use
 * camelCase, and that is the schema's shape, not an oversight.
 */

import type { DataClass } from './classification.js';
import type { IsoDateTime } from './common.js';

/**
 * Versioned event type. The trailing `.vN` is required so consumers pin a
 * schema (ADR-017). Schema pattern:
 * `^frank\.[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$`.
 */
export type EventType = string;

/** Schema pattern: `^frank://[a-z0-9-]+(/[A-Za-z0-9._-]+)*$`. */
export type EventSource = string;

/** Schema pattern: `^schema://[A-Za-z0-9._-]+/v[0-9]+$`. */
export type DataSchemaRef = string;

export interface EventEnvelope<TData extends Record<string, unknown> = Record<string, unknown>> {
  specversion: '1.0';
  type: EventType;
  source: EventSource;
  id: string;
  time: IsoDateTime;
  subject?: string;
  dataschema: DataSchemaRef;
  datacontenttype: 'application/json';
  /**
   * FRANK-§2.4. Every event is scoped to exactly one cell. Cross-cell delivery
   * is not representable.
   */
  cellid: string;
  actorid: string;
  correlationid: string;
  causationid?: string;
  classification: DataClass;
  /**
   * Required for events that drive an external side effect (FRANK-§13.5).
   * Optional in the schema because most events do not.
   */
  idempotencykey?: string;
  data: TData;
}

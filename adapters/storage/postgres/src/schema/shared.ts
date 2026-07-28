/**
 * Shared schema vocabulary — FRANK-§11.1 (data standards), FRANK-§11.4 (database
 * separation), FRANK-§2.3 (classification and trust).
 *
 * ## One schema, not one database, for now
 *
 * FRANK-§11.4: "Use separate logical databases or strongly separated schemas and
 * roles for: FRANK canonical domain data; durable workflow service; Buzz relay;
 * identity provider; projection engines...; observability and analytics."
 *
 * Every table in this package lives in the `frank_domain` PostgreSQL schema.
 * Temporal, the Buzz relay, the identity provider, and the projection engines
 * get their own schemas (and their own roles), so a credential scoped to
 * `frank_domain` cannot read the workflow service's tables and vice versa. The
 * spec permits either separate databases or separated schemas; schemas are
 * chosen here because ADR-004's transactional outbox requires the domain
 * mutation and the outbox row to commit in *one* PostgreSQL transaction, and a
 * transaction cannot span two databases without two-phase commit.
 *
 * The migrations in this package never create a role and never `GRANT`; role
 * provisioning belongs to Workstream 3 infrastructure, and FRANK-§11.4's "no
 * service receives a database superuser credential at runtime" is an
 * infrastructure control, not a schema one.
 *
 * ## Enumerations
 *
 * FRANK-§11.1: "Enumerations enforced by schema or lookup tables, not arbitrary
 * strings." Every closed vocabulary below is a real PostgreSQL enum type. The
 * two vocabularies that `@frank/contracts` already owns — `DataClass` and
 * `TrustLabel` — are *not* redefined here: the tuples are checked against the
 * imported union at compile time by {@link exhaustive}, so adding a class in
 * contracts without adding it here is a type error rather than a silent
 * divergence, and `schema.test.ts` re-checks the ordering against
 * `DATA_CLASS_ORDER` at run time.
 */

import type { DataClass, PolicyResult, TrustLabel } from '@frank/contracts';
import { jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

/** FRANK-§11.4: canonical domain data is separated from every other store. */
export const domain = pgSchema('frank_domain');

/**
 * Build a tuple that provably covers every member of `TUnion`.
 *
 * Omitting a member makes the argument fail to typecheck, with the missing
 * member named in the error. This is the mechanism that keeps the PostgreSQL
 * enums and the frozen contracts from drifting apart.
 */
function exhaustive<TUnion extends string>() {
  return <const T extends readonly TUnion[]>(
    values: [Exclude<TUnion, T[number]>] extends [never]
      ? T
      : readonly [`missing enum member`, Exclude<TUnion, T[number]>],
  ): T => values as T;
}

/* ------------------------------------------------- FRANK-§2.3 vocabularies --- */

/** FRANK-§2.3, least to most restrictive. Order matches `DATA_CLASS_ORDER`. */
export const DATA_CLASSES = exhaustive<DataClass>()([
  'open',
  'internal',
  'private',
  'sensitive',
  'secret',
]);

export const dataClassEnum = domain.enum('data_class', DATA_CLASSES);

/** FRANK-§2.3 content trust. A separate axis from classification, never conflated. */
export const TRUST_LABELS = exhaustive<TrustLabel>()([
  'policy-trusted',
  'owner-authenticated',
  'verified-source',
  'external-untrusted',
  'generated-untrusted',
]);

export const trustLabelEnum = domain.enum('trust_label', TRUST_LABELS);

/** FRANK-§6.9 `PolicyDecision.result`, stored on audit entries (FRANK-§11.5). */
export const POLICY_RESULTS = exhaustive<PolicyResult>()([
  'allow',
  'allow_with_limits',
  'hold_for_review',
  'deny',
]);

export const policyResultEnum = domain.enum('policy_result', POLICY_RESULTS);

/* -------------------------------------------------------------- actor kinds --- */

/**
 * WORK-003: "Work can be delegated to a person, agent profile, team of agents,
 * or external system without changing its identity." Those four are enum members
 * here so a delegation target is a typed value, not a parsed string prefix.
 */
export const ACTOR_KINDS = [
  'user',
  'agent',
  'agent_team',
  'external_system',
  'service',
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export const actorKindEnum = domain.enum('actor_kind', ACTOR_KINDS);

/**
 * A reference to whoever or whatever acted. Mirrors `ActorRef` in FRANK-§11.3.
 * Stored as two columns rather than a `kind/id` string so `WHERE actor_kind =
 * 'agent'` is an index scan and not a `LIKE 'agent/%'`.
 */
export interface ActorRef {
  readonly kind: ActorKind;
  readonly id: string;
}

/* --------------------------------------------------------------- provenance --- */

/**
 * FRANK-§11.1: "`created_at`, `updated_at`, `created_by`, `updated_by`,
 * `cell_id`, and provenance on durable records."
 *
 * Provenance answers "how did this row come to exist", which is distinct from
 * `created_by` ("who is accountable for it"). A row created by an automation on
 * Steven's behalf has `created_by = user/steven` and
 * `provenance.method = 'automation'`.
 */
export interface Provenance {
  /** `capture` | `automation` | `import` | `sync` | `agent` | `manual` | `migration`. */
  readonly method: string;
  /** Free-form identifier of the thing that produced the row, e.g. `automation/daily-brief`. */
  readonly producer: string;
  /** Correlation id of the run or request that produced it (FRANK-§19.1). */
  readonly correlationId?: string;
  /** External system this originated from, when applicable. */
  readonly externalProviderId?: string;
  /** Version of the code or definition that produced it. */
  readonly producerVersion?: string;
}

/**
 * A pointer to a versioned document (policy set, rights policy, retention
 * policy). Mirrors `VersionedRef` in FRANK-§11.3.
 */
export interface VersionedRef {
  readonly ref: string;
  readonly version: string;
}

/* ---------------------------------------------------------- column builders --- */

/**
 * The FRANK-§11.1 durable-record columns.
 *
 * Returned from a function rather than exported as a frozen object because
 * Drizzle column builders carry per-table state; sharing one instance across two
 * tables silently corrupts both definitions.
 *
 * `created_at` and `updated_at` have no database default. FRANK-§11.1 says
 * identifiers are "generated once at the domain boundary", and the same
 * reasoning applies to the timestamps that go into an audit hash: a value the
 * writer did not choose is a value the writer cannot include in the payload it
 * signs.
 */
export function durableRecordColumns() {
  return {
    /** FRANK-§2.4. Every durable row is scoped to exactly one cell. */
    cellId: text('cell_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    provenance: jsonb('provenance').$type<Provenance>().notNull(),
  };
}

/**
 * FRANK-§11.1: "Every external record retains provider ID, account ID, sync
 * cursor, observed version, and conflict state."
 */
export const CONFLICT_STATES = ['none', 'local_ahead', 'remote_ahead', 'diverged', 'unresolvable'] as const;

export type ConflictState = (typeof CONFLICT_STATES)[number];

export const conflictStateEnum = domain.enum('conflict_state', CONFLICT_STATES);

export function externalRecordColumns() {
  return {
    externalProviderId: text('external_provider_id'),
    externalAccountId: text('external_account_id'),
    externalId: text('external_id'),
    syncCursor: text('sync_cursor'),
    observedVersion: text('observed_version'),
    conflictState: conflictStateEnum('conflict_state').notNull().default('none'),
  };
}

/**
 * Where a human schedules something, FRANK-§11.1 requires "UTC timestamps plus
 * an explicit IANA timezone". A `timestamptz` alone cannot express "09:00 in
 * Melbourne" across a daylight-saving boundary, which is precisely what WORK-005
 * ("daylight-saving tests produce one intended occurrence") tests.
 */
export function zonedTimestampColumns<TPrefix extends string>(prefix: TPrefix) {
  return {
    instant: timestamp(`${prefix}_at`, { withTimezone: true, mode: 'date' }),
    timezone: text(`${prefix}_timezone`),
  };
}

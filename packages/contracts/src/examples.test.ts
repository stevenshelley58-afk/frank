/**
 * Every frozen example under `../examples/` is checked against the hand-written
 * type for its schema. The runtime `expect`s here are almost incidental — the
 * point of this file is that it must COMPILE. If a schema and its TypeScript
 * mirror drift apart (a renamed field, a field that stopped being optional, a
 * changed nesting), `pnpm --filter @frank/contracts typecheck` fails.
 *
 * Value-level constraints the schemas express and TypeScript cannot see from a
 * JSON import (enum membership, `pattern`, `format`, `minItems`) are enforced
 * by Ajv in `tools/registry/validate-contracts.mjs`, which runs against these
 * same files.
 */

import { describe, expect, it } from 'vitest';

import classificationExample from '../examples/classification.v1.example.json' with { type: 'json' };
import eventEnvelopeExample from '../examples/event-envelope.v1.example.json' with { type: 'json' };
import evidenceManifestExample from '../examples/evidence-manifest.v1.example.json' with { type: 'json' };
import moduleManifestExample from '../examples/module-manifest.v1.example.json' with { type: 'json' };
import packExample from '../examples/pack.v1.example.json' with { type: 'json' };
import policyDecisionExample from '../examples/policy-decision.v1.example.json' with { type: 'json' };
import actionEnvelopeExample from '../examples/policy-decision.v1.action-envelope.example.json' with { type: 'json' };
import standingAuthorizationExample from '../examples/policy-decision.v1.standing-authorization.example.json' with { type: 'json' };
import screenExample from '../examples/screen.v1.example.json' with { type: 'json' };

import classificationSchema from '../schemas/classification.v1.schema.json' with { type: 'json' };
import eventEnvelopeSchema from '../schemas/event-envelope.v1.schema.json' with { type: 'json' };
import evidenceSchema from '../schemas/evidence-manifest.v1.schema.json' with { type: 'json' };
import moduleManifestSchema from '../schemas/module-manifest.v1.schema.json' with { type: 'json' };
import packSchema from '../schemas/pack.v1.schema.json' with { type: 'json' };
import policySchema from '../schemas/policy-decision.v1.schema.json' with { type: 'json' };
import screenSchema from '../schemas/screen.v1.schema.json' with { type: 'json' };

import { DATA_CLASS_ORDER, type DataRouteDecision } from './classification.js';
import type { EventEnvelope } from './event-envelope.js';
import type { EvidenceManifest } from './evidence.js';
import type { ModuleManifest } from './module-manifest.js';
import type { PackManifest } from './pack.js';
import type { ActionEnvelope, PolicyDecision, StandingAuthorization } from './policy.js';
import type { ScreenContract } from './screen.js';

/* ------------------------------------------------------- type-level tools --- */

/**
 * TypeScript widens the type of an imported JSON module: the string `"private"`
 * in a `.json` file is typed `string`, never `"private"`. A byte-perfect
 * instance of a contract is therefore not assignable to the contract type, and
 * a bare `satisfies DataRouteDecision` cannot be used no matter how correct the
 * example is.
 *
 * `JsonShape<T>` widens exactly that one axis of `T` and nothing else. Field
 * names, required vs optional, nesting depth, array-ness, and the
 * string/number/boolean/null distinction are all still enforced, so renaming
 * `effectiveClass`, dropping `retention`, or turning an object into an array
 * remains a compile error. Only literal *values* (enum members and `const`
 * discriminators) are relaxed — Ajv covers those.
 */
type JsonShape<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? JsonShape<U>[]
        : T extends object
          ? { [K in keyof T]: JsonShape<T[K]> }
          : T;

/**
 * `satisfies` only performs excess-property checking against fresh object
 * literals, and an imported JSON module is not one. `UnknownKeys` recovers that
 * half of the check: it collects every key the example declares that the
 * contract does not, at any depth, so an example carrying a field the type
 * forgot is caught too.
 */
type UnknownKeys<Actual, Expected> = Actual extends readonly (infer ActualItem)[]
  ? Expected extends readonly (infer ExpectedItem)[]
    ? UnknownKeys<ActualItem, ExpectedItem>
    : never
  : Actual extends object
    ? Expected extends object
      ?
          | Exclude<keyof Actual, keyof Expected>
          | {
              [K in keyof Actual & keyof Expected]: UnknownKeys<
                Actual[K],
                NonNullable<Expected[K]>
              >;
            }[keyof Actual & keyof Expected]
      : never
    : never;

type Assert<T extends true> = T;

type NoUnknownKeys<Actual, Expected> = [UnknownKeys<Actual, Expected>] extends [never]
  ? true
  : { 'example declares keys the contract does not': UnknownKeys<Actual, Expected> };

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The keys of `T` that are not optional. */
type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K;
}[keyof T];

/* --------------------------------------- compile-time excess-key assertions --- */

export type AssertClassificationKeys = Assert<
  NoUnknownKeys<typeof classificationExample, DataRouteDecision>
>;
export type AssertEventEnvelopeKeys = Assert<
  NoUnknownKeys<typeof eventEnvelopeExample, EventEnvelope>
>;
export type AssertEvidenceKeys = Assert<
  NoUnknownKeys<typeof evidenceManifestExample, EvidenceManifest>
>;
export type AssertModuleManifestKeys = Assert<
  NoUnknownKeys<typeof moduleManifestExample, ModuleManifest>
>;
export type AssertPackKeys = Assert<NoUnknownKeys<typeof packExample, PackManifest>>;
export type AssertPolicyDecisionKeys = Assert<
  NoUnknownKeys<typeof policyDecisionExample, PolicyDecision>
>;
export type AssertActionEnvelopeKeys = Assert<
  NoUnknownKeys<typeof actionEnvelopeExample, ActionEnvelope>
>;
export type AssertStandingAuthorizationKeys = Assert<
  NoUnknownKeys<typeof standingAuthorizationExample, StandingAuthorization>
>;
export type AssertScreenKeys = Assert<NoUnknownKeys<typeof screenExample, ScreenContract>>;

/* --------------------------------------------------- required-key round trip --- */

/**
 * A single example cannot reveal that a required field was mistakenly typed as
 * optional — the example supplies the field either way. These tuples close that
 * gap for the top-level object of each schema by making the required-key set an
 * explicit value, then pinning it from both sides:
 *
 *   - at compile time, `Equals<RequiredKeys<Contract>, Tuple[number]>` forces
 *     the tuple to be exactly the type's non-optional keys;
 *   - at run time, the tuple is compared to the schema's own `required` array.
 *
 * Transitively, the TypeScript type's optionality equals the schema's, and
 * either side moving alone breaks the build.
 *
 * This covers top-level objects only; optionality inside nested objects is
 * still only as good as what the examples exercise.
 */
const dataRouteRequired = [
  'schema',
  'decisionId',
  'cellId',
  'effectiveClass',
  'contributingSources',
  'processor',
  'processingLocation',
  'retention',
  'redactions',
  'policyVersion',
  'reason',
  'decidedAt',
] as const satisfies readonly (keyof DataRouteDecision)[];

const eventEnvelopeRequired = [
  'specversion',
  'type',
  'source',
  'id',
  'time',
  'dataschema',
  'datacontenttype',
  'cellid',
  'actorid',
  'correlationid',
  'classification',
  'data',
] as const satisfies readonly (keyof EventEnvelope)[];

const evidenceRequired = [
  'schema',
  'changeId',
  'createdAt',
  'retentionPolicy',
  'outcome',
  'requirements',
  'source',
  'execution',
  'artifacts',
  'checks',
  'reviews',
  'risks',
  'rollback',
  'cost',
  'integrity',
] as const satisfies readonly (keyof EvidenceManifest)[];

const moduleManifestRequired = [
  'schema',
  'id',
  'name',
  'version',
  'kind',
  'depends_on',
  'provides',
  'data_scopes',
  'ui',
  'events',
  'permissions',
  'health_checks',
] as const satisfies readonly (keyof ModuleManifest)[];

const screenRequired = [
  'schema',
  'id',
  'path',
  'navigation',
  'roles',
  'compartments',
  'objects',
  'query_schema',
  'commands',
  'event_parts',
  'states',
  'offline',
  'capabilities',
  'deep_links',
  'acceptance_journeys',
] as const satisfies readonly (keyof ScreenContract)[];

const packRequired = [
  'schema',
  'id',
  'version',
  'requires_core',
  'namespace',
  'license',
  'permissions',
  'configuration_schema',
  'modules',
  'roles',
  'workflows',
  'terminology',
  'navigation',
  'ui_slots',
  'policies',
  'connectors',
  'reports',
  'events',
  'migrations',
  'data_ownership',
  'disable_behavior',
  'export_handler',
  'uninstall_options',
  'recovery',
  'fixtures',
  'acceptance_suites',
] as const satisfies readonly (keyof PackManifest)[];

const policyDecisionRequired = [
  'schema',
  'result',
  'policyVersion',
  'reasons',
  'evaluatedEnvelopeHash',
  'limits',
  'obligations',
] as const satisfies readonly (keyof PolicyDecision)[];

const actionEnvelopeRequired = [
  'schema',
  'actionId',
  'idempotencyKey',
  'nonce',
  'cellId',
  'principalId',
  'operation',
  'actionClass',
  'target',
  'requestHash',
  'dataClasses',
  'credentialHandles',
  'networkScope',
  'budget',
  'validFrom',
  'expiresAt',
  'signerId',
  'signature',
] as const satisfies readonly (keyof ActionEnvelope)[];

const standingAuthorizationRequired = [
  'schema',
  'authorizationId',
  'ownerId',
  'allowedActors',
  'operations',
  'targetPattern',
  'maximumDataClass',
  'credentialScopes',
  'networkScope',
  'perActionBudget',
  'aggregateBudget',
  'evidenceObligations',
  'retryLimit',
  'validFrom',
  'expiresAt',
  'revocationCounter',
  'signerId',
  'signature',
] as const satisfies readonly (keyof StandingAuthorization)[];

export type AssertDataRouteRequired = Assert<
  Equals<RequiredKeys<DataRouteDecision>, (typeof dataRouteRequired)[number]>
>;
export type AssertEventEnvelopeRequired = Assert<
  Equals<RequiredKeys<EventEnvelope>, (typeof eventEnvelopeRequired)[number]>
>;
export type AssertEvidenceRequired = Assert<
  Equals<RequiredKeys<EvidenceManifest>, (typeof evidenceRequired)[number]>
>;
export type AssertModuleManifestRequired = Assert<
  Equals<RequiredKeys<ModuleManifest>, (typeof moduleManifestRequired)[number]>
>;
export type AssertScreenRequired = Assert<
  Equals<RequiredKeys<ScreenContract>, (typeof screenRequired)[number]>
>;
export type AssertPackRequired = Assert<
  Equals<RequiredKeys<PackManifest>, (typeof packRequired)[number]>
>;
export type AssertPolicyDecisionRequired = Assert<
  Equals<RequiredKeys<PolicyDecision>, (typeof policyDecisionRequired)[number]>
>;
export type AssertActionEnvelopeRequired = Assert<
  Equals<RequiredKeys<ActionEnvelope>, (typeof actionEnvelopeRequired)[number]>
>;
export type AssertStandingAuthorizationRequired = Assert<
  Equals<RequiredKeys<StandingAuthorization>, (typeof standingAuthorizationRequired)[number]>
>;

const requiredKeyCases: readonly [string, readonly string[], readonly string[]][] = [
  ['classification.v1 / DataRouteDecision', dataRouteRequired, classificationSchema.required],
  ['event-envelope.v1 / EventEnvelope', eventEnvelopeRequired, eventEnvelopeSchema.required],
  ['evidence-manifest.v1 / EvidenceManifest', evidenceRequired, evidenceSchema.required],
  ['module-manifest.v1 / ModuleManifest', moduleManifestRequired, moduleManifestSchema.required],
  ['screen.v1 / ScreenContract', screenRequired, screenSchema.required],
  ['pack.v1 / PackManifest', packRequired, packSchema.required],
  [
    'policy-decision.v1 / PolicyDecision',
    policyDecisionRequired,
    policySchema.$defs.PolicyDecision.required,
  ],
  [
    'policy-decision.v1 / ActionEnvelope',
    actionEnvelopeRequired,
    policySchema.$defs.ActionEnvelope.required,
  ],
  [
    'policy-decision.v1 / StandingAuthorization',
    standingAuthorizationRequired,
    policySchema.$defs.StandingAuthorization.required,
  ],
];

/* -------------------------------------------------------------------- tests --- */

describe('type optionality matches the schema `required` array', () => {
  it.each(requiredKeyCases)('%s', (_name, fromType, fromSchema) => {
    expect([...fromType].sort()).toEqual([...fromSchema].sort());
  });
});

describe('frozen examples conform to their contract types', () => {
  it('classification.v1 -> DataRouteDecision', () => {
    const example = classificationExample satisfies JsonShape<DataRouteDecision>;

    expect(example.schema).toBe('frank.data-route/v1');
    expect(DATA_CLASS_ORDER).toContain(example.effectiveClass);
    expect(example.contributingSources.length).toBeGreaterThan(0);
    for (const source of example.contributingSources) {
      expect(DATA_CLASS_ORDER).toContain(source.class);
    }
  });

  it('event-envelope.v1 -> EventEnvelope', () => {
    const example = eventEnvelopeExample satisfies JsonShape<EventEnvelope>;

    expect(example.specversion).toBe('1.0');
    expect(example.datacontenttype).toBe('application/json');
    expect(DATA_CLASS_ORDER).toContain(example.classification);
    expect(example.type).toMatch(/^frank\.[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/);
  });

  it('evidence-manifest.v1 -> EvidenceManifest', () => {
    const example = evidenceManifestExample satisfies JsonShape<EvidenceManifest>;

    expect(example.schema).toBe('frank.evidence/v1');
    // FRANK-§14.3 / BUILD-009: fewer than two reviews cannot satisfy the gate.
    expect(example.reviews.length).toBeGreaterThanOrEqual(2);
    expect(example.checks.length).toBeGreaterThanOrEqual(1);
    expect(example.requirements.length).toBeGreaterThanOrEqual(1);
  });

  it('module-manifest.v1 -> ModuleManifest', () => {
    const example = moduleManifestExample satisfies JsonShape<ModuleManifest>;

    expect(example.schema).toBe('frank.module/v1');
    for (const scope of example.data_scopes) {
      expect(DATA_CLASS_ORDER).toContain(scope);
    }
  });

  it('pack.v1 -> PackManifest', () => {
    const example = packExample satisfies JsonShape<PackManifest>;

    expect(example.schema).toBe('frank.pack/v1');
    expect(example.uninstall_options.length).toBeGreaterThanOrEqual(1);
  });

  it('policy-decision.v1 -> PolicyDecision', () => {
    const example = policyDecisionExample satisfies JsonShape<PolicyDecision>;

    expect(example.result).toBe('allow_with_limits');
    expect(example.reasons.length).toBeGreaterThanOrEqual(1);
    expect(example.evaluatedEnvelopeHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('policy-decision.v1 (action envelope) -> ActionEnvelope', () => {
    const example = actionEnvelopeExample satisfies JsonShape<ActionEnvelope>;

    expect(example.schema).toBe('frank.action/v1');
    // FRANK-§2.3: opaque handles only, never a raw token.
    for (const handle of example.credentialHandles) {
      expect(handle).toMatch(/^handle:[A-Za-z0-9._:-]+$/);
    }
  });

  it('policy-decision.v1 (standing authorization) -> StandingAuthorization', () => {
    const example = standingAuthorizationExample satisfies JsonShape<StandingAuthorization>;

    expect(example.schema).toBe('frank.authorization/v1');
    // FRANK-§7.6: no standing authorization is perpetual.
    expect(example.expiresAt.length).toBeGreaterThan(0);
    expect(Date.parse(example.expiresAt)).toBeGreaterThan(Date.parse(example.validFrom));
  });

  it('screen.v1 -> ScreenContract', () => {
    const example = screenExample satisfies JsonShape<ScreenContract>;

    expect(example.schema).toBe('frank.screen/v1');
    expect(example.roles.length).toBeGreaterThanOrEqual(1);
    expect(example.states.length).toBeGreaterThanOrEqual(1);
    expect(example.deep_links.length).toBeGreaterThanOrEqual(1);
  });
});

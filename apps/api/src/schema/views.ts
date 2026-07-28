/**
 * Response view models — WORK-001..006, UX-001, UX-003, UX-007, OPS-004,
 * FRANK-§12.2.
 *
 * These are the *wire* shapes. They are deliberately not the storage rows:
 * FRANK-§17.2's "UI modules receive API contracts and view models, not database
 * clients" is about the client, and a view model that is a renamed row makes
 * every column change a breaking API change.
 *
 * Snake_case throughout, matching the FRANK-§12.3 command body the specification
 * prints (`command_id`, `expected_version`, `dry_run`). The internal TypeScript
 * is camelCase; the boundary is where the two meet, once, here.
 */

import { z } from 'zod';

import { freshnessSchema, identifiersSchema, policyDecisionSchema } from './registry.js';

/* ------------------------------------------------------------- primitives --- */

export const dataClassSchema = z.enum(['open', 'internal', 'private', 'sensitive', 'secret']);

export const trustLabelSchema = z.enum([
  'policy-trusted',
  'owner-authenticated',
  'verified-source',
  'external-untrusted',
  'generated-untrusted',
]);

/** FRANK-§11.3 ∪ WORK-004, as `adapters/storage/postgres/src/work-state.ts` reconciles them. */
export const workStateSchema = z.enum([
  'inbox',
  'planned',
  'ready',
  'scheduled',
  'waiting',
  'blocked',
  'active',
  'reviewing',
  'done',
  'cancelled',
  'failed',
]);

export const actorRefSchema = z.object({
  kind: z.enum(['user', 'agent', 'agent_team', 'external_system', 'service']),
  id: z.string(),
});

/* ------------------------------------------------------------------ capture --- */

/**
 * UX-003 lists six capture kinds. Slice 1 implements two.
 *
 * The other four are *not* silently missing: `unsupported_capture_kind` (415) is
 * in the capture route's error catalogue, and the OpenAPI document lists the
 * slice's supported set, so a client discovers the boundary from the contract
 * rather than from a 500.
 */
export const captureKindSchema = z.enum(['text', 'voice_transcript']);

export const captureRequestSchema = z
  .object({
    /** FRANK-§12.1 idempotency key; FRANK-§12.3 `command_id`. */
    command_id: z.string().min(8).max(128),
    kind: captureKindSchema,
    /**
     * The captured text. Bounded: FRANK-§15.5.8 requires "declared file types,
     * size, recursion, time, memory, and network limits" and a capture endpoint
     * with no size limit is the cheapest denial of service in the system.
     */
    text: z.string().min(1).max(256_000),
    /** FRANK-§2.3. Defaulted to the strictest sensible class, never to `open`. */
    data_class: dataClassSchema.exclude(['secret']).default('private'),
    /**
     * FRANK-§2.3 trust. A client may only *lower* trust from the default; the
     * server refuses `policy-trusted` and `owner-authenticated` from a request
     * body, because those two are claims about the platform that a payload
     * cannot make about itself. Enforced in the route, not here, so the refusal
     * is a typed problem rather than a schema error.
     */
    trust: trustLabelSchema.default('owner-authenticated'),
    /** Where it came from, if anywhere. */
    origin_uri: z.string().max(2_048).optional(),
    title: z.string().max(512).optional(),
    /** Voice only: the transcriber that produced `text`. */
    transcript_source: z.string().max(256).optional(),
    /** Voice only: seconds of audio. */
    duration_seconds: z.number().nonnegative().max(86_400).optional(),
  })
  .strict();

/**
 * UX-004's acknowledgement.
 *
 * Everything in it is a fact that is already durable when the response is
 * written. Nothing is a promise: there is no `enrichment_id` a client could
 * poll, because enrichment has not necessarily started, and returning an id for
 * work that may not exist is exactly the "silently presenting an old state as
 * current" failure UX-007 is about, one layer down.
 */
export const captureResponseSchema = z.object({
  /** Always `durable`. Present so the field exists when Slice 3 adds `quarantined`. */
  acknowledgement: z.literal('durable'),
  source_id: z.string(),
  source_version_id: z.string().nullable(),
  work_item_id: z.string().nullable(),
  capture_event_id: z.string(),
  content_hash: z.string(),
  /** True when this call returned an existing capture. UX-003 replay safety. */
  replayed: z.boolean(),
  replay_reason: z.enum(['request', 'content']).nullable(),
  /** ADR-004. Empty on a replay: a replay emits no events. */
  emitted_event_ids: z.array(z.string()),
  /** FRANK-§11.5. Null on a replay: nothing happened to audit. */
  audit_entry_id: z.string().nullable(),
  /**
   * Where enrichment stands *at the moment of the response*. `deferred` is the
   * normal answer and is the point of UX-004.
   */
  enrichment: z.object({
    state: z.enum(['deferred', 'queued', 'unavailable']),
    detail: z.string(),
  }),
  policy: policyDecisionSchema,
  identifiers: identifiersSchema,
  _links: z.object({
    source: z.string(),
    work_item: z.string().nullable(),
    provenance: z.string().nullable(),
  }),
});

/* --------------------------------------------------------------------- work --- */

/**
 * WORK-006: "All work must expose 'why now', 'definition of done', and 'next
 * safe action'."
 *
 * All three are required and non-nullable on the wire. The storage columns are
 * nullable (an item created before the requirement, or by a path that forgot),
 * so the API substitutes an explicit placeholder rather than emitting `null` —
 * see `services/work-view.ts`. A client that receives `null` cannot tell "no
 * next action exists" from "nobody set one", and WORK-006's acceptance evidence
 * is an API contract test, which a nullable field would pass while meaning
 * nothing.
 */
export const workGuidanceSchema = z.object({
  why_now: z.string().min(1),
  definition_of_done: z
    .array(
      z.object({
        id: z.string(),
        statement: z.string(),
        verification: z.string(),
      }),
    )
    .min(1),
  next_safe_action: z.object({
    /** Plain-language label. FRANK-§3.1's design direction. */
    label: z.string().min(1),
    /** The command endpoint that performs it, or null when it is not a command. */
    command: z.string().nullable(),
    /** Why it is *safe*: what it cannot do. */
    safety: z.string().min(1),
  }),
});

export const workItemSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(['task', 'decision', 'bug', 'milestone', 'follow_up', 'routine', 'agent_job']),
  title: z.string(),
  state: workStateSchema,
  priority: z.enum(['none', 'low', 'normal', 'high', 'critical']),
  owner: actorRefSchema,
  data_class: dataClassSchema,
  version: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  due_at: z.string().nullable(),
  scheduled_for: z.string().nullable(),
  guidance: workGuidanceSchema,
  _links: z.object({ self: z.string(), provenance: z.string(), history: z.string() }),
});

export const workItemDetailSchema = workItemSummarySchema.extend({
  description: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  policy_ref: z.object({ ref: z.string(), version: z.string() }),
  provenance: z.object({
    method: z.string(),
    producer: z.string(),
    correlation_id: z.string().nullable(),
  }),
  source_ids: z.array(z.string()),
  /**
   * FRANK-§12.2: "GET /{resources}/{id} — … and available commands."
   * Derived from the WORK-004 state machine and the caller's capabilities, so a
   * client never has to know the transition table.
   */
  available_commands: z.array(
    z.object({
      command: z.string(),
      to_state: workStateSchema,
      label: z.string(),
      href: z.string(),
    }),
  ),
  freshness: freshnessSchema,
  identifiers: identifiersSchema,
});

export const workListResponseSchema = z.object({
  items: z.array(workItemSummarySchema),
  /** FRANK-§12.1 cursor pagination. Null when there is no further page. */
  next_cursor: z.string().nullable(),
  freshness: freshnessSchema,
  identifiers: identifiersSchema,
});

export const workListQuerySchema = z
  .object({
    state: workStateSchema.optional(),
    owner_id: z.string().max(256).optional(),
    /** Opaque. A UUIDv7 is time-ordered, so the cursor is the last id seen. */
    cursor: z.string().max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(['created_at', 'updated_at', 'due_at', 'priority']).default('updated_at'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const workIdParamsSchema = z.object({ id: z.string().min(1).max(64) });

export const workCommandParamsSchema = z.object({
  id: z.string().min(1).max(64),
  command: z.string().min(1).max(64),
});

/** FRANK-§12.3: returns "the resulting resource, policy decision, receipts, and emitted event IDs". */
export const workCommandResponseSchema = z.object({
  /** Absent on a `dry_run`: nothing changed, so there is no resulting resource. */
  resource: workItemDetailSchema.nullable(),
  /** What the command *would* do. Present only on a dry run. */
  preview: z
    .object({
      from_state: workStateSchema,
      to_state: workStateSchema,
      would_succeed: z.boolean(),
      reason: z.string(),
    })
    .nullable(),
  policy: policyDecisionSchema,
  audit_entry_id: z.string().nullable(),
  emitted_event_ids: z.array(z.string()),
  /**
   * FRANK-§12.3 "receipts". Slice 1 produces none: a receipt is the record of an
   * *external* side effect through the invocation ledger (FRANK-§13.5), and
   * Slice 1 has no connectors. The field is present and empty rather than absent
   * so the shape does not change when Slice 5 fills it.
   */
  receipts: z.array(
    z.object({ kind: z.string(), reference: z.string(), recorded_at: z.string() }),
  ),
  identifiers: identifiersSchema,
});

export const workHistoryResponseSchema = z.object({
  work_item_id: z.string(),
  transitions: z.array(
    z.object({
      seq: z.number().int(),
      from_state: workStateSchema,
      to_state: workStateSchema,
      actor: actorRefSchema,
      reason: z.string().nullable(),
      occurred_at: z.string(),
      audit_entry_id: z.string().nullable(),
      resulting_version: z.number().int(),
    }),
  ),
  identifiers: identifiersSchema,
});

/* -------------------------------------------------------------------- today --- */

/**
 * UX-001 is *partial* in Slice 1 by design.
 *
 * The full requirement combines "calendar, tasks, goals, routines, waiting
 * items, messages, agent work, and system exceptions". Slice 1 has exactly one
 * of those contexts in the database (work), so the brief for this workstream
 * asks for "one card proving the provenance chain, not the full prioritised
 * brief".
 *
 * `sections` is therefore a list that currently contains one entry, and
 * `coverage` states in the response which UX-001 inputs are present and which
 * are not yet available. A Today response that silently omitted six of its eight
 * inputs would be the exact "presenting an old state as current" failure UX-007
 * warns about, applied to completeness rather than to freshness.
 */
export const todayCardSchema = z.object({
  id: z.string(),
  kind: z.literal('work_item'),
  title: z.string(),
  state: workStateSchema,
  priority: z.enum(['none', 'low', 'normal', 'high', 'critical']),
  guidance: workGuidanceSchema,
  data_class: dataClassSchema,
  /** UX-007 per card, because one stale source does not make the brief stale. */
  freshness: freshnessSchema,
  /** The Slice 1 exit gate: every card links to its provenance walk. */
  _links: z.object({ resource: z.string(), provenance: z.string() }),
});

export const todayResponseSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      cards: z.array(todayCardSchema),
    }),
  ),
  /** Which UX-001 inputs this brief actually covers. See the note above. */
  coverage: z.object({
    included: z.array(z.string()),
    not_yet_available: z.array(
      z.object({ input: z.string(), reason: z.string(), available_in: z.string() }),
    ),
  }),
  freshness: freshnessSchema,
  identifiers: identifiersSchema,
});

export const todayQuerySchema = z
  .object({
    /** IANA zone. FRANK-§11.1: a human-scheduled day needs its zone. */
    timezone: z.string().max(64).default('Australia/Melbourne'),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

/* --------------------------------------------------------------- provenance --- */

/**
 * The Slice 1 exit gate: a Today card walked back to its immutable source
 * envelope, run, policy decision, and cost receipt.
 *
 * Every link in the chain is a *present-or-explained* field. `runs` and
 * `cost_receipts` are commonly empty in Slice 1 — there is no agent kernel yet
 * (Slice 2) and no model spend on a hand-typed capture — and an empty array with
 * no explanation reads as "there were none" when the truth is "that link is not
 * built yet". `unavailable_links` says which, and why, in the response.
 */
export const provenanceResponseSchema = z.object({
  work_item: z.object({
    id: z.string(),
    title: z.string(),
    state: workStateSchema,
    created_at: z.string(),
    data_class: dataClassSchema,
    provenance: z.object({
      method: z.string(),
      producer: z.string(),
      correlation_id: z.string().nullable(),
    }),
  }),
  /** FRANK-§11.3 `SourceEnvelope`. Immutable while retained. */
  sources: z.array(
    z.object({
      id: z.string(),
      relation: z.string(),
      kind: z.string(),
      origin_uri: z.string().nullable(),
      content_hash: z.string(),
      /** ADR-003: the bytes live in object storage, referenced by URI + digest. */
      raw_artifact_uri: z.string(),
      raw_artifact_sha256: z.string(),
      data_class: dataClassSchema,
      trust: trustLabelSchema,
      lifecycle: z.string(),
      captured_at: z.string(),
      captured_by: actorRefSchema,
      current_version_id: z.string().nullable(),
      versions: z.array(
        z.object({
          id: z.string(),
          version_no: z.number().int(),
          content_hash: z.string(),
          recorded_at: z.string(),
          reason: z.string(),
        }),
      ),
      capture_events: z.array(
        z.object({
          id: z.string(),
          request_idempotency_key: z.string(),
          channel: z.string(),
          accepted_at: z.string(),
          replay_count: z.number().int(),
          correlation_id: z.string(),
        }),
      ),
    }),
  ),
  /** Slice 2. Empty and explained until the agent kernel exists. */
  runs: z.array(
    z.object({ id: z.string(), kind: z.string(), started_at: z.string(), state: z.string() }),
  ),
  /** FRANK-§6.9 decisions recorded on the audit chain (FRANK-§11.5). */
  policy_decisions: z.array(
    z.object({
      audit_entry_id: z.string(),
      seq: z.number().int(),
      action: z.string(),
      target: z.object({ kind: z.string(), id: z.string() }),
      policy_version: z.string().nullable(),
      result: z.enum(['allow', 'allow_with_limits', 'hold_for_review', 'deny']).nullable(),
      occurred_at: z.string(),
      actor: actorRefSchema,
    }),
  ),
  /** OPS-001 cost attached to this work item. */
  cost_receipts: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      amount: z.string(),
      currency: z.string(),
      attribution_state: z.enum(['attributed', 'partial', 'unattributed']),
      occurred_at: z.string(),
      usage_receipt_ref: z.string().nullable(),
      provider_id: z.string().nullable(),
      model_ref: z.string().nullable(),
    }),
  ),
  /** FRANK-§11.5 hash-linked chain covering this walk. */
  audit_chain: z.object({
    entries: z.array(
      z.object({
        id: z.string(),
        seq: z.number().int(),
        action: z.string(),
        occurred_at: z.string(),
        entry_hash: z.string(),
        prev_chain_hash: z.string(),
        chain_hash: z.string(),
      }),
    ),
    /** Recomputed over the returned entries at read time, not trusted from disk. */
    verified: z.boolean(),
    verification_detail: z.string(),
  }),
  /** Links this slice cannot yet provide, and why. See the note above. */
  unavailable_links: z.array(
    z.object({ link: z.string(), reason: z.string(), available_in: z.string() }),
  ),
  freshness: freshnessSchema,
  identifiers: identifiersSchema,
});

/* ------------------------------------------------------------------- health --- */

/** OPS-004, verbatim: "healthy, degraded, unavailable, stale, and intentionally paused". */
export const healthStateSchema = z.enum([
  'healthy',
  'degraded',
  'unavailable',
  'stale',
  'intentionally_paused',
]);

export const healthComponentSchema = z.object({
  id: z.string(),
  state: healthStateSchema,
  detail: z.string(),
  /** UX-007: age is mandatory whenever the component is not reporting live. */
  observed_at: z.string(),
  age_seconds: z.number().int().nonnegative(),
  /** UX-007: "displays age and recovery action". Null only when healthy. */
  recovery_action: z.string().nullable(),
  /** OPS-003: set when an operator paused it, so paused never reads as broken. */
  paused_by: z.string().nullable(),
  measurements: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});

export const healthResponseSchema = z.object({
  /** The worst component state. OPS-004's five values, never a boolean. */
  state: healthStateSchema,
  /** Liveness: this process is running. Separate from readiness on purpose. */
  live: z.boolean(),
  /** Readiness: this process can serve traffic. */
  ready: z.boolean(),
  checked_at: z.string(),
  components: z.array(healthComponentSchema),
  identifiers: identifiersSchema,
});

export const livenessResponseSchema = z.object({
  live: z.literal(true),
  service: z.string(),
  checked_at: z.string(),
});

export const readinessResponseSchema = z.object({
  ready: z.boolean(),
  state: healthStateSchema,
  checked_at: z.string(),
  blocking: z.array(z.object({ id: z.string(), state: healthStateSchema, detail: z.string() })),
});

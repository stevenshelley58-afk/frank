# Shared graph and trace contract

**Status:** Accepted contract; implementation pending

**Date:** 2026-08-14

**Scope:** Frank shared graph/trace workbench and `ToolManifestAdapter` only

## Context

Frank needs one graphical workbench for projects, tools, prompts, payloads,
instructions, demonstrations, traces, releases, infrastructure, and future
memory/knowledge views. Domain packages must not ship their own graph screens,
renderers, or execution engines. Hermes remains the sole authority for tool
execution, settings changes, policy, models, memory, and receipts.

The existing Frank Window is a Flask application with vanilla ES modules. It
already has a `trace` view and a placeholder `trace-view` widget, plus shared
project/tool/agent/service homes. The new workbench extends those seams rather
than introducing another Frank application.

## Decision

Frank will use [`@maxgraph/core`](https://github.com/maxGraph/maxGraph), under
the Apache-2.0 license, as its only interactive graph renderer. The package
version will be pinned in the implementation lockfile. maxGraph may lay out,
select, group, annotate, and edit graph projections; it must never schedule or
execute a node.

All providers project into one renderer-neutral graph envelope. The first
provider is `ToolManifestAdapter`, a pure adapter from versioned domain Tool
contracts plus optional settings and trace records into the shared graph and
trace envelopes in this document.

## Canonical schema identifiers

These identifiers are exact and case-sensitive.

| Schema ID | Owner | Purpose |
| --- | --- | --- |
| `schema://frank.tool-manifest/v1` | Domain Tool package | Declarative Tool identity and pipeline |
| `schema://frank.tool-settings-revision/v1` | Hermes/domain Tool package | Immutable settings revision referenced by a manifest or run |
| `schema://frank.hermes-command/v1` | Hermes boundary | Requested validate, demo, run, or commit operation |
| `schema://frank.hermes-event/v1` | Hermes boundary | Ordered command progress, result, failure, artifact, and receipt event |
| `schema://frank.tool-manifest-adapter/v1` | Frank | Adapter registration and compatibility declaration |
| `schema://frank.graph/v1` | Frank | Renderer-neutral graph snapshot |
| `schema://frank.trace/v1` | Frank | Redacted OpenTelemetry trace projection |

Producers must reject an unsupported major version. Additive fields in a known
major version are ignored unless declared in `extensions`. A producer must not
silently reinterpret a field.

## Shared registration identifiers

These identifiers are reserved for the one shared implementation.

| Kind | ID | Status and use |
| --- | --- | --- |
| Full graph view | `graph` | New shared rail/view ID |
| Full graph container | `slot-graph` | New maxGraph workbench host |
| Trace view | `trace` | Existing view; becomes the run-trace lens of the same workbench |
| Trace container | `slot-trace` | Existing host; mounts the same workbench in trace mode |
| Entity-home widget | `entity-graph` | New shared project/tool/agent/service home widget |
| Legacy trace widget | `trace-view` | Existing placeholder; compatibility alias to the shared workbench for v1, deprecated for v2 |
| Renderer component | `graph-workbench` | One internal renderer/editor component used by every host above |
| Tool adapter | `tool-manifest` | Provider/adapter registry ID |

Domain packages register no JavaScript, CSS, HTML, view, or renderer. Once the
Frank capability `frank.graph.v1` is available, a domain package may declare
`entity-graph` as a default home widget. Until that capability is present, its
default widget ID list remains empty.

## `ToolManifestAdapter` contract

The adapter is a pure projection. It performs no network call, database read,
file read, tool invocation, or mutation. All inputs are supplied by the Frank
provider boundary after authorization and redaction.

### Registration record

```json
{
  "schema": "schema://frank.tool-manifest-adapter/v1",
  "id": "tool-manifest",
  "version": "1.0.0",
  "accepts": [
    "schema://frank.tool-manifest/v1",
    "schema://frank.tool-settings-revision/v1",
    "schema://frank.hermes-event/v1",
    "OTLP/1.0"
  ],
  "produces": [
    "schema://frank.graph/v1",
    "schema://frank.trace/v1",
    "schema://frank.hermes-command/v1"
  ],
  "surfaces": ["graph", "trace", "project", "tool", "agent", "service"],
  "renderer": "graph-workbench"
}
```

### Adapter input fields

The following JSON pointers are the complete v1 field set consumed by the
adapter. Fields not listed here remain domain-owned and are not interpreted by
Frank.

#### Tool manifest: `schema://frank.tool-manifest/v1`

| JSON pointer | Required | Type | Meaning |
| --- | --- | --- | --- |
| `/schema` | yes | string | Exact schema ID |
| `/manifest_version` | yes | semver string | Domain contract version |
| `/tool/id` | yes | stable ID string | Tool identity |
| `/tool/name` | yes | string | User-facing name |
| `/tool/description` | yes | string | Plain-text description |
| `/tool/project_id` | yes | stable ID string | Owning Frank project/workspace |
| `/tool/revision` | yes | string | Immutable Tool revision |
| `/tool/source_ref` | yes | opaque string | Authorized source reference, never a raw secret-bearing path |
| `/tool/sha256` | yes | `sha256:<hex>` | Integrity hash of the manifest revision |
| `/pipeline/id` | yes | stable ID string | Pipeline identity |
| `/pipeline/revision` | yes | string | Immutable pipeline revision |
| `/pipeline/entry_node_ids` | yes | string array | One or more entry nodes |
| `/pipeline/nodes` | yes | node array | Declarative nodes in source order |
| `/pipeline/edges` | yes | edge array | Declarative edges in source order |
| `/settings_schema_ref` | yes | opaque string | Settings validation contract |
| `/active_settings_revision_ref` | no | opaque string | Currently selected immutable revision |
| `/command_contract_ref` | yes | opaque string | Hermes command contract reference |
| `/event_contract_ref` | yes | opaque string | Hermes event contract reference |
| `/telemetry/service_name` | yes | string | OpenTelemetry `service.name` |
| `/telemetry/instrumentation_scope` | yes | string | Instrumentation scope name |
| `/telemetry/node_attribute_key` | yes | string | Must equal `frank.graph.node.id` in v1 |

Each `/pipeline/nodes/*` object exposes exactly:

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `id` | yes | stable ID string | Stable within the Tool across revisions |
| `kind` | yes | enum | `input`, `prompt`, `instruction`, `transform`, `model`, `tool`, `decision`, `human`, `artifact`, or `output` |
| `label` | yes | string | User-facing label |
| `description` | yes | string | Plain-text description |
| `settings_ref` | no | opaque string | Settings slot/revision reference |
| `input_schema_ref` | no | opaque string | Input payload schema |
| `output_schema_ref` | no | opaque string | Output payload schema |
| `capabilities` | yes | enum array | Subset of `inspect`, `edit_prompt`, `edit_instructions`, `edit_payload`, `validate`, `demo`, `run`, `open_source` |
| `classification` | yes | enum | `public`, `internal`, `private`, or `secret` |
| `group_id` | no | stable ID string | Visual group/swimlane only |

`classification: secret` nodes are represented by identity and status only.
Their prompt, payload, attributes, and source reference are never returned to
the browser.

Each `/pipeline/edges/*` object exposes exactly:

| Field | Required | Type | Meaning |
| --- | --- | --- | --- |
| `id` | yes | stable ID string | Stable within the Tool across revisions |
| `from` | yes | node ID string | Source node |
| `to` | yes | node ID string | Target node |
| `from_port` | no | stable ID string | Source port |
| `to_port` | no | stable ID string | Target port |
| `kind` | yes | enum | `control`, `data`, `condition`, `error`, `retry`, or `artifact` |
| `label` | no | string | User-facing label |
| `condition_ref` | no | opaque string | Authorized condition reference, not executable code |

#### Settings revision: `schema://frank.tool-settings-revision/v1`

| JSON pointer | Required | Type | Meaning |
| --- | --- | --- | --- |
| `/schema` | yes | string | Exact schema ID |
| `/revision_id` | yes | stable ID string | Immutable revision identity |
| `/tool_id` | yes | stable ID string | Must match manifest Tool |
| `/pipeline_revision` | yes | string | Must match the rendered pipeline revision |
| `/parent_revision_id` | no | stable ID string | Previous immutable revision |
| `/created_at` | yes | RFC 3339 timestamp | Revision time |
| `/created_by` | yes | opaque actor reference | Actor identity without credentials |
| `/prompt_refs` | yes | reference array | `{slot, ref, version, sha256}`; no prompt body |
| `/instruction_refs` | yes | reference array | `{slot, ref, version, sha256}`; no instruction body |
| `/style` | yes | object | Validated style settings |
| `/model_policy` | yes | object | Validated model allow/deny/escalation policy |
| `/payload_policy` | yes | object | Validated payload schema, size, classification, and redaction policy |
| `/sha256` | yes | `sha256:<hex>` | Integrity hash of the complete revision |

Prompt, instruction, and payload editors fetch authorized content separately
from Hermes using the opaque reference. A successful save creates a new
settings revision; it never mutates an existing revision.

#### Runtime inputs

The optional runtime input set is:

- `events[]`: ordered `schema://frank.hermes-event/v1` envelopes;
- `spans[]`: OTLP span records using W3C trace/span identifiers;
- `permissions[]`: effective Frank capabilities for the current actor;
- `selection`: `{node_id?, edge_id?, trace_id?, span_id?}`;
- `lens`: `tool.pipeline`, `tool.settings`, or `run.trace`;
- `as_of`: RFC 3339 freshness boundary.

Absent optional inputs produce an explicit empty/unavailable state. The adapter
does not invent settings, events, traces, costs, or status.

### Adapter output: `schema://frank.graph/v1`

```json
{
  "schema": "schema://frank.graph/v1",
  "graph_id": "project:blockwise/tool:content-factory",
  "graph_revision": "sha256:...",
  "generated_at": "2026-08-14T00:00:00Z",
  "provider": {"id": "tool-manifest", "version": "1.0.0", "authority": "manifest"},
  "scope": {"kind": "tool", "id": "content-factory", "project_id": "blockwise"},
  "lens": "tool.pipeline",
  "capabilities": ["inspect", "validate", "demo"],
  "nodes": [],
  "edges": [],
  "groups": [],
  "trace_ref": null,
  "extensions": {}
}
```

Every `nodes[]` item has exactly:

- `id`: `project:<project_id>/tool:<tool_id>/node:<node_id>`;
- `source_id`: original manifest node ID;
- `kind`, `label`, and `description` from the manifest;
- `scope`: `{kind, id, project_id}`;
- `authority`: `manifest`, `settings`, `hermes`, `otel`, or `provider`;
- `source`: `{ref, revision, sha256}`;
- `classification`: `public`, `internal`, `private`, or `secret`;
- `freshness`: `{observed_at, expires_at?}`;
- `capabilities`: manifest capabilities intersected with actor permissions;
- `ports`: `[{id, direction, schema_ref}]` where direction is `in` or `out`;
- `status`: `idle`, `queued`, `running`, `succeeded`, `failed`, `blocked`,
  `cancelled`, or `unavailable`;
- `settings_revision_ref`: optional immutable revision reference;
- `presentation`: `{group_id?, icon?, tone?}` with no executable styling;
- `extensions`: namespaced additive data only.

Every `edges[]` item has exactly:

- `id`: `project:<project_id>/tool:<tool_id>/edge:<edge_id>`;
- `source_id`: original manifest edge ID;
- `from`, `to`, `from_port?`, and `to_port?`;
- `kind`, `label?`, and `condition_ref?`;
- `authority`, `classification`, `source`, and `freshness`;
- `status`: `idle`, `active`, `succeeded`, `failed`, or `unavailable`;
- `presentation`: `{tone?, dashed?}`;
- `extensions`: namespaced additive data only.

`groups[]` contains `{id, label, parent_id?, order?}`. Layout coordinates,
zoom, collapsed groups, and selection are Frank UI preferences, not manifest
data and not Hermes state.

## Trace contract

Hermes and domain runtimes emit OpenTelemetry spans. The adapter projects the
authorized subset into `schema://frank.trace/v1` without creating a second
trace store.

```json
{
  "schema": "schema://frank.trace/v1",
  "trace_id": "32-lowercase-hex",
  "run_id": "opaque-run-id",
  "graph_id": "project:blockwise/tool:content-factory",
  "pipeline_revision": "immutable-revision",
  "settings_revision_id": "immutable-revision-id",
  "mode": "demo",
  "status": "succeeded",
  "started_at": "2026-08-14T00:00:00Z",
  "ended_at": "2026-08-14T00:00:01Z",
  "root_span_id": "16-lowercase-hex",
  "spans": [],
  "artifacts": [],
  "receipt_ref": "opaque-receipt-ref",
  "redactions": [],
  "extensions": {}
}
```

Every `spans[]` item contains `span_id`, `parent_span_id?`, `node_id?`, `name`,
`kind`, `status`, `started_at`, `ended_at?`, `duration_ms?`, `attributes`,
`events`, and `links`. Every event contains `name`, `occurred_at`, and redacted
`attributes`. Every artifact contains `id`, `kind`, `label`, `media_type`,
`sha256`, `size`, and an authorized opaque `ref`.

The following custom OpenTelemetry attributes are the stable correlation seam:

- `frank.project.id`
- `frank.tool.id`
- `frank.pipeline.id`
- `frank.pipeline.revision`
- `frank.graph.node.id`
- `frank.command.id`
- `frank.settings.revision.id`
- `frank.run.mode`
- `frank.receipt.ref`

Prompt bodies, instruction bodies, user content, tool arguments, tool results,
and model inputs/outputs are opt-in sensitive fields. They are absent by
default even when an upstream OpenTelemetry/GenAI instrumentation library can
capture them.

## Commands and editing

The workbench may construct but never execute
`schema://frank.hermes-command/v1` envelopes. A command contains exactly:

- `schema`, `command_id`, `issued_at`, `actor_ref`, and `idempotency_key`;
- `project_id`, `tool_id`, `pipeline_revision`, and `settings_revision_id`;
- `mode`: `validate`, `demo`, `run`, or `commit`;
- `target`: `{kind, id, settings_ref?}`;
- `input`: a validated payload or authorized opaque payload reference;
- `capability_ref` and `policy_ref`;
- `trace_context`: `{traceparent, tracestate?}`.

`demo` is sandboxed by default. `run` and `commit` require an explicit Hermes
capability and policy decision. Hermes returns ordered
`schema://frank.hermes-event/v1` envelopes with `event_id`, `command_id`,
`sequence`, `occurred_at`, `type`, `status`, `node_id?`, `trace_id?`,
`span_id?`, `summary?`, `artifacts[]`, `error?`, and `receipt_ref?`.

## Registration and migration

1. Domain Tool packages publish `schema://frank.tool-manifest/v1` plus their
   immutable settings, Hermes envelope, and OpenTelemetry contracts. They do
   not publish UI code.
2. Frank registers the one `tool-manifest` adapter and the one
   `graph-workbench` renderer.
3. Frank adds the `graph` view with host `slot-graph` and registers the
   `entity-graph` home widget.
4. The existing `trace` view and `slot-trace` mount `graph-workbench` with lens
   `run.trace`.
5. The existing `trace-view` registration becomes a v1 compatibility alias.
   Saved layouts continue to work; new layouts use `entity-graph`.
6. A domain package may add `entity-graph` to its default widget IDs only after
   `/api/capabilities` reports `frank.graph.v1`. Before that, keep the list
   empty so current Frank does not reject an unknown widget.
7. Opening a Tool home passes only `{kind: "tool", id: <tool_id>}`. Frank
   resolves the registered provider and renders the manifest; no domain route
   or screen is added.
8. Editing creates an immutable settings revision through Hermes, refreshes
   the graph revision, and preserves the previous revision for diff/rollback.
9. Validate/demo/run/commit actions send typed commands to Hermes. Progress is
   rendered from events/spans; maxGraph never invokes a Tool directly.

## Knowledge-library separation

The multimodal knowledge-library design does **not** change any field or schema
in `ToolManifestAdapter`, Tool manifests, settings revisions, Hermes envelopes,
or Tool traces.

A future knowledge provider may register a separate adapter ID such as
`knowledge-library` and project its authorized topology into the existing
`schema://frank.graph/v1` envelope. It reuses `graph-workbench`; it does not add
knowledge fields to domain Tool contracts and does not give Frank direct access
to a memory/vector database.

## Explicit do-not-rebuild boundaries

- No domain-specific graph or trace screens.
- No Cytoscape, React Flow, Rete, LiteGraph, or custom renderer beside maxGraph.
- No workflow scheduler, graph executor, agent loop, model selection, or tool
  invocation in Frank or maxGraph.
- No second Hermes profile, runtime, memory store, graph database, vector
  database, or trace store inside Frank.
- No direct browser access to Hermes state, provider databases, Hindsight,
  Phoenix, OpenTelemetry collectors, credentials, or private VPS paths.
- No prompt or instruction bodies embedded in manifests or graph snapshots.
- No arbitrary shell command, URL, code, HTML, or provider call accepted from
  a graph node.
- No mutation of an existing settings revision.
- No fabricated trace, cost, status, artifact, or connection state.

## Consequences

One renderer and one adapter seam cover every registered Tool without bespoke
UI. Domain packages stay declarative, Hermes remains authoritative, trace data
remains portable OpenTelemetry, and future topology/memory/knowledge providers
can reuse the same graph envelope without contaminating Tool contracts.

The implementation will require a small frontend build step to bundle
`@maxgraph/core`, plus Frank provider endpoints and redaction. Those are
implementation work and are intentionally outside this specification-only
commit.

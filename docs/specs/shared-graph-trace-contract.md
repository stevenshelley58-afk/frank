# Shared graph and trace contract

**Status:** Accepted contract; implementation pending; Erratum 1 applied

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

## Erratum 1: canonical Tool contracts

The first committed draft incorrectly described a second, richer
`schema://frank.tool-manifest/v1` shape. That schema is withdrawn and must not
be implemented. Existing domain packages remain canonical. Their checked-in
`manifest.json` files are not converted, wrapped, or regenerated.

`ToolManifestAdapter` accepts the existing flat
`schema://frank.tool-app-manifest/v1` contract through a pure normalization
layer. The only generated representation is the runtime
`schema://frank.graph/v1` response. It is a disposable projection, never a
second checked-in pipeline definition or a new source of truth.

The migration decision is therefore:

| Choice | Decision |
| --- | --- |
| Convert canonical `manifest.json` in place | **No** |
| Accept the existing schema through pure normalization | **Yes** |
| Generate another persisted/check-in manifest or pipeline | **No** |
| Generate an in-memory or rebuildable response/cache from the canonical manifest | **Yes**, only as `schema://frank.graph/v1` and never authoritative |

## Canonical schema identifiers

These identifiers are exact and case-sensitive.

| Schema ID | Owner | Purpose |
| --- | --- | --- |
| `schema://frank.tool-app-manifest/v1` | Domain Tool package | Canonical flat Tool identity, settings schema, and pipelines |
| `schema://frank.tool-app-settings/v1` | Domain Tool package/runtime | Settings schema and append-only scoped settings revisions |
| `schema://frank.tool-app-pipeline/v1` | Domain Tool package | Canonical pipeline with `{id, kind}` nodes and `{from, to}` edges |
| `schema://frank.tool-app-command/v1` | Hermes boundary | Requested validate, demo, run, or commit operation |
| `schema://frank.tool-app-event/v1` | Hermes boundary | Ordered command progress, result, failure, artifact, and receipt event |
| `schema://frank.tool-app-trace/v1` | Domain Tool/Hermes boundary | Trace declaration and authorized OpenTelemetry-style run projection |
| `schema://frank.tool-manifest-adapter/v1` | Frank | Adapter registration and compatibility declaration |
| `schema://frank.graph/v1` | Frank | Renderer-neutral graph snapshot |

Producers must reject an unsupported major version. Additive fields in a known
major version are ignored unless declared in `extensions`. A producer must not
silently reinterpret a field.

## Shared registration identifiers

These identifiers are reserved for the one shared implementation.

| Kind | ID | Status and use |
| --- | --- | --- |
| Full graph view | `graph` | New shared internal view ID opened from homes; not a rail item |
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

### Home widget manifest

After the accepted modular-home runtime lands on `main`, Dashboard may add this
exact built-in manifest to its shared catalog. It is not registered by a domain
Tool package.

```json
{
  "id": "entity-graph",
  "version": "1.0.0",
  "title": "Graph",
  "description": "Read-only entity topology, settings, and run traces from registered providers.",
  "surfaces": ["project", "tool", "agent", "service"],
  "default_size": "wide",
  "allowed_sizes": ["medium", "wide"],
  "provider": "frank.graph",
  "freshness": "on_demand",
  "accepts_connection": false,
  "multiple": false
}
```

Its home provider registration is `home_providers.register("entity-graph")`.
The provider returns the existing `schema://frank.widget-snapshot/v1` envelope
with only `graph_schema`, `graph_id`, `graph_revision`, `lens`, `node_count`,
`edge_count`, and `trace_ref` in `data`. The full graph is loaded from the
read-only graph endpoint below. A provider that has no registered manifest or
topology returns `setup_needed` or `unavailable`; it never extracts a graph
from source code or invents nodes.

### Read-only provider endpoints

The shared provider boundary owns exactly these graph reads:

| Method and path | Response | Rules |
| --- | --- | --- |
| `GET /api/graphs/<kind>/<entity_id>?lens=<lens>&settings_revision_id=<id>&trace_id=<id>` | `schema://frank.graph/v1` | `kind` is `project`, `tool`, `agent`, or `service`; IDs and lens are allowlisted; optional selectors are opaque and authorized |
| `GET /api/traces/<trace_id>` | `schema://frank.tool-app-trace/v1` | `trace_id` is a lowercase 32-hex W3C trace ID; response is the authorized redacted projection |

Allowed v1 lenses are `tool.pipeline`, `tool.settings`, `run.trace`,
`system.topology`, `project.dependencies`, and `release.receipts`. Unknown
lenses fail closed. Both endpoints are GET-only and never accept a filesystem
path, URL, query language, provider name, SQL, code, or shell command. The
browser talks only to Frank; Frank obtains authorized provider projections and
never exposes a provider database or collector directly.

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
    "schema://frank.tool-app-manifest/v1",
    "schema://frank.tool-app-settings/v1",
    "schema://frank.tool-app-command/v1",
    "schema://frank.tool-app-event/v1",
    "schema://frank.tool-app-trace/v1",
    "OTLP/1.0"
  ],
  "produces": [
    "schema://frank.graph/v1",
    "schema://frank.tool-app-command/v1"
  ],
  "surfaces": ["graph", "trace", "project", "tool", "agent", "service"],
  "renderer": "graph-workbench"
}
```

### Adapter input fields

The following JSON pointers are the complete v1 field set consumed by the
adapter. Fields not listed here remain domain-owned and are not interpreted by
Frank.

#### Tool manifest: `schema://frank.tool-app-manifest/v1`

The adapter consumes the existing flat manifest. It does not require or create
a nested `tool` or singular `pipeline` object.

| JSON pointer | Required by canonical contract | Adapter use |
| --- | --- | --- |
| `/schema` | yes | Exact `schema://frank.tool-app-manifest/v1` identifier |
| `/id` | yes | Reusable Tool identity |
| `/version` | yes | Semantic manifest version |
| `/name` | yes | Graph title |
| `/description` | yes | Graph description |
| `/scopes` | yes | Allowed `global`, `profile`, `project`, `workspace`, and/or `session` render/settings scopes |
| `/settings` | no; canonical default is an empty settings schema | Schema-backed editable settings definition |
| `/pipelines` | no; canonical default is `[]` | Canonical pipeline definitions in source order |
| `/capabilities` | no | Tool-level capability labels; never promoted to execution permission |
| `/connectors` | no | Display-only connector requirements |
| `/schedules` | no | Display-only Hermes-owned schedule declarations |
| `/thresholds` | no | Display-only validated thresholds |
| `/approval_gates` | no | Display-only approval declarations |
| `/hermes` | no | Allowed action/event declarations; not executable callbacks |
| `/trace` | no | `schema://frank.tool-app-trace/v1` declaration and event/attribute allowlists |

Other safe domain fields remain canonical but are ignored by adapter v1. The
adapter never copies ignored fields into `extensions` automatically.

Each `/pipelines/*` object uses the existing
`schema://frank.tool-app-pipeline/v1` contract:

- `schema` is required;
- `id` and `version` are optional metadata already used by some packages;
- `nodes` is a list whose items are exactly `{id, kind}`;
- `edges` is a list whose items are exactly `{from, to}`.

Normalization is deterministic and does not enrich the domain definition:

- a missing pipeline `id` becomes `pipeline-<zero-based-index>` in the runtime
  graph only;
- a missing pipeline `version` uses the manifest `version` in the runtime
  source metadata only;
- node `label` is the exact node `id`, not a generated humanized label;
- node `description` is absent, node capabilities are empty, and
  classification is `unspecified` unless a future canonical manifest major
  version adds those fields;
- entry nodes are derived as nodes with no incoming edge;
- an edge runtime ID is
  `edge:<zero-based-index>:<from>:<to>`, and its derived kind is `control`;
- source order is preserved; no node, edge, port, condition, group, or setting
  reference is invented.

#### Settings revision: `schema://frank.tool-app-settings/v1`

The manifest `/settings` object is the property schema. A selected runtime
settings revision uses the existing append-only record shape and contains
exactly `schema`, `scope`, `revision`, and `settings`. `scope` is `{kind}` for
global or `{kind, id}` for other declared scopes; `revision` is a non-negative
integer; `settings` is the validated JSON value.

Prompt, instruction, style, model-policy, and payload-policy values are Tool
settings properties only when declared by that Tool's canonical settings
schema. Frank does not impose a second common settings object. Authorized
prompt or instruction content is resolved through Hermes; the manifest and
graph projection contain references/versions, not secret content. A successful
save appends a new scoped settings revision and never mutates an existing one.

#### Reusable Tools, project context, and digests

There is no `tool.project_id`. A Tool is reusable independently of a project.
The adapter receives a separate runtime `render_scope` matching one of the
manifest's declared scopes. A project rendering uses
`{"kind":"project","id":"<project-id>"}`. A global rendering has no project
ID. The resulting `graph_id` is `tool:<tool-id>` for global context or
`project:<project-id>/tool:<tool-id>` for project context. The same manifest can
therefore produce contextual graph instances without being copied or edited.

There is no `tool.sha256` field. The provider computes `manifest_sha256`
out-of-band as SHA-256 over the UTF-8 RFC 8785 JSON Canonicalization Scheme
representation of the complete canonical manifest object. Whitespace and
object-key order therefore do not change the digest. Because the digest is not
inside `manifest.json`, there is no self-field to exclude. A future signature
or digest belongs in a transport wrapper or companion record, not in the v1
manifest. The runtime graph may expose the computed value as
`source.sha256`; it is derived metadata, not domain-authored pipeline data.

#### Runtime inputs

The optional runtime input set is:

- `render_scope`: one canonical scope record selected outside the manifest;
- `settings_revision`: one optional `schema://frank.tool-app-settings/v1` record;
- `events[]`: ordered `schema://frank.tool-app-event/v1` envelopes;
- `trace`: an optional `schema://frank.tool-app-trace/v1` run projection;
- `spans[]`: OTLP span records using W3C trace/span identifiers;
- `permissions[]`: effective Frank capabilities for the current actor;
- `selection`: `{node_id?, edge_id?, trace_id?, span_id?}`;
- `lens`: `tool.pipeline`, `tool.settings`, or `run.trace`;
- `as_of`: RFC 3339 freshness boundary.

Absent optional inputs produce an explicit empty/unavailable state. The adapter
does not invent settings, events, traces, costs, or status.

### Adapter output: `schema://frank.graph/v1`

This is a disposable tool-renderer projection. Its `sha256:`
`graph_revision` is a content digest for this response only; it is deliberately
distinct from the canonical ControlGraphStore `g_<64 hex>` revision used by
estate maps and release evidence. It must never be promoted as control-graph
authority.

```json
{
  "schema": "schema://frank.graph/v1",
  "graph_id": "project:blockwise/tool:content-factory",
  "graph_revision": "sha256:...",
  "generated_at": "2026-08-14T00:00:00Z",
  "provider": {"id": "tool-manifest", "version": "1.0.0", "authority": "manifest"},
  "subject": {"kind": "tool", "id": "content-factory"},
  "scope": {"kind": "project", "id": "blockwise"},
  "lens": "tool.pipeline",
  "capabilities": ["inspect"],
  "nodes": [],
  "edges": [],
  "groups": [],
  "trace_ref": null,
  "extensions": {}
}
```

Every `nodes[]` item has exactly:

- `id`: `<graph_id>/pipeline:<pipeline_id>/node:<node_id>`;
- `source_id`: original manifest node ID;
- `kind` from the manifest and `label` equal to the original node ID;
- `scope`: the separately supplied `render_scope`;
- `authority`: `manifest`, `settings`, `hermes`, `otel`, or `provider`;
- `source`: `{manifest_id, manifest_version, pipeline_id, pipeline_version, sha256}`;
- `classification`: `unspecified`, `public`, `internal`, `private`, or `secret`;
- `freshness`: `{observed_at, expires_at?}`;
- `capabilities`: empty for v1 manifest nodes, then intersected with actor
  permissions for runtime overlays;
- `ports`: empty for v1 manifest nodes;
- `status`: `declared`, `queued`, `running`, `succeeded`, `failed`, `blocked`,
  `cancelled`, or `unavailable`;
- `settings_revision_ref`: optional immutable revision reference;
- `presentation`: `{group_id?, icon?, tone?}` with no executable styling;
- `extensions`: namespaced additive data only.

Every `edges[]` item has exactly:

- `id`: `<graph_id>/pipeline:<pipeline_id>/edge:<index>:<from>:<to>`;
- `source_id`: the zero-based canonical edge index;
- `from` and `to` mapped to normalized node IDs;
- `kind`: derived `control`; no label, ports, or condition reference in v1;
- `authority`, `classification`, `source`, and `freshness`;
- `status`: `declared`, `active`, `succeeded`, `failed`, or `unavailable`;
- `presentation`: `{tone?, dashed?}`;
- `extensions`: namespaced additive data only.

`groups[]` contains `{id, label, parent_id?, order?}`. Layout coordinates,
zoom, collapsed groups, and selection are Frank UI preferences, not manifest
data and not Hermes state.

## Trace contract

The canonical manifest `/trace` object remains
`schema://frank.tool-app-trace/v1`. It declares the Tool's instrumentation
style, span prefix, allowed attributes/fields, and allowed event kinds. It is
not replaced by a Frank-specific trace declaration.

Hermes/domain runtimes emit OpenTelemetry spans and
`schema://frank.tool-app-event/v1` envelopes. The adapter uses the Tool's trace
allowlist to produce an in-memory run overlay for `schema://frank.graph/v1`.
The read-only trace endpoint returns the canonical authorized
`schema://frank.tool-app-trace/v1` run record supplied by the Hermes boundary;
Frank does not persist or define a second trace envelope. If no canonical run
record exists, the endpoint returns unavailable rather than synthesizing one
from chat text.

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
`schema://frank.tool-app-command/v1` envelopes. The adapter does not introduce
fields into that canonical command contract. It supplies the Tool ID, selected
runtime scope, selected settings revision, declared Hermes action, validated
input, and trace context only through fields accepted by the domain validator.

`demo` is sandboxed by default. `run` and `commit` require an explicit Hermes
capability and policy decision. Hermes returns ordered
`schema://frank.tool-app-event/v1` envelopes. The graph workbench renders only
validated fields declared by the canonical event and trace allowlists.

## Registration and migration

1. Domain Tool packages publish `schema://frank.tool-app-manifest/v1` plus their
   immutable settings, Hermes envelope, and OpenTelemetry contracts. They do
   not publish UI code.
2. Frank registers the one `tool-manifest` adapter and the one
   `graph-workbench` renderer.
3. Frank adds the internal `graph` view with host `slot-graph`, the two
   read-only provider endpoints above, and the exact `entity-graph` home widget
   manifest. The live rail/menu is unchanged.
4. The existing `trace` view and `slot-trace` mount `graph-workbench` with lens
   `run.trace`.
5. The existing `trace-view` registration becomes a v1 compatibility alias.
   Saved layouts continue to work; new layouts use `entity-graph`.
6. A domain package may add `entity-graph` to its default widget IDs only after
   the shared `GET /api/widgets` catalog contains the exact manifest above.
   Before that, keep the list empty so current Frank does not reject an unknown
   widget.
7. Opening a Tool home passes only `{kind: "tool", id: <tool_id>}`. Frank
   resolves the registered provider and renders the manifest; no domain route
   or screen is added.
8. Editing creates an immutable settings revision through Hermes, refreshes
   the graph revision, and preserves the previous revision for diff/rollback.
9. Validate/demo/run/commit actions send typed commands to Hermes. Progress is
   rendered from events/spans; maxGraph never invokes a Tool directly.

## Memory separation

Project memory is Hindsight inside Hermes and is governed by
[`../MEMORY.md`](../MEMORY.md). It does not add fields or adapters to
`ToolManifestAdapter`, Tool manifests, settings revisions, Hermes envelopes,
Tool traces, or the graph workbench. Frank never projects the provider's raw
state into a graph response.

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
UI. Domain packages stay declarative, Hermes remains authoritative, and trace
data remains portable OpenTelemetry without contaminating Tool contracts.

The implementation will require a small frontend build step to bundle
`@maxgraph/core`, plus Frank provider endpoints and redaction. Those are
implementation work and are intentionally outside this specification-only
commit.

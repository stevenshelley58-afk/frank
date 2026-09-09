# Frank tool-app platform contract

This is the shared mini-app contract for Frank Window. A deployed tool app is a
directory at `apps/window/tools/<id>/` containing a `manifest.json` and its
tool-owned, declarative `home.json`. Discovery reads JSON only; it never imports
or executes an app. The tool manifest is versioned with
`schema://frank.tool-app-manifest/v1` and semantic `version` values.

The home manifest is intentionally separate from the tool manifest and must
contain exactly these fields: `{id, name, kind, blurb, capabilities[],
default_widget_ids[], connection_capabilities[]}`. JSON object order is not
significant. `kind` is exactly `tool`.
It contains no callbacks, executable code, credentials, provider calls, or
widget implementations. The shared dashboard runtime validates and registers
it, renders only known widget IDs, and fails closed. Each real domain tool
package owns its own `home.json`; this platform package contains only the
validator and inline contract tests, not a runtime tool.

The manifest describes a displayable app: supported scopes, a JSON-Schema-like
settings object, capabilities, connectors, schedules, thresholds,
approval-gates, and declarative pipelines. Pipeline nodes and edges are data;
cycles, duplicate IDs, unknown endpoints, unsafe IDs, HTML, and secret-like
values are rejected. Pipeline nodes and edges are exact data-only shapes
(`{id, kind}` and `{from, to}`). Tool manifests and settings select existing
Connections with non-secret `connection_id` and capability lists only; they do
not contain credentials, vault references, provider identifiers, secrets,
tokens, passwords, API keys, or connection/connector refs.

Settings are stored as immutable, append-only scoped revisions. Updates require
the current revision, making concurrent edits explicit. Valid scopes are
`global`, `profile`, `project`, `workspace`, and `session`; non-global scopes
require a safe identifier. An app declares which of these it accepts.

The Hermes boundary uses versioned command, event, and trace envelopes. Frank
may construct and forward a command and render ordered events, but Hermes
selects models, applies policy, executes tools, manages connectors and
approvals, and owns memory. Frank does not implement an agent loop or duplicate
Hermes state.

## Graph and inspection boundaries

Domain Tools own and version their manifests, pipeline nodes and edges,
immutable settings revisions, and Hermes envelopes. The implemented
`normalize_manifest(...)` function in `apps/window/graph/contract.py`
validates and normalizes those declarations into disposable
`schema://frank.graph/v1` read models; `TOOL_MANIFEST_ADAPTER` in
`graph/blueprint.py` publishes the `tool-manifest` registration. The
normalized graph is never a canonical Tool definition and the normalizer never
executes a Tool.

Graph views use the renderer that fits their bounded, read-only projection:
maxGraph for the workbench and diagram editing surface, G6 and Sigma for
network exploration, and Mermaid for compact declarative diagrams. None of
these renderers executes a Tool or becomes a source of graph truth. CodeMirror
6 is reserved for prompt/instruction inspection, and vanilla-jsoneditor plus
Ajv is reserved for schema-backed payload editing. The Window already pins
`jsonschema` and `rfc8785` for schema validation and canonical graph/manifest
digests. Existing trace, slot-trace, and trace-view hooks remain the
interchange/presentation integration points; generic event envelopes do not
replace them. OTel GenAI-style spans/events are the intended trace interchange
mapping.

Example manifest shape:

```json
{
  "schema": "schema://frank.tool-app-manifest/v1",
  "id": "weekly-report",
  "version": "1.0.0",
  "name": "Weekly report",
  "description": "Review a project report.",
  "scopes": ["project"],
  "settings": {"schema": "schema://frank.tool-app-settings/v1", "properties": {}},
  "pipelines": [{"schema": "schema://frank.tool-app-pipeline/v1", "nodes": [], "edges": []}],
  "capabilities": [], "connectors": [], "schedules": [], "thresholds": [], "approval_gates": []
}
```

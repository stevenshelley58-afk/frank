# Frank tool-app platform contract

This is the shared mini-app contract for Frank Window. A deployed tool app is a
directory at `apps/window/tools/<id>/` containing a `manifest.json` and its
tool-owned, declarative `home.json`. Discovery reads JSON only; it never imports
or executes an app. The tool manifest is versioned with
`schema://frank.tool-app-manifest/v1` and semantic `version` values.

The home manifest is intentionally separate from the tool manifest and must
contain exactly these fields: `{id, name, kind, blurb, capabilities[],
default_widget_ids[], connection_capabilities[]}`. `kind` is exactly `tool`.
It contains no callbacks, executable code, credentials, provider calls, or
widget implementations. The shared dashboard runtime validates and registers
it, renders only known widget IDs, and fails closed. The reference package in
this change owns `apps/window/tool_apps/weekly_report/home.json` with that
exact shape.

The manifest describes a displayable app: supported scopes, a JSON-Schema-like
settings object, capabilities, connectors, schedules, thresholds,
approval-gates, and declarative pipelines. Pipeline nodes and edges are data;
cycles, duplicate IDs, unknown endpoints, unsafe IDs, HTML, and secret-like
values are rejected. Credentials are metadata only and must be strict vault
references such as `openbao://frank/connections/main`.

Settings are stored as immutable, append-only scoped revisions. Updates require
the current revision, making concurrent edits explicit. Valid scopes are
`global`, `profile`, `project`, `workspace`, and `session`; non-global scopes
require a safe identifier. An app declares which of these it accepts.

The Hermes boundary uses versioned command, event, and trace envelopes. Frank
may construct and forward a command and render ordered events, but Hermes
selects models, applies policy, executes tools, manages connectors and
approvals, and owns memory. Frank does not implement an agent loop or duplicate
Hermes state.

## Reuse choices

The contract follows JSON Schema conventions (`schema`, `type`, `properties`,
and versioned URIs) without adding a runtime dependency to the lightweight
Window. Trace/event fields borrow the portable OpenTelemetry shape—stable
request identity, sequence, timestamp, status, and structured data—without
claiming to be an OTLP exporter. A future adapter can map these envelopes to
OpenTelemetry or Hermes transport types without changing the manifest.

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

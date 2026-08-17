# Graph assembly

Frank exposes one read-only graph widget over two explicit projections:
authorized Tool manifests that declare `global` scope, and the Hermes-owned
project knowledge projection. Hermes remains the sole brain for reasoning,
tools, memory, and execution.

At startup, `server.py` discovers and validates canonical Tool manifests via
`tool_apps.discover_tool_apps`, then gives the graph provider an immutable
authorized map. Requests never scan files or access Hermes state, databases,
collectors, credentials, or source trees. The provider normalizes the selected
manifest through `schema://frank.graph/v1` and fails closed for unsupported
entities, scopes, selectors, or unsafe payloads. Project homes use the
separate `schema://frank.graph/v2` / `knowledge.combined` adapter. The v2
client is configured with the exact dedicated projection endpoint and sends
the scoped `project=project/<id>` query; it never rewrites that endpoint to a
Frank route.

`graph.blueprint.registration_blueprint()` describes the live capability,
adapter, and `entity-graph` widget. The widget is registered in the shared
home catalog and mounts the bundled workbench from the already-returned,
validated snapshot; it does not perform a second fetch. It is presented on
Tool homes for v1 and configured project homes for v2. Domain default widget
IDs remain unchanged.

The existing trace view is untouched. Current Tool event/trace records do not
provide an approved W3C trace identity, so Frank does not advertise a graph
trace endpoint or reinterpret those records.

Duplicate canonical pipeline IDs remain valid. The adapter preserves source
pipeline identity and uses a zero-based index only in runtime graph paths and
group IDs. OTLP records naming an ambiguous duplicated source pipeline fail
closed.

The isolated harness and bundled assets are test/build artifacts; they are not
production data sources.

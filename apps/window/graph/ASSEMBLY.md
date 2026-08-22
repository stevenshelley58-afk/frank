# Graph assembly

Frank's graph workbench is a read-only visualisation of authorised Tool
pipeline manifests. It is not an agent memory system, knowledge database, or
execution engine.

At startup, `server.py` discovers canonical Tool manifests through
`tool_apps.discover_tool_apps`, gives the provider an immutable authorised map,
and normalises responses through `schema://frank.graph/v1`. Unsupported
entities, scopes, selectors, or unsafe payloads fail closed.

Project/workspace-scoped Tool views pass their authorized render context as
the exact `scope_kind` and `scope_id` graph selectors. The provider validates
the declared manifest scope and binds the returned graph identity to it; the
selectors do not grant access to state, settings, traces, or filesystem paths.

The workbench is available only on Tool homes. It has no project-memory
surface and is independent of Hermes memory.

The existing trace view remains separate. Tool event and trace records do not
gain graph semantics unless an explicit versioned contract adds them later.

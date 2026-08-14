# Final-main assembly notes

This lane is intentionally not production-registered. It is based on
`origin/codex/dashboard-runtime-v2` at `bf36236e` and must be rebased onto the
final combined `main` before browser acceptance.

The exact deferred patch points are:

1. `apps/window/server.py`: import `graph.provider.create_blueprint` and
   register the returned blueprint after the authorized graph callback is
   wired. The callback must read only authorized projections;
   do not add a filesystem, Hermes-state, database, collector, or source
   scanner.
2. Add the exact `graph.blueprint.WIDGET_MANIFEST` to the shared catalog and
   implement its `frank.graph` read-only summary provider only after the final
   `/api/widgets` runtime supports the accepted catalog shape. The isolated
   `registration_blueprint()` intentionally returns no widget until then.
3. `apps/window/home_defaults.py:189`
   (`register_entity_profile(manifest)`): register `entity-graph` only after
   `frank.graph.v1` is present in the catalog. Until then, keep every domain
   profile's default widget IDs unchanged.
4. Register one `graph-workbench` mount for the internal `graph` view. Do not
   add a domain renderer.
5. Keep the existing trace view untouched. Current Tool event/trace v1 records
   are request-correlated and have no W3C trace identity. Do not mount them in
   `run.trace`, alias `trace-view`, or advertise a trace endpoint until an
   approved versioned correlation contract exists.

The checked-in `isolated-harness.html` is test-only. Browser tests copy it and
the built runtime assets into a disposable temporary web root; the harness is
never written into `web/graph`. The production build cleans that directory
before emitting runtime assets, and `.dockerignore` excludes
the harness from both Docker stages. A release image must contain the bundled
JavaScript, bundled CSS, referenced maxGraph images, and the Apache-2.0 license,
with no harness or test fixture content anywhere under `/app` or `/web`.

Duplicate canonical pipeline IDs remain valid. The adapter preserves the exact
source pipeline ID/version and adds the zero-based source index only to the
runtime graph path and group ID. OTLP records that name a duplicated source
pipeline ID fail closed because that correlation is ambiguous.

Reserved current-assembly records are exported by `graph.blueprint` as
`RESERVED_VIEW_REGISTRATIONS` and `WIDGET_MANIFEST`.
`TOOL_MANIFEST_ADAPTER` truthfully produces graphs only; Frank does not yet
construct typed Tool commands. `CAPABILITIES` stays empty until every live
dependency is registered. The conflicting surface for later assembly is the
shared home/catalog/registry/runtime set above, especially Dashboard and
Connections changes. This lane deliberately leaves those files byte for byte
untouched.

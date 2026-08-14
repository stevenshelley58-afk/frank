# Final-main assembly notes

This lane is intentionally not production-registered. It is based on
`origin/codex/dashboard-runtime-v2` at `bf36236e` and must be rebased onto the
final combined `main` before browser acceptance.

The exact deferred patch points are:

1. `apps/window/server.py`: import `graph.provider.create_blueprint` and
   register the returned blueprint after the authorized provider callbacks are
   wired. The callbacks must read only redacted provider projections; do not
   add a filesystem, Hermes-state, database, collector, or source scanner.
2. `apps/window/home_platform.py:79` (`BUILTIN_WIDGETS`) and
   `apps/window/home_platform.py:370` (`_all_widgets`): add the copied
   `graph.blueprint.WIDGET_MANIFEST` to the shared catalog only after the final
   `/api/widgets` runtime supports the accepted catalog shape.
3. `apps/window/home_defaults.py:189`
   (`register_entity_profile(manifest)`): register `entity-graph` only after
   `frank.graph.v1` is present in the catalog. Until then, keep every domain
   profile's default widget IDs unchanged.
4. `apps/window/web/js/registry.js:20` (`define`),
   `apps/window/web/js/widgets.js:181` (`trace-view`), and the final shared
   view/runtime seams: register one `graph-workbench` mount and make the
   existing `trace-view` a compatibility alias. Do not add a domain renderer.
5. `apps/window/web/index.html:297` (`slot-trace`) and the final view
   navigation in `apps/window/web/js/app.js:8`/`:56`: add internal `graph` with
   `slot-graph`, and mount `graph-workbench` in both graph and trace lenses.

The expected assembly records are exported by `graph.blueprint`:
`CAPABILITIES`, `VIEW_REGISTRATIONS`, `WIDGET_MANIFEST`,
`TOOL_MANIFEST_ADAPTER`, and `ALIASES`. The conflicting surface for later
assembly is the shared home/catalog/registry/runtime set above, especially the
dashboard+Connections changes in `home_defaults.py`, `home_platform.py`, and
their frontend consumers. This lane deliberately leaves those files byte for
byte untouched.

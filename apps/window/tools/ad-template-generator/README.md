# Ad Template Generator tool package

This is the Frank-side contract for the Ad Template Generator. Frank may
display tool status, trace records, receipts, and immutable releases. Hermes
remains the sole owner of reasoning, model selection, provider calls, skills,
memory, execution, and durable state.

## Non-negotiable flow

`source → extract → clone → QA → native-pixel human approval → immutable,
source-free release`

The finished raster is the release authority. A release must not contain the
private source reference or source bytes, and no release is eligible before a
human has reviewed the output at native pixel size. QA correction is bounded by
the request's retry budget (0 or 1); a persistent failure is quarantined.

The request packet and trace contract record prompt refs/versions, project and
style packs, model policy, placements, export targets, provider attempts, cost,
hashes, evidence, and receipts. The package contains no provider SDK, image
engine, Blockwise core type, or Frank-to-Blockwise generation dependency.

## Reuse and integration seam

The canonical generator remains in Blockwise/Hermes. This package references
the existing implementation lineage rather than copying it:

- `1c91bda6` — clone-only creation path.
- `dcaaf47a` — local subscription execution adapter.
- `0cd587b4` — quality-locked durable reference cloning.

Hermes should route the kebab-safe domain actions and event kinds in
`manifest.json` through the shared Tool adapter. Frank can consume the declared
health state and existing shared Tools/Trace/Releases hooks when those surfaces
are next extended; this change intentionally does not declare a bespoke widget.

The named pipeline in `manifest.json` is the single source for typed graph
nodes and edges. `contract.py` loads that pipeline and validates it; it does
not duplicate the graph. The manifest does not declare a renderer, editor,
widget implementation, execution store, or settings store. It preserves the
existing Trace/slot-trace/trace-view hooks.

The Blockwise pack preserves real-estate goals and Meta lead-form requirements
without making them core generator types.

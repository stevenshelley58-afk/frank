# Content Factory tool package

This is a reusable, project-neutral contract package for Frank to display and
forward Content Factory work to Hermes. It has no worker, model client,
scheduler, queue claimer, publisher, credential store, or UI implementation.

`home.json` is the exact seven-field, non-executable home manifest
owned by this tool. The shared dashboard runtime registers it and renders only
known widget IDs. `manifest.json` is the versioned tool-app contract;
`blockwise-pack.json` adapts the current Blockwise content-engine skills and
prompt references without making them core defaults.

The fixed graph is research → brief → draft → edit → format/SEO/media, then
parallel channel branches (web, email, social, ads, instant forms) →
compliance → human approval → immutable release. Hermes owns scheduling,
execution, model selection, persistence, tools, secrets, and publication.
Completed public releases require a passing QA receipt, human approval,
provenance/checksums, sanitization receipts, and an immutable release hash.
Structured artifact and release hashes use SHA-256 over RFC 8785 canonical
JSON; the release hash is computed before the `release_hash` field is added.
`release.schema.json` is the closed machine-readable public contract, and
`fixtures/content-release-v1.json` is the golden producer-consumer payload.

The pack maps the current Blockwise implementation in
`hermes/tools/research-runtime/bin/content-engine.mjs`,
`src/lib/content-engine/{contracts.ts,queue.ts}`, and `hermes/skills`.
Shared image/page/ad skills are listed as
non-blog consumers; they remain Hermes-owned and are not reimplemented here.
The Blockwise source remains protected until those execution paths are deployed
and verified under the approved central Hermes owner.

Graph data projects through `ToolManifestAdapter` to
`schema://frank.graph/v1`. The shared renderer is maxGraph (Apache-2.0);
CodeMirror 6 is the prompt/instruction inspector and vanilla-jsoneditor + Ajv
is the schema-backed payload editor. This package owns/version-controls graph
data, immutable settings revisions, and Hermes envelopes only; it does not add
a graph UI, graph execution, or a tool-specific settings store. OTel
GenAI-style spans/events remain the trace interchange, including the existing
trace, slot-trace, and trace-view hooks.

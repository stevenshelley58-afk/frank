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

## Implemented Hermes runtime contract (Blog Studio, tool id `content-factory`)

Hermes implements this package's lifecycle as a durable tool run. The runtime
contract below is what Frank's `/blog-studio` surface and the Hermes
`skills/blog-studio` skill both rely on; it is pinned by
`contract-checksums.json`.

- Stages (fixed order): `source → research → brief → draft → edit → package →
  qa → human-approval → release`.
- Closed action set: `run, cancel, resume, rerun, approve, request_changes,
  reject, quarantine, withdraw`.
- Run statuses: `queued, running, blocked, waiting_review, quarantined,
  completed, failed, rejected, cancelling, cancelled`. `waiting_review` is the
  human gate; `quarantined` sets a run aside without discarding it.
- Event allowlist (exactly 28 kinds): `command.accepted, command.queued,
  command.cancel-requested, run.recovered, run.interrupted, run.failed,
  run.cancelled, run.approved, run.rejected, run.quarantined, stage.started,
  stage.completed, checkpoint.invalidated, rerun.queued, source.accepted,
  research.evidence, brief.ready, draft.ready, edit.ready, package.pinned,
  qa.passed, qa.failed, review.requested, changes.requested,
  release.published, release.withdrawn, tool.started, tool.completed`. Other
  kinds are rejected, never projected.
- Stage tool isolation: `research` may use only `web_search` and
  `web_extract`; `source` and every other model stage have no tools.
- Run inputs are closed: optional `topic` (≤2000 chars), `direction`
  (≤2000 chars), and 1–5 source documents (`.md`, `.markdown`, `.txt`,
  ≤1 MB each); at least one is required.
- Deterministic QA is computed only from stored artifact bytes: package
  manifest re-verification, title heading, word bounds (150–8000), unsafe
  markup rejection, and citation URLs must match persisted research evidence.
- Release pinning: on QA pass the run enters `waiting_review` with a package
  manifest (per-file sha256 + package digest). Approval requires the exact
  reviewed digest and releases exactly those bytes atomically. Release and
  withdrawal are idempotent; withdrawal records a public tombstone.
- Public artifact projection: `final.md`, `draft.md`, `manifest.json`
  (package manifest), and `release.json` (release receipt). Sources, state,
  and staging are never served.

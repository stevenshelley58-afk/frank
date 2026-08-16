# Ad Intelligence (Ad Radar)

Ad Radar is a reusable tool package for discovering and comparing public advertising
creative. It is a contract and policy package, not a scraper. Hermes owns execution;
adapters can later connect approved browser automation, CDP, OpenTelemetry, and provider
systems without changing the package's data boundaries.

## Design

- The project-neutral manifest controls taxonomy, sources, cadence, classification prompt
  reference/model policy, media QA, thresholds, retention, and approval.
- Every run follows the fixed graph: `discover -> resolve -> capture -> normalize ->
  classify -> media-qa -> publish`.
- Retryable failures use bounded exponential backoff. Non-retryable, policy, schema, and
  repeated failures are quarantined with a receipt; publication never silently skips them.
- Traces use span-like records with model, cost, evidence, and receipt references. The
  OpenTelemetry adapter is intentionally optional.
- Public exports are structural allowlists: copy, observation, media, and classification
  are typed records with no arbitrary nested dictionaries, raw payload slot, contact or
  outreach fields. HTML and contact-field variants are rejected before serialization.
  Public classification exposes only sanitized label, confidence, receipt refs, and
  provenance refs; prompt refs, prompt versions, models, and rationale remain private
  execution metadata in traces.
- `build_release` wraps that export in one closed immutable release. Its project scope
  must match the export project. It carries one positive integer settings revision and
  one settings ref, non-empty provenance and trace refs, a timestamped passing QA
  receipt, and exact timestamped passing PII and secret scan receipts. The old boolean
  claims and ambiguous settings/receipt arrays are not part of this contract.
- `consumer_compatibility` is exactly `["ad-intelligence-public-v1"]`. Release and
  observation timestamps are timezone-bearing ISO-8601 values; observations cannot
  run backwards or occur after export generation, and release cannot predate export.
- The complete release envelope is recursively checked for PII-like contact values,
  secrets, markup, and private vault/filesystem schemes before publication.
- Both hashes use SHA-256 over RFC 8785 canonical JSON. The whole-release hash
  excludes only its own `release_hash` field.
- Machine-readable contracts live in `schemas/public-export.schema.json` and
  `schemas/release.schema.json`; both close every object with
  `additionalProperties: false`. `fixtures/ad-radar-release-v1.json` is the golden
  producer-consumer fixture and includes the expected public checksum and release hash.
- Browser access is expressed by an adapter boundary. Prefer Playwright/CDP-compatible
  adapters for browser work; do not bake a provider SDK into this package.
- Domain Tools own/version manifests, declarative nodes/edges, immutable settings
  revisions, and allowlisted Hermes actions/events. The shared Tool contract owns
  command/event envelopes and its graph lane owns projection to `schema://frank.graph/v1`;
  maxGraph (Apache-2.0) is the sole renderer. CodeMirror 6
  is the prompt/instruction inspector, and vanilla-jsoneditor + Ajv is reserved for
  schema-backed payload editing.
- OTel GenAI-style spans/events are trace interchange. Existing Frank
  `trace`/`slot-trace`/`trace-view` hooks remain shared-runtime concerns; this package
  adds no graph UI, graph execution, or Tool-specific settings store.

Open-source make-vs-use guidance: use Playwright and its CDP connection for browser
control, OpenTelemetry APIs/exporters for traces, and a small schema/validation library
only if the host already standardizes on one. Build the orchestration, policy, redaction,
quarantine, and public export contract here because those are product-specific boundaries.

See `manifest.json`, `packs/blockwise-real-estate.json`, and `migration_map.md`.

`manifest.json` follows the shared Tool contract shape conceptually: versioned tool-app
schema, scoped settings, declarative pipeline nodes/edges, capabilities, schedules,
thresholds, approval gates, Hermes action/event allowlists, and OTel trace metadata.
`home.json` is the separate exact seven-field
non-executable dashboard manifest.

There is no bespoke graph surface or widget binding here. The shared graph owner uses
maxGraph (Apache-2.0) for rendering; the empty `default_widget_ids` is intentional until
the shared runtime assigns known widgets.

The pipeline contract is the sole owner of nodes and edges. The shared graph lane may
reference the pipeline ID for projection, but this package does not duplicate graph data
or declare renderer/editor choices.

## Reuse boundary from Blockwise

The existing Blockwise `hermes/` source was inspected before finalizing. These
components are transitional source implementations to adapt and deploy under the
approved central Hermes runtime before Blockwise removal:

| Existing component | Pipeline responsibility | Boundary decision |
| --- | --- | --- |
| `tools/meta-library-capture/bin/capture.mjs` | discover/resolve/capture | adapt to central Hermes; its structured outcome is an adapter input |
| `tools/research-runtime/bin/ad-classifier.mjs` | classify and image assessment | adapt to central Hermes; model/provider policy stays with Hermes |
| `tools/research-runtime/bin/ad-radar-accuracy-audit.mjs` | quality/health evidence | adapt to central Hermes and map to health/trace receipts |
| `tools/research-runtime/bin/media-quality-backfill.mjs` | media QA maintenance | adapt to central Hermes; do not reimplement it in Frank |
| `tools/research-runtime/bin/migrate-raw-evidence.mjs` | evidence retention/migration | adapt to central Hermes; Frank never handles credentials or storage |
| `tools/research-runtime/bin/customer-read-model-publisher.mjs` | optional customer projection | adapt to central Hermes and keep it out of the public creative export |

Copied: none. Wrapped: only the provider-neutral `BrowserAdapter`,
`TelemetryAdapter`, and `HermesAdapter` interfaces. Intentionally not moved: scraper
logic, OpenRouter/Supabase access, raw evidence storage, OCR/media backfills, and the
customer projection. This avoids a second scraper or a second customer data plane.
The Blockwise copies remain protected until the central Hermes runtime and database
owner are deployed, restart-tested, and accepted; only then may D2 remove them.

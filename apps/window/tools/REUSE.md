# Reuse and data-boundary notes

This isolated lane reviewed the requested Blockwise sources and keeps reuse at the contract level. No Blockwise code is imported or copied into Frank.

## Reusable concerns

- `C:\Dev\Blockwise\scripts\research\discover-agents-missing-email.mjs` provides the missing-contact discovery shape: paginated records, a count/sample report, and agency context.
- `C:\Dev\Blockwise\scripts\research\enrich-agent-emails-exa.mjs` provides reusable enrichment ideas: source URL/title evidence, candidate extraction, junk/data-broker filtering, confidence scoring, reasons, dry-run/resume behavior, and a minimum score gate.
- `C:\Dev\Blockwise\scripts\research\cleanup-enrichment-v2.mjs` and `C:\Dev\Blockwise\scripts\research\cleanup-foreign-tld-emails.mjs` provide cleanup/reversal semantics. MOVE/ADAPT their evidence-preserving cleanup into Prospect Discovery; do not move customer records.
- `C:\Dev\Blockwise\scripts\research\verify-agent-email-enrichment.mjs` provides verification/reporting semantics for accepted and rejected enrichment evidence. MOVE/ADAPT its evidence checks into Prospect Discovery.
- `C:\Dev\Blockwise\scripts\research\enrichment-stats.mjs` provides aggregate progress/statistics semantics, including source-domain summaries and reverted-cleanup counts. MOVE/ADAPT its reporting shape into Prospect Discovery.
- `C:\Dev\Blockwise\scripts\research\sync-demirs-wa-licence-register.mjs`, `C:\Dev\Blockwise\scripts\research\reconcile-exa-wa-roster-sources.mjs`, and `C:\Dev\Blockwise\scripts\research\seed-exa-wa-roster-sources.mjs` provide source synchronization, reconciliation, and seed/reference semantics. MOVE/ADAPT only the public-source evidence aspects into Prospect Discovery.
- `C:\Dev\Blockwise\src\lib\operator\email-service.ts` provides operator-mailbox concerns that may be adapted into Mail only after customer importers are separated: normalized addresses/recipients, mailbox scoping, thread-safe reply subjects, and paginated received-message summaries/details.

The canonical source for this review is `/projects/blockwise` at `ae89ca5`.

## Explicit exclusions

Blockwise customer transaction and lead-lifecycle mail remains Blockwise-owned. Keep `C:\Dev\Blockwise\src\lib\email\resend-client.ts` and `C:\Dev\Blockwise\src\lib\email\lead-lifecycle.ts` in Blockwise; Frank does not import their customer/lead records, campaign state, transaction state, or sender implementation. The Mail package is provider-neutral and read/sync/receipt oriented; Outreach owns policy lifecycle and delivery requests, not provider execution.

Prospect records never enter Ad Intelligence evidence or public exports. Ad Intelligence is represented only by a stable subject reference and cannot carry PII. Scraped availability is not consent, and public source evidence is not legal-basis evidence.

## Shared graph boundary

Each tool owns and versions declarative manifest nodes/edges, immutable settings revisions, and Hermes envelopes only. The shared `ToolManifestAdapter` projects them through `schema://frank.graph/v1`; maxGraph (Apache-2.0) is the sole graph renderer, CodeMirror 6 is the prompt/instruction inspector, and vanilla-jsoneditor + Ajv is limited to schema-backed payload editing. Tools do not add graph UI, graph execution, or settings stores, and do not introduce Cytoscape, React Flow, or custom graph implementations. Existing shared trace/slot-trace/trace-view hooks remain integration-owned.

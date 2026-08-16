# Reuse and data-boundary notes

This isolated lane reviewed the requested Blockwise sources and keeps reuse at the contract level. No Blockwise code is imported or copied into Frank.

## Reusable concerns

- Blockwise `scripts/research/discover-agents-missing-email.mjs` provides the missing-contact discovery shape: paginated records, a count/sample report, and agency context.
- Blockwise `scripts/research/enrich-agent-emails-exa.mjs` provides reusable enrichment ideas: source URL/title evidence, candidate extraction, junk/data-broker filtering, confidence scoring, reasons, dry-run/resume behavior, and a minimum score gate.
- Blockwise `scripts/research/cleanup-enrichment-v2.mjs` and `scripts/research/cleanup-foreign-tld-emails.mjs` provide cleanup/reversal semantics. MOVE/ADAPT their evidence-preserving cleanup into Prospect Discovery; do not move customer records.
- Blockwise `scripts/research/verify-agent-email-enrichment.mjs` provides verification/reporting semantics for accepted and rejected enrichment evidence. MOVE/ADAPT its evidence checks into Prospect Discovery.
- Blockwise `scripts/research/enrichment-stats.mjs` provides aggregate progress/statistics semantics, including source-domain summaries and reverted-cleanup counts. MOVE/ADAPT its reporting shape into Prospect Discovery.
- Blockwise `scripts/research/sync-demirs-wa-licence-register.mjs`, `scripts/research/reconcile-exa-wa-roster-sources.mjs`, and `scripts/research/seed-exa-wa-roster-sources.mjs` provide source synchronization, reconciliation, and seed/reference semantics. MOVE/ADAPT only the public-source evidence aspects into Prospect Discovery.
- Blockwise `src/lib/operator/email-service.ts` provides operator-mailbox concerns that may be adapted into Mail only after customer importers are separated: normalized addresses/recipients, mailbox scoping, thread-safe reply subjects, and paginated received-message summaries/details.

The canonical source for this review is `/projects/blockwise` at `ae89ca5`.

## Explicit exclusions

Blockwise customer transaction and lead-lifecycle mail remains Blockwise-owned. Keep Blockwise `src/lib/email/resend-client.ts` and `src/lib/email/lead-lifecycle.ts`; Frank does not import their customer/lead records, campaign state, transaction state, or sender implementation. The Mail package is provider-neutral and read/sync/receipt oriented; Outreach owns policy lifecycle and delivery requests, not provider execution.

Prospect records never enter Ad Intelligence evidence or public exports. Ad Intelligence is represented only by a stable subject reference and cannot carry PII. Scraped availability is not consent, and public source evidence is not legal-basis evidence.

## Shared graph boundary

Each tool owns and versions declarative pipeline nodes/edges, immutable settings revisions, and Hermes envelopes only. The named pipelines are the domain-owned graph input; the shared integration lane will project them after the committed graph adapter specification. Tools do not add graph sections, graph UI, graph execution, or settings stores, and do not introduce Cytoscape, React Flow, or custom graph implementations. Existing shared trace/slot-trace/trace-view hooks remain integration-owned.

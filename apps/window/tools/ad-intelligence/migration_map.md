# Blockwise research-table migration map

This map was checked against the current Blockwise Hermes research-runtime
references and migrations. It is a contract for adoption, not a migration script.
The live VPS database is existing data: after backup, schema/version, and row-count
gates, adopt it in place. Do not re-import or create a parallel Ad Radar database.

## Capture and creative records

| Current concept/table | Ad Radar responsibility | Adoption rule |
| --- | --- | --- |
| `research.source_documents` | source/evidence reference | Retain IDs, URLs, captured timestamps, content hash, and provenance; never put raw payload in public export |
| `research.advertiser_pages` | resolved advertiser/source identity | Keep page IDs, page URL, status, resolver decision, `agent_id`/`agency_id` references; no contact fields |
| `research.ad_fetch_runs` | capture run receipt | Map run status, source, cursor/limits, started/finished times, counts, and failure receipt |
| `research.observed_ads` | source-scoped observation | Retain stable source IDs, advertiser page, first/last seen, raw evidence reference, and capture status |
| `research.ad_snapshots` | point-in-time ad version | Retain snapshot timestamps, source URL, copy/media references, and evidence links |
| `research.ad_creatives` | normalized creative | Map creative identity, copy, destination, classification, display state, and publish eligibility |
| `research.ad_creative_versions` | immutable creative history | Preserve version lineage and content hashes; do not overwrite prior observations |
| `research.media_assets` | media reference and QA input | Preserve storage path/reference, kind, content type, dimensions, hash, capture status, and QA receipt |
| `research.ad_quality_scores` | quality/accuracy evidence | Map score, reason codes, model/prompt, confidence, and evidence/receipt references |
| `research.ad_area_matches` and `research.location_*` | geography matching | Keep normalized suburb/postcode/state/country matches and evidence; never infer a person or prospect |

## Runtime and evidence records

| Current concept/table family | Ad Radar destination | Rule |
| --- | --- | --- |
| `research.refresh_*` and refresh policy/settings | manifest cadence/source settings | Preserve runtime settings as Hermes-owned versioned settings |
| `research.runtime_*` and `research.runtime_settings` | policy/model/health configuration | Keep model policy, thresholds, feature flags, and audit history in Hermes |
| `research.work_queue` | pipeline scheduling | Adopt existing jobs, dedupe keys, claims, retries, blocked/failed status, and results in place |
| `research.evidence_*` and raw-evidence objects | evidence/receipt references | Retain object manifests, hashes, URLs, and retention metadata; credentials stay in Hermes/VPS |
| `research.agent_decisions` / decision records | classification, resolver, approval decisions | Preserve decision ID, prompt/model, confidence, rationale, evidence IDs, and approver |
| `research.ingest_events` / ingest records | write receipts | Preserve ordered mutation receipts and idempotency references |
| `research.audit_*` / audit records | operational audit trail | Preserve actor, action, table/object, reason, timestamp, and receipt references |

## Separate roster and Prospect Discovery boundary

These are not Ad Radar public creative entities and must remain separate Hermes or
Prospect Discovery data:

- `research.agents`, `research.agencies`, `research.agent_service_areas`, and
  `research.real_estate_verifications` remain advertiser/roster resolution data,
  referenced by ID only.
- Every email/contact field—`email`, `email_address`, `contact_email`, `lead_email`,
  `phone`, `phone_number`, `mobile`, `contact_phone`, `recipient`, contact names,
  `agent_contacts`, outreach sequences, CRM IDs, and prospect IDs—moves to or stays
  in Prospect Discovery. None is copied into `ad_creatives`, public exports, traces,
  media metadata, or Ad Radar settings.
- `agent_contacts` is explicitly split out; it is not a creative attribute and is not
  a join performed by the public Ad Radar publisher.

## Optional Blockwise customer consumer

The public `customer_ad_radar_*` read-model/projection remains an optional Blockwise
consumer after Hermes has approved and published neutral creative data. It is not the
Ad Radar source of truth, not a second ingest path, and not a destination for roster,
contact, or prospect fields.

## Cutover gates

1. Back up the live VPS database and raw-evidence manifests.
2. Verify schema/version compatibility and row counts for every adopted table family.
3. Verify representative IDs, hashes, decision/evidence links, queue status, and
   media references before enabling writes.
4. Enable the Hermes-owned runtime in place; do not re-import rows or run a second
   scraper/database alongside the existing system.

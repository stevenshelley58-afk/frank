# F2-B1…B4 — Ad intelligence · Prospect discovery · Mail · Outreach

**Depends:** F1-1, F1-3, F1-4 · **Model:** cheap · **Parallel group B**
**Allowed:** `modules/ad-intelligence/**`, `modules/prospect-discovery/**`, `modules/mail/**`, `modules/outreach/**`
**Order within group:** B1 ∥ B2 ∥ B3, then B4 (needs B2 + B3)

**The single most important rule in this group:** Blockwise's `research.agent_contacts` currently mixes outreach data into the ad-intelligence schema. That merge is the bug. These four modules exist to keep it split forever.

---

## The PII boundary

| Data | Owner |
|---|---|
| Public advertiser identity needed to display an ad | `ad-intelligence` |
| Email, phone, social handles, enrichment confidence, contact source evidence | `prospect-discovery` |
| List membership, qualification, drafts, send state, replies, bounces, complaints, suppression | `outreach` |
| Raw email bodies and attachments | `mail` |

Modules exchange `subject_ref` and versioned events. **They never join each other's tables.**

**The ad-intelligence export schema must make contact fields structurally impossible, not merely optional.** Write a negative contract test that fails if any field named like `email`, `phone`, `contact`, `prospect_score`, or `outreach_*` can appear in an export. That test is the whole point of the split.

---

## B1 — `ad-intelligence`

**Owns:** advertisers, pages, ads, snapshots, creatives, media, classifications, coverage, provenance.
**Never contains:** emails, phones, outreach status, send history.

Port from Blockwise `research.*`: `ad_area_matches`, `ad_area_tags`, `ad_attribution_links`, `ad_creative_versions`, `ad_creatives`, `ad_fetch_runs`, `ad_snapshots`, `advertiser_pages`, `coverage_audits`, `coverage_defects`, `media_assets`, `media_blobs`, `observed_ads`, `official_api_validation_runs`, `pipeline_runs`, `refresh_policies`, `runtime_settings`, `source_fetch_log`, plus the ad-specific parts of `source_documents`, `agent_decisions`, `build_runs`, `capture_actors`, `ingest_events`, `target_manifest`.

Replace hardcoded real-estate classification with **core taxonomy + pack mapping** (`pack.taxonomy.classification_map`).

**Export API:**
```
GET /v1/projects/:id/ad-intelligence/ads?after=<cursor>&limit=100
GET /v1/projects/:id/ad-intelligence/ads/:adId
GET /v1/projects/:id/ad-intelligence/facets
GET /v1/projects/:id/ad-intelligence/health
```

Exports only: stable Frank ad ID and provider IDs · active/inactive + tombstones · advertiser **display** identity · creative text, media refs, format, CTA, landing URL · classification and project-mapped taxonomy · geography evidence · first/last seen · provenance links and content hashes.

**Stays in Blockwise:** `ad_style_profiles` (it's an AdStudio product table — move it to a workspace-scoped Blockwise table with RLS, not to Frank) and `research_saved_ads` (a user preference — keep as a projection referencing an opaque Frank ad ID, **no cross-database FK**).

---

## B2 — `prospect-discovery`

**Owns:** prospect profiles, organisations, public contact points, source evidence, confidence, qualification.
**Never contains:** ad snapshots, campaign sends, mailbox bodies.

Port `agent_contacts`, the contact-oriented fields of `agents`/`agencies`, census/enrichment evidence, and the prospecting parts of `agent_service_areas`, `real_estate_verifications`.

**Preserve source URLs, timestamps, confidence and old→new ID maps** through the migration. Test PII access control, retention, deletion, provenance, dedupe and cross-project isolation.

---

## B3 — `mail`

**Owns:** threads, messages, provider IDs, cursors, delivery receipts, attachments.
**Never contains:** prospect scoring policy, or any Blockwise product auth mail.

Move the operator Resend adapter and mailbox UI into a **provider-neutral** boundary. Preserve provider message IDs, inbound cursors, exact sent content, delivery evidence and ambiguous-outcome reconciliation.

**Do not move** — these stay in Blockwise as product transactional mail: Supabase auth email · workspace invitations · Stripe/billing · customer lead notifications · suburb-report delivery.

Test: list, read, draft, send, reply, dropped response, retry, bounce, revoke.

---

## B4 — `outreach`

**Owns:** campaigns, list membership snapshots, sequences, message intents, approval, send ledger, replies, bounces, complaints, unsubscribe, global and project suppression.

**Non-negotiable:** suppression and standing-policy checks run **immediately before every send**, inside the same transaction as the send intent. No code path may call `mail` directly to bypass them — enforce with a lint rule and a test that attempts the bypass and must fail.

**Scraped contact availability is contactability evidence, not consent.** Model consent and legal basis as separate explicit fields.

On an unknown or ambiguous send outcome: **reconcile, never resend blindly.**

---

## Done when (each module)

- [ ] Manifest validates; migrations apply clean and rerun as no-op
- [ ] Cross-project isolation tested
- [ ] `grep -ri blockwise modules/<name>/` returns nothing
- [ ] Test suite green against `packs/acme`
- [ ] **B1:** negative export test proves contact/outreach fields cannot appear
- [ ] **B2:** old→new ID map complete; counts and hashes reconcile
- [ ] **B3:** Blockwise transactional mail still works, untouched
- [ ] **B4:** no path reaches `mail` without a suppression check — bypass test fails as required

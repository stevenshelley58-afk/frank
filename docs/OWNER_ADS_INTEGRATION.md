# Owner ads integration: inventory and contracts

Phase 1 of connecting the owner Ads workspace to real services. This document is
an **inventory**: what exists, what does not, who owns it, and where the boundary
between the owner's advertising and customer accounts is enforced. Nothing here
has been connected, and no credential was read or moved while writing it.

The intended architecture, which this inventory is written against:

    Frank interface → authorised services / Hermes execution → Meta
    saved reporting data → Frank dashboard

Provider credentials, execution and durable jobs stay out of the browser.

## 1. Account mapping

| What | Identifier | Where it is recorded | Owner |
| --- | --- | --- | --- |
| **Owner Meta ad account** | **does not exist** — no `act_…` anywhere in `/projects/frank`, its worktrees, or this host | required but undeclared: `apps/window/owner_reporting.py:72-79`, `docs/OWNER_WORKSPACE.md:161` | unassigned |
| Owner Facebook Page | does not exist | — | unassigned |
| Owner Instagram professional account | does not exist | — | unassigned |
| Owner-side Meta credential | does not exist — no `META_*`/`FB_*` key in any file under `/srv/frank/secrets` (key names inspected, never values) | — | — |
| Blockwise Meta Business Portfolio | `3701213676688100` | `blockwise/docs/runbooks/meta-direct-api-go-live-checklist.md:12` | Blockwise product |
| Meta app (product) | `1366207442127664`, "In development", partner-assisted publishing live | same runbook `:11-13` | Blockwise product |
| Meta Pixel (blockwise.sale) | `1699948581050851` | `blockwise/src/app/layout.tsx:41` | Blockwise product site |
| Customer ad accounts | per workspace, discovered from Graph `/me/accounts` into `provider_connections.external_account_id` | `src/lib/providers/meta-assets.ts:68-113` | each customer workspace |
| GA4 (website analytics) | account `407072065`, property `553012529`, stream `G-PX6NWGX9B5` | `blockwise/docs/analytics-tracking.md:43-45` | Blockwise product site |
| Test-only ad account | `act_998540809306211` | `blockwise/tests/live-provider-normalization.test.ts:69` | test fixture |

**The owner's ad account, Page and Instagram identity are recorded nowhere.** The
phase-1 proof this document was supposed to carry — "exact account mapping; no
customer-account crossover" — can therefore only be half-delivered: there is no
owner identifier to map yet, and the crossover claim can only be argued
negatively (no owner code path reaches a customer store or token, because no
owner Meta code exists).

Everything above the owner rows belongs to the **customer product**, and none of
it may be reused for the owner's advertising: Frank is the owner's Hub, not a
customer surface (`AGENTS.md`).

## 2. Sources and permissions, as they actually are

| Source | Frank may read | Frank may write | Through |
| --- | --- | --- | --- |
| Meta ads | nothing. `REPORTING_READERS` is empty (`owner_reporting.py:112`), so the source reports `unconfigured` and names the missing step | nothing | intended: Frank → authorised service / Hermes → Meta. Frank's vault has **no Meta adapter** (`provider_adapters.py:114`) |
| Conversion dataset | nothing | nothing | a browser-only Pixel, consent-gated, PageView only (`marketing-analytics.tsx:48-50`). There is **no Conversions API integration anywhere**: no `/events` POST, no dataset token, and no `fbclid`/`fbc`/`fbp` capture in either repository |
| Website analytics (GA4) | nothing | nothing | declared only (`owner_reporting.py:56-63`, `owner_workspace.py:75`). Needs a property id and a read-only service account; neither exists |
| Blog Studio | the whitelisted public run projection (`blog_studio.py:400-505`) | nothing — commands are forwarded to Hermes | Hermes |
| Owner CRM | `CRM Lead` (four fields), `CRM Lead Status`, `HD Ticket` (`owner_projections.py:142`) | nothing (the only POST is the Frappe login) | Frappe REST `127.0.0.1:18081`, site `owner.crm.internal` |

### The crossover boundary

What exists today, in order of strength:

1. **Documentary, explicit.** "Frank is the owner's Hub, not a customer surface…
   Never put a customer-facing screen or a customer account in Frank."
2. **Token boundary.** On the customer side, `private.provider_token_vault` is not
   exposed through PostgREST; only security-definer RPCs granted to `service_role`
   can read or write it, and tokens are encrypted at rest.
3. **Customer write gate.** `metaPublishProviderWritesEnabled()` requires both a
   global switch and the workspace UUID in an allowlist, and fails closed.
4. **Tenant isolation.** Every customer workspace table carries a non-null
   `workspace_id` with row-level security.

What does **not** exist: any code-level check that an owner ads reader resolves a
business-owned ad account rather than a customer's. It cannot exist yet, because
no owner reader has been implemented. That check is a phase-2/3 deliverable, not
something this inventory can certify.

## 3. What can be reused, and in what shape

**Owner surface (keep, extend):**

- `apps/window/owner_ads.py` — the seven frozen reader names, each answering `501`
  with a typed not-connected envelope, parity-tested against the browser. Replace
  the bodies; keep the contract.
- `web/js/ads/ads-source.js` — one result envelope; `404`/`501` mean
  *not connected*, never *empty*.
- `web/js/ads/ads-identity.js` — `cmp_`/`crvv_`/`ad_` identities, the version
  policy and the approval digest. This is the reporting-join story, and it is
  already correct and tested.
- `web/js/ads/ads-drafts.js` — real mutation-queue semantics (kinds, phases,
  revision-guarded saves, recovery), but stored in `localStorage`: **not durable
  and not server-authoritative**. Durable drafts are phase 2.
- `apps/window/connections_agent.py` — the closest owner-side ledger:
  `planned|applying|waiting_for_provider|applied|failed|expired`, idempotency
  fingerprints, receipts. Extend rather than invent.
- `apps/window/vault_broker.py` and `provider_adapters.py` — a write-only secret
  boundary with opaque references, and a pure metadata registry that has no Meta
  entry yet.

**Customer stack (do not import; copy the pattern):**

- `meta-mutations.ts` — explicit statuses, PAUSED-first creation, pause
  confirmation before activation. Cross-repository import is forbidden by the
  product's own rules, and these modules are workspace-scoped customer code.
- `meta-publish-queue.ts` / `job_queue` — a dedupe key plus lease, attempts bumped
  at claim, stale-job reaping. Lives in the customer Supabase.
- `reporting_snapshots` — one current snapshot per workspace, provider and range,
  carrying `generated_at`, `stale_at`, `payload`, `etag`. Reuse the *shape* for
  the owner's reporting import, in the owner's own store.

**Not owner ads at all:** Ad Radar, the ad template generator, `/api/ad-db/*` and
the ops projections serve the product and its customers.

**Storage reality:** Frank's Window has no database. State is JSON/JSONL under
`/srv/frank/data/window`. Any owner reporting store is new work.

## 4. Access limits

Verified in 2026 against Meta's own documentation (their pages are
client-rendered, so they were read through raw snapshots and a rendered browser,
not a plain fetch), plus project records which are *not* policy:

- **Reading insights for an ad account the app's admin owns** needs `ads_read`.
  Standard access is sufficient; App Review and Business Verification are not
  required for role-only users.
- **Creating paused campaigns, ad sets and ads** needs `ads_management`, uses the
  documented `status=PAUSED`, and follows the same access rules.
- **Conversions API** needs no additional permission and no App Review. No CAPI
  integration exists in either repository today.
- **Rate limits:** read 1 point, write 3; development tier maximum score 60 with a
  300-second decay and 300-second block, full access 9,000 with a 60-second block;
  mutation requests 100/s per app and ad account; per-account budgets of 300
  (`ads_management`) or 600 (`ads_insights`) per hour on the development tier,
  rising with active ads on full access. Ad-set budget changes are limited to four
  per hour and account spend-limit changes to ten per day.
- **Unconfirmed, and therefore not relied on:** whether serving *active* ads needs
  a higher tier than paused ones; Business Verification for CAPI; the newest Graph
  version; and one line about a 30-second per-object edit limit which Meta's HTML
  and Markdown renderings disagree about.

The development tier's budget cannot carry the interface's current 200-ad launch
ceiling. That is a phase-6 constraint to design for, not a number to hard-code.

## 5. What blocks what

**Before read-only reporting (phase 3):**

1. No owner Meta ad account, Page or Instagram account exists — and no credential
   for one. Nothing can be read until a business-owned asset is created and named.
2. No owner reporting store exists, and the Window has no database.
3. The reader routes exist but have no implementations.
4. There is no GA4 read path at all, so neither website visits nor the blog
   reader can be filled.
5. The blog join is by `blog_topic` today, while its own column contract says
   "internal id and slug, never the title". The identity exists in Blog Studio's
   published record; the join does not.
6. There is no ad→lead join key. The lead table has no UTM or click-id column,
   and lead identity is `blockwise_demo_request:<uuid>`. "Qualified leads per ad"
   cannot be computed until that key exists on both sides.
7. The CRM's qualified signal is coarse — a native status plus an eligibility
   field — and Frank reads only four lead fields today.

**Before controlled publishing (phase 6):**

8. No owner-side write gate. The customer gate is not importable and has no owner
   analogue.
9. No durable owner queue; drafts are browser-local.
10. No Meta vault adapter or binding path for a system-user token.
11. Reconcile-before-retry is designed but unimplemented, and Meta's create calls
    are not idempotent, so it needs a plan id, a dedupe key and a read-back.
12. The development-tier quota above.

## 6. Not determined

- Whether owner Meta assets exist inside Meta itself (that needs Business Manager
  access, which was not available here).
- Any secret value, by rule: only key names were inspected.
- Whether the GA4 connector-status keys in the Window environment are populated.
  Moot for now: no reader is registered, so the source reports `unconfigured`.
- Whether Blog Studio's `blockwise-guides` publication target is actually wired to
  the guides directory it names: the contract names it, but no publisher that
  consumes it was found.

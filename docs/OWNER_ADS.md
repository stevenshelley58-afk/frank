# Owner ads workspace

The Ads section is a Frank owner-workspace section at
`/project/blockwise/ads`, beside Mail, CRM and the email flows. It is separate
from **Email flows** (`campaigns`), which stays Mautic's: Mautic owns email
campaigns and audiences, this section owns paid advertising.

Open it at `https://frank.fail/project/blockwise/ads`. A screen can be deep
linked with `?screen=`, for example
`/project/blockwise/ads?screen=creative`, and a link may carry `?preview=1` to
open the labelled rehearsal without anything being set up first.

The workspace is one implementation with one entry: the same build is what the
owner shell mounts at that route, and what a review instance serves at the same
route. The address this section was first shared under (a static page describing
the workspace) now redirects into the workspace itself.

## What it is

A **reader**. It renders rows a scheduled sync has already written into scoped
reporting tables. Opening a tab, changing a date range, changing an attribution
setting or editing a filter re-reads saved rows. It never calls Meta.

That is also why the screens are usable while the provider is throttling: there
is nothing to throttle. The header states how old the last successful sync is,
and cached rows stay on screen with their age rather than being blanked.

## Screens

| Screen | `?screen=` | Purpose |
| --- | --- | --- |
| Overview | `overview` | Spend, results, cost per result, one trend, and what needs attention |
| Campaigns | `campaigns` | Campaigns, ad sets and ads: filter, compare, bulk review, inspect delivery |
| Creative intelligence | `creative` | Concepts, hooks, formats and styles, with the original prompt attached |
| Blogs & destinations | `blogs` | Which articles attract traffic, convert, and work as ad destinations |
| Tracking | `tracking` | UTM templates, URL validation, and the ad → creative → content chain |
| Publishing queue | `queue` | Bulk launches, per-row failures, pending changes, activity history |

The account, date range, comparison period, attribution setting and last
successful sync are always visible and never scroll away.

## Three rules the code enforces

**A provider-attributed number and an observed number are different facts.**
Meta-attributed results and website- or CRM-observed outcomes never share a
column, a total or a colour. They are labelled at the point of display. UTMs
identify traffic; they do not prove causation.

**Low volume is not a winner.** `evidenceFor()` returns *insufficient evidence*
below a stated floor, and `compareRates()` refuses a verdict while the Wilson
confidence intervals overlap. The floor is shown in the interface so the reader
can disagree with it.

**Submission is not proof of delivery.** Only `delivering` and `paused` mean the
provider has served an ad. `submitted`, `in_review` and `uploading` are
acknowledgements of a write. An uncertain write is reconciled before any retry,
so a retry cannot create a duplicate ad.

## Preview versus live

Unconnected production screens show **Not connected** and name the reader that
has no implementation. They never fall back to fixtures.

`Preview` in the header turns on a clearly-labelled synthetic dataset, with a
banner above every screen and a small/large set switch for testing realistic
row counts. Preview is a rehearsal surface, is stored as a browser preference
only, and is never mixed with live rows.

## Identity

Reporting history joins on identity, so an identity may never be derived from a
name, a position in a list, or a piece of copy: each of those splits or merges a
join the first time somebody renames, reorders or rewords something.
`web/js/ads/ads-identity.js` owns the rule.

- A **campaign** is `cmp_…`, allocated when Frank first plans it, or the
  provider's own id when the campaign already exists in Meta. Its name is a label
  attached to that identity. Renaming a campaign cannot move its history or
  change `utm_campaign`.
- A **creative version** is `crvv_…`, addressed by the rendition itself: the
  asset key, the format and the crop. Re-generating the asset mints a new
  version; renaming, reclassifying, adding a note, reordering or editing an ad's
  copy does not. The full descriptor is stored beside the id, so two renditions
  compare equal only when they really are the same. The policy is stated in
  `VERSION_POLICY`, in code, so the screens, the tests and the future writer read
  the same sentence.
- A **planned ad** is `ad_…`, allocated when the row is first planned and carried
  through every later edit. Rebuilding the plan reconciles identities in two
  passes — exact content first, then the creative a leftover row came from — so
  editing a headline in place, reordering creatives or deselecting and
  reselecting a creative updates the ads instead of replacing them.
- The **tracking identity** of a planned ad is that ad's identity and nothing
  else. `{{ad.internal_id}}` and `{{creative.internal_id}}` resolve to it;
  `{{ad.label}}` resolves to the operator's readable label for the creative,
  which is deliberately *not* an identity, because two variations of one creative
  share one label. Validation flags a template that would collide.
- An **approval** is an approval *of* something: `planDigest()` hashes the plan's
  identities and copy in identity order, so the same ads approved in another
  order are the same snapshot and any later edit makes the recorded approval
  stale.

## Data contract

| Reader | Endpoint | Returns |
| --- | --- | --- |
| `context` | `/api/owner/ads/context` | Account, currency, time zone, sync state |
| `overview` | `/api/owner/ads/overview` | Totals, previous period, daily series, attention items |
| `entities` | `/api/owner/ads/entities?level=` | Rows for `campaign`, `adset` or `ad` |
| `creatives` | `/api/owner/ads/creatives` | Creative rows with prompts, lineage and tags |
| `blogs` | `/api/owner/ads/blogs` | Article rows with organic/paid split and outcomes |
| `tracking` | `/api/owner/ads/tracking` | Templates, validation findings, destination history |
| `queue` | `/api/owner/ads/queue` | Batches, per-row attempts, pending changes, activity |

Every reader resolves to one envelope: `{ status, data, detail, fetchedAt,
origin, cached }`. `status` is one of `ready`, `syncing`, `stale`, `throttled`,
`error`, `not_connected`, `empty`. `404` and `501` are the honest
"not built yet" answers and map to `not_connected`; they are never treated as an
empty result.

The routes exist before their readers do. `apps/window/owner_ads.py` answers
every reader name with `501` and the typed envelope naming what that reader
still needs, so an unimplemented reader is never answered by the single-page
catch-all with a page of HTML. The browser vocabulary and the server vocabulary
are held together by `tests/test_owner_ads.py`, which fails if the two lists or
the requirement sentences drift.

Parameters accepted by the reporting readers: `from`, `to`, `comparison`,
`attribution`, `level`.

## Publishing

`Publish ads` opens the bulk flow: **select creatives → configure campaign →
map variations → tracking → review → queue**.

Selecting 20 creatives and 5 headlines does not silently create 100 ads. The
flow computes the axes separately, shows the equation, defaults to one ad per
creative (the headlines travel as alternative text options inside that ad), and
requires an explicit confirmation before it will multiply them.

One function decides the plan. `planAdRows()` returns every ad a plan would
create and `planAds().total` **is** that array's length, so the advertised count
and the rows that are staged cannot disagree. Blank or whitespace-only copy is
not a variation: an axis with nothing in it contributes exactly one empty value,
which is why a plan with no primary text still produces the ads the counter
promises. The review step lists the planned rows with the tracking identity each
one would carry.

Per-creative mapping edits are independent. Editing the destination, the
headline and `utm_content` in any order leaves all three in place, because each
control merges into the current record rather than into a copy captured when its
row was built.

Tracking URLs are built in one place and that one string is both displayed and
validated. A destination's own query parameters and `#anchor` survive, a
parameter the template also sets is replaced rather than duplicated, an empty
value is omitted, and an unparseable destination is a blocking problem.
`utm_campaign` resolves to the draft's own `cmp_…` identity and each variation
gets its own `utm_content`, so renaming a campaign cannot move a reporting join
and two variations of one creative cannot collide.

The review step states the exact number of ads, the combined budget change and
every validation problem, and lists failures against the individual row they
belong to so a partial failure does not force the batch to run again.

### Bulk selection scope

"This page" and "every matching row" are different decisions, so they are
different controls. The header checkbox and the page selection act only on the
rows the table is showing; selecting the whole filtered result is a separate,
named action that states its count first, and the bar then says how many of the
selected rows are not on this page. A row the filters exclude cannot stay
selected, and a bulk review lists every affected row with its before and after
value before anything is staged.

### One draft model

A staged change is one record in `web/js/ads/ads-drafts.js`, written by the
launch flow, the campaigns table and the publishing queue alike, and read back
by the queue. A draft keeps the selected creatives and their mappings, the
campaign configuration and tracking, the planned rows and their validation, the
proposed budget or pause changes with before/after values, and its own identity
and lifecycle. Saving keeps the creatives (an earlier build dropped them, so a
reopened draft lost its plan). Drafts survive a reload, and rehearsal drafts are
stored under their own origin and never appear in the live queue.

### Lifecycle, revisions and recovery

The local states are **Draft** (being built), **Saved draft**, **Staged in
Frank** and **Approved**. **Submitted to Meta** and **Delivering** are reserved:
only a real writer that heard back from the provider may set them, through
`applyProviderState`, and nothing in this browser calls it. The wizard footer
states which local state the plan is in and whether it has unsaved changes;
leaving with unsaved work asks first.

Every save carries the revision the screen was editing from. If the same draft
changed somewhere else — another tab, another device — the save is refused, the
newer revision is named, and the screen offers both ways out instead of retrying
over somebody's work. Each save records a bounded history of what changed and
when.

Two tabs, or two people, holding the same draft is the normal case, and each
tab has its own view of it. A guarded save therefore compares the revision it
was editing from against the revision that is **stored**, not against its own
memory: comparing against memory would let two tabs each believe they were
current and the later save would silently destroy the other's approval. When the
save is refused, the store reloads so the screen offering the other revision
really shows the other revision.

Recovery is part of the model rather than an afterthought: a record that cannot
be parsed is counted and reported instead of vanishing, the previous stored
payload is kept as a backup before every write, and a browser that refuses to
store (private mode, quota) sets a flag the queue shows, so "saved" never means
"saved into a void". Records written by an older build are migrated forward.

Nothing is sent to the provider from this build. Staging adds a local draft to
the queue, and approving records the owner's sign-off on one exact plan digest.
Publishing is a gated write and is not wired yet; the interface says so rather
than implying a successful launch.

## Where the files are

`apps/window/web/js/ads/` — see `README.md` in that directory for the module
guide. `apps/window/web/ads.css` owns how a reading is presented and
`apps/window/web/ads-controls.css` owns the operator's controls; both are scoped
to `.ads-workspace`.

## Verification

```bash
cd apps/window
PATH=/usr/local/bin:$PATH bash scripts/verify.sh
```

Rule-level regression tests, including one per defect this section describes:

```bash
cd apps/window
node --test tests/ads_identity.test.mjs tests/ads_workspace_contract.test.mjs tests/ads_tracking.test.mjs
python3 -m pytest tests/test_owner_ads.py
```

The interactive journey runs the production modules in a real Chromium through
`acceptance/ads_harness.html`, which controls only the answers on the wire:

```bash
cd apps/window
/srv/frank/acceptance-venv/bin/python acceptance/ads_journey.py \
    --root . --out /srv/frank/verification/ads-repair-20260914
```

It drives bulk selection at 50 visible and 960 matching rows, the mapping edits,
the launch flow through to a staged draft, the queue, a reload, reopening the
draft with the same configuration and ad count, a rename that must not move the
tracking identity, a throttled refresh that must keep the last good rows, and
the preview/live isolation of drafts, on desktop and at 390x844.

The **entry journey** drives the real application instead of the harness — a
fresh browser, no test-only setup, the exact link, the real shell around the
workspace:

```bash
cd apps/window
/srv/frank/acceptance-venv/bin/python acceptance/ads_entry_journey.py \
    --base-url http://127.0.0.1:18090 \
    --out /srv/frank/verification/ads-plan-a-20260914
```

It covers the fresh entry, all six screens and the return, reload and deep links,
Back and Forward across screens and sections, the honest disconnected state with
preview off, a phone viewport, keyboard navigation, preview isolation, and the
operator's controls driven through the real screens: built-in and saved views
(applied, linked in the address and surviving a reload), the hierarchy drill-down
that filters by the parent's immutable id, the lifecycle from staging to a local
approval that says it is not a submission, and the same staging done on a phone
with thumb-sized actions and no sideways scroll.

## Not yet built

- The scheduled incremental reporting sync behind `/api/owner/ads/*`. The routes
  exist and answer `501` with the reader's requirement; the rows behind them do
  not exist yet.
- Adaptive refresh for active versus historical campaigns, bounded concurrency,
  usage-header monitoring, and backoff with jitter.
- Asynchronous reporting for large requests, and deduplicated or queued manual
  refreshes.
- Asset reuse and change-only uploads.
- Re-fetching a recent window to capture delayed attribution, and reconciling
  uncertain writes before retry.
- Any gated write: campaign, ad set, ad, budget, pause and publish.

Exact provider rate limits and permissions also need verification during
integration. Meta's documentation fetch was rate limited when this was written,
so no limit is asserted here.

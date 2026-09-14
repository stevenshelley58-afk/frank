# Owner ads workspace

The Ads section is a Frank owner-workspace section at
`/project/blockwise/ads`, beside Mail, CRM and the email flows. It is separate
from **Email flows** (`campaigns`), which stays Mautic's: Mautic owns email
campaigns and audiences, this section owns paid advertising.

Open it at `https://frank.fail/project/blockwise/ads`. A screen can be deep
linked with `?screen=`, for example
`/project/blockwise/ads?screen=creative`.

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
and approval state. Saving keeps the creatives (an earlier build dropped them,
so a reopened draft lost its plan); staging moves `editing → staged` and
`draft → queued`; nothing in the model can set a submission state. Drafts
survive a reload, and preview drafts are stored under their own origin and never
appear in the live queue.

Nothing is sent to the provider from this build. Staging adds a local draft to
the queue. Publishing is a gated write and is not wired yet; the interface says
so rather than implying a successful launch.

## Where the files are

`apps/window/web/js/ads/` — see `README.md` in that directory for the module
guide. `apps/window/web/ads.css` owns every style, scoped to `.ads-workspace`.

## Verification

```bash
cd apps/window
PATH=/usr/local/bin:$PATH bash scripts/verify.sh
```

Rule-level regression tests, including one per defect this section describes:

```bash
cd apps/window
node --test tests/ads_workspace_contract.test.mjs tests/ads_tracking.test.mjs
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

## Not yet built

- The scheduled incremental reporting sync behind `/api/owner/ads/*`.
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

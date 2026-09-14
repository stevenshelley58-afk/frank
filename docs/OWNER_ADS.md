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

The review step states the exact number of ads, the combined budget change and
every validation problem, and lists failures against the individual row they
belong to so a partial failure does not force the batch to run again.

Nothing is sent to the provider from this build. Staging adds a draft to the
queue. Publishing is a gated write and is not wired yet; the interface says so
rather than implying a successful launch.

## Where the files are

`apps/window/web/js/ads/` — see `README.md` in that directory for the module
guide. `apps/window/web/ads.css` owns every style, scoped to `.ads-workspace`.

## Verification

```bash
cd apps/window
PATH=/usr/local/bin:$PATH bash scripts/verify.sh
```

Plus the interactive acceptance pass: desktop and mobile, keyboard only,
loading, stale, empty and failure states.

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

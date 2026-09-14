# Ads workspace — module guide

The Ads workspace is a Frank owner-workspace section that lives at
`/project/blockwise/ads`, beside Mail, CRM and the email flows. It is a
**reader**: it renders rows a scheduled sync has already written. It never calls
Meta because a tab opened or a filter changed.

## Files

| File | Owns |
| --- | --- |
| `ads-workspace.js` | The shell: account bar, context strip, screen nav, preview switch, deep links, history, reader wiring, the error boundary |
| `ads-identity.js` | Identity: campaign, creative version and planned-ad ids, the version policy, plan reconciliation and the approval digest |
| `ads-drafts.js` | The shared draft model: one record per staged change, its lifecycle phase, revisions, conflicts, recovery and storage |
| `ads-contracts.js` | Metric definitions, controlled vocabularies, evidence maths, formatters |
| `ads-source.js` | Reader endpoints, the result envelope, cache, dedupe, preview delegation |
| `ads-preview-data.js` | Synthetic fixtures. **Only** reachable when preview is on |
| `ads-ui.js` | Shared primitives: panel states, banners, stats, badges, popover, drawer |
| `ads-table.js` | Sortable, column-configurable, selectable, paged table |
| `ads-views.js` | Filters as data, saved views, filter bar, bulk bar |
| `ads-decisions.js` | The overview's decision rules: what needs attention, how outcomes are ranked, what to test next. Pure functions |
| `ads-overview.js` … `ads-queue.js` | One screen each |
| `ads-publish.js` | The bulk publishing flow |
| `web/ads.css` | How a reading is presented. Scoped to `.ads-workspace` |
| `web/ads-controls.css` | The operator's controls: saved views, columns, hierarchy, lifecycle, phone layout |

## Writing a screen

A screen module exports one factory:

```js
export function createMyScreen(ctx, host) {
  const node = el("div", "ads-block");
  host.append(node);
  let disposed = false;
  const controller = new AbortController();

  async function load() {
    const result = await ctx.reader.read("blogs", params, { signal: controller.signal });
    if (disposed) return;
    // render from result
  }
  void load();

  return { node, dispose() { disposed = true; controller.abort(); }, settled: load };
}
```

`ctx` carries: `reader`, `params` (window, comparison, attribution), `context`
(account + sync), `isPreview()`, `setParams`, `navigate`, `refresh`, `say`
(polite live region), `store` (per-screen saved views), `drafts`, `openPublish`,
`openDraft`, `openRecord` (hand a record to the screen that owns it),
`takePendingRecord`, `recordMiss`, `win`, `doc`.

A screen may return `focusRecord({ kind, id })` alongside `dispose`/`reload` to
show one record another screen asked for, and should return `false` when the
record is not in its rows so the caller can say so instead of looking like a
link that did nothing.

## Staged changes

The launch flow, the campaigns table and the publishing queue all write the same
record through `ads-drafts.js`. A draft keeps the creatives and their mappings,
the campaign configuration and tracking, the planned rows with their validation,
and the proposed budget or pause changes with before/after values.

Its lifecycle is explicit: **Draft → Staged in Frank → Approved** are the states
this browser may reach; **Submitted to Meta** and **Delivering** are reserved for
a real writer that heard back from the provider (`applyProviderState`), and
nothing here calls it. Every save carries the revision the screen was editing
from, so a save built on a stale copy is refused with the newer revision named
rather than overwriting it. A plan is pinned to one side of the preview line when
the flow opens, so rehearsal rows cannot be saved or staged into the live queue
because the switch moved. Records that cannot be read are counted and reported,
the previous payload is kept as a backup, and a browser that refuses to store
sets a flag the queue shows. Drafts survive a reload; rehearsal drafts carry
`origin: "preview"` and never surface in a live queue.

Approving records the owner's sign-off on one exact plan: `planDigest()` over the
plan's identities and copy. Change the plan afterwards and the recorded digest no
longer matches, which is what makes the approval mean something.

## Non-negotiables

1. **Never invent a number.** A missing value renders `—`. A missing reader
   renders `notConnectedPanel`. There is no `0` fallback for missing data.
2. **Never fake state.** `submitted` is a write acknowledgement, not delivery.
   `delivering` is the only proof. Uncertain writes are reconciled, never retried
   blind.
3. **Keep the two measurement kinds apart.** Meta-attributed and
   website/CRM-observed numbers never share a column, a total or a colour. Use
   `sourceNote()` next to any observed metric.
4. **Refuse a verdict on low volume.** Use `evidenceFor()` / `compareRates()`.
   Below the floor the UI says "Insufficient evidence", never a winner badge.
5. **Preview is labelled or absent.** Fixtures are only reachable through
   `ctx.reader` when preview is on, and the shell renders the banner above every
   screen. A screen never renders its own copy of fixture data.
6. **Frank's visual language, nothing else.** Tokens from `web/tokens.css`,
   classes from `ads.css`. No tinted backgrounds, no gradients, no shadows
   except the popover and drawer, no new accent colour. The red `--mark` is for
   the active marker only.
7. **13px body, 10-11px metadata, tabular numerals on every number.**
8. **Keyboard-complete.** Anything clickable is reachable by Tab and operable by
   Enter or Space. Rows take Space to select and Enter to open.
9. **Motion is earned.** Entering surfaces get a short `--ease-out`; repeat-use
   controls get none. Everything collapses under `prefers-reduced-motion`.

## Verification

```bash
cd apps/window
/usr/local/bin/python -m compileall -q .
node --check web/js/ads/<file>.js     # node parses; these are ES modules
npm run verify                         # compiles python, checks every JS file
```

`npm run verify` is the declared runner in `docs/DEVELOPMENT.md`. It is not a
browser test; the interactive acceptance pass is separate:

```bash
cd apps/window
bash scripts/verify-ads.sh --out /srv/frank/verification/ads-plan-a-20260914
```

That one command runs every layer and writes one receipt: the syntax check, the
rule tests (identity, drafts, the workspace contract, tracking, the server half
of the reader contract), the wire-level journey and the entry journey.

Individually:

```bash
cd apps/window
node --test tests/ads_identity.test.mjs tests/ads_drafts.test.mjs \
    tests/ads_workspace_contract.test.mjs tests/ads_tracking.test.mjs \
    tests/ads_overview.test.mjs tests/ads_controls.test.mjs
python3 -m pytest tests/test_owner_ads.py -q
/srv/frank/acceptance-venv/bin/python acceptance/ads_journey.py \
    --root . --out /srv/frank/verification/ads-repair-20260914
/srv/frank/acceptance-venv/bin/python acceptance/ads_entry_journey.py \
    --base-url http://127.0.0.1:18090 --out /srv/frank/verification/ads-plan-a-20260914
```

`ads_journey.py` mounts these modules unchanged in a real Chromium through
`acceptance/ads_harness.html`, which stubs only what a server would answer, and
covers the bulk-selection scope, the mapping edits, the launch-to-queue handoff,
reopening a staged draft, tracking identity stability, a throttled refresh and
preview isolation.

`ads_entry_journey.py` drives the real application instead — a fresh browser, the
exact link, the Frank shell around the workspace — and covers the fresh entry,
all six screens and the return, reload and deep links, Back and Forward across
screens and sections, the honest disconnected state with preview off, a phone
viewport, keyboard navigation and preview isolation.

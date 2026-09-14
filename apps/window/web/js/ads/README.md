# Ads workspace — module guide

The Ads workspace is a Frank owner-workspace section that lives at
`/project/blockwise/ads`, beside Mail, CRM and the email flows. It is a
**reader**: it renders rows a scheduled sync has already written. It never calls
Meta because a tab opened or a filter changed.

## Files

| File | Owns |
| --- | --- |
| `ads-workspace.js` | The shell: account bar, context strip, screen nav, preview switch, reader wiring |
| `ads-drafts.js` | The shared draft model: one record per staged change, its identity, approval state and storage |
| `ads-contracts.js` | Metric definitions, controlled vocabularies, evidence maths, formatters |
| `ads-source.js` | Reader endpoints, the result envelope, cache, dedupe, preview delegation |
| `ads-preview-data.js` | Synthetic fixtures. **Only** reachable when preview is on |
| `ads-ui.js` | Shared primitives: panel states, banners, stats, badges, popover, drawer |
| `ads-table.js` | Sortable, column-configurable, selectable, paged table |
| `ads-views.js` | Filters as data, saved views, filter bar, bulk bar |
| `ads-overview.js` … `ads-queue.js` | One screen each |
| `ads-publish.js` | The bulk publishing flow |
| `web/ads.css` | Every style. Scoped to `.ads-workspace` |

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
(polite live region), `store` (per-screen saved views), `openPublish`, `win`,
`doc`.

## Staged changes

The launch flow, the campaigns table and the publishing queue all write the same
record through `ads-drafts.js`. A draft keeps the creatives and their mappings,
the campaign configuration and tracking, the planned rows with their validation,
the proposed budget or pause changes with before/after values, and its own
identity and approval state. `stage()` is the only transition that produces a
queue entry (`editing → staged`, `draft → queued`), it stays local, and no code
path in this module sets a submission state. Drafts survive a reload; preview
drafts carry `origin: "preview"` and never surface in a live queue.

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
node --test tests/ads_workspace_contract.test.mjs tests/ads_tracking.test.mjs
/srv/frank/acceptance-venv/bin/python acceptance/ads_journey.py \
    --root . --out /srv/frank/verification/ads-repair-20260914
```

The journey mounts these modules unchanged in a real Chromium through
`acceptance/ads_harness.html`, which stubs only what a server would answer, and
covers the bulk-selection scope, the mapping edits, the launch-to-queue
handoff, reopening a staged draft, tracking identity stability, a throttled
refresh and preview isolation.

# Frank UI — shadcn design system

**Status:** adopted. shadcn/ui is the default component system for all Frank UI work.
**Location:** `apps/window/ui` (Vite + React 19 + Tailwind v4)
**Served at:** `/ui` (review surface — see §6)

---

## 1. The rule

> **All new Frank UI is built with shadcn/ui components. Do not hand-write CSS for
> something shadcn already ships.**

Before adding UI, check `src/components/ui/` first. If the component exists, use it. If it
does not:

```bash
cd apps/window/ui
npx shadcn@latest add <component>
```

Never edit a file in `src/components/ui/` to change one screen — wrap it in
`src/components/frank/` instead. Those files are upstream source; we want to keep taking
updates.

---

## 2. What is installed

**39 components**, all added with the real CLI (`radix-nova` style, Radix primitives, Lucide
icons, Geist font):

```
accordion  alert  alert-dialog  avatar  badge  breadcrumb  button  card  chart
checkbox  collapsible  command  dialog  drawer  dropdown-menu  empty  hover-card
input  input-group  label  pagination  popover  progress  radio-group  resizable
scroll-area  select  separator  sheet  sidebar  skeleton  slider  sonner  switch
table  tabs  textarea  toggle  tooltip
```

| | |
|---|---|
| React | 19.2.8 |
| Tailwind | v4 (`@tailwindcss/vite`, CSS-first config) |
| Primitives | `radix-ui` 1.6.7 |
| Icons | `lucide-react` |
| Font | Geist Variable (`@fontsource-variable/geist`) |
| Charts | Recharts 3.8 |
| Toasts | `sonner` |
| Theme | `next-themes`, class-based dark mode |
| Build | Vite 8 + `tsc -b` |

### Why these, for Frank specifically

| Frank needs | Component |
|---|---|
| The left rail (currently 220px fixed) | `sidebar` — collapses to icons, has `SidebarRail` |
| 93 buttons, 54 inputs, 27 selects, 11 textareas | `button` `input` `select` `textarea` `label` |
| 4 modals + 3 disclosures | `dialog` `alert-dialog` `dropdown-menu` `collapsible` |
| Source status ("Ready" / "Empty" / "Unavailable") | `badge` + status conventions in §5 |
| Ad database list, CRM tables | `table` `avatar` `pagination` `scroll-area` |
| Ad Radar filters | `popover` `command` `checkbox` `slider` |
| Long-running research runs | `progress` `skeleton` `sonner` |
| Cross-source search | `command` (Cmd-K) |
| Every metric and trend | `card` + `chart` |

Frank currently renders all tabular data with `<div>`s — there are **zero** `<table>`
elements in the existing `index.html`. That is the biggest structural win available.

---

## 3. Running it

```bash
cd apps/window/ui
npm ci
npm run dev        # dev server with HMR
npm run build      # tsc -b && vite build -> dist/
npm run typecheck  # tsc --noEmit
```

From `apps/window`: `npm run build:ui` and `npm run test:ui`.

---

## 4. Charts

`src/components/frank/smooth-charts.tsx` exports:

| Export | Use |
|---|---|
| `SmoothAreaChart` | Multi-series trend, gradient fill + legend. Owner overview "Source activity". |
| `SmoothLineChart` | Single/multi line, optional axes. Response-time style panels. |
| `Sparkline` | 40px, no axes, no chrome. Inside metric cards. |
| `FRANK_DOMAINS` | Frank's five domain series, pre-bound to `--chart-1..5`. |

**Smooth curves come from `type="natural"`** on Recharts `Area`/`Line`. Without it Recharts
draws straight segments between points. Fills use a vertical gradient (35% → 2% alpha)
rather than a flat colour, so overlapping series stay readable.

### ⚠️ The chart palette had to be replaced

The `radix-nova` preset ships a **greyscale** chart palette — every value has chroma `0`:

```css
--chart-1: oklch(0.87 0 0);   /* chroma 0 = grey */
--chart-2: oklch(0.556 0 0);
```

It is also **identical between light and dark**, so `--chart-1` is near-white in light mode.
On a multi-series dashboard that is unusable: five series render as five
indistinguishable greys. The first build hit exactly this.

`src/index.css` now carries a real categorical palette (Carbon-derived, Apache-2.0)
converted to OKLCH, with separate light and dark sets — `--chart-1..10`. Verified: five
series render five distinct stroke colours. **Do not revert these to the preset defaults.**

---

## 5. Status conventions

Frank's `PRODUCT.md` requires that status never be signalled by colour alone. Every status
badge carries **an icon and a word**, with colour as the third signal:

| State | Icon | Light treatment |
|---|---|---|
| Ready | `CheckCircle2` | `bg-emerald-50 text-emerald-800` |
| Degraded | `CircleAlert` | `bg-amber-50 text-amber-900` |
| Unavailable | `CircleSlash` | `bg-red-50 text-red-800` |
| Empty | `CircleSlash` | `bg-muted text-muted-foreground` |

Carried over from the earlier design research:

- **Numbers get `tabular-nums`.** Without it, columns of digits do not align.
- **A card's left rule carries its domain colour** — this is what makes a six-card grid
  scannable rather than six identical boxes.
- **Empty and error states are designed, not dimmed.** An unavailable source gets a reason
  line and a working Retry button. Frank already computes `reason: adapter_missing`; it
  should not render that in 11px grey.
- **Minimum 14px for body text, 12px floor for captions.** The legacy UI uses **11px as its
  most common size (147 declarations)** and renders **22 distinct font sizes in a single
  view**. shadcn's scale fixes this by construction.

---

## 6. Deployment and scope

The bundle is built in the `ui-build` Docker stage and copied to `/web/ui` in the image.
`server.py` serves it at **`/ui`** (and `/ui/<path>`), falling back to its own `index.html`
for client-side routes.

**This is an additive review surface.** `/ui` does not replace the main Window: `/` and every
existing route still serve `apps/window/web` unchanged, and all native application panels are
untouched. Shipping `/ui` is therefore independently revertable — removing the route and the
Docker copy line restores the previous behaviour exactly.

---

## 7. Migration path for the existing UI

`apps/window/web` is ~28 raw ES modules and ~6,000 lines of hand-written CSS, served
directly by the Python host with no build step. It coexists with `apps/window/ui` during
migration.

| Step | Work |
|---|---|
| 1 | Shell — rail, header, routing (done: `App.tsx`) |
| 2 | Owner overview rebuilt (done: `owner-overview.tsx`) |
| 3 | Port one real view at a time, starting with **Ad database** — strongest current surface, natural `table` fit |
| 4 | Move each migrated route from `/` to `/ui` |
| 5 | Delete each `web/js/*.js` module and its `*.css` as its replacement ships |
| 6 | Retire `tokens.css` once nothing reads it |

**Do not port all 19 views at once.** Each should ship and be verified independently.

---

## 8. Verification

```bash
cd apps/window/ui && npm run build
```

Current output: **2,573 modules, ~886 KB JS (263 KB gzip), 114 KB CSS (18 KB gzip)**,
builds in <1s. Zero TypeScript errors, zero console errors at runtime.

Screenshot harness: `design-system/lib/shoot-ui.mjs` — captures both themes, asserts chart
and curve counts, fails loudly on page errors.

---

## 9. Licence

shadcn/ui is **MIT**. Components are copied into this repository, so we own the source.
Radix UI (MIT), Tailwind (MIT), Lucide (ISC), Recharts (MIT) and Geist (SIL OFL) are all
permissive. The Carbon-derived chart palette is Apache-2.0 — keep the attribution comment
in `src/index.css`.

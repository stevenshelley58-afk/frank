# Frank UI — shadcn design system

**Status:** adopted. shadcn/ui is the default component system for all Frank UI work.
**Location:** `apps/window/ui` (Vite + React 19 + Tailwind v4)
**Served at:** `https://frank.fail/` and the owner routes under `/project/blockwise/` (behind the owner auth gate); assets at `/ui/assets/` (see §6)

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

`src/components/ui/chart.tsx` (shadcn's Recharts wrapper) is the chart primitive. The earlier
`smooth-charts.tsx` helpers were removed with the fixture overview; add a chart component beside
the screen that needs it, under `src/components/`, and use `type="natural"` on Recharts
`Area`/`Line` for smooth curves.

### The chart palette was replaced

The `radix-nova` preset ships a **greyscale** chart palette (chroma `0`, identical in light and
dark). `src/index.css` carries a real categorical palette (Carbon-derived, Apache-2.0) converted to
OKLCH with separate light and dark sets, `--chart-1..10`. **Do not revert these to the preset
defaults.**

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

The bundle is built in the `ui-build` Docker stage (which also copies `apps/window/web/js`
beside it, see §7) and copied to `/web/ui` in the image. Vite's `base` is `/ui/`, so every
asset URL is absolute (`/ui/assets/...`) whatever path the document was requested from.

**The shell is Frank's front door.** `apps/window/owner_shell.py` decides which document the
SPA catch-all in `server.py` serves:

| Request | Document |
|---|---|
| `/`, `/project/blockwise`, `/project/blockwise/<section>`, `/project/blockwise/customer/<id>` | the shell (`/web/ui/index.html`, `Cache-Control: no-store`) |
| any of those with `?technical=1` | the classic window (`/web/index.html`) |
| `/hub`, `/tools`, `/files`, `/blog-studio`, every other route | the classic window |
| `/ui`, `/ui/`, unknown `/ui/<path>` | 308 to `/` |
| `/ui/<real file>` | the bundle asset |

The section allowlist is the one in `web/js/view-routing.js`, which the shell imports, so the
server and the browser agree about which URLs belong to the shell. `/hub` is the classic chats
and projects home; the classic window itself now navigates there instead of `/`.

The classic window hands the Blockwise project over: `showProject("blockwise")` performs a full
navigation to the owner route rather than mounting its own owner dashboard. The vanilla owner
dashboard module (`web/js/owner-dashboard.js`) is no longer mounted in production; it stays in
the tree only because other modules and tests import its exports.

Caddy's CSP for this host already allows the bundle and the native panels: `script-src 'self'`,
`style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `img-src 'self' data: blob:`,
`frame-src 'self' https://crm.frank.fail https://marketing.frank.fail https://mail.frank.fail`.

---

## 7. What the shell reuses, and what still renders in the classic window

The shell does not carry a second implementation of anything the vanilla Window already
implements and tests. Three vanilla modules are bundled verbatim through the `@legacy` alias
(`ui/vite.config.ts`, typed in `ui/src/legacy.d.ts`):

| Module | Role in the shell |
|---|---|
| `web/js/view-routing.js` | the owner route grammar (`lib/routes.ts`) |
| `web/js/owner-app-host.js` | the native panel host: readiness check, bridge protocol, sign-in hand-off, preloading, retained panels, unsaved-work guard (`components/native/NativeHost.tsx`) |
| `web/js/ads/ads-workspace.js` | the Ads workspace, mounted as an island (`components/ads/AdsIsland.tsx`) |

Their stylesheets (`/tokens.css`, `/owner-dashboard.css`, `/ads.css`, `/ads-controls.css`) are
linked from `ui/index.html` and served by the Window host, so the shell and the classic window
read the same files. `tokens.css` is generated from `ui/src/index.css` and is what gives those
modules the `--ink`/`--line`/`--bg` aliases.

Layout: a narrow icon rail names the areas (Overview, Ads, Content, CRM, Mail, Email flows,
Customers, Reports; Tools and Settings below), a secondary menu lists the sections inside an
area that has more than one (CRM: Leads, Support; Reports: Results, Revenue, Notifications;
Content and Tools: their destinations), and the content pane renders the section. Under `lg`
the rail and secondary menu collapse into one drawer.

Data: Overview, Customers and Reports render `/api/owner/workspace/sources` and
`/api/owner/workspace/readiness`; a customer record renders
`/api/owner/workspace/customers/<id>`. A source that is not connected renders its own
unavailable state; nothing is invented.

Still in the classic window, reached from the Content and Tools menus as full navigations:
chats and projects (`/hub`), Files, Connections, Accounts, Trace, Releases, Ops, Live, Map,
Control, Blog Studio, Ad Template Generator, Ad Radar, Ad database, and the Blockwise
technical view (`/project/blockwise?technical=1`). Convert one at a time; each conversion
removes its entry from `components/areas/Areas.tsx` and its `web/js` module once nothing else
imports it.

---

## 8. Verification

```bash
cd apps/window/ui && npm run typecheck && npm run build
cd apps/window && bash scripts/verify.sh
```

`verify.sh` covers the theme parity check, the Python route split tests
(`tests/test_owner_shell_routes.py`), and the vanilla hand-off tests
(`tests/owner_dashboard_route.test.mjs`, `tests/view_routing.test.mjs`). Live acceptance is a
browser on the deployed revision: the shell at `/`, CRM, Support, Mail and Email flows opening
inside it, Back and Forward across sections, and the 390px layout with no page-level horizontal
scroll and no control under 44px.

---

## 9. Licence

shadcn/ui is **MIT**. Components are copied into this repository, so we own the source.
Radix UI (MIT), Tailwind (MIT), Lucide (ISC), Recharts (MIT) and Geist (SIL OFL) are all
permissive. The Carbon-derived chart palette is Apache-2.0 — keep the attribution comment
in `src/index.css`.

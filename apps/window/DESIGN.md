# Frank design system

Approved 15 September 2026. The owner accepted the design in `owner-ui-review-20260915` and requested this exact system across Frank. This replaces the earlier Inter-only, red-dot, icon-only-mobile design rules. Impeccable `extract` governs shared-token consolidation; `polish` was used for specialist surfaces.

## Product and architecture
Frank is the owner's Window and Hub. Home/chat, projects, tools, files, connections, studios and operator views belong to Frank. Blockwise remains one project workspace, not a new Frank application. Customers remain in Blockwise. Hermes keeps reasoning, tools and execution.

The approved preview is a design reference, not a production data source. Never import its sample metrics or replace working features with sample interactions. The current production Window keeps its existing DOM modules, routes, event handlers, IDs, native panels and APIs. New React features use the installed `ui/src/components/ui` shadcn primitives. Existing Window controls consume the same theme through the generated token bridge; they are not falsely described as migrated React/shadcn components.

## One authoritative theme
`apps/window/ui/src/index.css` is the source for the approved shadcn semantic palette and chart colors. `scripts/sync-window-theme.mjs` extracts its light and dark theme into `web/tokens.css` and maps legacy names to those exact values. Run it after changing theme values; `--check`, the verification runner and the parity regression test reject drift. Never independently tune a second legacy palette.

- Font: self-hosted Geist Variable, 100–900, with its OFL license retained. UI 14px/1.5; metadata normally 12px; form help at least 12px.
- Background and cards: `--background` / `--card`, white in the approved light theme.
- Main text: `--foreground`, oklch(.145 0 0).
- Secondary text: `--muted-foreground`, oklch(.556 0 0).
- Primary controls: `--primary`, oklch(.205 0 0), with `--primary-foreground`.
- Dividers and inputs: `--border`, oklch(.922 0 0).
- Hover/selected/subtle surface: `--muted` / `--accent`, oklch(.97 0 0).
- Rail: `--sidebar`, oklch(.985 0 0).
- Radius base 10px. Controls 8px; cards 14px; larger panels/dialogs 18px. Pills only for badges/tags, not every button.
- Spacing: 4/8/12/16/24/32px. Content padding 32px desktop, 16px mobile; restrained 20px grid gaps.
- Data uses tabular numbers. Chart colors come from the existing ten-color semantic chart palette; never use colors as the only evidence of state.
- Frank's red mark remains branding. Destructive, warning and successful states retain semantic colors; routine navigation is neutral.

The legacy runtime currently presents the approved light theme. Its token bridge includes the matching dark palette for parity, but a global dark-mode control is not exposed until every owned surface has dark-mode acceptance. Native applications control their own themes.

## Layout and hierarchy
Use the approved quiet shell: 240px pale rail, 64px header, flat white working canvas, rounded controls and subtle borders. Preserve one viewport; long working regions scroll internally. Work should fill the available width without nesting the same control hierarchy repeatedly.

Home remains the Hermes conversation surface. Keep projects/chats visible and searchable. Tools contains specialist applications; Connections is directly reachable. Technical Live/Map/Control/Trace/Releases remain under More. Never remove a route or capability merely to shorten the menu.

On small screens, replace the 60px icon rail with a labelled modal navigation drawer. The same original rail moves into that drawer so project/chat listeners and existing route behavior survive. Native dialog handling provides Escape, focus trapping and background inertness. Reopening and resizing must restore the rail correctly. Touch actions should be at least 44px where practical; dense desktop controls may be 40px.

Page search uses existing navigation labels and conversation titles only. It neither searches private message bodies nor stores the query. Ctrl/Cmd K opens it; blocked navigation must not bypass unsaved-work protection.

## Components and content
For React screens, reuse installed shadcn buttons, inputs, dialogs, sheets, selects, tables and tabs. Do not add another framework. For existing vanilla Window screens, update their owning styles and semantic controls rather than injecting Tailwind preflight or an override stylesheet. Preserve native browser controls where a rewrite would needlessly risk behavior.

Headings describe the working area. One main action per context; routine controls stay quiet. Details, IDs, receipts and provenance remain available without dominating the first viewport. Use functional copy, no decorative eyebrows or em dashes in new copy. Show unavailable, loading, empty, denied, stale and failure states honestly. Missing data is not zero. A successful UI click is not provider completion.

The content editor, ad review canvas and timeline are specialist layouts, not generic dashboard cards. Preserve source images, aspect ratios, annotations, artifact evidence, drafts, version guards and approval controls. Do not repaint actual creative artwork, graph canvases, video or native application interiors.

## Native applications and alerts
Frappe CRM and Helpdesk have one primary CRM family entry; Support is an internal family view. Preserve `/project/blockwise/support` and existing native-panel sessions. Roundcube and Mautic keep their specialist UIs in the shared shell. Native authentication, origin validation, session readiness, preloading and unsaved-mail protection are unchanged. Never inject global CSS into native frames.

Alerts must distinguish unread from unresolved and use real action identities before adding counts. Do not transplant sample badges from the approved preview. No new notification permissions, push subscription, OS badging, provider connection or campaign activation is part of this visual rollout.

## Verification and boundaries
Check desktop and 390px: shell, search, drawer open/close, back/refresh, forms, tables/cards, native CRM-family navigation and overflow. Review real working and error states. Keep the old backend/behavior tests and shared-token parity test. Release from the exact committed revision through the canonical Frank release path; do not apply a live CSS overlay.

The separate `/ui/` component playground remains available and is not the app's new entry point. The approved sample owner preview remains a reference until its full behavior can be migrated safely. Theme alignment is not a claim that every old screen has been converted to React, that native apps have been redesigned, or that backend launch gates have passed.

## Blockwise owner native application launch

`/project/blockwise` is now a small owner launch surface, not a dashboard or a replacement application.

- The sole primary action is `Open CRM`.
- Short labelled lists link to the native CRM, Helpdesk, Purelymail, Mautic, Stripe, reports, ntfy, and ntfy. Custom tools remain in the Frank sidebar.
- Private Frappe, Mautic, and ntfy links say `Requires Tailscale`. Mautic uses its native login and is not SSO.
- Links open a separate tab with `noopener noreferrer` and no referrer. There are no iframes, credentials, auto-login claims, copied provider data, fake metrics, or provider actions.
- Scheduling says that no native interface is deployed. It has no sample or substitute UI.

The surface remains in Frank's incumbent white Inter shell. It uses an ink primary pill, text-first link rows, hairlines, and a single-column mobile composition. It deliberately avoids an owner-local rail, cards, charts, mock records, or a provider-state simulator.

The technical project home stays available at `/project/blockwise?technical=1`; other project homes and real custom Frank applications remain reachable and unchanged.

Frontend acceptance only proves named routes, safe outbound-link attributes, non-embedding, scoped routing, and the preserved technical-home route. It does not prove native authentication, provider delivery, billing, reporting, or scheduling.

## Ads workspace

`/project/blockwise/ads` is the owner's paid-advertising section, beside Mail,
CRM and Email flows. It is a Frank read model with no native application to
frame, so it takes the read slot whole rather than being wrapped in the panel
title every other section gets.

It extends the incumbent white, compact system rather than adding a second one:
the same tokens, the same Inter steps, the same hairlines, the same pill
actions. What changes is density. An ads screen is an Operate surface read
against a table, so it adds:

- **A context strip that never scrolls.** Account, date range, comparison
  period, attribution setting and last successful sync sit above the screen nav
  and stay put while the rows move.
- **One management table, three altitudes.** Campaigns, ad sets and ads share a
  table with sortable headers, choosable columns, saved filter views, row
  selection with shift-range, and paging. Numbers are right-aligned with tabular
  figures so a column can be read down the page.
- **Measurement labels at the point of display.** Meta-attributed and
  website/CRM-observed numbers are different facts. They never share a column or
  a total, and an observed metric carries its source inline.
- **Evidence instead of a winner badge.** Low volume renders *Insufficient
  evidence*, not a crown, and a comparison refuses a verdict while the
  confidence intervals overlap.
- **A record drawer, not a second page.** Rows open a trailing panel so the list
  behind it survives; Escape closes it and focus returns to where it was.

The red `--mark` stays what it is everywhere else: the active marker only. No
new accent, no tinted panel and no chart wall — the overview carries exactly one
chart, because a screen where every metric has its own sparkline is a screen
nobody reads.

Motion follows the same restraint: entering surfaces (drawer, popover, bulk bar,
publish flow) get a short custom ease-out because they explain a state change,
repeat-use controls get a bounded transition and nothing more, and everything
collapses under `prefers-reduced-motion`.

`web/ads.css` owns every style, scoped to `.ads-workspace`, so no other Frank
surface changes.


# Blockwise owner UI review

**Status: superseded.** The isolated preview described here was replaced by the shell that
now serves Frank's root and owner routes with live data and the native panels; see
[`SHADCN-UI.md`](SHADCN-UI.md) §6 and §7. The surface map and preservation gates below remain
the conversion inventory for the views still rendered by the classic window.

## Scope
Interactive UI-only concept. No new backend connection, service authentication, Meta write, notification subscription, payment, email send or production deployment. The existing ads repair and native app code stay unchanged. The concept is not a replacement for their tested business logic and is not functional-parity acceptance.

## Evidence and diagnosis
The six-screen Meta preview at :18918 was inspected on desktop/mobile. It has extensive explanation, ID/provenance tables, scattered controls and zero creative thumbnails. At 390px its tables range approximately 433-1247px wide. The customer Home, Results and template preview were inspected live: stronger hierarchy, actual creative previews, one understandable graph, coherent controls. Adopt those interaction/layout principles, not customer code or customer stores. Native CRM was inspected directly and remains authoritative. The live CRM screen has a large getting-started drawer competing with the lead list; use supported native setup/preferences to remove irrelevant onboarding once appropriate, rather than injecting CSS. Native screens need a full-width hosting region and deliberately managed outer versus inner navigation, not a small iframe card with two cramped sidebars. The agent's owner-project route landed on Home; do not assume that alone proves an authentication failure. Other native-app internals below were inspected through their source contracts, not exhaustive live workflow tests.

## Complete owner surface map
| Area | Features to retain | Presentation ownership | Preview coverage |
|---|---|---|---|
| Overview | attention, source health, customer context, record drill-down | shadcn | Action-first home, filters, record handoff and sample completion |
| Meta Ads | overview, campaign/adset/ad hierarchy, filters, saved views, columns, bulk review, identity, evidence, creatives, destinations, tracking, queue, recovery | shadcn with original tested models retained later | Six-screen visual/interaction concept; advanced parity tests still required |
| Ad Radar | chronological observations, filters, research/evidence reports | shadcn | Inventory and navigation placement; not a full rewritten research engine |
| Ad database | creative assets, search/filter, evidence detail | shadcn | Inventory and placement under Ads/Content assets; full data workflow retained for subsequent conversion |
| Content templates | generator inputs, variants, QA, versions, review/export | shadcn; Hermes executor retained | Sample content workspace and detail states |
| Blog Studio | briefs, drafts, source/QA review, versions, delivery state | shadcn; Hermes executor retained | Sample list and detail states |
| Video Studio | jobs, assets, renders, history, errors | shadcn; existing tool boundary retained | Sample UI state; no render job |
| CRM | leads, deals, contacts, organizations, tasks, notes, activity | native Frappe | Single CRM outer shell and state review only |
| Support | tickets, replies, helpdesk KB | native Frappe Helpdesk | Inside CRM family; no duplicated top-level Support |
| Mail | folders, messages, composition, drafts | native Roundcube | Shell/state preview; no message access or sends |
| Email flows | campaigns, emails, templates, outcomes | native Mautic | Shell/state preview; no automation activation |
| Customers | cross-app identity, account/trial state, billing, access, consent and followup | shadcn read/control context, original authorities retained | Sample customer detail; no mutations |
| Booking | scheduling readiness and owner followup | existing SnagTime service/native UI where available | Readiness only; do not invent an operational calendar |
| Reports and revenue | spend/leads/quality, currency, cash versus MRR, attribution/freshness | shadcn projections, native analytics where suitable | Sample report presentation |
| Alerts | action IDs, grouping, unread versus unresolved, urgency, snooze, history, badges | shadcn UI; existing event/delivery path later | Local sample states only; no OS notifications |
| Settings | workspace, accounts, connections, device and alert preferences | shadcn | Visual settings only |
| Tools | files, connections/accounts, trace, releases, live/map/control, Hermes | existing native/technical tools with shared shell | Secondary placement; no backend replacement |

## Required implementation preservation gates
Before replacing old production surfaces, retain and re-run immutable IDs, tracking joins, URL-stored saved views, configured columns, full lifecycle, version conflicts, cross-tab recovery, before/after approval snapshot, uncertain-write reconciliation and attribution/evidence floors. A nice preview does not replace those checks. Preserve app sessions, draft retention, deep links, Back/Forward and native permissions. A shared hostname is not proof all native routes share permission.

## Native shell contract
One primary app-family entry. CRM internally switches Leads / Tasks / Support while CRM and Helpdesk remain separate native tools. Frank styles only its shell and owned controls, never globally injects Tailwind/CSS into cross-origin native apps. No proxy-auth workaround, no duplicate CRM, no rebuilt mail client. Native region in this review is explicitly a placeholder so approval concerns framing rather than a fake clone.

## Preview safety
Only compiled public demo files may be served. Never serve a worktree, repository, secrets directory, or /root/work broadly. Bind to Tailscale only; do not change public ingress. Task-owned unit frank-owner-ui-review has a 24-hour runtime limit and stop method: systemctl stop frank-owner-ui-review. It must not be mistaken for production service. Source branch: owner-ui-review-20260915.

## Outstanding
This first UI concept is for direction and interaction review. Full conversion of every legacy tool, advanced ads behavioral parity, real native panel display in the new shell, backend integration, and actual OS/device alert delivery remain separate work. No launch readiness is claimed.

## Priorities and proposed subagent work plan

### 0. Lock the direction before wiring anything
Parent owns the shared design contract, route map and acceptance decisions. Use this isolated preview to approve structure, density, language and mobile behavior. Do not merge the prototype App.tsx over the production app: it deliberately removes live behavior and uses sample records. The existing customer UI is a visual/interaction reference only, not a code import.

Required decisions: keep the current Frank shadcn theme; action-first Overview; Ads as one workspace; Content as one workspace; one CRM entry with Support inside it; full-width native regions; Tools secondary. No backend, authentication, provider-write or device-permission work in this UI phase.

### 1. Shell and shared interaction agent
Ownership: apps/window/ui/src/App.tsx, shared owner-shell components and apps/window/ui/src/index.css. Parent alone resolves design-token changes in apps/window/DESIGN.md.

Tasks: extract the approved shell from the prototype, preserve original routes rather than replacing their data models, make menu grouping and active states consistent, preserve Back/Forward, add accessible global search, clear breadcrumb/context, keyboard focus and mobile safe areas. Establish loading, empty, denied, unavailable and stale-data patterns. Keep 44px touch controls and no page-level horizontal scrolling at 390px. Do not duplicate native navigation unnecessarily.

Exit: keyboard-only and desktop/mobile navigation pass; no dead primary controls; each route has one clear heading and primary action. Deliver exact changed files and screenshots.

### 2. Meta Ads migration agent
Ownership: apps/window/ui/src/components/owner/AdsWorkspace.tsx and newly extracted ads presentation components. Read existing apps/web/js/ads source contracts; do not independently rewrite their tested models or mutate their existing worktree.

Tasks: convert Overview, Campaigns, Creative, Blogs & destinations, Tracking and Queue to actual shadcn controls. Keep account/currency/timezone/date context. Put decisions before explanations; reveal provenance on demand. Show real creative images when available and a truthful missing-asset state otherwise. Keep campaign/adset/ad relationships, status filters, saved views, configurable columns and explicit selection. Provide a mobile contextual review bar. Review must show only selected records with immutable IDs, before/after values and revision checks. Preserve uncertain-outcome handling rather than offering an unsafe retry. Use agent-acquisition examples for Blockwise's owner account, not home-seller acquisition examples from customer accounts.

Exit: every old ads behavior has a named old-to-new counterpart or explicit retained fallback; 390px cards and desktop tables work; switching filters/levels cannot silently broaden a selection. Drafts survive the specified navigation/refresh lifecycle, conflicts and failures are visible, and no sample action is described as a provider success. UI phase uses deterministic fixtures only.

### 3. Content, customers and reports agent
Ownership: apps/window/ui/src/components/owner/AppsWorkspace.tsx content/customer/report sections, to be extracted into separate owned files before another agent edits them.

Tasks: complete the actual workflows behind Blog Studio, Templates, Video and Assets, not just lists. Preserve inputs, versions, source evidence, QA, preview, edit, export and failed-job recovery. Extend customer context to account, trial, billing, consent, access and booking handoff without rebuilding CRM or billing authorities. Reports need trustworthy source/date/currency labels, chart values accessible without hover, and separate cash/MRR/provider/website/CRM figures. Convert Radar and Ad DB search, creative inspection, reports and history using their existing engines. Do not leave an inventory card masquerading as a migrated feature.

Exit: each meaningful control leads to a complete fixture-based flow; pending checks never display a completion checkmark; blank, long, error and stale records render correctly. No invented calendar, billing total, publication or render success. Record all specialist tools still using their existing UI.

### 4. Native-app shell agent
Ownership: native-shell components extracted from AppsWorkspace, with sole ownership assigned before parallel work. No edits to native application internals without a separate verified need.

Tasks: review Frappe CRM, Helpdesk, Roundcube, Mautic and any native booking/analytics surface on desktop and mobile. Keep native functionality native. CRM and Helpdesk share one outer CRM menu family but retain their distinct permissions and routes. Prototype full-width framing, restrained outer navigation, clear app identity, loading, session return, denied/unavailable and unsaved-work handling. Use supported native preferences for distracting onboarding, not injected cross-origin CSS. Document whether each app permits supported embedding; if not, design a clear open-native handoff with return context. Do not work around authentication or security headers to force an iframe.

Exit: all native feature entry points inventoried and visually reviewed; shell states approved using placeholders first. Real session/embedding verification is a later connection gate, not claimed from this preview.

### 5. Action visibility and notifications agent
Ownership: extracted owner alert model/components and settings. Coordinate with the shell owner through a shared typed interface; do not concurrently edit App.tsx.

Tasks: define one action identity per item, deduplication, urgency, assignment, unread versus unresolved, snooze duration, history and exact destination. Keep app icon, CRM family badge, menu counts and inbox reconciled. Seen must not mean done. Completion in the owning UI removes the outstanding count; failure keeps it visible. Snoozed work stays findable and returns at its due time. Include private lock-screen text and quiet-hours/critical-item decisions. Design desktop and mobile appearance, permission denied, unsupported device and muted state before building delivery.

Exit: fixtures exercise new, duplicate, seen, snoozed, due, completed, reopened and failed work. Badges and inbox agree after navigation and refresh. Actual desktop/mobile push, OS icon badging and cross-device synchronization remain disabled in this phase and require later real-device proof; visual mockups are not delivery proof.

### 6. Independent UI acceptance agent
Ownership: review evidence and tests only. No broad source edits; return material defects to the responsible agent.

Tasks: test the daily owner journey: find today's work; inspect and review an ad; inspect its creative and destination; handle an uncertain outcome without duplicate action; review content; find a customer/support task through CRM; return from a native app; discover work from a badge and finish it. Check 390px and desktop, keyboard, focus return, text zoom, contrast, dark/light theme, reduced motion, long lists, empty/error states and refresh/back navigation. Compare every inventoried old feature to its converted or retained route. Check route-level loading and bundle splitting before calling mobile performance ready.

Exit: zero unresolved critical/major UI defects, evidence for each route and state, exact remaining exceptions, approved design document. Only then prepare a separate backend/notification integration plan. No production release merely because this preview builds.

## Execution order and coordination
Run 0 first. Establish shell interfaces and extract ownership boundaries in 1. Then 2, 3, 4 and 5 may proceed independently within available slots. All agents work in their own VPS worktrees, are not alone in the codebase, preserve others' edits and return reviewed commits. Parent integrates and resolves shared-file conflicts. Run 6 on the integrated candidate, not on isolated screenshots. Do not replace any production route until its preservation gate passes. Keep the old route available until the replacement is approved; rollback is the previous approved revision, not deletion of worktrees or data.

## Browser verification of this isolated concept
Checked 2026-09-15, against the compiled preview, not production.

| Area | Evidence obtained | Still not proven |
|---|---|---|
| Shell | Desktop and 390x844 mobile layouts; single CRM grouping; section routing | Full route/keyboard/a11y suite, every breakpoint |
| Meta | Six screens render; campaign search; explicit selected-record before/after sheet; 390px cards without document overflow; creative preview; destinations; invalid tracking URL disables save; valid session save survives refresh; queue uncertainty filter | Full legacy parity, provider writes, real creative loading |
| Alerts | Mark seen leaves count unchanged; snooze reduces count; restore returns count; badges group CRM/support; sample content review changes global count from 6 to 5 | Timed snooze, real event ingestion, cross-device delivery |
| Content | Record detail, review feedback; sample completion reconciles owning alert | Full editor/export/generation/history workflow |
| Native shell | CRM Support route; expired-session example and return; notification example opens Support | Real embedded native screens or auth renewal |
| Reports | Metric switch and accessible expandable chart values | Live attribution or billing data |
| Customers | Sample account list and detail tabs | Real account/billing operations |
| Settings | Notification appearance dialog; explicitly no device notification or permission request | Real OS badge/push behavior |

TypeScript/Vite build, focused ESLint, and diff checks pass. The mechanical UI detector returned no findings before the last bounded copy/state fixes; this is not accessibility certification. Vite reports an approximately 809kB uncompressed main JS bundle (about 244kB gzip) and a future config-loader warning. Route splitting and real mobile performance checks remain before release. Other native interiors and specialist tools are inventory/source-reviewed, not exhaustive live UX acceptance.

## Handover
Preview: http://100.78.126.112:18921/?section=ads (Tailscale required; task-owned preview has a 24-hour lifetime). The source and report remain in branch owner-ui-review-20260915. No production deployment or backend connection was performed. This document is the subagent work plan and conversion inventory; the prototype is an approval aid, not a launch-readiness claim.

# Blockwise owner UI review

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

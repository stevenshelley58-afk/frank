---
version: 1
slug: owner-dashboard
primary_target: web/js/owner-dashboard.js
related_targets: [web/owner-dashboard.css]
---

## Scope and mode
Operate. Owner-only Blockwise project home inside Frank. Frontend preview only.

## Approved direction
Extend Frank's white Inter Window, restrained separators, one viewport with internal content scrolling. Start with actionable customer work, then four business measures, acquisition evidence and today's work. Avoid an equal-card wall. The owner can move between customers, inbox, growth, revenue, email flows, operations and connection readiness without losing Blockwise context.

## Boundary
The 14 September user approved building the frontend first, connecting later. All figures and people are explicitly fictional sample data. No provider calls, authentication changes, billing mutations, sends, imports, secrets or persistence. Source labels never imply a connection. Existing native CRM/mail/billing remain authoritative. This is not a customer-facing Blockwise route.

## Interaction acceptance
All screens navigable on desktop and phone; date ranges and filters change sample views; detail panels, notifications and state previews are interactive. Disabled live actions explain the boundary. Keyboard focus, Escape and restoration, empty/no-results/loading/disconnected/stale/error views must work. No horizontal page overflow at 390px or 768px. Preserve technical project home via ?technical=1.

## Implementation choice
Code-first expansion of existing Frank operations preview. Reuse the Window shell, tokens and installed chart libraries. No new UI framework or second CRM. Source schemas/adapters remain future connection work, not frontend claims.


## Observed shipped facts

- The surface inherits Frank's white and Inter treatment and scopes local values to ink `#111`, muted text `#666`, hairline `#ececec`, soft neutral `#f7f7f6`, and Frank red `#e53c1f` for the active navigation dot.
- The local shell is `174px + flexible content` on desktop, `132px + flexible content` below 900px, and stacked with a horizontally scrollable navigation row below 620px. The main pane owns scrolling.
- Cards and dialogs use 12px corners; nav items, fields, and connection tiles use 8px; controls and chips use a pill radius. The dashboard uses hairline borders and one restrained native-dialog shadow.
- Inter hierarchy is local and compact: 30px Blockwise title, 16px section headings, 22px tabular stat values, and 10–13px supporting labels and evidence notes.
- Active navigation uses a red dot and semibold text; active tabs and range controls invert to ink. Focus-visible controls use a 2px ink outline with a 2px offset.

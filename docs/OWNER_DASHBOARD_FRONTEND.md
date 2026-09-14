# Blockwise owner dashboard frontend

## Scope

Frank's owner-only `/project/blockwise` home is a frontend preview. It renders fictional, in-memory sample data. It does not connect providers, send messages, change billing, import customers, or alter authentication. The real technical project home remains available at `/project/blockwise?technical=1` with a return link.

The default home and legacy operations-preview link open the same new frontend. Other project homes are unchanged. Existing native Frappe, Helpdesk, Purelymail, Mautic, Stripe and customer Blockwise surfaces remain separate authorities.

## Implementation

- `apps/window/web/js/owner-dashboard.js` owns preview state, section rendering, filters and read-only details. `mountOwnerDashboard(host)` returns a cleanup function called by the existing router.
- `apps/window/web/owner-dashboard.css` is scoped to the owner dashboard and its native dialogs, within the existing Frank Window shell.
- The existing `app.js` project selection branches before the live Home fetch. Its normal home-refresh work is disposed when entering this preview.
- `view-routing.js` selects the dashboard only for Blockwise and preserves the technical-home option.
- There is no browser storage or provider transport in the dashboard module. Labels identify sample data; connection cards do not represent provider readiness.

## Future connections

Replace fictional read models through existing versioned Frank widget/projection contracts, with per-source freshness and independently failed sections. Provider authentication and execution remain server-side; credentials never reach this frontend. Do not wire browser requests directly into private customer databases. Customer scope, business acquisition accounts versus client accounts, metric definitions, notification deduplication and real SSO acceptance are later work.

## Verification boundary

Frontend acceptance covers navigation, filters, date controls, read-only details, notification preview state, failure/empty/disconnected views and desktop/phone layout. It is not evidence of CRM synchronization, inbox delivery, subscription charging, marketing journeys, provider reporting, phone push or shared login.

Evidence is recorded under `/srv/frank/verification/owner-dashboard-ui-20260914`. Initial whole-repository verification found unrelated baseline failures: two knowledge-manifest hash errors, an Ad Template Generator score expectation mismatch, and existing secret-pattern detections. Missing pinned submodules were initialized without changing their pins. Relevant Home tests and JavaScript/browser results are recorded separately; do not call the entire Frank suite green.

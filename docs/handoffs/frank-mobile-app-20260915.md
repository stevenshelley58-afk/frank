# Handover: Frank as an installable phone app with push

Dated handoff, 15 September 2026. It records the state at the time of writing
and the work ordered next. It does not override the current guides
(`docs/README.md`, `docs/SHADCN-UI.md`, `docs/OWNER_WORKSPACE.md`).

## Outcome required

Steven opens Frank on his Android phone (Pixel 10) from a home-screen icon,
it behaves like an app, and it tells him when something needs him. On the
phone he needs to manage leads (CRM and Support) and email (Mail). Mautic he
uses only on the laptop; on the phone it is reachable but not the point.

Decisions already made by the owner, do not reopen them:

- Web Push from the installed Frank app itself (option B). Not the ntfy app,
  not a native wrapper, not a third-party push vendor.
- shadcn for every Frank UI. Reuse the vanilla modules the shell already
  bundles (`web/js/view-routing.js`, `web/js/owner-app-host.js`,
  `web/js/ads/ads-workspace.js`); do not rewrite them.
- Layout rule on wide screens stays: icon rail, secondary menu when an area has
  more than one section, content pane. The phone gets its own layout (below).
- No em dashes in any text, copy or docs.

## Addendum, 16 September 2026: Frank's home is the hub, not Blockwise

Owner correction, and it changes the order of work. Do this first, before the
phone layout and push, because both of those hang off the shell's structure.

### What is wrong today

The shell at `/` is the Blockwise owner workspace. Frank is the hub for every
project the owner runs: Frank itself, Blockwise, Mini Frank, Pavone,
Merrypaws, Elf & Wonder, Business OS (`GET /api/projects` is the list; ids
`blockwise`, `merrypaws`, `elfwonder`, `pavone`, `mini-frank`, `business-os`).
The hub and the Hermes chats still exist in the classic window at `/hub`,
which is the wrong way round. Blockwise is one project inside Frank.

### Required structure (same shell, one level up)

1. `/` is the hub: every project as a card (name, setup state from
   `/api/projects`, what needs the owner from that project where a read
   model exists; for Blockwise that is the attention count from
   `/api/owner/workspace/sources`), and the Hermes chat list from
   `/api/chat/sessions`. Opening a chat goes to the classic window
   (`/hub` keeps working) until chats are converted; say so on the card.
2. The icon rail becomes the project switcher: Frank (home), then each
   project. Tools and Settings stay at the bottom. On the phone this is the
   "More" sheet plus a Home tab.
3. The secondary menu becomes the current project's sections. For Blockwise
   they are the ones already built: Overview, Ads, Content, CRM (Leads,
   Support), Mail, Email flows, Customers, Reports. Everything under
   `/project/blockwise/...` keeps its URL and its behaviour; only the root
   changes. The Blockwise overview moves from `/` to `/project/blockwise`.
4. Every other project gets `/project/<id>` in the shell: a project home
   with the same information the classic project home shows today
   (`openProjectHome` in `web/js/homes.js`: name, blurb, status, setup
   state) and links into the classic window for the rest
   (`/project/<id>?technical=1`). No fixture data; a project with no read
   model says so.
5. Server split: `owner_shell.py` must serve the shell for `/` and
   `/project/<id>` for every id in the project registry grammar
   (`validId` in `view-routing.js`), not only `blockwise`; `?technical=1`
   still goes to the classic window for every project. Update the tests.
   The classic window's `showProject` hand-off (`web/js/app.js`) then
   applies to every project, not only Blockwise, with the same
   `?technical=1` escape.

### Preserve

- The trusted-device entry, native panels, drill-downs, Ads island and
  route grammar exactly as they are. This is a re-parenting, not a rebuild.
- `/hub` keeps serving the classic hub until chats are converted; the shell
  links to it, it is not removed.
- The hPanel rule: icon rail, secondary menu, content pane, on every screen
  that has more than one section.

### Acceptance

On the laptop and the Pixel: open `frank.fail`, see the hub with every
project and the chats; tap Blockwise, see its sections in the secondary
menu and the overview in the pane; tap Mail, see the mailbox inside Frank;
tap another project, see its home; Back returns through each step. Anonymous
and forged-proof requests to `/` and `/project/<id>` still reach the
identification stage.

## 1. Bootstrap and source rules

Use `ssh vps` (root). Read, in this order:

- `/projects/blockwise/AGENTS.md` (the rulebook), `/projects/frank/AGENTS.md`
- `/projects/frank/docs/README.md`
- `/projects/frank/docs/SHADCN-UI.md` sections 6 and 7 (the shell, the route
  split with the classic window, what it reuses)
- `/projects/frank/docs/OWNER_WORKSPACE.md` (owner surface contract)
- `/projects/frank/apps/window/infra/owner_notifications/README.md` and
  `/projects/frank/apps/window/infra/owner_crm_notifications/README.md`
  (the alert pipeline that already exists)

Edit in a task worktree
(`git -C /projects/frank worktree add -b <task> /projects/frank-worktrees/<task> origin/main`),
never in `/projects/frank`. Canonical `/projects/frank` carries an unrelated
modified `AGENTS.md` and an untracked `docs/DESIGN-SYSTEM.md`; leave both.
Merge to `main` yourself once green, then deploy the Window with
`/projects/frank/apps/window/deploy.sh --revision <full-sha>` from the
canonical checkout. Read bounded tails of the deploy log; one reconciliation
line is enormous.

Do not print credentials, weaken authentication, add public routes, or
activate any sending. Do not rotate tokens or credentials.

## 2. Verified state at handover

Live Window: `0e73371` (shell) plus the resolver fix merge on top; check
`git -C /projects/frank log --oneline -3` and the `frank-window` image label.

Proven in the owner's real browsers today:

- Laptop and phone are both enrolled trusted devices. Either opens
  `https://frank.fail` with no password. The phone reaches `auth.frank.fail`
  over Tailscale through split DNS (`frank.fail` nameserver `100.78.126.112`
  in the Tailscale admin console) and the resolver in
  `apps/window/infra/owner_identity/trusted_device/dns/`.
- The shadcn shell is served at `/` and the owner routes; CRM, Support, Mail
  and Email flows open inside it, signed in, on both devices.
- The phone's Chrome had a cached permanent redirect to a dead
  `hub.frank.fail`; clearing cached files fixed it. Not a server issue.

Known limits at handover:

- The shell has no web app manifest, no service worker, no push. Nothing is
  installable yet.
- Under `lg` the shell collapses to a drawer; the native panels are full-page
  frames. It works but it is a desktop layout squeezed to a phone.
- Ads readers answer `501 not_connected` by design; the Ads workspace renders
  its honest state. Not in scope here.
- Views still rendered by the classic window (chats, files, studios, tools)
  open as full navigations from the Content and Tools menus. Not in scope
  here except that the phone layout must not strand the user in them.

Evidence for the shell release: `/srv/frank/verification/owner-shell-20260915/`.

## 3. Architecture for this work

### 3.1 Installable app

- Web app manifest served at `/ui/manifest.webmanifest` from the bundle
  (`apps/window/ui/public/`): `name` Frank, `short_name` Frank,
  `start_url` `/`, `scope` `/`, `display` `standalone`,
  `background_color` and `theme_color` from the approved tokens, maskable
  icons at 192 and 512 (draw a simple monochrome mark; no third-party
  branding). Link it from `apps/window/ui/index.html`. Caddy's CSP already
  allows `manifest-src 'self'` and `worker-src 'self' blob:`.
- Service worker at the root scope. The bundle lives under `/ui/`, so the
  worker must be served at `/sw.js` with scope `/`. Either emit it to the
  bundle root and add a small `server.py` route that serves it from
  `WEB/ui/sw.js` with `Service-Worker-Allowed: /` and `Cache-Control:
  no-store`, or serve it as a static file under `web/`. Add the route to
  `owner_shell.py` tests. Do not cache owner API responses in the worker; a
  cached payload would be shown after the session expired. Cache only the
  hashed bundle assets, and let navigations fall through to the network so the
  owner gate still decides.
- The worker's push handler shows the notification and its `notificationclick`
  handler opens or focuses the app at the target route (`/project/blockwise/crm`,
  `/project/blockwise/support`, `/project/blockwise/mail`, with `?app_path=`
  for a record where the alert carries one). Deep links already resolve in
  the shell (`ui/src/lib/routes.ts`).

### 3.2 Phone layout (shell only, no new backend)

- Below `lg`, replace the drawer as the primary navigation with a bottom tab
  bar: Home (Overview), Leads (CRM), Support, Mail, More. "More" opens the
  drawer with Email flows, Customers, Reports, Ads, Content, Tools, Settings.
  Keep every control at 44px or more and no page-level horizontal scroll at
  390px; the Playwright checks in the shell release did this and should be
  kept as the bar.
- Native panels on the phone: full height below the header, the panel bar
  compressed to one line, and the tab bar hidden while a native panel is
  visible if it steals too much height (measure on the Pixel, decide from
  the measurement). CRM 1.83 and Helpdesk 1.30 have their own mobile
  layouts; Roundcube's elastic skin is responsive. Mautic is not, and that
  is accepted.
- Overview on the phone: attention list first, one column, source cards
  collapsed to a status row with an expand. Customers and Reports: one
  column. Reuse `components/sources/source-ui.tsx`.
- Safe areas: `viewport-fit=cover` is already set; pad the tab bar with
  `env(safe-area-inset-bottom)`.
- Standalone mode has no browser back button on some Android gestures;
  keep history correct (the shell already pushes real URLs) and add a back
  affordance in the header when `history.length > 1` and the app is
  `display-mode: standalone`.

### 3.3 Web Push (option B)

Push follows the standard: the page subscribes through the service worker's
`PushManager` with an application server key (VAPID), Frank stores the
subscription, and Frank sends encrypted messages to the subscription's push
service endpoint (for Chrome on Android that is Google's FCM endpoint; the
`frank-window` container can reach `fcm.googleapis.com`, verified today).

Reuse the alert pipeline that already exists instead of inventing events:

- Native Frappe webhooks already POST private alerts (new lead, ticket
  waiting, owner mail reply) to ntfy topic `owner-notifications`
  (`infra/owner_crm_notifications`). ntfy is private, loopback plus the
  `frank_owner_notifications_private` Docker network, and `frank-window` is
  already attached to that network.
- Add one small relay in the Window: subscribe to ntfy's JSON stream for
  `owner-notifications` with the read-only `owner` credential (from the
  root-owned 0600 env under `/srv/frank/secrets/owner-notifications/`, passed
  through `window.env`, never committed), map each alert to a notification
  (title, body, target route) and send it to every stored subscription.
  Delete a subscription when the push service answers 404 or 410.
- Storage: subscriptions under `/srv/frank/data/window/` (the existing Window
  data root), one JSON document per subscription keyed by endpoint hash,
  never in Git. There is exactly one owner; still key by endpoint so laptop
  Chrome and phone Chrome can both subscribe.
- Endpoints, all behind the owner gate like every `/api/owner/*` route:
  `GET /api/owner/push/key` (public VAPID key), `POST /api/owner/push/subscribe`,
  `DELETE /api/owner/push/subscribe`, `GET /api/owner/push/status`
  (subscription count and last delivery result, no endpoints echoed).
- VAPID keys: generate once on the VPS into the root-owned 0600
  `window.env` (`OWNER_PUSH_VAPID_PRIVATE`, `OWNER_PUSH_VAPID_PUBLIC`,
  `OWNER_PUSH_VAPID_SUBJECT=mailto:owner@blockwise.sale`). Never print them.
- Library: `pywebpush` (pins in `requirements.txt`, MIT) rather than
  hand-rolling RFC 8291 encryption. Record why in the module docstring.
- Settings area in the shell gets a Notifications card: permission state,
  a Subscribe or Unsubscribe control, "send a test" (calls a gated
  `POST /api/owner/push/test` that pushes to the caller's own subscription
  only), and what is delivered. Permission is requested from that control
  only, never on page load.
- Quiet hours and dedup: the alert already carries a stable id from Frappe
  (record name); do not push the same id twice within 10 minutes. No quiet
  hours in this pass; note it as later work.
- Nothing here sends mail, activates campaigns or writes to a provider.

### 3.4 Session and the trusted phone

The owner session on `frank.fail` lasts `OWNER_IDENTITY_SESSION_DURATION`
(set in the identity env; default 12 hours). A push tap that opens the app
after expiry goes through Authentik and, on the enrolled phone over
Tailscale, comes back without a password. The relay does not depend on the
session; it pushes to the stored subscription regardless. Do not try to
extend sessions to make push "work".

## 4. Work order

Ship each step on its own, verified, before the next. One worktree per step
is fine. Step 0 is the addendum above (hub as home); do it first.

1. Manifest, icons, service worker, install. Acceptance: Chrome on the Pixel
   shows the install prompt (or Add to Home screen installs a standalone
   window), the installed app opens at Overview, deep links from a notification
   land on the right section. Playwright: manifest reachable, worker registers
   at scope `/`, no console errors.
2. Phone layout. Acceptance on the Pixel: bottom tab bar, Overview readable
   without zoom, CRM lead list and a lead record usable, Mail inbox and a
   message readable and a reply composable, no page-level horizontal scroll,
   no control under 44px, dark theme intact. Take screenshots into
   `/srv/frank/verification/<task>/`.
3. Push backend: VAPID env, subscription store, endpoints, relay from ntfy,
   tests for the mapping (alert JSON to notification), the store, the
   404/410 pruning, and the gate (anonymous request to every push endpoint
   is refused).
4. Push front end: Settings card, subscribe from the installed app, "send a
   test" arrives on the phone with the screen off, tap opens the right
   screen. Then a real event: create a lead in CRM on the laptop, the phone
   gets "New lead" and the tap opens that lead.
5. Docs and receipt: update `docs/SHADCN-UI.md` section 7 (phone layout),
   add `docs/OWNER_PUSH.md` (contract, endpoints, secrets, what is and is not
   delivered), write `/srv/frank/verification/<task>/release-receipt.json`
   with the deployed revision, the device-observed results and the remaining
   limitations.

## 5. Preserve

- The shell's route split (`apps/window/owner_shell.py`) and its tests.
- `NativeHost.tsx` mounts `owner-app-host.js` once and keeps it alive; the
  phone layout must not remount it on tab changes (a remount destroys the
  native panels and any draft).
- The legacy stylesheets are appended after the bundle's own stylesheet in
  `ui/src/main.tsx`; keep that order or Tailwind's preflight resets the native
  panel and Ads markup.
- Trusted-device verifier, resolver and Caddy device-header stripping. Do not
  touch `owner-trusted-devices.json` for this work.
- The public denial checks: anonymous and forged-proof requests to `/`,
  `/api/owner/*` and the new push endpoints must still hit the identification
  stage.

## 6. Files

Under `/projects/frank/apps/window/`:

- `ui/src/App.tsx`, `ui/src/lib/routes.ts`, `ui/src/components/*`
- `ui/index.html`, `ui/public/`, `ui/vite.config.ts` (base `/ui/`)
- `server.py`, `owner_shell.py`, `tests/test_owner_shell_routes.py`
- `web/js/owner-app-host.js` (read only for this work)
- `infra/owner_notifications/`, `infra/owner_crm_notifications/`
- `Caddyfile` (CSP already permits manifest and workers; only touch it if a
  push endpoint needs a header, and add the test)
- Secrets: `/srv/frank/secrets/window.env` (0600, root), never in Git

## 7. Report format

Finish with: what changed, exact commands and results, deployed revision,
what was observed on the Pixel (not on a resized desktop window), and the
exact remaining limitations. Distinguish committed from merged from deployed
from device-verified.

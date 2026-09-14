# Owner workspace contract

Frozen 14 September 2026 by the coordinator for the hybrid owner-workspace build.
This is the single current contract for the owner workspace inside Frank. It
extends the existing Frank Window, Home and Connections contracts; it does not
replace them and it does not introduce a second widget framework.

Read with [`README.md`](README.md), [`OWNER_CRM.md`](OWNER_CRM.md),
[`OWNER_DASHBOARD_FRONTEND.md`](OWNER_DASHBOARD_FRONTEND.md),
[`tool-app-platform.md`](tool-app-platform.md) and
[`../apps/window/DESIGN.md`](../apps/window/DESIGN.md).

## 1. What this is

Steven opens Frank in the Codex in-app browser and sees a real combined overview
of Blockwise, then opens email, CRM, support, campaigns and reporting **inside
the same Frank workspace**, without external browser tabs and without repeatedly
entering separate application passwords.

Mature upstream applications stay authoritative for their specialist work.
Frank builds only the shared workspace, the cross-source summaries, the
cross-app customer context and the necessary integration glue.

### Two rejected implementations, kept here as anti-examples

1. A fictional custom dashboard with a home-made inbox and simulated business
   data.
2. A launcher of links to separately authenticated applications.

Neither may be reintroduced, and no retired sample screen may be restored to
save time. The launcher that preceded this contract opened
`target="_blank"` links to `*.ts.net` application URLs, each demanding its own
Tailscale and application sign-in. Every one of those properties is disallowed:
no owner surface may open an external tab, and no owner surface may require a
second daily-use password after initial setup.

## 2. Ownership boundary

```text
Owner using Frank in Codex or a phone
                 |
         Shared authenticated entry
                 |
       Frank navigation and workspace
          /                       \
Real summary/customer/alerts     Native application panels
          |                       |
Existing authorized             Frappe CRM + Helpdesk
read projections                Mautic campaign/email UI
and domain services             Self-hosted OSS webmail client
          |                       |
Authoritative existing stores   Existing app stores / Purelymail
```

Frank renders, aggregates authorized read models and routes work. Hermes and the
existing domain services keep their execution responsibilities. Native
application forms execute through those applications' own authenticated APIs.

Frank must not gain a second mail sender, a generic provider-execution service,
a new CRM, a billing ledger, an automation engine, an agent runtime, a duplicate
memory store, a second Hermes profile, or a customer account.

## 3. Navigation contract

Owner routes are nested under the existing Blockwise project home so that the
project, rail and `?technical=1` contracts keep working.

| Route | Purpose |
| --- | --- |
| `/project/blockwise` | Overview (real combined home) |
| `/project/blockwise/mail` | Mail (native webmail client) |
| `/project/blockwise/crm` | CRM (native Frappe CRM) |
| `/project/blockwise/support` | Support (native Frappe Helpdesk) |
| `/project/blockwise/campaigns` | Email flows (native Mautic) |
| `/project/blockwise/revenue` | Revenue |
| `/project/blockwise/results` | Results |
| `/project/blockwise/notifications` | Notifications |
| `/project/blockwise/customer/<opaque-id>` | Customer overview |

Rules, implemented in `web/js/view-routing.js`:

- The section is an **allowlisted identifier**, never an arbitrary user string.
  `OWNER_SECTIONS` is the frozen list above.
- The customer identifier is **exactly one** opaque segment, decoded before
  validation, so an encoded separator cannot widen the route. Extra segments are
  invalid rather than silently ignored.
- `routeForPath` parses the path only and is query-safe. `?technical=1` still
  selects the technical project home.
- A nested route under any other project is invalid.
- `/project/blockwise` keeps its historical `{ view: "project", projectId }`
  shape.
- Cross-app record targets are **typed and allowlisted**, never raw URLs or
  user-supplied redirects.

Back, Forward, refresh and shareable owner-only deep links are required to work
for every route above. Navigating between sections must not silently discard an
email draft or other unsaved work.

## 4. Native app registry

Every registered app records:

| Field | Meaning |
| --- | --- |
| `app_id` | Stable identifier, allowlisted |
| `display_name` | Owner-facing name |
| `origin` | Approved origin, allowlisted |
| `default_route` | Where the app opens |
| `allowed_routes` | Allowlisted route patterns for deep links |
| `access` | Access requirement (owner session) |
| `native_account` | Explicit mapping to the native account |
| `capabilities` | What Frank may do with this app |
| `session_ready` | Session readiness |
| `limits` | Integration-specific limits |

- **No credentials in this registry.** It is browser-visible.
- **A client cannot mark an app connected.** Readiness comes from an authorized
  server check or a supported app bridge.
- An iframe `load` event is **not** evidence of readiness or authentication.
- If a message bridge is used, it validates exact origin, source window, version
  and an allowed payload schema. Wildcard origins are never accepted, and an app
  message is never authorization to send email or mutate records.

## 5. Read-model contract

Use the existing versioned Home snapshot contract where it fits. Every summary
or item carries:

- Stable `source` and source record/event ID.
- Owner/workspace scope, **established by the server**, never by the client.
- Actual source observation time, and last successful refresh time.
- Status: `ready`, `empty`, `stale`, `unavailable` or `error`.
- A sanitized value and a **typed internal drill-down target**.

Absolute rules:

- **Missing data is not zero.**
- **A failed source must not blank the entire page.**
- Cached data stays visibly dated.
- No secrets, no full message bodies, no card details, and no unrelated customer
  records in overview payloads.
- Do not query every provider on every render, and do not poll all apps
  continuously. Use bounded timeouts, pagination, backoff and reusable cached
  projections, within provider limits.

## 6. Metric definitions

| Metric | Definition |
| --- | --- |
| Research prospect | Ad Radar research record. Not a lead and not a customer. |
| CRM lead | Frappe CRM Lead. |
| Registered customer | Blockwise profile with a workspace. |
| Paying customer | Stripe subscription in a paying state. |
| New lead | By the source record's **creation time** and stable ID, never by mirror time. |
| Unread mail | From the intended mailbox and folders, excluding duplicated internal notification copies. |
| Tickets awaiting owner | By native status and assignment rules. **Not** all open tickets. |
| Trial/access state | Owned by Blockwise. |
| Payment/subscription state | Owned by Stripe. These are not the same authority and must not be presented as one. |
| Cash collected | Distinct from recurring revenue. |
| MRR | Define intervals, discounts, cancelled and free plans, and currency treatment. **Never sum different currencies.** |
| Paid-ad leads / website visits / signups | Separate metrics with explicit attribution limits, using the selected business accounts and never clients' ad accounts. |

Timezone: use the configured business timezone. If none is configured, label
the temporary Australia/Perth display assumption and list it for resolution.

## 7. Authentication contract

Owner clarification, 14 September 2026: the approved laptop and phone should
recognise the owner without a separate daily login wall. Device recognition
uses current Tailscale WhoIs and an explicit stable node ID plus owner-user
allowlist, never a shared public IP or a browser-supplied identity header.

The approved laptop routes only auth.frank.fail over Tailscale. Other owner
origins keep their existing addresses and normal authenticated sessions.
A recognised device seeds the intended active Authentik owner and uses the
normal login/session machinery; unrecognised requests retain password/MFA.
The phone must first join Tailscale and its actual node must be reviewed and
added to the allowlist. It is not silently trusted by account membership.

Device removal prevents a new passwordless sign-in. To revoke an already
issued browser session immediately, revoke that session in Authentik or
disable the owner, which the app gates check independently. Signing out
terminates the session; reopening a protected app on a still-approved device
can sign in again. Remove device trust as well when retiring a device.

Native entry extensions are committed into the Frappe and Mautic images.
An inert native-origin bridge checks protected native endpoints with that
origin's browser cookies, refusing redirected login pages. It then reports
readiness to the exact Frank parent and frame. It never sends cookies, native
page contents or credentials to Frank. Required authentication stays in the
same tab with a fixed return target and a bounded retry guard.

- One stable owner identity, with explicit mappings to the native accounts.
- Frank establishes a **trusted owner session**, not merely hidden navigation.
- Frappe uses its supported OpenID/OAuth login. Mautic uses its supported SAML
  where compatible with the installed version. Helpdesk uses the same intended
  owner account and site, not a separate customer account.
- **No automatic public signup** into the owner workspace. Provisioning is
  restricted to approved identities and least-privilege roles.
- MFA, session expiry, revocation, logout and recovery are defined **before** any
  existing access method is removed, and a restricted recovery route is retained
  until the new login and recovery paths pass.
- All app origins are gated through the owner session, so logout and revocation
  block access even if an upstream session survives. Supported native
  logout/revocation is used where available.
- **Proxy authentication alone is never proof that the native app is logged in.**
- An identity-provider login form is never placed inside an iframe. Use a
  same-tab authentication round trip that returns to the intended Frank route.

## 8. App hosting and isolation contract

- Native services stay on private internal upstreams.
- Every externally reachable app entry is protected by the owner access boundary
  **and** native authorization.
- Same-site subdomains are not same-origin and do not share login
  automatically.
- Prefer supported base-URL, theme and extension settings to rewriting HTML or
  arbitrary application URLs in the proxy.
- Framing is permitted **only** by approved Frank parent origins. Clickjacking
  protection is not removed globally and one broad domain session cookie is not
  shared across all apps.
- Verified in Chromium: a scoped CSP `frame-ancestors` overrides a present
  `X-Frame-Options`, while `X-Frame-Options` alone is still enforced. So the
  scoped CSP is what grants permission for a native app panel, and stripping the
  upstream header is defence-in-depth. The parent must also name the app origin
  in its own `frame-src`. This is browser behaviour proven on one build; it is
  not a specification guarantee, so neither the strip nor the scoped policy is
  removed as redundant.
- Source-application CSRF protections, cookies, redirects, assets, attachments
  and streaming are preserved.
- **Never proxy arbitrary user-supplied URLs.** App IDs, origins and route shapes
  are allowlisted.
- Admin ports are not exposed publicly, and Tailscale Funnel is not enabled.

## 9. Mail contract

- Purelymail remains the mailbox provider. Only an OSS webmail client is hosted.
- Roundcube is evaluated first because the owner already uses its native inbox.
  Any alternative must materially solve a demonstrated integration problem, and
  its licence, pinned version and maintenance status are recorded.
- The **client**, not Frank, owns compose, attachments, folders, search, reply
  threading, drafts, sending and Sent-copy behaviour.
- The mailbox database is not cloned into Frank.
- Ordinary sends use the approved mailbox identity and provider policy.
  Purelymail is not a marketing or cold-outreach transport here.
- No credential in browser storage, URLs, frame messages, source or logs. Any
  session-launch mechanism is authenticated, short-lived, one-use and
  replay-resistant, using established application mechanisms.

## 10. Worker ownership

| Owner | Exclusive area |
| --- | --- |
| Coordinator | `web/js/app.js`, `web/js/view-routing.js`, `web/index.html`, central server route imports and Home registrations, shared contracts and docs, integration, release |
| Identity | Owner identity component `infra/owner_identity/`, native SSO configuration, sole author of Caddy changes |
| Shell | `web/js/owner-dashboard.js`, `web/owner-dashboard.css`, `web/js/owner-app-host.js`, scoped shell tests |
| Native/mail | `infra/owner_crm/`, `infra/owner_marketing/`, `infra/owner_webmail/`, their scoped tests |
| Projection | Existing owner read adapters and `owner_workspace.py`; central registration requests go to the coordinator |

Every worker works in its own worktree under `/projects/frank-worktrees/` and
commits only files it changed. `/projects/frank` is read/fetch/merge/release
only. Workers do not deploy, push to `main`, install live services or send
messages independently.

## 11. Verification contract

Acceptance happens on the VPS against a real browser. A passing unit test, a
stale release record or a curl response is not user-visible acceptance.

The single consolidated acceptance matrix and the production release procedure
live in the build handoff and the
[Frank release runbook](FRANK_RELEASE_RUNBOOK.md). Software-implemented and
live-integration-accepted are **separate** ledger columns. An unconnected
required source is never marked complete because an empty-state component
exists, and a scope item is deferred only by an explicit owner decision.

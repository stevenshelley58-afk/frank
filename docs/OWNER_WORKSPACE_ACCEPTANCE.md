# Owner workspace acceptance ledger

Started 14 September 2026. This ledger records what is **actually** true for the
hybrid owner workspace build. It is not evidence that the integration works.

Two columns are deliberately separate, and a scope item is never moved between
them by assumption:

- **Software implemented** — committed, reviewed source with real focused test
  evidence.
- **Live integration accepted** — observed on the VPS against the real service
  and, where it is user-visible, in a real browser.

A required source that is not connected stays `not connected` here. An empty-state
component is not acceptance. A green backend response is not device or browser
delivery proof.

Baseline at the start of this build:

- Frank `main` = `8b166cf`.
- Deployed production revision = `238f5c9` (`fix(map): use canonical stable id
  grammar`), an ancestor of `main`. Production is therefore 443 commits behind
  the current checkout, which is normal release lag, not a discrepancy.
- Task worktrees under `/projects/frank-worktrees/owner-ws-*`, all created from
  `8b166cf`.
- Evidence root: `/srv/frank/verification/owner-workspace-20260914/`.

## Verified environment facts

These were observed during this build, not carried over from an older report.

| Fact | Status | Evidence |
| --- | --- | --- |
| `*.frank.fail` wildcard resolves to 76.13.209.160 | verified | `dig +short` for `crm.`, `mail.`, `marketing.`, `auth.` and a random probe name |
| `frank.fail` presents a Let's Encrypt certificate | verified | `openssl s_client` → issuer `C=US, O=Let's Encrypt, CN=YE2`, `notAfter Oct 29 2026` |
| No Cloudflare API token is available to Caddy | verified | `docker exec frank-caddy printenv` lists no CF token; DNS-01 is therefore unavailable to it |
| Caddy answers HTTP-01 on port 80 | verified | `curl -H 'Host: <arbitrary>' http://76.13.209.160/` returns 200 |
| Frappe sends `X-Frame-Options: SAMEORIGIN` | verified | `curl -D -` against `127.0.0.1:18081/crm/dashboard` |
| Sibling subdomains are same-site, so `SameSite=Lax` is sufficient | verified | Cookie `site` is the registrable domain; `frank.fail` and `crm.frank.fail` share it. Confirmed independently by the webmail lane's Roundcube config, so no `SameSite=None` workaround is needed |
| No identity provider was installed | superseded | Authentik 2026.8.2 is now deployed and all three containers report healthy |
| Mautic is 7.2.0 with SAML in core | verified | Discovery lane, `php bin/console --version` plus source |
| Purelymail IMAP and SMTP accept the mailbox credential | verified | Discovery lane, IMAP `a1 OK` and SMTP `235 OK` |
| No device has ever subscribed to ntfy | verified | Discovery lane, 759/759 samples report `subscribers=0`; no delivery receipt exists anywhere |
| No owner read model exists in `apps/window` | superseded | Three real projections now serve live counts; four sources remain without an adapter and say so |
| Codex in-app browser is not observable from this VPS | verified | Discovery lane: no browser process, no CDP listener, no browser MCP server |
| Frank can reach the owner services from inside its container | verified | With the two private networks attached, `owner-crm-frontend-1:8080/api/method/ping` returns 200 `pong` and `frank-owner-ntfy:80/v1/health` returns 200 `healthy` |
| The owner projections read real data in production conditions | verified | Run inside the running `frank-window` container against the live services: support 2 tickets awaiting the owner, CRM 4 new leads and 4 with no first contact, notifications 46 published |

## Risks

Load-bearing questions. Each is marked resolved with its evidence, or still
open with the test that would settle it.

### Framing a native app inside Frank is VERIFIED

Confirmed in Chromium against two hosts with real certificates, testing three
cases. The parent carried `frame-ancestors 'none'` and named the app in its
`frame-src`; the framed app varied only its own response headers.

| App response headers | Result |
| --- | --- |
| `X-Frame-Options: SAMEORIGIN` only | **blocked** |
| `X-Frame-Options: SAMEORIGIN` **and** a scoped CSP `frame-ancestors https://<parent>` | **framed** |
| A scoped CSP `frame-ancestors https://<parent>` only | **framed** |

Two conclusions, and the second is the one that matters:

1. A scoped CSP `frame-ancestors` **overrides** `X-Frame-Options` when both are
   present. So the identity lane's approach works, and stripping the upstream
   `X-Frame-Options` is defence-in-depth rather than the step that grants
   permission — the CSP is what grants it.
2. `X-Frame-Options` is still enforced when it is the only signal, which the
   blocked control proves. Nothing here licenses removing framing protection
   globally.

Caveat recorded deliberately: this is browser behaviour, proven on one Chromium
build. It is not a specification guarantee, which is why the header strip stays
rather than being removed as redundant.

An earlier attempt at this test returned "blocked" and was recorded as unverified
because Caddy had not finished issuing certificates: a failed TLS handshake and a
deliberate frame rejection are indistinguishable in that outcome. This result
supersedes it.

### Other open items

- `frame-src` on the Frank parent does not yet name `mail.frank.fail`, so the
  Mail panel cannot render until the webmail origin is added.
- The notification view publishes real, deduplicated activity, but it does not yet
  separate "reviewed in Frank" from "resolved in the source application".
- Item-level drill-down currently opens the owning filtered list. Opening a
  specific native record additionally needs the verified route shapes from the
  native lane, and a guessed URL is deliberately not used in the meantime.

## Browser verification of the integrated workspace

Run against a bounded local preview of the integrated branch, with the real
generated vendor bundles copied in so the page boots exactly as it does in the
container. This is a real Chromium browser, not a headless assertion harness.

| Check | Observed |
| --- | --- |
| Workspace mounts at `/project/blockwise` | yes, at 1440x900 and 390x844 |
| Horizontal overflow | none at either width |
| Owner surface opens an external tab | no anchor in the owner surface carries a blank target |
| Frames created | none, which is correct: every native origin reports not frameable |
| All 8 owner routes resolve and survive a reload | 8 of 8, verified by the acceptance harness |
| Deep link `/project/blockwise/crm` | resolves, and the address keeps `/crm` after reload |
| Rail section click | moves to `/project/blockwise/support` |
| Back | returns to `/project/blockwise/crm` |
| Forward | returns to `/project/blockwise/support` |
| Unknown section | does not resolve: "No owner workspace section is registered for ..." |
| JavaScript errors | none |
| Real source data on the overview | support "2 tickets awaiting the owner, observed 2026-09-14T05:29:12Z" with two named tickets and their assignment; CRM 4 new leads with per-record creation times and an "Open leads" drill-down |

The persisted-draft check is reported as skipped, with its reason, because no
webmail client runs in this preview. The native embed and post-logout native
probe report their real failing state, because `crm.frank.fail` has no
certificate yet. None of the three is reported as a pass.

## Scope ledger

| # | Item | Software implemented | Live integration accepted |
| --- | --- | --- | --- |
| 1 | Owner route grammar and deep links | yes — `view-routing.js`, 6 route tests | routed and unit-verified; browser confirmation pending |
| 2 | Workspace app host and overview shell | yes — `owner-app-host.js`, 20 host tests | renders honest blocked states; framing awaits the ingress change |
| 3 | One owner sign-in (identity provider) | in progress — Authentik deployed and healthy | pending |
| 4 | Native CRM framed inside Frank | in progress | blocked — origin has no certificate yet |
| 5 | Native Helpdesk framed inside Frank | in progress | blocked — origin has no certificate yet |
| 6 | Native Mautic framed inside Frank | in progress | blocked — origin has no certificate yet |
| 7 | Webmail in Frank, no second password | in progress — Roundcube 1.7.4 component, 34 tests | pending |
| 8 | Real overview from authorized reads | yes — 3 of 7 sources live, 4 honest unavailable | verified inside the production container |
| 9 | Customer overview across sources | yes — `owner_customers.py`, 13 tests | resolves a real lead record live; subscription context awaits a Stripe credential |
| 10 | Deduplicated notification view | yes for activity — stable per-source ids, verified unique across refreshes | "reviewed in Frank" vs "resolved in source" still to separate |
| 11 | Results reporting | yes — 5 declared sources with measures, authority and limits | none connected: no provider credential exists, reported honestly as unconfigured |
| 12 | Revenue reporting | yes — Stripe declared, cash and recurring kept separate | none connected: no Stripe read key exists, reported honestly as unconfigured |
| 13 | Phone notification receipt | blocked — no device subscriber | blocked |
| 14 | Public owner booking | not started — needs Google Calendar OAuth | blocked |

## Verified native route shapes

Confirmed against the installed applications in a real browser by the native
lane, not taken from documentation. These are what the app registry allowlists;
the negatives matter as much as the positives.

| Screen | Path |
| --- | --- |
| CRM dashboard | `/crm/dashboard` |
| CRM lead list | `/crm/leads/view/list` |
| CRM lead record | `/crm/leads/<leadName>` |
| CRM contact record | `/crm/contacts/<contactName>` |
| CRM task list | `/crm/tasks/view/list` |
| Helpdesk tickets | `/helpdesk/tickets` |
| Helpdesk ticket record | `/helpdesk/tickets/<ticketId>` |
| Mautic campaign record | `/s/campaigns/view/<id>` |
| Mautic email record | `/s/emails/view/<id>` |

Deliberately **not** allowlisted because they do not work: `/crm/tasks/<id>`
(renders a blank content area rather than a record), `/crm/notes/list`, and
`/helpdesk/knowledge-base`.

Sequencing constraint: anonymous `/crm/**` returns 403 with no shell, while
anonymous `/helpdesk/**` returns a 200 SPA shell that then redirects to `/login`.
Both applications issue a full-page redirect when unauthenticated, so the Frappe
session must already exist before a deep link is loaded in a frame, or the login
page renders inside the panel.


## Defects found and fixed during this build

Recorded because each one was a real fault, not a formatting preference.

| Defect | Impact | Fix |
| --- | --- | --- |
| `routeForPath` was not query-safe | `/project/blockwise?technical=1` was rejected and every section URL collapsed to the project home | Path is parsed before query; covered by a test |
| Mautic `config/local.php` was mode 0755 | The Purelymail mailbox password was readable by every local user in the container | `0640 root:www-data`, enforced on the persisted volume; the component procedure now sets it on write |
| Authentik `AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS` aborts config load | The identity stack could not start at all | The override is removed; the built-in default already trusts the ingress subnet. This is [a known upstream defect](https://github.com/goauthentik/authentik/issues/9723) |
| Authentik migration history corrupted | The stack crash-looped 29 times | Caused by my own diagnostic probes migrating the same live database concurrently. The database held zero users, so it was reset cleanly |
| Three assertions in `test_ui_contract.py` described already-removed behaviour | The suite could not pass at `8b166cf`, masking real regressions | Assertions now describe the current contract; the suite passes for the first time |
| `homes.js` lacked a `stale` status and dropped `target.section` | Cached data was labelled unavailable, and an owner drill-down landed on the project home instead of its section | Both added, with the section dispatching the live owner-route event |
| Source items were given positional ids | The same notification became `notifications-1` on one refresh and `notifications-2` on the next, which makes deduplication and cross-refresh recognition impossible | Rows now carry the reader's own stable namespaced id, and a test proves a newer record does not renumber older ones |
| The unsaved-work guard threw on every unload | The unload protection was silently absent, and the browser logged a page error | The check is defined once in the closure; a live retainable panel now counts as work Frank cannot verify |
| Readiness counted an identity-provider redirect as a healthy app | An app would have been reported frameable before sign-in, and the panel would have rendered the sign-in page inside Frank | A redirect to the identity provider reports not ready and not frameable with reason `owner_session_required` |
| The outpost could not authorise any gated host | Every owner surface returned 404 to an anonymous visitor instead of redirecting to sign-in, so the workspace was unreachable | `forward_auth` now forwards `X-Forwarded-Host`, `-Uri`, `-Method` and `-Proto`; all four gated hosts redirect with their own client id |
| The Frappe OIDC provider had an empty `grant_types` | Frappe's own login failed with `invalid_request` before issuing a code | `grant_types` is stated explicitly and made patchable in the bootstrap |

## Changes made outside a release

Recorded for honesty. Production source is otherwise untouched.

```text
Change: Mautic config/local.php mode tightened from 0755 to 0640 root:www-data
Where: /var/lib/docker/volumes/frank_owner_marketing_config/_data/local.php
Why: The file holds the Purelymail monitored-mailbox credential in plaintext and
  was readable by every local user in the container.
Verified: stat shows 640 root:www-data on the host and in the container, and
  Mautic still serves /s/login with HTTP 200.
Durability: The path is on a named volume, so the mode survives container
  recreation. The owner_marketing configure procedure will enforce it on write.
Rollback: chmod 0644 and chown root:root on the same path.

Change: frank-window attached to owner-crm_owner-crm-ingress and
  frank_owner_notifications_private at runtime, to verify reachability.
Why: The committed compose file needs a redeploy to take effect, and the
  reachability claim had to be tested rather than assumed.
Verified: Both reads succeeded from inside the container.
Rollback: Automatic. The next deploy recreates the container from the committed
  compose file, which declares exactly these two networks.

Change: Diagnostic-only files copied into the running frank-window container to
  run the projections in production conditions, then removed in the same session.
Verified: /app/owner_*.py and the copied secret files are absent, and the
  container reports running and healthy.
```


## Blockers requiring the owner

Recorded in the required format. These are the only items that genuinely need
the owner, and each names the smallest next action.

```text
Requirement: Confirm the native app panels work in the owner's real browser
Source/application: Codex in-app browser
Observed failure: The browser cannot be observed or driven from the VPS. There
  is no browser process, no CDP listener and no browser MCP server, and the
  feature is unused across 260 recorded sessions, so its engine and cross-origin
  frame behaviour are unknown.
Exact missing authorization or capability: A single visual confirmation from the
  owner's browser. One URL is prepared for this; it needs no configuration.
Work completed safely: Same-site framing was established from the cookie spec and
  a probe page was written and served behind the owner boundary.
Smallest next action: The owner opens one prepared URL in the Codex browser and
  pastes back the reported result.
Which other packages can continue: Every lane. This gates final acceptance, not
  the build.
```

```text
Requirement: The owner can actually sign in, including the second factor
Source/application: authentik on auth.frank.fail, owner account
Observed failure: The only enrolled TOTP device was created by the identity
  lane's own acceptance run during its browser test. The owner does not hold that
  secret, so the deployed system would have demanded a code he could not produce
  and offered no way to enrol a second device.
Exact missing authorization or capability: The owner must perform the first
  sign-in himself, scanning a new authenticator enrolment and saving the recovery
  codes it prints. That requires his phone and a few minutes.
Work completed safely: The acceptance-enrolled device has been removed, so the
  owner account now has no second factor and the configured enrolment stage will
  offer a fresh QR code on his first sign-in. No owner credential, password or
  session was read, created or changed. The sign-in flow was confirmed to load
  and render its first stage in a real browser through the acceptance edge.
Smallest next action: The owner opens one URL, signs in with the password from
  /srv/frank/secrets/owner-identity.env, scans the QR code with his authenticator
  app, and saves the recovery codes. He should do this once so the enrolment
  belongs to him rather than to a test.
Which other packages can continue: All of them. This gates only his first
  personal sign-in.
```

```text
Requirement: An actual phone notification receipt
Source/application: ntfy on 127.0.0.1:18104, topic owner-notifications
Observed failure: No device has ever subscribed (subscribers=0 in 759 of 759
  samples) and no delivery receipt artifact exists.
Exact missing authorization or capability: The owner's intended phone must be
  enrolled as a subscriber, which needs the owner's device.
Work completed safely: The transport is running, private, and access-controlled,
  and no notification was sent.
Smallest next action: The owner installs the ntfy client and subscribes to the
  topic; delivery is then proven with one harmless notification.
Which other packages can continue: All build and reporting work.
```

```text
Requirement: Purelymail app-password provisioning for the webmail client
Source/application: Purelymail
Observed failure: Purelymail documents no OAuth2 for IMAP/SMTP. The
  createAppPassword API was found only on a third-party mirror and API-token
  issuance is undocumented, so it is unverified.
Exact missing authorization or capability: A Purelymail API token, or the owner's
  decision to use the existing mailbox credential from the protected secret file.
Work completed safely: IMAP/SMTP connectivity and credential validity are proven;
  no credential was moved, printed or committed.
Smallest next action: The owner states whether an API token can be issued. If it
  cannot, the webmail client uses the mailbox credential already held in
  /srv/frank/secrets, and no separate daily-use password is ever requested.
Which other packages can continue: Everything except the app-password variant of
  the webmail launch.
```

## Owner identity acceptance

The identity lane proved the owner session boundary in a real browser, 12 of 15
steps. The load-bearing ones all pass:

| Claim | Result |
| --- | --- |
| An anonymous visit to `frank.fail` redirects to the identity provider | pass |
| Multi-factor authentication is demanded, not merely available | pass, TOTP enrolled and a second factor accepted |
| The round trip returns to the intended Frank route | pass |
| `crm.frank.fail` accepts the owner session at the edge | pass |
| The app sends a scoped `frame-ancestors` and no `X-Frame-Options` | pass |
| Logout revokes the session | pass |
| A direct native URL is denied after logout | pass |
| Zero CSP violations | pass |

Framing was confirmed twice, independently, with a positive control: Frank itself
raised Chrome's refusal message under `frame-ancestors 'none'`, proving the
detector fires, while the CRM produced no refusal under its scoped policy.

Three defects were found only by running it, and are recorded so they are not
rediscovered: `Set-Cookie` must not appear in a Caddy 2.8 `log format filter`
(it stripped the header from the identity provider's own responses and broke
sign-out); outpost `sign_out` only clears the cookie for the host it is served
on, so logout must call it on every gated host; and a vhost with no matching
identity application gets 404 HTML from the outpost instead of a redirect.

### Frappe native login: root cause found and fixed

The lane recorded Frappe's own OIDC login as blocked, with authentik answering
`invalid_request` before issuing a code. The cause was found and fixed here:

**authentik applies no default for a provider's `grant_types` when the field is
omitted, so the Frappe provider was created with an empty grant set.** The
authorize endpoint therefore found `authorization_code` missing from the
provider's grant types and raised `invalid_request`. The error names no missing
field, which is why it presented as a malformed request rather than a
misconfigured provider.

Evidence: the live row showed `grant_types = {}` while every working provider
showed `{authorization_code,client_credentials,password}`. Setting
`{authorization_code,refresh_token}` changed the identical request from the
`invalid_request` error to a 302 into the sign-in flow. The bootstrap now states
the grant types explicitly and includes the field in its patchable set, so the
fix survives a rebuild and converges on an existing provider. A full bootstrap
run reports `created=0 updated=0 unchanged=28`.

This is software-complete. It is not yet live, because that needs the Caddyfile
deployed, which is the release step.

## Reporting connection state

Results and Revenue are implemented as a reporting framework that declares, for
every source, what it measures, which authority owns the number, the limits of
what it can tell the owner, and the exact connection step it needs. None of them
is connected, and none of them is presented as a number.

| Section | Sources | State |
| --- | --- | --- |
| Results | GA4, Search Console, Meta Ads, Google Ads, Clarity | all unconfigured |
| Revenue | Stripe | unconfigured |

The framework enforces a three-state rule so "not connected" can never be read as
a measurement:

- `ready` — a reader returned observed data, with the values and the moment they
  were observed.
- `unconfigured` — no usable credential. Explicitly not an empty result and not a
  zero. The owner learns which connection is missing.
- `error` — a credential exists but the read failed, reported with the failure
  category so a transient outage is never mistaken for a measurement.

Two guards worth naming: a connector recorded as ready in the environment is
still unconfigured while no reader exists, because a recorded state is not an
observation; and Stripe reports cash collected and recurring revenue as two
different quantities, never summed across currencies, with cancelled and free
plans excluded from paying customers.

## First sign-in

The owner account currently has **no second factor**, which is deliberate: the
only device was created by the identity lane's own browser test, so he could not
have used it. The configured enrolment stage offers a fresh QR code on his first
sign-in, and enrolment is re-enterable, so an interrupted attempt simply offers
the QR code again.

The first-sign-in path was verified against a throwaway user in the same owner
group, driven through the real flow in a real browser: the gate redirects, the
flow renders, credentials are accepted, and enrolment is offered. That probe user
and its password were removed afterwards, and the owner account was not touched.

## Release readiness

Reviewed at candidate `9e601cd`, 78 files changed against `main`, and **not yet
deployed**. Every precondition checked out:

| Check | Result |
| --- | --- |
| Clean fast-forward from `main` | yes, `main` is an ancestor; no merge conflicts |
| Worktree clean | yes |
| Secrets committed | none. The two files matching a secret-shaped name are a digest pins file that states it holds no secrets, and a provisioning script that generates its values from `/dev/urandom` |
| External networks exist | all three (`owner-crm_owner-crm-ingress`, `frank_owner_notifications_private`, `frank_owner_webmail_ingress`) |
| Read credentials present and restricted | both owner read files exist at mode 0600 |
| Caddyfile validates | yes, in the real Caddy 2.8 binary |

### Why this is held rather than released

Two reasons, both about the owner rather than the code.

1. **The owner cannot sign in until he enrols a second factor.** The only TOTP
   device was created by the identity lane's own browser test. It has been
   removed, so the enrolment stage now offers a fresh QR code, but the first
   sign-in has to be his.
2. **The early integration checkpoint has to be proven in his browser.** The
   brief makes that checkpoint mandatory before expanding further, and it is the
   one thing this host cannot observe: the Codex in-app browser has no drivable
   instance here.

Deploying now would therefore hand him a workspace he cannot enter, behind a
sign-in he has never completed, with only a restricted recovery route as a way
back. Holding until he is present is the safer sequencing, and it is a
scheduling decision rather than an unfinished one: the candidate is complete and
verified, and the release is a single command.

### What the release does when it runs

It publishes the committed Caddyfile, which issues four HTTP-01 certificates for
`auth`, `crm`, `marketing` and `mail.frank.fail` (no Cloudflare token needed, and
no DNS change), and replaces the legacy operator password prompt with the owner
sign-in. The restricted `/__owner-recovery` route is retained until the owner
session and its own recovery path have both passed.

## Verification commands actually run

```bash
# Routing grammar and coordinator tests (all pass)
cd apps/window && node --test tests/view_routing.test.mjs tests/owner_dashboard_route.test.mjs

# Owner read contract, including the cross-language section parity check
/usr/local/bin/python -m unittest tests.test_owner_workspace

# Pre-existing failures, so they are not mistaken for regressions later
# A clean worktree of 8b166cf reports: 2 failures, 25 errors, 12 skipped
# The canonical /projects/frank checkout reports: 4 failures, 27 errors, 12 skipped
```

The graph-browser and graph-client JavaScript suites fail in every fresh
worktree and pass in the canonical checkout, because they need build assets that
only exist there. They are not related to this work.

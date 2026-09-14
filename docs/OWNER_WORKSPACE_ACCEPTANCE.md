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
| 9 | Customer overview across sources | not started | not started |
| 10 | Deduplicated notification view | partly — publish activity is real and deduplicated by source id | "reviewed in Frank" is not separated from "resolved in source" yet |
| 11 | Results reporting | not started | not started |
| 12 | Revenue reporting | not started | not started |
| 13 | Phone notification receipt | blocked — no device subscriber | blocked |
| 14 | Public owner booking | not started — needs Google Calendar OAuth | blocked |

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

## Changes made outside a release

Recorded for honesty. Production is otherwise untouched.

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
```

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

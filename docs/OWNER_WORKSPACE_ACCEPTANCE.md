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
| Sibling subdomains are same-site, so `SameSite=Lax` is sufficient | verified | Cookie `site` is the registrable domain; `frank.fail` and `crm.frank.fail` share it. Confirmed independently by the webmail lane's Roundcube config |
| No identity provider was installed | verified | No Authentik/Keycloak container |
| Mautic is 7.2.0 with SAML in core | verified | Discovery lane, `php bin/console --version` plus source |
| Purelymail IMAP and SMTP accept the mailbox credential | verified | Discovery lane, IMAP `a1 OK` and SMTP `235 OK` |
| No device has ever subscribed to ntfy | verified | Discovery lane, 759/759 samples report `subscribers=0`; no delivery receipt exists anywhere |
| No owner read model exists in `apps/window` | verified | Discovery lane section 8; every owner metric reader has to be built |
| Codex in-app browser is not observable from this VPS | verified | Discovery lane: no browser process, no CDP listener, no browser MCP server |

## Scope ledger

| # | Item | Software implemented | Live integration accepted |
| --- | --- | --- | --- |
| 1 | Owner route grammar and deep links | yes — `view-routing.js`, 6 route tests | pending |
| 2 | Workspace app host and overview shell | in progress | pending |
| 3 | One owner sign-in (identity provider) | in progress | pending |
| 4 | Native CRM framed inside Frank | in progress | pending |
| 5 | Native Helpdesk framed inside Frank | in progress | pending |
| 6 | Native Mautic framed inside Frank | in progress | pending |
| 7 | Webmail in Frank, no second password | in progress | pending |
| 8 | Real overview from authorized reads | in progress | pending |
| 9 | Customer overview across sources | not started | not started |
| 10 | Deduplicated notification view | not started | not started |
| 11 | Results reporting | not started | not started |
| 12 | Revenue reporting | not started | not started |
| 13 | Phone notification receipt | blocked — no device subscriber | blocked |
| 14 | Public owner booking | not started — needs Google Calendar OAuth | blocked |

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

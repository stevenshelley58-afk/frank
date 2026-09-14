# Owner webmail

The owner's real mailbox, in Frank's workspace, without a second password
prompt. Roundcube 1.7.4 runs as a pinned native application; Frank authenticates
the owner once and hands the client a single-use launch session.

This component owns the client, its configuration, its session launch and its
health. It does not own the mailbox: Purelymail IMAP remains the store of
record, and nothing is copied into Frank.

## What runs

| Service | Image | Role |
| --- | --- | --- |
| `webmail` | `roundcube/roundcubemail:1.7.4-apache` pinned by digest | The mail client. Only container with outbound access (IMAP 993, SMTP 465). |
| `launch` | built from `launch/Dockerfile` on pinned `python:3.12-alpine` | Mints the single-use launch token and redeems it exactly once. Holds no mailbox credential. |
| `ingress` | `nginx:1.28.0-alpine` pinned by digest | The one upstream the identity layer proxies to. Holds the ingress proof secret. |

Networks: `frank_owner_webmail_private` (internal-only), `frank_owner_webmail_egress`
(mail client only), `frank_owner_webmail_ingress` (the seam the identity layer's
proxy joins). The ingress binds `127.0.0.1:18107` on the host; nothing else is
published.

Runtime state is outside Git: secrets in `/srv/frank/secrets/owner-webmail.env`
(mode 0600, root-owned), the Roundcube application tree and SQLite database in
the `frank_owner_webmail_app` and `frank_owner_webmail_db` volumes, and the
launch token store in `frank_owner_webmail_launch_state`.

## Why Roundcube

Roundcube 1.7.4 (released 2026-09-06) is the current stable line, maintained
upstream, GPL-3.0-or-later with an explicit exception that lets skins and
plugins carry other licences, and published as an official pinned image. The
owner already used Roundcube's native inbox at Purelymail, so nothing has to be
relearned.

Alternatives were evaluated and rejected on evidence:

| Client | Licence | Status | Why not |
| --- | --- | --- | --- |
| SnappyMail | AGPL-3.0 | last release 2024-10-09 | Its only SSO path (`plugins/proxy-auth`) needs a Dovecot master user, which Purelymail does not provide. |
| Cypht | LGPL-2.1 | active (2026-08-29) | No documented automatic-session mechanism; a combined-inbox UX, not a mailbox client. |
| Mailpile | AGPL | abandoned (last commit 2023-11, README says development halted) | Unmaintained, no official image. |
| RainLoop | MIT | last release 2022-08-31 | Unmaintained. |
| AfterLogic WebMail Lite | AGPL-3.0 | dormant since 2019 | Not recommendable. |

None materially solves a demonstrated integration problem better than
Roundcube, so Roundcube is the choice and no fork was created.

## How the session is launched

```
browser (same tab or Frank panel)
   |  GET https://mail.frank.fail/frank/launch
   v
identity layer  -- authenticates the owner, sets X-Frank-Owner, strips client copies
   |
   v
ingress (nginx) -- adds the ingress proof header, replaces any client copy
   |
   v
launch broker  -- mints a 120s single-use token, sets an HttpOnly/Secure cookie, 303 to /
   |
   v
Roundcube + frank_sso plugin
   |  POST /internal/consume  (private network, consumer secret)
   |  <- {ok, owner, mailbox}   exactly once
   v
authenticate hook -> real IMAP login -> mailbox
```

Properties, each one exercised by `bin/token-check.py`:

* **Authenticated.** The launch route requires the ingress proof header, which
  only the ingress can set, plus an owner identity from the identity layer. The
  mailbox credential never reaches the browser.
* **Short-lived.** The token lives `OWNER_WEBMAIL_TOKEN_TTL_SECONDS` (default
  120) and the cookie carries the same `Max-Age`.
* **One-use.** Redemption is a single atomic SQLite `UPDATE ... WHERE used_at IS
  NULL AND expires_at >= now`. The second redemption returns `410 Gone`.
* **Replay-resistant.** The token is 32 random bytes, travels only in an
  HttpOnly cookie over TLS, is cleared by the client after use, and the mailbox
  credential is never derived from it.

The mechanism is Roundcube's own `authenticate` plugin hook: the same hook
upstream's `autologon` and `http_authentication` plugins use. No core file is
patched and no new authentication protocol is invented. OAuth2 is deliberately
not used: Purelymail advertises `AUTH=PLAIN` only and offers no XOAUTH2, so an
identity provider's tokens would be rejected by the mail server itself.

## Secrets

`bin/provision-secret.sh` creates `/srv/frank/secrets/owner-webmail.env` (0600,
root-owned) once, from the existing mailbox secret, and never prints a value.

* `OWNER_WEBMAIL_IMAP_PASSWORD` is a dedicated, component-scoped mailbox
  credential. Purelymail **app passwords** are created in the Purelymail account
  portal, which only the owner can open; when one is issued, replace this single
  value and restart the component. Until then the value is a private copy of the
  mailbox login, held apart from CRM, Mautic and Hermes.
* `OWNER_WEBMAIL_INGRESS_SECRET` is rendered into the ingress configuration at
  container start by the pinned nginx image's `envsubst` entrypoint
  (`NGINX_ENVSUBST_FILTER=^OWNER_WEBMAIL_`), so it is never in Git and never in
  a static file.
* `OWNER_WEBMAIL_CONSUME_SECRET` is held by the broker and the client only.

## Mailbox behaviour that must not regress

* **Folders** are the provider's own (`INBOX`, `Sent`, `Drafts`, `Trash`,
  `Junk`, `Archive`, `Support`, `Notifications`). Roundcube is told not to
  create defaults.
* **Sent copy.** SMTP submission does not append; Roundcube appends exactly one
  copy to `Sent` after a successful send.
* **Reply threading** comes from the message's own `Message-ID`/`References`
  headers on the server. Nothing rewrites them.
* **Attachments** are handled by Roundcube's `filesystem_attachments` with
  `vcard_attachments` and `zipdownload`; uploads are capped by
  `OWNER_WEBMAIL_MAX_UPLOAD`.
* **Sender aliases** are reconciled on login through Roundcube's own identity
  API from `OWNER_WEBMAIL_IDENTITIES`.
* **HTML mail isolation** is Roundcube's `washtml` allowlist sanitizer: scripts
  and forms are stripped and remote content is blocked until the owner asks.
* **Sieve filters stay untouched.** The `managesieve` plugin is deliberately not
  enabled: the provider holds a load-bearing support-routing Sieve script written
  by `apps/window/infra/owner_marketing/support_sieve_setup.sh`, and this client
  must not be the thing that rewrites it. To enable it later, add `managesieve`
  to `$config['plugins']` in `roundcube/config.inc.php` and set
  `managesieve_host` to `ssl://mailserver.purelymail.com:4190`.

## Operating it

```bash
apps/window/infra/owner_webmail/bin/owner-webmail secret    # create the 0600 secret, once
apps/window/infra/owner_webmail/bin/owner-webmail build
apps/window/infra/owner_webmail/bin/owner-webmail up
apps/window/infra/owner_webmail/bin/owner-webmail health
apps/window/infra/owner_webmail/bin/owner-webmail token-check
apps/window/infra/owner_webmail/bin/owner-webmail down
```

`owner-webmail` refuses to run against a dirty checkout: production runs
committed source, and the running containers are stamped with the applied
revision.

## Framing and cookies

Roundcube sends no `X-Frame-Options` of its own; the ingress states the framing
policy once as `Content-Security-Policy: frame-ancestors` for exactly the
approved parent origin. Session cookies are host-only (`session_domain` empty),
`HttpOnly`, `Secure` (`use_https` plus a `proxy_whitelist` for the private
ranges).

The guaranteed flow is a **same-tab** navigation: the identity layer's cookie is
sent on a top-level request, so `SameSite=Lax` is enough everywhere. Embedding
the panel in an iframe additionally requires `SameSite=None` on the identity
layer's session cookie and on the launch and client session cookies, because a
sibling subdomain is a different site. That is a browser third-party-cookie
policy question, so it is enabled by setting
`OWNER_WEBMAIL_COOKIE_SAMESITE=None` and is not the default.

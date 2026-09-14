# Owner identity provider — decision record

Status: accepted, implemented on branch `owner-ws-identity`, not deployed to
production. Author: P1 identity lane. Date: 14 September 2026.

This record covers the authenticated access foundation: one shared owner
sign-in for Frank and the native owner applications. It answers the questions
the shared brief makes mandatory — choice, why, licence, pinned version, MFA,
OIDC **and** SAML, resource cost, rollback, and what was rejected.

## 1. Decision

**authentik**, pinned to `ghcr.io/goauthentik/server:2026.8.2`
(`sha256:ff8489a5af4f4fe415ffd180a8e3c10b120bc2592d13d79dac050d977f7b9ecd`),
running as its own Compose project `owner-identity` on `auth.frank.fail`.

Deployed as three containers: `postgresql` (`postgres:16-alpine`, digest-pinned),
`server` and `worker`. No host port is published; the only route in is the Frank
edge on the pinned `owner-identity_owner-identity-ingress` bridge.

## 2. Why authentik

| Requirement | How authentik satisfies it |
| --- | --- |
| OIDC for Frappe and Frank | Native OAuth2/OIDC provider; `/application/o/authorize/`, `/token/`, `/userinfo/`, per-app discovery |
| SAML for Mautic | Native SAML 2.0 **identity provider** in the open-source edition |
| MFA | TOTP, WebAuthn, static recovery codes, all in the open-source edition |
| Reverse-proxy session boundary | Embedded outpost with a documented Caddy `forward_auth` integration; no extra container |
| Resource cost | 3 containers, PostgreSQL only (Redis was removed upstream in 2025.10.4), documented minimum 2 vCPU / 2 GB |
| Licence | MIT for everything outside `authentik/enterprise/` |

Measured on this host after start: the whole project idles at roughly 500 MB
resident across `server`, `worker` and `postgresql`, against 31 GB total and
22 GB available. Disk is 182 GB free; the image and database are well under 2 GB.
This host can run it with wide margin.

### Licence, precisely

`LICENSE` reads: "All content that resides under the `authentik/enterprise/`
directory of this repository ... is licensed under the license defined in
`authentik/enterprise/LICENSE`. ... Content outside of the above mentioned
directories or restrictions above is available under the MIT license."

The SAML provider (`authentik/providers/saml/`) and every MFA stage
(`authentik/stages/authenticator_{totp,webauthn,static}/`) sit outside
`authentik/enterprise/`, and none of them appears on the published enterprise
feature list. **No enterprise feature is used by this deployment**, so the
enterprise licence never applies.

## 3. Version and upgrade policy

`2026.8.2`, the current patch of the 2026.8 release branch. The image has no
`latest` tag in this deployment; the tag *and* the digest are both pinned in
`compose.yaml`, and `bin/check-compose.py` fails if the resolved configuration
names any other image. The wrapper additionally refuses any tag other than the
accepted one.

Upgrade procedure: change `OWNER_IDENTITY_TAG`/`OWNER_IDENTITY_DIGEST` in
`/srv/frank/secrets/owner-identity.env`, re-run `bin/owner-identity config` (which
re-validates the digest) and `bin/owner-identity up`. Database migrations run
once, under the server's own migration lock.

## 4. Resource cost on this host

| | |
| --- | --- |
| Containers | 3 (`postgresql`, `server`, `worker`) |
| Networks | 2 — one `internal: true` data network, one ingress network joined only by `frank-caddy` |
| Published ports | none |
| State outside Git | `/srv/frank/owner-identity/{postgresql,data,certs,blueprints}` |
| Secrets outside Git | `/srv/frank/secrets/owner-identity.env`, mode 0600, root-owned |

Ownership is deliberately **not** uid 1000: on this host uid 1000 is the real
`ubuntu` login account. The authentik containers run as uid/gid 10001, which has
no host account, and `bin/owner-identity` fails closed if the runtime tree is not
owned by it.

## 5. What was rejected, and why

**Keycloak 26.7.3 (Apache-2.0).** The licence-cleanest option and the most
battle-tested, with SAML IdP and every MFA factor in the single upstream
distribution. Rejected because it is a JVM needing ~750 MB floor and 2 GB
recommended *plus* a separately provisioned PostgreSQL, and — decisively —
it has **no forward-auth / auth-request mode**. Gating `frank.fail` and every app
origin would have needed an additional component (oauth2-proxy) in the request
path. authentik's embedded outpost gives the same boundary with no extra hop.

**ZITADEL v4.17.3 (AGPL-3.0).** Can act as a SAML IdP and the free self-hosted
edition covers OIDC, SAML and MFA. Rejected on three counts: it ships its own
Traefik competing with the existing Caddy edge; it is 4–6 containers rather than
3; and its published roadmap gives V4 "at least 12 months" of support while a
next iteration ships, which is a real upgrade-path risk for the component that
holds the owner's identity. The AGPL-3.0 copyleft is acceptable for internal use
but is a strictly larger licence obligation than MIT.

**Frappe as its own OAuth2 server.** Frappe 15.120.1 can act as an OAuth2
authorization server and has a `Social Login Key` doctype with a `Custom`
provider. Rejected because it would make the CRM the root of trust for the whole
workspace: Frank, Mautic and the webmail panel would all depend on Frappe being
up in order to sign in, and Mautic has no OIDC client for interactive login at
all, so the SAML path would still need a second identity source. It was,
however, used as a *client* of authentik, which is what `Social Login Key` with
the `Custom` provider is for.

**A shared `.frank.fail` domain cookie.** Explicitly rejected. Each app keeps a
host-only session cookie on its own origin, and the shared boundary is the
outpost session on `auth.frank.fail`, checked per request.

**Path-based routing (`frank.fail/crm`).** Not needed: the wildcard resolves and
Caddy obtains certificates for the new names (section 8). It remains the
documented fallback if that ever stops being true, and it is a fallback with real
cost — it would put every app on Frank's own origin and remove the isolation the
per-host split gives.

## 6. One stable owner identity and its mappings

| | |
| --- | --- |
| authentik user | `owner` |
| Email | `owner@blockwise.sale` |
| Group | `owner-workspace`, role `owner-workspace-owner`, **not** superuser |
| Frappe | `owner@blockwise.sale` (existing `System User`, roles Agent, Agent Manager, Inbox User, Knowledge Base Editor, Sales Manager) |
| Mautic | username `owner` (existing user id 1) |
| Frank | `X-Authentik-Uid` on every gated request |
| Webmail | `X-Frank-Owner: {http.request.header.X-Authentik-Uid}`, with any client-supplied copy stripped first |

**No automatic public signup.** Three independent controls: the OIDC client's
`Social Login Key.sign_ups` is `Deny`, so an unknown identity is refused rather
than created; the SAML provider has **no default role**, which makes Mautic throw
`User does not exist` for an unknown user instead of creating one; and no
enrolment or invitation flow is exposed.

**Least privilege.** An expression policy `owner-workspace-members-only`
(`ak_is_group_member(request.user, name="owner-workspace")`) is bound to every
application, with `failure_result: false`. `akadmin` retains full administrative
access to authentik itself but is not silently entitled to the applications —
which is observable: the application list endpoint hides them from `akadmin`,
and `bin/bootstrap.py` has to pass `superuser_full_list=true` to see them.

## 7. MFA, sessions, revocation, logout, recovery

- **MFA is enforced, not offered.** authentik's stock
  `default-authentication-mfa-validation` stage ships with
  `not_configured_action: skip`, which means an owner with no second factor is
  simply not asked for one. `bin/bootstrap.py` sets it to `configure` with the
  TOTP and static-recovery-code enrolment stages bound, `last_auth_threshold:
  seconds=0` so there is no "trust this device" bypass window, and
  `device_classes: ["static", "totp"]`. This was verified end to end in a
  browser, not merely set.
- **Session expiry** is owned by the **User Login stage's `session_duration`**,
  set to `hours=12`. It is *not* an environment variable:
  `AUTHENTIK_SESSIONS__UNAUTHENTICATED_AGE` explicitly does not affect
  authenticated session lifetime. The container sets the unauthenticated age to
  `minutes=30` separately.
- **Revocation** is immediate for every app origin, because the outpost session
  lives in authentik's database and `forward_auth` re-checks it on **every**
  request. Deleting a session (`DELETE /api/v3/core/authenticated_sessions/{uuid}/`)
  or disabling the user blocks the next request even while the native
  application's own upstream session is still alive. This is the property that
  makes the ingress worth having: it is proven by the acceptance run, where after
  logout a direct `crm.frank.fail/crm/dashboard` request is denied even though
  Frappe's own session cookie is still in the browser.
- **Logout** ends the authentik session through the invalidation flow and then
  calls the outpost's `sign_out` on **each** gated host, because the outpost
  stores one proxy cookie per host and only clears the cookie for the host it is
  served on. Doing it only on `auth.frank.fail` was measured to clear **zero**
  cookies; that was the bug that made the first acceptance run fail.
- **Recovery**, in order: (1) static recovery codes, enrolled alongside TOTP at
  first sign-in; (2) the `akadmin` break-glass account, whose API token is the
  one in the secret file; (3) the restricted Basic Auth route
  `frank.fail/__owner-recovery`, kept until the owner session and its own
  recovery path have both passed acceptance, and documented for retirement
  afterwards.

## 8. Certificates for new subdomains — answered with evidence

**HTTP-01 through Caddy on port 80. No new secret is required, and no
Cloudflare API token is needed.**

Evidence, in order of strength:

1. The Caddy data volume already holds **single-host Let's Encrypt certificates**
   issued by this Caddy for `preview.frank.fail`, `git.frank.fail`,
   `mcp.frank.fail`, `mockup.frank.fail`, `tasks.frank.fail`, `buzz.frank.fail`
   and `ssh.frank.fail`, each with that one DNS name in `subjectAltName`. A
   single-host SAN list is only obtainable over HTTP-01 or TLS-ALPN-01, never
   DNS-01 (which is the only way to get a wildcard).
2. `git.frank.fail` was issued most recently, on **11 September 2026** — three
   days before this session — by the same running container. So the mechanism is
   not historical, it is current.
3. `*.frank.fail` is grey-cloud (resolves directly to `76.13.209.160`), so port
   80 reaches this host without traversing Cloudflare.
4. `http://auth.frank.fail/` — a name that has never had a site block — is
   answered by `frank-caddy` with its `:80` catch-all ("Frank is running.",
   `remote_ip=76.13.209.160`), which is the same listener that serves ACME
   HTTP-01 tokens.

The coordinator's point that `frank-caddy` has no Cloudflare API token in its
environment is correct and is exactly why DNS-01 is not the answer. It is also
not needed. Adding the `auth.`, `crm.`, `marketing.` and `mail.frank.fail` site
blocks will cause Caddy to request four new HTTP-01 certificates on the next
config load. TLS-ALPN-01 on 443 would also work but is not required, and the
grep-only claim that "Tailscale occupies 443" does not apply to the public IP,
which `frank-caddy` binds.

**No owner-side DNS or token action is required.** Path-based routing is
therefore not needed and is recorded above only as a fallback.

## 9. Framing: VERIFIED

The whole "native apps inside Frank" design rests on the browser honouring a CSP
`frame-ancestors` allowlist on the app origin while `X-Frame-Options` is replaced
at the edge, and on Frank's own `frame-src` naming those origins. An earlier
attempt to prove this was inconclusive because it ran against hosts whose
internal certificates were not yet serving. It was re-tested properly.

Method: a real Chromium, logged in as the owner, on `https://frank.fail/`,
creating iframes. The detector is Chrome's own refusal message
(`Refused to display` / `Framing ... violates the following Content Security
Policy directive`). To show the detector works, the same page also frames a host
expected to refuse — `frank.fail` itself, which keeps `frame-ancestors 'none'`.

| Case | `frame-ancestors` sent | Chrome refusal message |
| --- | --- | --- |
| **control** `frank.fail` | `'none'` | **yes** — `Framing 'https://frank.fail/' violates the following Content Security Policy directive: "frame-ancestors 'none'". The request has been blocked.` |
| **test** `crm.frank.fail/login` | `https://frank.fail`, no XFO | **none** |

So: the detector demonstrably fires, the control refuses as designed, and the
Frappe origin does **not** refuse. **Framing of `crm.frank.fail` by
`https://frank.fail` is VERIFIED.**

The coordinator ran an independent three-case test on real certificates, which
sharpens *why* this works. Varying only the framed app's headers:

| Framed app response headers | Result |
| --- | --- |
| `X-Frame-Options: SAMEORIGIN` only | blocked |
| `X-Frame-Options: SAMEORIGIN` **and** scoped CSP `frame-ancestors https://frank.fail` | **framed** |
| scoped CSP `frame-ancestors https://frank.fail` only | **framed** |

Two consequences, and the first corrects an emphasis in an earlier draft of this
record:

1. **The scoped CSP `frame-ancestors` is what grants permission.** It overrides a
   conflicting `X-Frame-Options` when both are present. The
   `-X-Frame-Options` strip in `owner_native_app_headers` is therefore
   **defence in depth, not the mechanism**. It is kept deliberately: the control
   case shows XFO is still enforced when it is the only signal, and this is
   browser behaviour observed on one Chromium build rather than a specification
   guarantee.
2. **The parent must name each app origin in its own `frame-src`.**
   `frame-ancestors 'none'` on Frank does not stop Frank framing others; Frank's
   own `frame-src` is what permits it. `crm`, `marketing` and `mail` are all
   named. Any further app origin needs adding there as well as receiving its own
   scoped `frame-ancestors`.

`mail.frank.fail` produced no refusal message either, but its response status was
not captured in the same run, so **webmail framing is recorded as UNVERIFIED by
this lane's own test** rather than as passing on that evidence alone. It does not
import `owner_native_app_headers` at all: the ingress's own
`frame-ancestors 'self' https://frank.fail` is passed through untouched, because
`'self'` is load-bearing for Roundcube's own message panes.

An initial attempt to detect blocking with the `securitypolicyviolation` DOM
event is recorded here as a **failed method**: the control produced zero
violation events, so absence of an event proved nothing. That method was
discarded rather than reported.

**Frank remains unframeable by every origin.** `frank_private_response_headers`
keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY`, and the control case
above exercised exactly that, from the app side. Nothing in this change relaxes
it. The only host that gained an allowlist is the app origin, and it names
exactly one parent.

## 10. Per-host framing, cookies and origins

| Host | `frame-ancestors` | `X-Frame-Options` | Session cookie |
| --- | --- | --- | --- |
| `frank.fail` (parent) | `'none'` — unframeable by anyone | `DENY` | host-only on `frank.fail` |
| `crm.frank.fail` | `https://frank.fail` only | **removed** at the edge | Frappe `sid`, host-only, `Secure`, `HttpOnly`, `SameSite=Lax` |
| `marketing.frank.fail` | `https://frank.fail` only | **removed** at the edge | Mautic session, host-only, `Secure`, `HttpOnly`, `SameSite=Lax` |
| `mail.frank.fail` | passed through from the ingress: `'self' https://frank.fail` | passed through, none added | webmail ingress owns it |
| `auth.frank.fail` | `'none'` — the sign-in form is never framed | `DENY` | `authentik_session` on `auth.frank.fail` only |

`SameSite=Lax` is correct and `None` is not needed: `SameSite` compares
*site* (registrable domain), and `frank.fail` and `crm.frank.fail` share the
site `frank.fail`, so a `Lax` cookie is sent on a same-site subresource request
inside an iframe. Each app's cookie stays host-only; there is no
`.frank.fail` cookie anywhere.

`Secure`: Frappe sets it automatically when the request scheme is `https`, which
it reads from `X-Forwarded-Proto`; the `crm.frank.fail` route sets
`header_up X-Forwarded-Proto https`. Mautic's `cookie_secure` already defaults to
`true` and its live login response confirms `secure; httponly; samesite=lax`.

Two corrections to the earlier strict-CSP plan, both found by running the real
pages rather than by reasoning:

1. **`auth.frank.fail` sets only `frame-ancestors 'none'`.** An earlier revision
   also pinned `default-src`/`script-src`/`style-src`/`connect-src`. Loading the
   real flow page showed that broke authentik's own inline bootstrap scripts
   (`Executing inline script violates ... 'script-src 'self''`). A partially
   broken identity provider is a worse failure than an otherwise unrestricted
   page that nothing may frame, so the remaining directives are omitted rather
   than guessed at.
2. **`Set-Cookie` must not appear in a Caddy `log format filter` on this
   version.** The pre-existing `frank.fail` block documents the 2.8.x
   field-deletion bug; a first draft of the new blocks copied
   `response>headers>Set-Cookie delete` from it, and that silently stripped
   `Set-Cookie` from the identity provider's own responses and broke sign-out.
   All three new blocks now carry the warning comment instead.

## 11. Blockers and what is genuinely unverified

1. **Frappe's own OIDC login does not complete. The owner session boundary in
   front of it does.** Precision matters here: `crm.frank.fail` is correctly
   gated, Frappe's login page offers the authentik button, the browser is handed
   to authentik's authorize endpoint with the correct `client_id`,
   `redirect_uri` and `state`, and the flow then **fails at authentik** with
   `error=invalid_request&error_description=The request is otherwise malformed`
   before any code is issued. A hand-built request to
   `/application/o/authorize/` carrying the exact configured `client_id`,
   the exactly-configured `redirect_uri`, `response_type=code` and
   `scope=openid email profile` reproduces the same error, while the outpost's
   own authorize calls to the same endpoint succeed with `302`. The remaining gap
   is therefore in the OIDC client's configuration on the authentik side, not in
   the edge, not in Frappe's callback wiring, and not in the owner session. Two
   intermediate causes were found and fixed on the way: `response_type` was not
   being sent at all (Frappe builds the URL through rauth), and the endpoint
   paths were relative to the per-application base URL, but
   `/application/o/<slug>/authorize/` does not exist and returns 404.
2. **Webmail framing is UNVERIFIED**, as recorded in section 9.
3. **Mautic SAML uses a split public entity ID and native ACS.** Mautic 7.2.0
   has native SAML 2.0 SP support in core (no plugin; `mautic/plugin-saml` does
   not exist and is not needed). Its configured `saml_idp_entity_id` remains
   `https://mail.blockwise.sale`, preserving the existing audience, while its
   LightSAML AuthnRequest does not supply an ACS override. Authentik therefore
   posts the assertion to its configured native ACS,
   `https://marketing.frank.fail/s/saml/login_check`. `mautic.site_url` remains
   public for recipient opt-out links; it is not the SAML ACS authority.
4. **No certificate has actually been issued for the four new names**, because
   that requires loading the new config into production `frank-caddy`, which
   this lane is not allowed to do. The *mechanism* is established with the
   evidence in section 8; the issuance is the coordinator's step.

## 12. Unsubscribe is untouched

`mail.blockwise.sale` keeps exactly its existing block: `/email/unsubscribe/*`
and `/email/dnc/*` public, everything else 404. `marketing.frank.fail` is an
**additive** hostname. `mautic.site_url` is deliberately **not** changed, because
Mautic builds every unsubscribe and DNC link from it and repointing it would move
opt-out behind the owner identity. Mautic's SAML entity ID stays `https://mail.blockwise.sale`, so its existing
SAML audience remains stable. Its native LightSAML login request deliberately
has no ACS override, so Authentik is configured to POST the assertion only to
`https://marketing.frank.fail/s/saml/login_check`. This preserves the public
opt-out boundary without adding any SAML route to it.

## 13. Rollback

The change is additive and reversible in four independent steps, in this order:

1. **Stop the identity provider**: `apps/window/infra/owner_identity/bin/owner-identity down`.
   Nothing else depends on it running.
2. **Restore access to Frank**: re-apply the previous `apps/window/Caddyfile`,
   which had `basic_auth` on the catch-all and the `remote_ip 100.86.154.37`
   bypass. The Frank release path already retains immutable configs by commit, so
   this is a redeploy of the prior revision, not a hand edit.
3. **Unwire the native apps**: delete the `authentik` Social Login Key in Frappe
   (`bench --site owner.crm.internal console`), and remove the `saml_idp_*`
   values in Mautic. Both apps keep their own password login throughout — the
   IdP was never made the only way into either of them.
4. **Retire the data**: stop the project, then remove
   `/srv/frank/owner-identity/` and `/srv/frank/secrets/owner-identity.env`.
   Nothing else on the host reads them.

There is no migration to reverse. The identity database holds only the owner
account, its group, three applications and their providers, and is reproducible
from `bin/bootstrap.py` in under a minute.

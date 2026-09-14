# Owner identity provider

One shared owner sign-in for the Frank Window and the native owner applications.
This is the authenticated access foundation: the thing that makes it possible for
the owner to open Frank once and reach CRM, Helpdesk, marketing and webmail
without a separate password for each.

The decision record, including licence, pinned version, MFA, session, rollback
and what was rejected, is [`docs/OWNER_IDENTITY_ADR.md`](../../../../docs/OWNER_IDENTITY_ADR.md).

## What it is

[authentik](https://goauthentik.io) `2026.8.2`, digest-pinned, as its own Compose
project on `auth.frank.fail`. Three containers: `postgresql`, `server` and
`worker`. No host port is published. The only route in is the Frank edge.

It is used in two ways at once:

- as an **OIDC provider** for Frappe's supported `Social Login Key`, and
- as a **SAML 2.0 identity provider** for Mautic, whose only interactive
  single-sign-on path is SAML, and
- as a **forward-auth session boundary** in front of every owner host through
  its embedded outpost, which is what makes one session cover every app origin.

## Deployment seam

Everything that must not be in Git lives here:

| Concern | Location | Mode |
| --- | --- | --- |
| Secrets | `/srv/frank/secrets/owner-identity.env` | `0600`, root |
| Database | `/srv/frank/owner-identity/postgresql` | `0700`, uid 70 |
| Media and files | `/srv/frank/owner-identity/data` | `0700`, uid 10001 |
| Certificates | `/srv/frank/owner-identity/certs` | `0700`, uid 10001 |
| Acceptance edge config | `/srv/frank/owner-identity/acceptance/` | `0700`, root |

The containers run as uid/gid **10001**, which has no account on this host. uid
1000 is deliberately not used: it is the real `ubuntu` login account, and the
identity store must not be owned by something that can log in.

## First provision

```bash
cp .env.example /srv/frank/secrets/owner-identity.env   # then fill it in
chmod 0600 /srv/frank/secrets/owner-identity.env
chown root:root /srv/frank/secrets/owner-identity.env

bin/owner-identity config      # validates Compose, pins and required keys
bin/owner-identity up          # creates state, attaches the edge, waits for health
bin/owner-identity bootstrap   # creates the owner, applications and policies
```

`.env.example` documents every value and how to generate it. No value in it is
real.

## Commands

| Command | What it does |
| --- | --- |
| `config` | Validates the Compose file, the pinned digests and the required keys |
| `up` | Creates runtime state, attaches `frank-caddy`, starts, waits for health |
| `down` | Stops and removes this project's containers |
| `status` | Container state for this project |
| `health` | Proves the stack actually serves the owner session boundary |
| `bootstrap` | Idempotently creates the owner identity, groups, providers, applications and policies |
| `provision-native` | Wires Frappe (OIDC) and Mautic (SAML) to the provider |
| `outpost` | Prints the exact Caddy directives this deployment requires |
| `probe CMD...` | Runs `CMD` against a **scratch** database, never the live one |
| `reset-database` | Destroys and recreates the identity database, refusing while anything is provisioned |
| `acceptance` | Runs the end-to-end browser proof and writes a receipt |

### Do not start a second server

authentik's server owns a database migration lock, and two servers migrating the
same database concurrently interleave the migration graph into an unrecoverable
state. That is not hypothetical: it happened while this component was being
built, from `docker compose run ... server` probes against the live database.

`up` and `probe` therefore both refuse to run while any authentik server or
worker outside this project is up, and `probe` creates a throwaway database so a
one-off command can never touch the identity store. Use `bin/owner-identity probe
'ak dump_config'`, never `docker compose run server`.

## Health evidence

`bin/owner-identity health` is not a Compose check. It requires the containers to
be running at the checkout's commit, the database and server to be healthy, the
server image to be the pinned digest, the server to answer
`/-/health/ready/`, the embedded outpost to answer the exact
`/outpost.goauthentik.io/auth/caddy` path Caddy forward-auths against, and
`frank-caddy` to actually be attached to the ingress network — because without
that last one, nothing can reach the boundary at all.

## The owner identity

One identity, no self-service path:

| | |
| --- | --- |
| User | `owner` |
| Email | `owner@blockwise.sale` |
| Group / role | `owner-workspace` / `owner-workspace-owner`, not superuser |
| Frappe | `owner@blockwise.sale` |
| Mautic | username `owner` |

An expression policy bound to every application restricts access to that group
with `failure_result: false`. `akadmin` remains the break-glass administrator of
authentik itself but is not entitled to the applications — which is why
`bootstrap.py` has to request `superuser_full_list=true` to see them.

Signup is refused in three independent places: `Social Login Key.sign_ups = Deny`
in Frappe, no default role on the SAML provider in authentik (which is what makes
Mautic refuse an unknown user instead of creating one), and no enrolment flow
exposed at all.

## Ingress contract

`bin/owner-identity outpost` prints the snippets. They are duplicated verbatim in
`apps/window/Caddyfile`, because Frank's release ships only that one file to the
edge; `bin/owner-identity config` fails if the two copies drift.

Every owner host — `frank.fail`, `crm.frank.fail`, `marketing.frank.fail`,
`mail.frank.fail` — must carry **all three** of:

1. `import owner_identity_outpost` — the outpost's own path, first in the route,
   reachable without a session.
2. `import owner_identity_session_gate` — `forward_auth` against the outpost.
3. A matching **authentik application and proxy provider** for that host.

Missing (3) is the failure mode to know about: the outpost has no client for the
host and answers **404 with its own HTML**, which looks exactly like a broken
Caddy block. `crm.`, `marketing.` and `mail.` all have providers created by
`bootstrap`. A new host needs a new loop entry there, not just a Caddy block.

Only `crm.frank.fail` and `marketing.frank.fail` take
`import owner_native_app_headers`, which replaces `X-Frame-Options` with a scoped
`frame-ancestors`. **`mail.frank.fail` must not**: its ingress already sends
`frame-ancestors 'self' https://frank.fail`, and `'self'` is load-bearing because
Roundcube frames its own message list and body.

## Acceptance

```bash
bin/acceptance-edge.sh up     # a second Caddy on 127.0.0.1:9443 serving the
                              # committed site blocks, with an internal CA
bin/owner-identity acceptance # drives a real Chromium through the whole flow
bin/acceptance-edge.sh down
```

The acceptance edge exists so the flow can be proven **without deploying to
production**. It serves the same site blocks, the same snippets and the same
header policy as the real edge; only the port and the certificate authority
differ. DNS is remapped inside the browser, so the URLs stay
`https://frank.fail/` and `https://crm.frank.fail/` with no port — cookies,
OAuth redirect URIs and `frame-ancestors` are all exercised exactly as they will
be in production.

It binds only `127.0.0.1`, uses throwaway Basic Auth credentials that are
documented in `acceptance/compose.yaml` and protect nothing, and is removed when
the proof is finished.

The harness completes the sign-in form through authentik's own flow-executor JSON
API called from inside the page, because authentik renders its stages inside
shadow DOM and synthetic clicks did not advance the flow. Everything after
sign-in is ordinary browser navigation.

## What this component does not do

- It does not send mail. authentik's email host is `localhost` and no invitation
  or reset flow is exposed.
- It does not hold customer data. Only the owner identity, its group, the
  applications and their providers.
- It does not touch `mail.blockwise.sale`'s public opt-out routes, and it does
  not change `mautic.site_url`.

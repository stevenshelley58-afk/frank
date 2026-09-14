# Owner workspace — factual discovery report

Lane: `owner-ws-inventory`. Worktree `/projects/frank-worktrees/owner-ws-inventory`,
branch `owner-ws-inventory`, baseline `main` = `8b166cf`.

Method: read-only probing over SSH on the VPS. Every command below was executed and
its observed output is quoted, with secret values redacted. A claim is marked
**VERIFIED** only where I ran it and saw the result, **PARTIAL** where the result is
incomplete or came from an unverified mirror, and **UNVERIFIED** where I could not
establish it. Where I could not prove something I say so rather than infer it.

Authority read before probing: `/projects/blockwise/AGENTS.md`,
`/projects/frank/AGENTS.md`, the three `apps/window/infra/owner_*/README.md` guides,
and the frozen brief at
`/srv/frank/verification/owner-workspace-20260914/shared-brief.md`.

The path named in my task, `/srv/frank/verification/owner-workspace-brief.md`, **does
not exist** (VERIFIED: the `cat` produced nothing). The frozen brief was located at
`/srv/frank/verification/owner-workspace-20260914/shared-brief.md` and read there.

One incident to declare: an early redaction filter of mine matched only top-level
keys and therefore printed one nested secret value (a mailbox password inside
Mautic's `monitored_email` block). It is not reproduced anywhere in this file, and I
switched to targeted extraction afterwards. Its path and key name are reported in
Q3 as a finding.

---

## 1. Codex browser context

**Status: PARTIAL** — the VPS side is fully established; the in-app browser itself is
**UNVERIFIED** and is not observable from this host.

### Evidence

Codex runtime present, no browser process:

```
$ ps aux | grep -iE "codex|chrom|playwright|puppeteer" | grep -v grep
root  28861  node /usr/bin/codex -c features.code_mode_host=true app-server --listen unix://
root  28874  .../@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex -c features.code_mode_host=true app-server --listen unix://
root  29406  node /usr/bin/codex app-server proxy
root 861996  .../bin/codex-code-mode-host
```

No `chrome`, `chromium`, `playwright` or `puppeteer` process appears in the process
table.

```
$ /usr/bin/codex --version
codex-cli 0.145.0
```

No remote-debugging / CDP listener exists:

```
$ ss -ltnp | grep -E "922[0-9]|9333|9515|4444|CDP"
none matched
```

The installed Codex does advertise the browser features as enabled:

```
$ codex features list
in_app_browser              stable   true
browser_use                 stable   true
browser_use_full_cdp_access stable   true
browser_use_external        stable   true
computer_use                stable   true
```

But the binary contains **no browser engine wiring**. Strings extracted from the
0.145.0 vendor binary contain only the feature-flag names plus the Rust `webbrowser`
crate (used to open login URLs):

```
$ strings -n 5 <codex-binary> | grep -aiE "ms-playwright|chrome-headless-shell|chrome-linux64|headless_shell|playwright-core|chrome-devtools-mcp"
(no output)

$ strings -n 5 <codex-binary> | grep -aE "webbrowser|Failed to open browser"
/home/runner/work/codex/codex/.cargo-home/.../webbrowser-1.0.6/src/common.rs
Failed to open browser for
If your browser did not open, navigate to this URL to authenticate:
```

The product map embedded in the same binary describes this as a client surface, not
a server one:

> CLI is terminal-first local repo work; ... Codex app is desktop planning, review,
> and interactive work; ... Browser Use/in-app browser is Codex-controlled web testing

Codex has never used it on this host. Of 260 session rollouts:

```
$ grep -rlI "in_app_browser" /root/.codex/sessions/ | wc -l
0
$ grep -rlI "browser_use"     /root/.codex/sessions/ | wc -l
1     # incidental text: a skill-catalogue listing, not a tool call
```

Codex MCP configuration has no browser server:

```
$ sed -E "s/(key|token|secret|password|api_key)[[:space:]]*=.*/\1 = <REDACTED>/I" /root/.codex/config.toml
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
service_tier = "default"
...
[mcp_servers.openaiDeveloperDocs]
url = "https://developers.openai.com/mcp"
```

Browser engines installed on the VPS but **not running**, with versions read from the
binaries themselves:

| Path | Engine |
| --- | --- |
| `/opt/google/chrome/chrome` | Google Chrome 150.0.7871.186 |
| `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` | Google Chrome for Testing 151.0.7922.34 |
| `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` | Google Chrome for Testing 151.0.7922.34 |
| `/root/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome` | Google Chrome for Testing 152.0.7977.75 |

`/root/.agent-browser/sessions/*.json` is **not** Codex browser state. It is stale
Playwright storage state from 11 Aug with empty contents:

```
$ cat /root/.agent-browser/sessions/frank-factory-desktop-default.json
{ "cookies": [], "origins": [] }
```

Its provenance is the Vercel plugin skill shipped to Codex, whose own text calls it a
CLI:

```
$ cat /root/.codex/.tmp/plugins/plugins/vercel/skills/agent-browser/SKILL.md
name: agent-browser
description: Browser automation CLI for AI agents...
```

and that CLI is **not installed**:

```
$ which agent-browser
(no output)
$ find / -maxdepth 7 -name "agent-browser*" -type f
(nothing)
```

I attempted to capture a real user-agent from the local engines to give a concrete
data point. It did not work in this environment:

```
$ /root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome --headless=new \
    --no-sandbox --disable-gpu --disable-dev-shm-usage --virtual-time-budget=3000 \
    --user-data-dir=... --dump-dom "data:text/html,<body><script>document.body.textContent=navigator.userAgent</script></body>"
(no DOM returned within 40s; first attempt timed out at 60s)
```

So the user-agent string of any engine remains **UNVERIFIED**. I report engine
*versions* (verified via `--version`, and for the Playwright/puppeteer builds via the
binaries' own `--version`) and do not guess a UA.

### What I cannot prove

* The browser engine, version and user-agent of the Codex in-app browser the owner
  actually uses. Nothing on this VPS hosts or exposes it.
* Whether it is a Chromium variant. The Codex binary ships no Chromium and opens no
  CDP endpoint, so on this host the in-app browser must come from the client install.
* Whether we can drive or observe it programmatically. There is no CDP port, no
  browser MCP server and no browser service here, so on the available evidence:
  **we cannot, from the VPS.**

### Implication for the build

The in-app browser is a Codex *client* feature running on the owner's machine, not a
VPS service. Frank cannot observe or drive it. Any argument that depends on
third-party-cookie or iframe behaviour inside that browser — which is exactly what
framing `crm.frank.fail` / `mail.frank.fail` / `marketing.frank.fail` depends on —
cannot be validated from the VPS and must be validated in the owner's real client.
For our own automated checks we have Playwright Chromium 151 (Chrome for Testing) and
google-chrome 150 available locally.

### Open question

Which Codex surface is the owner actually using (CLI TUI in-app browser, Codex desktop
app, or IDE extension), and what is its Chromium version and third-party-cookie
policy? Only the owner can confirm this; the VPS cannot.

---

## 2. Frappe CRM / Helpdesk auth capability

**Status: VERIFIED** (all read-only; no record created or changed).

### Evidence

Installed apps:

```
$ docker exec owner-crm-frontend-1 bench --site owner.crm.internal list-apps

frappe     15.120.1 UNVERSIONED
crm        1.83.0   UNVERSIONED
telephony  0.0.1    UNVERSIONED
helpdesk   1.30.1   UNVERSIONED
```

Auth-relevant doctypes that exist in **this** installed version (directory listing of
`apps/frappe/frappe/integrations/doctype/`):

```
ldap_group_mapping      oauth_authorization_code   oauth_provider_settings
ldap_settings           oauth_bearer_token         oauth_scope
oauth_client            oauth_client_role          social_login_key
                                                   social_login_keys
```

Exact provider list, read from the installed doctype JSON, not from memory or docs:

```
$ cat .../social_login_key/social_login_key.json
social_login_provider  Select
options = "Custom\nFacebook\nFrappe\nGitHub\nGoogle\nOffice 365\nSalesforce\nfairlogin\nKeycloak"
```

Full field list of `Social Login Key` in the installed version:

| fieldname | fieldtype | required |
| --- | --- | --- |
| `enable_social_login` | Check | no |
| `social_login_provider` | Select (list above) | no |
| `client_id` | Data | no |
| `provider_name` | Data | **yes** |
| `client_secret` | Password | no |
| `icon` | Data | no |
| `base_url` | Data | no |
| `authorize_url` | Data | no |
| `access_token_url` | Data | no |
| `redirect_url` | Data | no |
| `api_endpoint` | Data | no |
| `custom_base_url` | Check | no |
| `api_endpoint_args` | Code | no |
| `auth_url_data` | Code | no |
| `user_id_property` | Data | no |
| `sign_ups` | Select (`Allow` / `Deny`) | no |

Built-in endpoint map from `social_login_key.py` in the installed version, showing it
is a real OAuth2/OIDC **client**:

```
Office 365 -> provider preset
GitHub     -> api_endpoint "user"
Google     -> api_endpoint "oauth2/v2/userinfo"
Frappe     -> api_endpoint "/api/method/frappe.integrations.oauth2.openid_profile"
Salesforce -> api_endpoint "https://login.salesforce.com/services/oauth2/userinfo"
fairlogin  -> api_endpoint "https://id.fairkom.net/auth/realms/fairlogin/protocol/openid-connect/userinfo"
Keycloak   -> api_endpoint "/protocol/openid-connect/userinfo"
              user_id_property "preferred_username"
```

Frappe is also an OAuth2 **server** in this version: `oauth_client`, `oauth_scope`,
`oauth_bearer_token`, `oauth_authorization_code` doctypes exist, and
`OAuth Provider Settings` is a Single:

```
$ SELECT field, value FROM tabSingles WHERE doctype="OAuth Provider Settings";
creation            NULL
docstatus           0
idx                 0
modified            2026-09-12 21:10:09.821510
modified_by         Administrator
name                OAuth Provider Settings
owner               Administrator
skip_authorization  Force
```

Current auth state — nothing is configured yet:

```
$ SELECT COUNT(*) FROM `tabSocial Login Key`;   -> 0
$ SELECT COUNT(*) FROM `tabOAuth Client`;       -> 0
```

Owner user and role state (read-only; no password hash was selected or printed):

```
$ SELECT name, enabled, user_type FROM `tabUser` ORDER BY name;
Administrator            1  System User
crm-sync@blockwise.sale  1  Website User
Guest                    1  Website User
owner@blockwise.sale     1  System User

$ SELECT parent, GROUP_CONCAT(role ORDER BY role) FROM `tabHas Role`
  WHERE parenttype="User" GROUP BY parent;
Administrator           -> 28 roles incl. System Manager, Sales Manager, Workspace Manager
crm-sync@blockwise.sale -> Owner CRM Sync
Guest                   -> Guest
owner@blockwise.sale    -> Agent, Agent Manager, Inbox User, Knowledge Base Editor, Sales Manager
```

### Implication for the build

Frappe 15.120.1 can act as an OAuth2/OIDC **client** through `Social Login Key` today
with no custom app: it needs `client_id`, `client_secret`, `authorize_url`,
`access_token_url`, `api_endpoint` (userinfo), `redirect_url`, scopes and extra
authorize parameters via `auth_url_data` / `api_endpoint_args`, plus
`user_id_property` for OIDC providers. It can equally act as an OAuth2 **server**
(`oauth_client`), which is the cheaper path if Frappe is to be the owner IdP. Both are
greenfield: zero social login keys and zero OAuth clients exist.

One existing setting needs review before Frappe is used as the IdP:
`OAuth Provider Settings.skip_authorization = Force` means Frappe's own authorization
endpoint would auto-approve consent.

### Open question

Is Frappe intended to be the owner identity provider, or only a relying party to an
external IdP? The brief records that no IdP (Authentik/Keycloak) is installed.

---

## 3. Mautic auth capability

**Status: VERIFIED** (read from the installed source and live config, not from docs).

### Evidence

Exact installed version:

```
$ docker exec -w /var/www/html frank-owner-marketing php bin/console --version
Mautic 7.2.0 - app/prod (env: prod, debug: false)

$ grep -m5 '"name"|"version"' /var/www/html/composer.json
"mautic/core-lib": "7.2.0",
```

Bundled plugins — the complete set (`docroot/plugins`):

```
GrapesJsBuilderBundle    MauticClearbitBundle        MauticCloudStorageBundle
MauticCrmBundle          MauticEmailMarketingBundle  MauticFocusBundle
MauticFullContactBundle  MauticGmailBundle           MauticOutlookBundle
MauticSocialBundle       MauticTagManagerBundle      MauticZapierBundle
```

No SAML and no LDAP plugin is bundled or present.

Auth-relevant packages actually installed (`composer.lock`):

```
javer/lightsaml                    (1.9.0)
klapaudius/oauth-server-bundle
klapaudius/oauth2-php
guzzlehttp/oauth-subscriber
kamermans/guzzle-oauth2-subscriber
```

**SAML is in core, not a plugin.** The `UserBundle` carries a full SAML
implementation:

```
$ find ... -iname "*saml*"     -> core files (50 files match "saml" in app/bundles):
/var/www/html/docroot/app/bundles/UserBundle/Security/SAML/Store/IdStore.php
/var/www/html/docroot/app/bundles/UserBundle/Security/SAML/Store/CredentialsStore.php
/var/www/html/docroot/app/bundles/UserBundle/Security/SAML/Store/Request/RequestStateStore.php
/var/www/html/docroot/app/bundles/UserBundle/Security/SAML/Store/EntityDescriptorStore.php
/var/www/html/docroot/app/bundles/UserBundle/Security/SAML/User/UserMapper.php
/var/www/html/docroot/app/bundles/UserBundle/DependencyInjection/Firewall/Factory/MauticSsoFactory.php
/var/www/html/docroot/app/bundles/UserBundle/DependencyInjection/Compiler/SsoAuthenticatorPass.php
```

Routes it exposes (`UserBundle/Config/config.php`):

```
mautic_sso_login          /sso_login/{integration}
mautic_sso_login_check    /sso_login_check/{integration}
lightsaml_sp.login        /saml/login
lightsaml_sp.login_check  /saml/login_check
lightsaml_sp.metadata     /saml/metadata.xml
lightsaml_sp.discovery    /saml/discovery
mautic_saml_login_retry   /saml/login_retry
```

**LDAP: not supported.** No `*ldap*` file anywhere under the Mautic source, config or
plugins, and no LDAP package in `composer.lock`.

**OAuth2:** bundled as a **server** (for Mautic's own API) and as a **client** (for its
Gmail/Outlook integrations). Live config has `api_enabled = true` and
`api_enable_basic_auth = true`.

**`sso` keys under `parameters`: none are set.** The live `$parameters` in
`/var/www/html/config/local.php` contains no `sso` or `saml` key at all
(`grep -cE "sso|saml" /var/www/html/config/local.php` prints `0`, exit code 1). The
SSO/SAML settings are Mautic configuration defaults, not `parameters` entries, and are
declared in `UserBundle/Config/config.php`:

```
saml_idp_metadata, saml_idp_entity_id, saml_idp_own_certificate,
saml_idp_own_private_key, saml_idp_own_password, saml_idp_email_attribute,
saml_idp_username_attribute, saml_idp_firstname_attribute,
saml_idp_lastname_attribute, saml_idp_default_role
```

They are edited through Mautic's Configuration UI
(`UserBundle/Form/Type/ConfigType.php`), and the entity id is read from the
`mautic.saml_idp_entity_id` parameter. The keys present in the live `$parameters` are
only: `db_driver`, `db_host`, `db_port`, `db_name`, `db_user`, `db_password`,
`db_table_prefix`, `db_backup_tables`, `db_backup_prefix`, `db_host_ro`,
`db_server_version`, `secret_key`, `site_url`, `api_enable_basic_auth`, `api_enabled`,
`trusted_proxies`, `monitored_email`, `disable_trackable_urls`.

**Public site URL** (live config): `site_url => https://mail.blockwise.sale`

**Unsubscribe / DNC routes are defined in**
`docroot/app/bundles/EmailBundle/Config/config.php`:

```
'mautic_email_unsubscribe' => [
    'path'       => '/email/unsubscribe/{idHash}/{urlEmail}/{secretHash}',
    'controller' => 'Mautic\EmailBundle\Controller\PublicController::unsubscribeAction',
],
'mautic_email_unsubscribe_all' => [
    'path'       => '/email/dnc/{idHash}/{urlEmail}/{secretHash}',
    'controller' => 'Mautic\EmailBundle\Controller\PublicController::unsubscribeAllAction',
],
```

Caddy exposes exactly these two paths publicly on `mail.blockwise.sale` (see Q7).

**Security finding (path and key name only, no value disclosed):**
`/var/www/html/config/local.php` stores the Purelymail mailbox credential for monitored
email in plaintext at key `monitored_email.general.password`, alongside `db_password`
and `secret_key`. The file is mode `0755`, owned `root`:

```
$ ls -la /var/www/html/config
-rwxr-xr-x 1 root root 1131 Sep 14 03:36 local.php
```

### Implication for the build

Mautic 7.2.0 supports **SAML SSO natively in core** (LightSAML + `UserBundle`), and
OAuth2 both as a server (its API) and as a client (integrations). It does **not**
support LDAP. So an owner SSO boundary can front Mautic with SAML, or leave native
Mautic login in place behind forward-auth. The public opt-out contract is
`/email/unsubscribe/*` and `/email/dnc/*` and must stay public and unauthenticated.

### Open question

Use Mautic's core SAML (which requires an IdP we do not yet have) or keep native
Mautic login behind the owner boundary? Also: should the plaintext mailbox credential
move out of `local.php` into `/srv/frank/secrets`?

---

## 4. Purelymail mail connectivity

**Status: VERIFIED** — IMAP reachable and authenticating; SMTP reachable and
authenticating on both 465 and 587.

### Evidence

Credential file key **names** only. No secret value was read into this report:

```
$ stat -c "%n mode=%a owner=%U" /srv/frank/secrets/owner-mail.env
/srv/frank/secrets/owner-mail.env mode=600 owner=root

keys: PURELYMAIL_USERNAME  PURELYMAIL_PASSWORD  OWNER_MAIL_ADDRESS
non-secret values only:
  PURELYMAIL_USERNAME=blockwise@purelymail.com
  OWNER_MAIL_ADDRESS=hello@blockwise.sale
```

DNS and TCP reachability from the VPS:

```
$ getent hosts imap.purelymail.com smtp.purelymail.com mailserver.purelymail.com
imap.purelymail.com       -> 18.204.123.63
smtp.purelymail.com       -> 18.204.123.63
mailserver.purelymail.com -> 18.204.123.63

$ TCP connect tests
imap.purelymail.com:993        OPEN
smtp.purelymail.com:465        OPEN
smtp.purelymail.com:587        OPEN
mailserver.purelymail.com:993  OPEN
```

TLS certificate presented on IMAP:

```
subject=CN = purelymail.com
issuer=C = US, O = Let's Encrypt, CN = YR1
notBefore=Aug  1 14:45:19 2026 GMT
notAfter=Oct 30 14:45:18 2026 GMT
```

Authentication results. Credentials were supplied from the env file and never echoed:

```
IMAP 993  ->  * OK PM IMAP ready
              a1 OK LOGIN <redacted>
              a2 OK LOGOUT completed.

SMTP 465  ->  220 smtp.purelymail.com
              250-AUTH LOGIN PLAIN
              250 SIZE 51200000
              235 OK                      (AUTH PLAIN accepted)

SMTP 587  ->  250-AUTH LOGIN PLAIN
              235 OK                      (STARTTLS + AUTH PLAIN accepted)
```

Correct settings, independently confirmed against Purelymail's own technical page
(fetched: https://purelymail.com/docs/setup/technical): IMAP
`imap.purelymail.com:993` SSL/TLS; SMTP `smtp.purelymail.com:465` SSL/TLS, or `:587`
STARTTLS; POP3 `pop3.purelymail.com:995`; ManageSieve
`mailserver.purelymail.com:4190` STARTTLS. The username is the full email address.
Purelymail's page states that when Two Factor Authentication is enabled an **App
Password must replace the real password** — the 2FA state of this account is not
observable from here.

### Implication for the build

A VPS-hosted webmail client can connect to this mailbox today. Plain-password auth over
TLS works and is accepted. If 2FA is enabled on the account, the stored password would
have to be a Purelymail app password instead.

### Open question

Is 2FA enabled on `blockwise@purelymail.com`? That decides whether the existing stored
password keeps working for a new client or an app password is required.

---

## 5. Roundcube evaluation

**Status: PARTIAL.** The Purelymail half is VERIFIED (I fetched the official page and
independently proved connectivity in Q4). The Roundcube half is desk research delegated
to a sub-agent and **not independently fetched by me**; version numbers and CVE
identifiers below should be re-checked before they are relied on.

### Evidence

Roundcube (delegated research, sources as cited by the researcher):

* Latest stable **1.7.4, released 2026-09-06** (security release); 1.6 LTS line
  **1.6.19**, same date; 1.7.0 released 2026-05-10. Source:
  `api.github.com/repos/roundcube/roundcubemail/releases` and `roundcube.net/news`.
  **Not independently fetched by me.**
* Minimum **PHP 8.1** (`docs/INSTALL.md`: "PHP Version 8.1 or greater"; `composer.json`
  pins `"php": ">=8.1 <8.6"`, so 8.1-8.5). Required extensions include PCRE, DOM,
  JSON, Session, Sockets, OpenSSL, Mbstring, Filter, Ctype, Intl, plus PDO with a
  MySQL, PostgreSQL or SQLite driver; Iconv, Zip, Fileinfo and Exif recommended. No
  recommended PHP version is documented.
* Licence **GPL-3.0-or-later with an exception for skins and plugins**.
* Actively maintained, with releases on 2026-05-10, 05-24, 07-05, 08-09 and 09-06. The
  published release-management policy fully supports only the latest version; the
  previous minor receives security and similarly critical fixes only.
* Auth: Roundcube is a client and sends the user's supplied credentials to IMAP/SMTP
  (`imap_host`, `smtp_host`, `smtp_user='%u'`, `smtp_pass='%p'`). A plain password or
  an app password both work, because the server sees each as a password. OAuth2 is
  bundled in **core config** (`oauth_provider`, `oauth_client_id/secret`,
  `oauth_auth_uri`, `oauth_token_uri`, `oauth_identity_uri`, OIDC discovery, PKCE,
  `oauth_auth_type` = XOAUTH2/OAUTHBEARER/OAUTH); there is **no `oauth2` plugin** in
  core. Auth-related core plugins are `http_authentication`, `krb_authentication`,
  `password` and `autologon`.

Purelymail app passwords (**VERIFIED** from official docs): supported. Created in the
account admin portal `https://purelymail.com/manage` (not the webmail) via Users ->
App Passwords -> Add New, shown once. The 2FA documentation states an app password
grants full email access but cannot be used for the admin portal or a password change.

Purelymail API (**PARTIAL**): the researcher reports a published OpenAPI spec at
`https://news.purelymail.com/api/swagger-spec.js` (served as JavaScript and not
fetchable as text by the tooling), with base `https://purelymail.com`, calls as
`POST /api/v0/<operation>`, an auth header `Purelymail-Api-Token`, and a
`createAppPassword` operation taking `{"userHandle": ..., "name": ...}` and returning
`{"result": {"appPassword": ...}}`. The spec contents were read from a **third-party
mirror**, and how an API token is issued is **UNVERIFIED** — the former
`purelymail.com/docs/api` page now returns 404. Treat automated app-password
provisioning as unproven.

Purelymail OAuth2 for IMAP/SMTP: **not supported**. No OAuth2 is documented for these
protocols anywhere in Purelymail's docs. This is a negative finding, not an explicit
denial.

Purelymail hosts its own Roundcube at **https://inbox.purelymail.com** (VERIFIED:
linked as "Webmail" in the site navigation of the page I fetched).

### Implication for the build

A VPS-hosted maintained Roundcube is viable here, but it must use **password auth**
(the account password, or an app password if 2FA is on), because Purelymail exposes no
OAuth2 endpoints for IMAP/SMTP. Roundcube's bundled OAuth2 support is therefore
unusable against this provider. Config would be
`imap_host='ssl://imap.purelymail.com:993'`, `smtp_host='ssl://smtp.purelymail.com:465'`,
`smtp_user='%u'`, `smtp_pass='%p'`. Purelymail already provides a working Roundcube, so
the only reason to host one is iframe/SSO integration into the owner workspace.

### Open question

Can a Purelymail API token actually be issued? Without it, per-user app-password
provisioning is a manual portal step, which conflicts with the brief's "no repeated
separate app passwords".

---

## 6. ntfy state

**Status: VERIFIED.**

### Evidence

Reachable on loopback:

```
$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18104/   -> 200
$ curl -s http://127.0.0.1:18104/v1/health                         -> {"healthy":true}
```

Topics and ACLs (native ntfy auth store):

```
$ docker exec frank-owner-ntfy ntfy user list
user owner (role: user, tier: none)
- read-only access to topic owner-notifications
user publisher (role: user, tier: none)
- write-only access to topic owner-notifications
user * (role: anonymous, tier: none)
- no topic-specific permissions
- no access to any (other) topics (server config)
```

Exactly **one** topic exists, derived from the message cache:

```
$ SELECT topic, COUNT(*), MIN(time), MAX(time) FROM messages GROUP BY topic;
owner-notifications | 46 | 1789277418 | 1789299948
   -> window 2026-09-13T05:30:18Z .. 2026-09-13T11:45:48Z
stats table: messages = 58
```

Every message was published by Frank's own internal services, not by a device:

```
$ SELECT sender, user, COUNT(*) FROM messages GROUP BY sender,user;
172.25.0.9  | u_2NilS3sgdM | 36
172.25.0.10 | u_2NilS3sgdM |  9
172.23.0.1  | u_2NilS3sgdM |  1

newest titles: "Owner CRM task created", "Owner inbound email received",
               "Owner CRM lead created"
```

**No device has ever subscribed.** Across the entire retained log every statistics
sample reports zero subscribers, and no line reports anything else:

```
$ docker logs frank-owner-ntfy | grep -oE "subscribers=[0-9]+" | sort | uniq -c
    759 subscribers=0
```

Log coverage runs 2026-09-12T16:40:39Z to 2026-09-13T05:19:41Z; messages continued to
be published until 2026-09-13T11:45:48Z, so the log window does not cover the whole
publishing period. Even so, no sample anywhere shows a subscriber.

No notification receipt exists as a stored artifact:

```
$ grep -rlIiE "owner-notifications|ntfy" /srv/frank/verification/
  -> only deploy logs, access-audit.md, and the frozen shared brief itself
```

The owner_notifications README states the same position independently: "No production
device notification is claimed by this bundle."

I sent no notification during this work.

### Implication for the build

The **publish** path is real and has been exercised (58 messages published, 46 still
cached, all from internal Frank services). The **delivery** path has never run: no
device subscription has ever existed. Any design that assumes an existing phone
subscription, or that claims the owner has received an alert, is currently unbacked.

### Open question

Does an enrolled phone with the Tailscale plus ntfy setup exist at all? This requires
owner action and cannot be established from the VPS.

---

## 7. Caddy / ingress auth seam

**Status: VERIFIED** (file read only; not edited).

### Evidence

Site blocks in `apps/window/Caddyfile` (top-level, with line numbers):

| Line | Site block |
| --- | --- |
| 104 | `frank.fail` |
| 364 | `blockwise.sale` |
| 419 | `mail.blockwise.sale` |
| 447 | `preview.frank.fail` |
| 487 | `tasks.frank.fail` |
| 502 | `buzz.frank.fail` |
| 506 | `ssh.frank.fail` |
| 520 | `git.frank.fail` |
| 572 | `:80` |

There is **no** block for `crm.frank.fail`, `mail.frank.fail`, `marketing.frank.fail`
or `auth.frank.fail`:

```
$ grep -nE "crm\.frank\.fail|mail\.frank\.fail|marketing\.frank\.fail|auth\.frank\.fail" apps/window/Caddyfile
NONE PRESENT
```

Wildcard DNS does resolve all of them to this host:

```
frank.fail            -> 76.13.209.160
crm.frank.fail        -> 76.13.209.160
mail.frank.fail       -> 76.13.209.160
marketing.frank.fail  -> 76.13.209.160
auth.frank.fail       -> 76.13.209.160
```

Basic Auth is applied in exactly three places, all inside `frank.fail`, each gated by
the same matcher:

```
line 305  handle @agenttrail      (AgentTrail board)
line 326  handle @map_artifact    (map artifacts)
line 347  handle { ... }          (catch-all fallback -> frank-window:8080)

each block:
    @frank_operator_auth not remote_ip 100.86.154.37
    basic_auth @frank_operator_auth {
        {$FRANK_BASIC_AUTH_USER} {$FRANK_BASIC_AUTH_HASH}
        {$FRANK_ACCEPTANCE_AUTH_USER} {$FRANK_ACCEPTANCE_AUTH_HASH}
    }
```

The only auth bypass is a single hard-coded Tailscale IP, `remote_ip 100.86.154.37`
(the owner laptop). Note the ordering: routes for MCP (`/mcpx*`), the Resend owner-mail
callback, signed ad-template releases and the Mini UI are deliberately placed **ahead**
of the Basic Auth fallback.

`frank_private_response_headers` (lines 34-41) sets exactly:

```
X-Frame-Options "DENY"
Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'"
Cache-Control "no-store, private"
X-Robots-Tag "noindex, nofollow, noarchive, nosnippet"
```

It is imported at lines 199, 205 and 342. Its `frame-ancestors 'none'` plus
`X-Frame-Options DENY` is why nothing can be framed today, and its CSP has no
`frame-src`, so `default-src 'self'` also stops Frank framing anyone else.

`mail.blockwise.sale` (lines 419-446) exposes **only** the opt-out routes and returns
404 for everything else:

```
@mautic_optout {
    method GET POST
    path /email/unsubscribe/* /email/dnc/*
}
handle @mautic_optout { reverse_proxy frank-owner-marketing-ingress:80 { ... } }
handle { respond 404 }
```

### What would need to change

**(a) Replace Basic Auth with a session-cookie / forward-auth owner boundary.**

1. Remove the three `basic_auth @frank_operator_auth { ... }` blocks at lines 305, 326
   and 347, together with the `X-Frank-Operator-Attestation {$FRANK_BASIC_AUTH_HASH}`
   header injection that currently derives the upstream attestation from the Basic Auth
   hash (lines 316, 334, 355).
2. Introduce an owner-boundary decision point. Caddy 2.8 in `frank-caddy` supports
   `forward_auth`, so the smallest change is a `forward_auth` directive calling a
   Frank-owned session endpoint that returns 200 plus identity headers, with the
   existing `handle` fallback kept as the deny path so an unauthenticated request still
   fails closed.
3. Decide the fate of the `not remote_ip 100.86.154.37` bypass. Keeping it leaves a
   second, independent auth path that bypasses the session entirely.
4. The cookie plumbing on the owner routes must be revisited. Most upstreams currently
   strip cookies in both directions (`header_up -Cookie`, `header_down -Set-Cookie` at
   lines 164-166, 191-193 and in the fallback block), so a session cookie cannot
   round-trip through those handlers as written. Either the session terminates at Caddy
   itself, or those strips must be scoped away from the owner routes.
5. Keep the existing public routes ahead of the boundary: `/mcpx` (MCP validates its own
   bearer token), `/api/owner-mail-events/resend` (Svix-validated) and
   `/releases/ad-template-generator/...`. These must not silently become session-gated.

**(b) Allow framing of `crm.frank.fail` / `mail.frank.fail` / `marketing.frank.fail`
only by `https://frank.fail`.**

1. Create three site blocks. None exists today, so each needs `tls` (wildcard DNS is
   already in place), a `reverse_proxy` to the correct private upstream
   (`owner-crm-frontend-1` on `127.0.0.1:18081`, the Mautic ingress on `127.0.0.1:18106`,
   and a webmail upstream), and the same proxy hygiene the other blocks use
   (`header_up Host`, `X-Forwarded-Proto`, `X-Real-IP`).
2. On those three hosts, replace the clickjacking headers. `X-Frame-Options` cannot
   express a third-party allowlist (`ALLOW-FROM` is obsolete and unsupported), so it
   must be dropped on these hosts and framing restricted with CSP instead:
   `frame-ancestors https://frank.fail`. The rest of the CSP can stay.
3. On Frank's own responses, `frame-src` must be added on the owner-workspace routes:
   `frank_private_response_headers` has no `frame-src` today, so `default-src 'self'`
   blocks the child origins. Add `frame-src https://crm.frank.fail
   https://mail.frank.fail https://marketing.frank.fail` only on the routes that embed
   them, rather than weakening the shared header.
4. Preserve each app's own session. Subdomains are **not** same-origin, so each app keeps
   its own cookie on its own host; if those apps rely on cookies inside a framed context,
   those cookies must be `SameSite=None; Secure`, and browsers with third-party-cookie
   restrictions may still refuse them. This is the single largest technical risk in the
   framing approach, and it is exactly the thing Q1 could not verify.
5. Preserve each app's CSRF behaviour, redirects, assets and attachments, as the brief
   requires. An app that redirects to its own login inside a frame will also break the
   rule "never put an IdP login form inside an iframe".
6. Keep `mail.frank.fail/email/unsubscribe/*` and `/email/dnc/*` public and
   unauthenticated, mirroring the `mail.blockwise.sale` block. The public opt-out must
   keep working and must not land behind the owner boundary.

### Open question

Whether authenticated cross-origin iframes actually work in the owner's real browser.
This hinges on Q1, which is unverified, and it decides whether the framed panel approach
is viable at all or whether the apps must be reached by same-tab navigation instead.

---

## 8. Existing read projections

**Status: VERIFIED.**

### Evidence

Registered providers in `apps/window/home_providers.py`, in registration order, with the
source each actually reads:

| Widget id | Line | Source it reads |
| --- | --- | --- |
| `entity-overview` | 298 | canonical entity profile + entity record |
| `application-status` | 323 | profile `live` / `health` URL, live HTTP probe (`probe_profile_health`) |
| `project-signal` | 344 | `application-status` + git branch + connection attention items |
| `repository-status` | 367 | mounted checkout, git dir/branch |
| `repository-activity` | 379 | `git log` rows |
| `repository-pulse` | 390 | `git log` grouped by day |
| `project-attention` | 415 | `_project_attention_items` (connection records) |
| `project-activity` | 426 | `application-status` + `git log` |
| `project-quick-paths` | 454 | profile live URL + internal views |
| `project-files` | 479 | repository files |
| `accounts-summary` | 488 | `ctx.accounts` — the account **record store**, not a provider |
| `connections-summary` | 499 | connection **record store** |
| `connection-attention` | 525 | connection **record store** |
| `provider-catalog` | 544 | `ctx.catalog` = `CONNECTION_CATALOG` |
| `entity-graph` | 555 | graph reader (only when `configure_graph_reader` was called) |
| `provider-coverage` | 569 | `CONNECTION_CATALOG` x connection records |
| `hermes-status` | 626 | Hermes health endpoint |
| `hermes-session` | after 626 | Hermes session summaries |
| `widget-catalog` | after 626 | widget manifests |
| `analytics-summary` | after 626 | analytics **connection record only** |
| `work-status` | after 626 | **hard-coded stub** |
| `recent-receipts` | after 626 | **hard-coded stub** |
| `quick-links` | after 626 | internal links + profile live URL |

The stub providers are self-evident in source:

```python
@register("work-status")
def work_status(ctx):
    return snapshot("setup_needed", "No work-event provider is configured for this home.",
                    {"running": 0, "waiting": 0}, ...)

@register("recent-receipts")
def recent_receipts(ctx):
    return snapshot("setup_needed", "No receipt provider is configured for this home.",
                    {"receipts": []}, ...)

@register("analytics-summary")
def analytics_summary(ctx):
    ...
    return snapshot("setup_needed",
                    "Analytics connection is verified; no live metrics adapter is configured.",
                    {"metrics": [], "adapter": "not_configured", ...}, ...)
```

`analytics-summary` returns `setup_needed` with `adapter: "not_configured"` **even when
the connection is verified** — it can never return a metric.

`CONNECTION_CATALOG` (`home_platform.py:273-320`) lists provider **types** with
capabilities, licence and setup mode: `mautic`, `chatwoot`, `mailflare`, `stalwart`,
`resend`, `stripe`, `activepieces`, `mcp`, `api`. These are catalogue entries feeding
`provider-catalog` and `provider-coverage`, not readers.

`provider_adapters.py` defines `ADAPTERS = {STALWART, MAUTIC, CHATWOOT, MAUTIC_SMTP,
RESEND, ACTIVEPIECES}`. Each entry is a **contract only** — provider, title, consumer,
capabilities, `secret_keys`, `transport`, `setup_note` — and no adapter performs a read.
For example `MAUTIC` declares
`secret_keys=("MAUTIC_BASE_URL","MAUTIC_CLIENT_ID","MAUTIC_CLIENT_SECRET")` with
`transport="hermes-provider"`, i.e. the intended execution path is Hermes, not Frank.

`ops_projections.py` does contain `mautic` and `stripe-billing` projection schemas, but
they belong to `BlockwiseOpsClient` and read the **Blockwise customer** ops API — not the
owner's Frappe, Mautic or mailbox services.

**Nothing in `apps/window` reads the owner services.** A grep across the whole worktree
for the owner service ports and site name found only infrastructure scripts:

```
$ grep -rIn -E "18081|18106|18104|owner\.crm\.internal" apps/window
infra/owner_marketing/check.sh, configure_site.sh, compose.yml, deploy.sh, test.sh
infra/owner_mail_events/provision.py, acceptance.py, test_acceptance.py
(no runtime projection or provider)
```

### Verdict for today

* **Real and working now:** all project/repository widgets (git plus health probes),
  `entity-overview`, `application-status`, connection summaries, `provider-catalog`,
  `provider-coverage`, `connection-attention`, `widget-catalog`, `quick-links`,
  `hermes-status`, `hermes-session`, and `accounts-summary` (which counts rows in the
  account **record store**, not a CRM).
* **Stubs:** `work-status` and `recent-receipts` (hard-coded zeroed payloads) and
  `analytics-summary` (structurally incapable of returning a metric).
* **Completely absent:** any reader for CRM, Helpdesk, mailbox, Stripe or Mautic counts.
  There is no owner read model in `apps/window` at all.

### Implication for the build

Every number the owner workspace needs — CRM leads, Helpdesk tickets, mailbox counts,
Mautic contacts and campaigns, Stripe billing state — has to be built from nothing. The
existing framework is the right seam: `@register` plus `ProviderContext` plus
`snapshot()` already gives per-widget isolation (a failing provider degrades only its own
widget) and standard envelopes. What is missing is the readers.

Note the constraint from `/projects/blockwise/AGENTS.md`: provider tokens live in
`private.provider_token_vault`, reached only through service-role RPCs, and provider
writes stay disabled until their product gate passes. Read-only projections are the
correct scope for this phase.

### Open question

Should the owner read models go through the existing connection/vault abstraction
(`CONNECTION_CATALOG` plus `provider_token_vault`), or through direct
service-to-service calls to the loopback services already on this host? That decision
determines whether the owner workspace reuses the connections UI or bypasses it.

---

## Blocking unknowns

1. **Codex in-app browser behaviour is unverified (blocks the framing design).**
   The engine, version and third-party-cookie policy of the browser the owner actually
   uses cannot be observed from the VPS, and there is no CDP endpoint, browser service or
   browser MCP server here. If that browser blocks third-party cookies, framing
   authenticated CRM/Mautic breaks and the panel approach needs rethinking.
   *Smallest next action:* the owner opens one static page in the Codex in-app browser
   that prints `navigator.userAgent` and reports whether a cookie set inside a
   cross-origin iframe survives. No infrastructure required.

2. **No owner identity provider exists (blocks Q7(a)).**
   No Authentik or Keycloak container; Frappe has 0 OAuth clients and 0 social login
   keys; Mautic has only native login. There is nothing for a forward-auth session
   boundary to authenticate against.
   *Smallest next action:* the coordinator decides external IdP versus Frappe-as-IdP
   (Frappe can serve OAuth2 today) before any Caddyfile change is written.

3. **No owner read model exists (blocks every real number in the workspace).**
   No provider in `apps/window` reads CRM, Helpdesk, mailbox, Mautic or Stripe, and three
   widgets are hard-coded stubs.
   *Smallest next action:* land one smallest real projection behind `@register` — for
   example a Helpdesk open-ticket count from `owner-crm-frontend-1` — and prove the
   envelope end to end before adding more.

4. **ntfy has never had a subscriber (blocks any alerting claim).**
   759 of 759 statistics samples report `subscribers=0`; no device has ever subscribed;
   no delivery receipt exists in `/srv/frank/verification`.
   *Smallest next action:* enrol one device, confirm `subscribers` rises above zero, then
   publish one test notification and record the receipt.

5. **Purelymail app-password provisioning is unproven (weakens the "no repeated app
   passwords" goal).**
   App passwords exist and are created manually in the admin portal; the API path
   (`createAppPassword`) was read from a third-party mirror of the spec, and API token
   issuance is undocumented.
   *Smallest next action:* the owner checks, read-only, whether the Purelymail account
   portal exposes an API token.

6. **Mautic stores a live mailbox credential in plaintext at mode 0755.**
   `/var/www/html/config/local.php` holds `monitored_email.general.password` (plus
   `db_password` and `secret_key`) in cleartext. This does not block the build, but it is
   a real exposure that any new integration should not replicate.
   *Smallest next action:* confirm the intended file mode and decide whether the
   credential moves into `/srv/frank/secrets` with a generated `local.php`.

---

## Appendix — commands actually run

All commands were executed over SSH against the VPS. Grouped by question.

* **Rules and brief:** `cat /projects/blockwise/AGENTS.md`; `cat /projects/frank/AGENTS.md`;
  `cat apps/window/infra/owner_{crm,marketing,notifications}/README.md`;
  `cat /srv/frank/verification/owner-workspace-20260914/shared-brief.md`.
* **Q1:** `ps aux | grep -iE 'codex|chrom|playwright|puppeteer'`; `ss -ltnp`;
  `codex --version`; `codex features list`; `strings` and `grep` over the Codex vendor
  binary; `grep -rlI` over `/root/.codex/sessions/`; redacted `cat` of
  `/root/.codex/config.toml`; `ls` and `find` for Chromium, Playwright and puppeteer
  binaries; `--version` on each engine; `cat` of the Vercel `agent-browser` SKILL.md;
  `which agent-browser`; a headless `--dump-dom` user-agent capture attempt.
* **Q2:** `docker exec owner-crm-frontend-1 bench --site owner.crm.internal list-apps`;
  `ls` of the Frappe integrations doctype directory; `cat` of `social_login_key.json`;
  `grep` over `social_login_key.py`; read-only `bench mariadb` SELECTs against
  `tabSocial Login Key`, `tabOAuth Client`, `tabSingles`, `tabUser` and `tabHas Role`;
  `SHOW TABLES LIKE` for social, oauth and ldap tables.
* **Q3:** `docker exec -w /var/www/html frank-owner-marketing php bin/console --version`;
  `composer.json` and `composer.lock` inspection; `ls` of `docroot/plugins` and
  `docroot/app/bundles`; `find` and `grep` for SAML and LDAP; `grep` of
  `EmailBundle/Config/config.php`, `UserBundle/Config/config.php` and
  `UserBundle/Form/Type/ConfigType.php`; redacted `cat` of `config/local.php`.
* **Q4:** `stat` and key-name-only `grep` of `/srv/frank/secrets/owner-mail.env`;
  `getent hosts`; `/dev/tcp` connect tests; `openssl s_client` for TLS inspection, IMAP
  `LOGIN`/`LOGOUT`, and SMTP `EHLO` plus `AUTH PLAIN` on 465 and 587. No password was
  echoed, and `AUTH PLAIN` payloads were filtered from all output.
* **Q5:** delegated web research (`web_search` and `web_fetch` by a sub-agent) plus my own
  `web_fetch` of `https://purelymail.com/docs/setup/technical`.
* **Q6:** `curl` against `127.0.0.1:18104/` and `/v1/health`;
  `docker exec frank-owner-ntfy ntfy user list`; read-only `sqlite3` (via Python,
  `mode=ro&immutable=1`) against the ntfy `cache.db` volume; `docker logs` subscriber
  census; `grep` over `/srv/frank/verification`. No notification was sent.
* **Q7:** `grep -n` and `sed -n` reads of `apps/window/Caddyfile`; `grep` for site blocks,
  `basic_auth` and header imports; `getent hosts` for the wildcard DNS check.
* **Q8:** `grep` and `sed` reads of `home_providers.py`, `home_platform.py`,
  `provider_adapters.py` and `ops_projections.py`; a repo-wide `grep` for the owner
  service ports and site name.

# AionUi Login Fix

This runbook explains why `aionui.frank.fail` kept showing the AionUi login
screen, what changed in the repo to fix it, and how to deploy and verify on the
VPS. It also lists what could not be verified without the running server.

## Symptom

Visiting `aionui.frank.fail` (or the dashboard AionUi tab) shows AionUi's own
login screen instead of dropping into the embedded AionUi page. The Cloudflare
tunnel route was already corrected to send `aionui.frank.fail` through Frank, so
the redirect itself was fine — the login screen is AionUi's, not Frank's.

## Root causes (verified against AionUi v2.x source)

AionUi's WebUI always requires a login (single `admin` user, JWT session in the
`aionui-session` cookie). There is no no-auth mode. Frank's "no second login"
only works if the dashboard mints that session for you. Three things broke that:

1. **Admin password was never captured.** `infra/aionui/entrypoint.sh` scraped
   the container logs for lines like `Initial admin password:`, but AionUi
   actually prints bilingual lines `Username / 用户名: admin` and
   `Password / 密码:   <pw>` (AionUi `src/process/webserver/index.ts`,
   `displayInitialCredentials`). The patterns never matched, so
   `runtime/access/aionui-admin.json` was never written, so the Host Agent's
   `createAionUiSession` threw and no cookie was minted → login screen.

2. **AionUi cannot be served under a sub-path.** It registers all routes, the
   `/ws` WebSocket bus, and static assets at the origin root (AionUi
   `src/process/webserver/index.ts`, `routes/authRoutes.ts`). Serving it under
   `hub.frank.fail/aionui/` meant its own `POST /login`, `/api/*`, and `/ws`
   calls hit Frank instead of AionUi, so even an authenticated embed could not
   work. The design intent (`.env.example` `AIONUI_PUBLIC_URL=https://aionui.frank.fail`,
   cookie domain `.frank.fail`) is to serve AionUi at its **own subdomain root** —
   but Nginx was redirecting that subdomain into the broken sub-path.

3. **Login response handling was fragile.** AionUi `POST /login` (body
   `{username, password}`) returns the JWT both in the JSON body (`token`) and a
   `Set-Cookie`. Frank only forwarded the raw `Set-Cookie`. Cookie name is
   `aionui-session` (AionUi `config/constants.ts`).

## What changed in the repo

- `infra/aionui/entrypoint.sh` — capture username/password from every known
  AionUi log format (including the bilingual `用户名:` / `密码:` lines), with
  colon-safe extraction, and redact the password from logs.
- `apps/host-agent/src/server.ts` — new `buildAionUiCookieHeader` helper:
  prefer the JSON body `token`, fall back to `Set-Cookie`, clearer errors. Uses
  the `aionui-session` cookie name. `createAionUiSession` posts
  `{username, password}` to `/login`.
- `apps/host-agent/src/config.ts` — add `AIONUI_COOKIE_NAME`
  (default `aionui-session`); default `AIONUI_PUBLIC_URL` is now
  `https://aionui.frank.fail/?frank_bootstrapped=1`.
- `apps/api/src/config.ts` + `apps/api/src/routes/aionui.ts` — default
  `AIONUI_PUBLIC_URL` is `https://aionui.frank.fail/?frank_bootstrapped=1`.
  The API re-scopes the cookie to `${AIONUI_COOKIE_DOMAIN:-.frank.fail}`
  (`Domain=.frank.fail; Path=/; HttpOnly; Secure; SameSite=Lax`) and exposes
  `GET /v1/aionui/open` to mint the cookie before redirecting to AionUi.
- `apps/web/nginx.conf` — first-load `aionui.frank.fail/` requests redirect to
  `https://hub.frank.fail/api/v1/aionui/open`; after the API mints the cookie it
  redirects back to `https://aionui.frank.fail/?frank_bootstrapped=1`, where
  Nginx proxies to `aionui:25808` at the origin root with WebSocket upgrade.
  `hub.frank.fail/aionui` and `/aionui/` now redirect to `/api/v1/aionui/open`.
- `docker-compose.aionui.yml` — set `AIONUI_HTTPS=true` and
  `SERVER_BASE_URL=https://aionui.frank.fail` so AionUi issues `Secure` cookies
  and correct login/QR URLs (it deliberately ignores `X-Forwarded-Proto`).
- `scripts/healthcheck.sh`, `docs/aionui-runtime.md`, `AGENTS.md` — updated to
  the new origin-root routing.

No Cloudflare change is needed: the tunnel still points `aionui.frank.fail` at
`localhost:33480` (the Nginx web container); only Nginx's behavior changed.
Keep the Cloudflare Access policy on `aionui.frank.fail`.

## Deploy (on the VPS)

```bash
cd /opt/frank-hub
# pull the branch with these changes, then:
./scripts/deploy.sh          # rebuilds web (nginx) + aionui with AIONUI_ENABLED=true
./scripts/healthcheck.sh
```

If AionUi was already initialized before this fix, the admin password file may
still be missing. Recreate it so auto-login can work (see below).

## Verify (on the VPS)

```bash
# 1. The credential file now exists and is valid JSON with a non-empty password.
sudo test -s /opt/frank-hub/runtime/access/aionui-admin.json && echo "creds present"
sudo python3 -c "import json;d=json.load(open('/opt/frank-hub/runtime/access/aionui-admin.json'));print('user=',d['username'],'pw_len=',len(d['password']))"

# 2. aionui.frank.fail is served at root through Nginx (expect 200/302/401, not 5xx).
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: aionui.frank.fail' http://127.0.0.1:33480/

# 3. The login API works with the captured creds (expect {"success":true,...,"token":"..."}).
PW=$(sudo python3 -c "import json;print(json.load(open('/opt/frank-hub/runtime/access/aionui-admin.json'))['password'])")
curl -sS -X POST http://127.0.0.1:25808/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}" | head -c 300; echo

# 4. End to end: open https://aionui.frank.fail (after Cloudflare Access) and the
#    dashboard AionUi tab. Neither should show a second AionUi login.
```

## If the credential file is still missing or empty

AionUi only prints the generated password on first run. To (re)capture it:

```bash
cd /opt/frank-hub
# Reset to a fresh random password and read it from the logs:
docker compose -f docker-compose.yml -f docker-compose.aionui.yml exec aionui \
  /opt/aionui-web/aionui-web --resetpass admin
./scripts/aionui_logs.sh    # find the "Password / 密码:" (or "Initial admin password:") line
```

Then write `/opt/frank-hub/runtime/access/aionui-admin.json` (mode 600):

```json
{"username":"admin","password":"<the password>","generatedAt":"<UTC ISO time>"}
```

Restart AionUi so the entrypoint can also auto-capture on the next first run:
`./scripts/aionui_compose_down.sh && ./scripts/aionui_compose_up.sh`.

## Not verified from here (check on the VPS)

These depend on the running container / live system and could not be confirmed
from the repo alone:

- That the prebuilt `aionui-web` v2.1.9 binary prints credentials in the same
  format as the AionUi source and honors `AIONUI_HTTPS` / `SERVER_BASE_URL`. If
  the log format differs, use the manual capture above. (The entrypoint matches
  several formats to be safe.)
- That the **Frank Host Agent is installed and connected** on the VPS. If the
  dashboard shows "Frank Host Agent is not connected," `createAionUiSession`
  cannot run. Check `scripts/install_host_agent.sh` and the agent service.
- That AionUi emits `X-Frame-Options: DENY` (Nginx now strips it regardless). If
  the dashboard iframe still refuses to load, confirm the header is gone:
  `curl -sI -H 'Host: aionui.frank.fail' http://127.0.0.1:33480/ | grep -i x-frame`.
- That the browser sends the `.frank.fail` cookie into the embed. If not, the
  cookie's `SameSite`/`Secure` attributes can be adjusted in
  `apps/api/src/routes/aionui.ts` (`rewriteAionUiCookie`).

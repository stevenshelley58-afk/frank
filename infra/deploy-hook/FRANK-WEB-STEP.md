# Step 3 — let the hook deploy `frank-web`

The hook is written and installed, but two things stop it deploying the app:
`deploy.frank.fail` never got its Caddy block (TLS handshake fails from
outside), and the whitelist in `hook.mjs` only contains `pavone`.

Both are three-minute fixes. Do them once and every future UI change can ship
over 443 without SSH.

## 1. Add `frank` to the whitelist

On the VPS, edit the hook's `APPS` map:

```bash
sudo nano /srv/frank-deploy-hook/hook.mjs   # wherever install-hook.sh put it
```

```js
const APPS = {
  pavone: { dir: '/srv/pavone', script: 'deploy.sh' },
  frank:  { dir: '/srv/frank',  script: 'apps/web/deploy.sh' },
};
```

`apps/web/deploy.sh` ships in this branch. It rebuilds `frank-api` and
`frank-web` through compose, restarts them API-first (the API runs the
migrations the new web build expects), and waits for readiness. It is
idempotent — safe to re-run.

Then restart the hook:

```bash
sudo systemctl restart frank-deploy-hook   # or however install-hook.sh runs it
curl -s http://127.0.0.1:9099/hook/health  # → {"ok":true,"apps":["pavone","frank"]}
```

## 2. Finish the Caddy block

`CADDY-STEP.md` has the detail; the short version is to append this to the live
Caddyfile and reload:

```
deploy.frank.fail {
  handle /hook/* {
    reverse_proxy host.docker.internal:9099
  }
  respond 404
}
```

Use `host.docker.internal:9099` (with `extra_hosts: ["host.docker.internal:host-gateway"]`
on the Caddy service) because Caddy runs in a container — `127.0.0.1` there is
the container, not the host.

Verify from outside the box:

```bash
curl -s https://deploy.frank.fail/hook/health
```

That must return JSON. It currently fails the TLS handshake, which is how you
can tell the site block is missing.

## 3. Hand over the token

The token `install-hook.sh` generated is what authenticates the upload. With it,
a deploy is one request:

```bash
curl -sS -X POST https://deploy.frank.fail/hook/deploy/frank \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  --data-binary @frank-web.tar.gz
```

Treat the token like a password — it is a remote-code-execution key for the
whitelisted directories. Rotate it by re-running `install-hook.sh` if it leaks.

## Why this exists

Anthropic's sandbox allows outbound 80/443 only, so SSH to the box is
impossible from a build session. This hook is the deliberate, narrow
alternative: an authenticated upload that can run exactly one script in exactly
one directory per whitelisted app, and nothing else.

#!/bin/bash
# One-shot Frank setup: deploy hook + Pavone visualiser + Caddy routes.
# Run ON the VPS as root:  bash /tmp/pavone-bundle/frank-setup.sh
#
# Idempotent. Backs up the Caddyfile and rolls back if the new config fails
# validation, so a broken block cannot take frank.fail down.
set -euo pipefail

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/srv/pavone
HOOK_DIR=/srv/frank-deploy-hook
APP_HOST=tint.frank.fail
HOOK_HOST=deploy.frank.fail

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m   ! %s\033[0m\n' "$*"; }
ok()  { printf '   \033[1;32mok\033[0m %s\n' "$*"; }

command -v node   >/dev/null || { echo "node not installed"; exit 1; }
command -v docker >/dev/null || { echo "docker not installed"; exit 1; }
ok "node $(node -v), docker present"

# ── 1. App ────────────────────────────────────────────────────────────────
say "Installing app to $APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$BUNDLE/app/." "$APP_DIR/"
chmod +x "$APP_DIR/deploy.sh"
ok "app files in place ($(find "$APP_DIR" -type f | wc -l) files)"

# ── 2. Deploy hook ────────────────────────────────────────────────────────
say "Installing deploy hook to $HOOK_DIR"
mkdir -p "$HOOK_DIR"
cp "$BUNDLE/hook.mjs" "$HOOK_DIR/hook.mjs"
if [ ! -f "$HOOK_DIR/.env" ]; then
  TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 43)
  printf 'DEPLOY_TOKEN=%s\nHOOK_PORT=9099\n' "$TOKEN" > "$HOOK_DIR/.env"
  chmod 600 "$HOOK_DIR/.env"
  ok "generated a new deploy token"
else
  ok "keeping existing token"
fi

cat > /etc/systemd/system/frank-deploy-hook.service <<UNIT
[Unit]
Description=Frank deploy hook (HTTPS deploy for agents without SSH)
After=network.target docker.service

[Service]
Type=simple
EnvironmentFile=$HOOK_DIR/.env
ExecStart=$(command -v node) $HOOK_DIR/hook.mjs
Restart=always
RestartSec=3
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now frank-deploy-hook >/dev/null 2>&1 || true
systemctl restart frank-deploy-hook
sleep 2
if curl -fsS -m 8 http://127.0.0.1:9099/hook/health >/dev/null 2>&1; then
  ok "hook healthy on 127.0.0.1:9099"
else
  warn "hook not responding — systemctl status frank-deploy-hook"
  journalctl -u frank-deploy-hook -n 15 --no-pager || true
fi

# ── 3. Deploy the app ─────────────────────────────────────────────────────
say "Deploying the app container"
bash "$APP_DIR/deploy.sh" "$APP_DIR" || warn "app deploy reported a problem (see above)"

# ── 4. Caddy routes ───────────────────────────────────────────────────────
say "Wiring Caddy"
CADDY_CT=$(docker ps --format '{{.Names}}' | grep -i caddy | head -1 || true)

# Where does Caddy read its config from?
CADDYFILE=""
if [ -n "$CADDY_CT" ]; then
  # find the host path bind-mounted to the container's Caddyfile
  CADDYFILE=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$CADDY_CT" 2>/dev/null || true)
fi
[ -n "$CADDYFILE" ] || for c in /opt/frank/Caddyfile /srv/frank/infra/compose/caddy/Caddyfile /etc/caddy/Caddyfile; do
  [ -f "$c" ] && CADDYFILE="$c" && break
done

# Work out the proxy targets first — a Caddy CONTAINER reaches the app by
# container name (we joined its network) and the host-side hook via the docker
# bridge gateway; a host Caddy uses loopback for both.
if [ -n "$CADDY_CT" ]; then
  APP_TARGET="pavone-visualizer:8787"
  GW=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo 172.17.0.1)
  HOOK_TARGET="${GW}:9099"
else
  APP_TARGET="127.0.0.1:8787"
  HOOK_TARGET="127.0.0.1:9099"
fi

if [ -z "$CADDYFILE" ] || [ ! -f "$CADDYFILE" ]; then
  warn "Could not locate the Caddyfile. Add these blocks manually, then reload Caddy:"
  cat <<MANUAL

$APP_HOST {
  reverse_proxy $APP_TARGET
}
$HOOK_HOST {
  handle /hook/* { reverse_proxy $HOOK_TARGET }
  respond 404
}
MANUAL
  exit 0
fi
ok "Caddyfile: $CADDYFILE"

BACKUP="${CADDYFILE}.bak.$(date +%s)"
cp "$CADDYFILE" "$BACKUP"
ok "backed up to $BACKUP"

add_block() {
  local host="$1" body="$2"
  if grep -qE "^[[:space:]]*${host//./\\.}[[:space:]]*\{" "$CADDYFILE"; then
    warn "$host already present — leaving it alone"
  else
    printf '\n# --- added by frank-setup.sh ---\n%s\n' "$body" >> "$CADDYFILE"
    ok "added $host"
  fi
}

add_block "$APP_HOST" "$APP_HOST {
  reverse_proxy $APP_TARGET
}"

add_block "$HOOK_HOST" "$HOOK_HOST {
  handle /hook/* {
    reverse_proxy $HOOK_TARGET
  }
  respond 404
}"

# Validate before reloading; roll back rather than break the live site.
VALID=1
if [ -n "$CADDY_CT" ]; then
  docker exec "$CADDY_CT" caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || VALID=0
else
  caddy validate --config "$CADDYFILE" >/dev/null 2>&1 || VALID=0
fi

if [ "$VALID" != 1 ]; then
  warn "new Caddy config FAILED validation — rolling back, nothing changed"
  cp "$BACKUP" "$CADDYFILE"
  exit 1
fi
ok "config validates"

if [ -n "$CADDY_CT" ]; then
  docker exec "$CADDY_CT" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || warn "reload failed — try: docker restart $CADDY_CT"
else
  systemctl reload caddy 2>/dev/null || caddy reload --config "$CADDYFILE" >/dev/null 2>&1 || warn "reload failed"
fi
ok "Caddy reloaded"

# ── 5. Report ─────────────────────────────────────────────────────────────
say "Result"
sleep 4
printf '  https://%s/            -> %s\n' "$APP_HOST"  "$(curl -s -o /dev/null -m 25 -w '%{http_code}' https://$APP_HOST/ 2>/dev/null)"
printf '  https://%s/hook/health -> %s\n' "$HOOK_HOST" "$(curl -s -o /dev/null -m 25 -w '%{http_code}' https://$HOOK_HOST/hook/health 2>/dev/null)"
echo
echo "  (first HTTPS hit can 000/fail for ~30s while Caddy gets a certificate — retry)"
echo
echo "  DEPLOY TOKEN (paste to Claude so it can deploy future changes itself):"
grep '^DEPLOY_TOKEN=' "$HOOK_DIR/.env" | cut -d= -f2-
echo
echo "  Edit the app in $APP_DIR — public/* is live on reload;"
echo "  server.mjs / src/* need: docker restart pavone-visualizer"

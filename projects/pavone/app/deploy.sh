#!/bin/bash
# Deploy / redeploy the Pavone visualiser on the Frank VPS. Run ON the VPS.
#   bash /srv/pavone/deploy.sh [app_dir]      (default /srv/pavone)
#
# The app directory is BIND-MOUNTED into the container read-only, so editing
# files in /srv/pavone takes effect without rebuilding the image:
#   • public/*.html|css|js  → live on next page load, no restart
#   • server.mjs, src/*.mjs → run this script again (or: docker restart pavone-visualizer)
set -euo pipefail

APP_DIR="${1:-/srv/pavone}"
IMAGE_NAME="pavone-visualizer"
CONTAINER_NAME="pavone-visualizer"
PORT="${PORT:-8787}"

echo "=== Pavone visualiser deploy ==="
echo "app dir : $APP_DIR"

[ -d "$APP_DIR" ] || { echo "ERROR: $APP_DIR does not exist"; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "ERROR: $APP_DIR/.env not found (copy .env.example and fill it in)"; exit 1; }
grep -qE '^GEMINI_API_KEY=.+' "$APP_DIR/.env" || { echo "ERROR: GEMINI_API_KEY empty in $APP_DIR/.env"; exit 1; }
grep -qE '^ADMIN_PASSWORD=.+' "$APP_DIR/.env" || { echo "ERROR: ADMIN_PASSWORD empty (the leads page would be unprotected)"; exit 1; }

echo "--- building image"
docker build -t "$IMAGE_NAME" "$APP_DIR" >/dev/null
echo "    ok"

# If Caddy runs in Docker, join its network so Caddy can reach us by container
# name. A container cannot reach a host port bound to 127.0.0.1.
CADDY_CT=$(docker ps --format '{{.Names}}' | grep -i caddy | head -1 || true)
NET_ARGS=()
if [ -n "$CADDY_CT" ]; then
  CADDY_NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$CADDY_CT" | head -1)
  if [ -n "$CADDY_NET" ]; then
    NET_ARGS=(--network "$CADDY_NET")
    echo "--- joining Caddy network: $CADDY_NET (container: $CADDY_CT)"
  fi
fi

echo "--- replacing container"
docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker rm   "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart always \
  "${NET_ARGS[@]}" \
  -p "127.0.0.1:${PORT}:8787" \
  --env-file "$APP_DIR/.env" \
  -v "$APP_DIR":/app:ro \
  -v pavone-data:/app/data \
  "$IMAGE_NAME" >/dev/null

echo "--- waiting for health"
HEALTHY=0
for _ in $(seq 1 25); do
  if HEALTH=$(curl -fsS "http://127.0.0.1:${PORT}/api/health" 2>/dev/null); then
    echo "    $HEALTH"; HEALTHY=1; break
  fi
  sleep 1
done
if [ "$HEALTHY" != 1 ]; then
  echo "ERROR: never became healthy. Logs:"; docker logs --tail 40 "$CONTAINER_NAME" || true; exit 1
fi

# hasKey:true only means a key is SET. Spend one real render to find out whether
# image generation actually works, rather than learning it from a customer who
# only ever sees the fallback preview.
echo "--- self-test (one real render)"
ADMIN_PW=$(grep -E '^ADMIN_PASSWORD=' "$APP_DIR/.env" | cut -d= -f2-)
SELF=$(curl -fsS -m 120 -u "admin:${ADMIN_PW}" "http://127.0.0.1:${PORT}/api/selftest" 2>/dev/null || echo '{}')
case "$SELF" in
  *'"ok":true'*) echo "    IMAGE GENERATION WORKS — renders are live." ;;
  *) echo "    IMAGE GENERATION NOT WORKING:"
     echo "    $SELF" | sed 's/.*"reason":"\([^"]*\)".*/      \1/'
     echo "    Site still runs and still captures leads; previews fall back to CSS shading."
     echo "    Fix the cause, then: docker restart $CONTAINER_NAME" ;;
esac

echo
echo "=== deployed ==="
echo "local  : http://127.0.0.1:${PORT}/"
echo "public : https://tint.frank.fail/        (once the Caddy route is in place)"
echo "admin  : https://tint.frank.fail/admin   (user: admin)"
echo
echo "Editing: files live in $APP_DIR and are bind-mounted into the container."
echo "  public/* changes are live immediately — just reload the page."
echo "  server.mjs / src/* changes need: docker restart $CONTAINER_NAME"

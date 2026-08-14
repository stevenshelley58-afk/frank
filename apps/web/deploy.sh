#!/usr/bin/env bash
#
# apps/web deploy — invoked by the HTTPS deploy hook (infra/deploy-hook).
#
# The hook unpacks the uploaded tarball over this app's directory and then runs
# this script with the app root as CWD. Port 22 is closed to the build sandbox,
# so this is the only path code takes to the box; keep it boring and idempotent.
#
# Everything here is safe to re-run: compose rebuilds only what changed, and
# migrations are applied by the API's own start.ts on boot (drizzle records
# which have run, so replaying is a no-op).
set -euo pipefail

REPO="${FRANK_REPO:-/frank/deployed}"
COMPOSE_BASE="${FRANK_COMPOSE_BASE:-$REPO/infra/docker-compose.dev.yml}"
COMPOSE_APP="${FRANK_COMPOSE_APP:-$REPO/repo/infra/production/docker-compose.app.yml}"
COMPOSE_ARGS=(-f "$COMPOSE_BASE" -f "$COMPOSE_APP")

cd "$REPO"

echo "[deploy] building frank-web + frank-api"
docker compose "${COMPOSE_ARGS[@]}" build frank-web frank-api

echo "[deploy] restarting"
# frank-api first: it runs the migrations the new web build expects.
docker compose "${COMPOSE_ARGS[@]}" up -d --no-deps frank-api
docker compose "${COMPOSE_ARGS[@]}" up -d --no-deps frank-web

echo "[deploy] waiting for the API to answer"
for _ in $(seq 1 30); do
  if docker compose "${COMPOSE_ARGS[@]}" exec -T frank-api \
      node -e "fetch('http://127.0.0.1:3000/v1/system/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "[deploy] api ready"
    break
  fi
  sleep 2
done

echo "[deploy] done"

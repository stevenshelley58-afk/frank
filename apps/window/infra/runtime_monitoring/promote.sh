#!/usr/bin/env sh
set -eu

# Explicit production activation.  This intentionally does not run by default.
: "${FRANK_RELEASE_SHA:?set the reviewed Frank release SHA}"
: "${BLOCKWISE_RELEASE_SHA:?set the reviewed Blockwise release SHA}"
ROOT=${RUNTIME_MONITORING_ROOT:-/srv/frank/runtime-monitoring}
COMPOSE="$ROOT/beszel-compose.yml"
ENV_FILE=${RUNTIME_MONITORING_ENV:-/srv/frank/secrets/runtime-monitoring.env}
mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -s "$ENV_FILE" ]; then
  umask 077
  printf 'BESZEL_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 32)" > "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" --profile step4b-isolated up -d --no-build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" --profile step4b-isolated ps

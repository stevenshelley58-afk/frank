#!/usr/bin/env sh
set -eu
ROOT=${RUNTIME_MONITORING_ROOT:-/srv/frank/runtime-monitoring}
COMPOSE="$ROOT/beszel-compose.yml"
ENV_FILE=${RUNTIME_MONITORING_ENV:-/srv/frank/secrets/runtime-monitoring.env}
[ -f "$COMPOSE" ] || exit 0
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" --profile step4b-isolated down --remove-orphans

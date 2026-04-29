#!/usr/bin/env bash
set -euo pipefail

read_env() {
  key="$1"
  default="$2"
  value=""
  if [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//')"
  fi
  printf '%s' "${value:-$default}"
}

HERMES_API_SERVER_KEY="$(read_env HERMES_API_SERVER_KEY "")"

if [ -z "${HERMES_API_SERVER_KEY}" ]; then
  echo "Refusing to start Hermes: HERMES_API_SERVER_KEY is missing." >&2
  exit 1
fi

mkdir -p runtime/hermes runtime/artifacts workspaces/tasks

docker compose \
  -f docker-compose.yml \
  -f docker-compose.hermes.yml \
  --env-file .env \
  up -d hermes

echo "Hermes compose service requested."

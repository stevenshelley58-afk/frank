#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and edit it before deploying." >&2
  exit 1
fi

docker compose --env-file .env build
docker compose --env-file .env up -d
docker compose --env-file .env ps

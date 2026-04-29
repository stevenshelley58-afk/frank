#!/usr/bin/env bash
set -euo pipefail

LINES="${LINES:-100}"

docker compose \
  -f docker-compose.yml \
  -f docker-compose.hermes.yml \
  --env-file .env \
  logs --tail="${LINES}" -f hermes

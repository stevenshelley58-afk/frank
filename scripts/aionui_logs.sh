#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose \
  -f docker-compose.yml \
  -f docker-compose.aionui.yml \
  --env-file .env \
  logs --no-color --tail="${AIONUI_LOG_TAIL:-200}" aionui \
  | sed -E 's/([A-Z0-9_]*(SECRET|PASSWORD|TOKEN|API[_-]?KEY)[A-Z0-9_]*=)[^[:space:]]+/\1[redacted]/gi'

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose \
  -f docker-compose.yml \
  -f docker-compose.aionui.yml \
  --env-file .env \
  stop aionui

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p runtime/aionui runtime/access runtime/artifacts runtime/ai-instructions workspaces

docker compose \
  -f docker-compose.yml \
  -f docker-compose.aionui.yml \
  --env-file .env \
  up -d --build aionui web

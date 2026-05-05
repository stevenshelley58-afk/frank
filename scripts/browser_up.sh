#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and edit VPS values first." >&2
  exit 1
fi

mkdir -p runtime/browser

docker compose \
  -f docker-compose.yml \
  -f docker-compose.browser.yml \
  --env-file .env \
  up -d browser

echo "Frank VPS browser requested at /vps-browser/."

#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and edit VPS values first." >&2
  exit 1
fi

mkdir -p runtime/browser

target_url="${1:-${FRANK_BROWSER_APP_ARGS:-https://chatgpt.com}}"

FRANK_BROWSER_APP_ARGS="${target_url}" docker compose \
  -f docker-compose.yml \
  -f docker-compose.browser.yml \
  --env-file .env \
  up -d --force-recreate browser

echo "Frank VPS browser requested at /vps-browser/ for ${target_url}."

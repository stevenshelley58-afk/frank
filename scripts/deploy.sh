#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and edit it before deploying." >&2
  exit 1
fi

json_value() {
  local value="${1:-}"
  if [ -z "$value" ]; then
    printf 'null'
    return
  fi

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

mkdir -p runtime

git_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
git_commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
deploy_timestamp="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
app_version="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1 || true)"

{
  printf '{\n'
  printf '  "schemaVersion": 1,\n'
  printf '  "branch": '
  json_value "$git_branch"
  printf ',\n'
  printf '  "commit": '
  json_value "$git_commit"
  printf ',\n'
  printf '  "deployedAt": '
  json_value "$deploy_timestamp"
  printf ',\n'
  printf '  "appVersion": '
  json_value "$app_version"
  printf '\n'
  printf '}\n'
} > runtime/deploy.json.tmp
mv runtime/deploy.json.tmp runtime/deploy.json
chmod 0644 runtime/deploy.json

docker compose --env-file .env build
docker compose --env-file .env up -d
docker compose --env-file .env ps

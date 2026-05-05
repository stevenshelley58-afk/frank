#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and edit it before deploying." >&2
  exit 1
fi

read_env() {
  local key="$1"
  local default="$2"
  local value=""
  if [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' || true)"
  fi
  printf '%s' "${value:-$default}"
}

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
mkdir -p runtime/access workspaces/tasks

git_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
git_commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
deploy_timestamp="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
app_version="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1 || true)"
hermes_enabled="$(read_env HERMES_ENABLED false)"
hermes_api_server_key="$(read_env HERMES_API_SERVER_KEY "")"
browser_enabled="$(read_env FRANK_BROWSER_ENABLED false)"

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

compose_files=(-f docker-compose.yml)
if [ "${hermes_enabled}" = "true" ]; then
  if [ -z "${hermes_api_server_key}" ]; then
    echo "Refusing Hermes deploy: HERMES_ENABLED=true but HERMES_API_SERVER_KEY is missing." >&2
    exit 1
  fi
  compose_files+=(-f docker-compose.hermes.yml)
fi
if [ "${browser_enabled}" = "true" ]; then
  mkdir -p runtime/browser
  compose_files+=(-f docker-compose.browser.yml)
fi

docker compose "${compose_files[@]}" --env-file .env build
docker compose "${compose_files[@]}" --env-file .env up -d
docker compose "${compose_files[@]}" --env-file .env ps

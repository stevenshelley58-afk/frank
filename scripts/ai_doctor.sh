#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

read_env() {
  local key="$1"
  local default="$2"
  local value=""
  if [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' || true)"
  fi
  local access_file="${FRANK_ACCESS_ENV_FILE:-./runtime/access/frank-access.env}"
  if [ -f "${access_file}" ]; then
    local access_value=""
    access_value="$(grep -E "^${key}=" "${access_file}" | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' || true)"
    value="${access_value:-$value}"
  fi
  printf '%s' "${value:-$default}"
}

failures=0

check_command() {
  local command_name="$1"
  if command -v "${command_name}" >/dev/null 2>&1; then
    echo "${command_name}: available ($(command -v "${command_name}"))"
  else
    echo "${command_name}: missing" >&2
    failures=$((failures + 1))
  fi
}

check_command node
check_command pnpm
check_command git
check_command tmux
check_command docker
check_command codex
check_command claude

if docker compose version >/dev/null 2>&1; then
  echo "docker compose: available"
else
  echo "docker compose: missing" >&2
  failures=$((failures + 1))
fi

echo "FRANK_HOST_AGENT_ENABLED=$(read_env FRANK_HOST_AGENT_ENABLED false)"
if [ -n "$(read_env FRANK_HOST_AGENT_TOKEN "")" ]; then
  echo "FRANK_HOST_AGENT_TOKEN=configured (redacted)"
else
  echo "FRANK_HOST_AGENT_TOKEN=missing" >&2
  failures=$((failures + 1))
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet frank-host-agent; then
    echo "frank-host-agent: active"
  else
    echo "frank-host-agent: not active" >&2
    failures=$((failures + 1))
  fi
fi

docker compose -f docker-compose.yml -f docker-compose.browser.yml --env-file .env config >/dev/null
echo "browser overlay compose: valid"

docker compose -f docker-compose.yml -f docker-compose.hermes.yml --env-file .env config >/dev/null
echo "hermes overlay compose: valid"

if [ "${failures}" -ne 0 ]; then
  echo "AI doctor found ${failures} issue(s)." >&2
  exit 1
fi

echo "AI doctor passed."

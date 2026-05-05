#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
codex_package="${CODEX_NPM_PACKAGE:-@openai/codex}"
claude_package="${CLAUDE_CODE_NPM_PACKAGE:-@anthropic-ai/claude-code}"

if [ "$(id -u)" -eq 0 ]; then
  sudo_cmd=()
else
  sudo_cmd=(sudo)
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command after install attempt: $1" >&2
    exit 1
  fi
}

install_node_22() {
  if command -v node >/dev/null 2>&1; then
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [ "${major}" -ge 22 ]; then
      return
    fi
  fi

  curl -fsSL https://deb.nodesource.com/setup_22.x | "${sudo_cmd[@]}" -E bash -
  "${sudo_cmd[@]}" apt-get install -y nodejs
}

install_docker_tools() {
  if ! command -v docker >/dev/null 2>&1; then
    "${sudo_cmd[@]}" apt-get install -y docker.io docker-compose-plugin
    return
  fi

  if ! docker compose version >/dev/null 2>&1; then
    "${sudo_cmd[@]}" apt-get install -y docker-compose-plugin
  fi
}

"${sudo_cmd[@]}" apt-get update
"${sudo_cmd[@]}" apt-get install -y ca-certificates curl git tmux
install_docker_tools

install_node_22
require_command node

"${sudo_cmd[@]}" corepack enable
"${sudo_cmd[@]}" corepack prepare pnpm@10.20.0 --activate
require_command pnpm
require_command docker
docker compose version >/dev/null 2>&1 || {
  echo "Missing required command after install attempt: docker compose" >&2
  exit 1
}

cd "${repo_dir}"
pnpm install
pnpm --filter @frank/host-agent build

"${sudo_cmd[@]}" npm install -g "${codex_package}" "${claude_package}"

echo "AI tool install complete."
echo "Next: run codex login and claude login from the VPS user that will run frank-host-agent."

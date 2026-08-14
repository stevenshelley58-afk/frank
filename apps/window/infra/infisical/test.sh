#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
compose_file="$script_dir/compose.yml"

command -v python3 >/dev/null 2>&1 || { echo "test: python3 is required" >&2; exit 1; }
python3 - "$compose_file" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text(encoding="utf-8")
bootstrap = Path(sys.argv[1]).with_name("bootstrap-hermes.sh").read_text(encoding="utf-8")
assert "127.0.0.1:${INFISICAL_HOST_PORT:-18082}:8080" in text
assert '"0.0.0.0:' not in text
assert '":::' not in text
assert re.search(r"image:\s+infisical/infisical:v0\.162\.14@sha256:[0-9a-f]{64}", text)
assert re.search(r"image:\s+postgres:16-alpine@sha256:[0-9a-f]{64}", text)
assert re.search(r"image:\s+redis:7\.4-alpine@sha256:[0-9a-f]{64}", text)
assert "name: infisical_pg_data" in text
assert "name: infisical_redis_data" in text
assert "internal: true" in text
assert "ports:" in text
assert "HERMES_CONNECTIONS_INFISICAL_TOKEN" not in bootstrap
assert "login_response" not in bootstrap
print("static policy checks passed")
PY

for file in "$script_dir"/*.sh; do
  bash -n "$file"
done
echo "shell syntax checks passed"

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$script_dir"/*.sh
  echo "shellcheck passed"
else
  echo "shellcheck unavailable; bash syntax checks passed"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  tmp_env="$(mktemp)"
  trap 'rm -f -- "$tmp_env"' EXIT
  printf 'INFISICAL_ENV_FILE=%s\nINFISICAL_HOST_PORT=18082\n' "$script_dir/infisical.env.example" >"$tmp_env"
  docker compose --project-name infisical --env-file "$tmp_env" -f "$compose_file" config --quiet
  echo "compose syntax check passed"
else
  echo "Docker Compose unavailable; static and shell checks passed"
fi

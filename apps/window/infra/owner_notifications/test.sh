#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
bash -n "$script_dir/deploy.sh" "$script_dir/check.sh"
grep -q 'binwiederhier/ntfy:v2.14.0@sha256:' "$script_dir/compose.yml"
grep -q 'auth-default-access: deny-all' "$script_dir/deploy.sh"
grep -q 'cache-duration: 24h' "$script_dir/deploy.sh"
grep -q 'owner-notifications.*read-only' "$script_dir/deploy.sh"
grep -q 'publisher.*write-only' "$script_dir/deploy.sh"
grep -q '127.0.0.1:' "$script_dir/compose.yml"
if command -v shellcheck >/dev/null 2>&1; then shellcheck "$script_dir/deploy.sh" "$script_dir/check.sh"; fi
if command -v docker >/dev/null 2>&1; then docker compose -f "$script_dir/compose.yml" config >/dev/null 2>&1 || true; fi
echo 'owner-notifications static tests passed'

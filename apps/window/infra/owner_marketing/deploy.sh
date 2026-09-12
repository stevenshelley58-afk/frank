#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; compose_file="$script_dir/compose.yml"; die(){ echo "owner-marketing deploy: $*" >&2; exit 1; }
[[ -f "$compose_file" ]] || die missing-compose
cd "$script_dir/../../../.."; [[ -z "$(git status --porcelain)" ]] || die dirty-or-untracked-source; git ls-files --error-unmatch apps/window/infra/owner_marketing/compose.yml apps/window/infra/owner_marketing/deploy.sh apps/window/infra/owner_marketing/check.sh >/dev/null || die untracked-source; export MAUTIC_SOURCE_SHA="$(git rev-parse HEAD)"; cd "$script_dir"
secret_dir=/srv/frank/secrets/owner-marketing; env_file="$secret_dir/owner-marketing.env"; port="${MAUTIC_HOST_PORT:-18106}"; install -d -m 0700 "$secret_dir"; [[ "$(stat -c '%U:%a' "$secret_dir")" == root:700 ]] || die unsafe-secret-dir; umask 077
if [[ ! -e "$env_file" ]]; then tmp="$(mktemp "$secret_dir/.env.XXXXXX")"; printf 'MAUTIC_HOST_PORT=%s
MAUTIC_DB_PASSWORD=%s
MAUTIC_DB_ROOT_PASSWORD=%s
' "$port" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" >"$tmp"; chmod 0600 "$tmp"; mv "$tmp" "$env_file"; fi
[[ -f "$env_file" && ! -L "$env_file" ]] || die unsafe-env-file; chmod 0600 "$env_file"; [[ "$(stat -c '%U:%a' "$env_file")" == root:600 ]] || die unsafe-env-file
running="$(docker ps --filter publish="$port" --format '{{.Names}}' || true)"; [[ -z "$running" || "$running" == frank-owner-marketing ]] || die port-in-use
export MAUTIC_HOST_PORT="$port"
docker compose --project-name frank-owner-marketing --env-file "$env_file" -f "$compose_file" up -d
for _ in $(seq 1 60); do s="$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing 2>/dev/null || true)"; [[ "$s" == healthy ]] && break; [[ "$s" != unhealthy ]] || die unhealthy; sleep 5; done
"$script_dir/check.sh"
echo "private Mautic draft foundation healthy at http://127.0.0.1:$port"

#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; compose_file="$script_dir/compose.yml"; die(){ echo "owner-marketing deploy: $*" >&2; exit 1; }
[[ -f "$compose_file" ]] || die missing-compose
cd "$script_dir/../../../.."; [[ -z "$(git status --porcelain)" ]] || die dirty-or-untracked-source; git ls-files --error-unmatch apps/window/infra/owner_marketing/compose.yml apps/window/infra/owner_marketing/nginx.conf apps/window/infra/owner_marketing/deploy.sh apps/window/infra/owner_marketing/install.sh apps/window/infra/owner_marketing/check.sh apps/window/infra/owner_marketing/configure_site.sh >/dev/null || die untracked-source; export MAUTIC_SOURCE_SHA="$(git rev-parse HEAD)"; cd "$script_dir"
secret_dir=/srv/frank/secrets/owner-marketing; env_file="$secret_dir/owner-marketing.env"; port="${MAUTIC_HOST_PORT:-18106}"
runtime_profiles="${MAUTIC_RUNTIME_PROFILES:-}"
compose_args=(--project-name frank-owner-marketing --env-file "$env_file" -f "$compose_file")
if [[ -n "$runtime_profiles" ]]; then
  IFS=',' read -r -a profile_list <<< "$runtime_profiles"
  for profile in "${profile_list[@]}"; do
    case "$profile" in
      owner-marketing-cron|owner-marketing-worker) compose_args+=(--profile "$profile") ;;
      *) die "unsupported MAUTIC_RUNTIME_PROFILES value" ;;
    esac
  done
fi
install -d -m 0700 "$secret_dir"; [[ "$(stat -c '%U:%a' "$secret_dir")" == root:700 ]] || die unsafe-secret-dir; umask 077
if [[ ! -e "$env_file" ]]; then tmp="$(mktemp "$secret_dir/.env.XXXXXX")"; printf 'MAUTIC_HOST_PORT=%s
MAUTIC_DB_PASSWORD=%s
MAUTIC_DB_ROOT_PASSWORD=%s
MAUTIC_ADMIN_PASSWORD=%s
' "$port" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" >"$tmp"; chmod 0600 "$tmp"; mv "$tmp" "$env_file"; fi
[[ -f "$env_file" && ! -L "$env_file" ]] || die unsafe-env-file; chmod 0600 "$env_file"; [[ "$(stat -c '%U:%a' "$env_file")" == root:600 ]] || die unsafe-env-file
if ! grep -q '^MAUTIC_ADMIN_PASSWORD=' "$env_file"; then printf 'MAUTIC_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 32)" >>"$env_file"; fi
running="$(docker ps --filter publish="$port" --format '{{.Names}}' || true)"; [[ -z "$running" || "$running" == frank-owner-marketing-ingress ]] || die port-in-use
export MAUTIC_HOST_PORT="$port"
if [[ -z "$runtime_profiles" ]]; then
  cleanup_args=("${compose_args[@]}" --profile owner-marketing-cron --profile owner-marketing-worker)
  docker compose "${cleanup_args[@]}" stop cron worker >/dev/null 2>&1 || die cannot-stop-native-senders
  docker compose "${cleanup_args[@]}" rm -f cron worker >/dev/null 2>&1 || die cannot-retire-stopped-senders
fi
# Start the exact proxy revision, then pause it before its first health
# request. Pausing retains its private address while native cache/configuration
# is refreshed without concurrent proxy requests. Always unpause on failure.
docker compose "${compose_args[@]}" up -d db mautic ingress
docker pause frank-owner-marketing-ingress >/dev/null
trap 'docker unpause frank-owner-marketing-ingress >/dev/null 2>&1 || true' EXIT
"$script_dir/configure_site.sh"
docker unpause frank-owner-marketing-ingress >/dev/null
trap - EXIT
docker compose "${compose_args[@]}" up -d
for _ in $(seq 1 60); do s="$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing 2>/dev/null || true)"; i="$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing-ingress 2>/dev/null || true)"; [[ "$s" == healthy && "$i" == healthy ]] && break; [[ "$s" != unhealthy && "$i" != unhealthy ]] || die unhealthy; sleep 5; done
"$script_dir/check.sh" --preinstall
echo "private Mautic native setup is reachable at http://127.0.0.1:$port"

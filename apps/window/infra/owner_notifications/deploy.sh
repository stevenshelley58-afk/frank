#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
compose_file="$script_dir/compose.yml"
secret_dir="${NTFY_SECRET_DIR:-/srv/frank/secrets/owner-notifications}"
config_file="${NTFY_CONFIG_FILE:-$secret_dir/server.yml}"
env_file="$secret_dir/owner-notifications.env"
port="${NTFY_HOST_PORT:-18104}"
die(){ echo "owner-notifications deploy: $*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null || die "missing required command: $1"; }
[[ -f "$compose_file" ]] || die "missing compose file"
[[ "$secret_dir" != "$script_dir"* ]] || die "runtime secrets must be outside tracked bundle"
need docker; need openssl; need curl; need python3
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
[[ "$port" =~ ^[0-9]+$ ]] && ((port>=1024 && port<=65535)) || die "NTFY_HOST_PORT must be 1024-65535"
install -d -m 0700 "$secret_dir"; umask 077
if [[ ! -e "$config_file" ]]; then
  [[ "$config_file" != "$script_dir"* ]] || die "config must be outside tracked bundle"
  tmp="$(mktemp "$secret_dir/.server.yml.XXXXXX")"; trap 'rm -f -- "$tmp"' EXIT
  cat >"$tmp" <<EOF
base-url: http://127.0.0.1:$port
listen-http: :80
auth-file: /var/cache/ntfy/user.db
auth-default-access: deny-all
cache-file: /var/cache/ntfy/cache.db
cache-duration: 24h
behind-proxy: false
EOF
  chmod 0600 "$tmp"; mv "$tmp" "$config_file"; trap - EXIT
elif [[ ! -f "$config_file" || -L "$config_file" ]]; then die "config must be a regular non-symlink file"; fi
chmod 0600 "$config_file"
if [[ ! -e "$env_file" ]]; then
  tmp="$(mktemp "$secret_dir/.env.XXXXXX")"; trap 'rm -f -- "$tmp"' EXIT
  printf 'NTFY_HOST_PORT=%s
NTFY_OWNER_PASSWORD=%s
NTFY_PUBLISHER_PASSWORD=%s
' "$port" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" >"$tmp"
  chmod 0600 "$tmp"; mv "$tmp" "$env_file"; trap - EXIT
fi
chmod 0600 "$env_file"
owner_pw="$(awk -F= '$1=="NTFY_OWNER_PASSWORD"{print substr($0,index($0,"=")+1)}' "$env_file")"
publisher_pw="$(awk -F= '$1=="NTFY_PUBLISHER_PASSWORD"{print substr($0,index($0,"=")+1)}' "$env_file")"
[[ -n "$owner_pw" && -n "$publisher_pw" ]] || die "missing generated credentials"
export NTFY_CONFIG_FILE="$config_file" NTFY_HOST_PORT="$port"
running="$(docker ps --filter publish="$port" --format '{{.Names}}' || true)"
[[ -z "$running" || "$running" == frank-owner-ntfy ]] || die "loopback port $port already used by $running"
docker compose --project-name frank-owner-notifications --env-file "$env_file" -f "$compose_file" up -d
for _ in $(seq 1 36); do s="$(docker inspect --format '{{.State.Health.Status}}' frank-owner-ntfy 2>/dev/null || true)"; [[ "$s" == healthy ]] && break; [[ "$s" != unhealthy ]] || die "ntfy became unhealthy"; sleep 5; done
[[ "$(docker inspect --format '{{.State.Health.Status}}' frank-owner-ntfy)" == healthy ]] || die "ntfy did not become healthy"
# Idempotently converge native ntfy users and ACLs. Credentials are passed only in process env.
NTFY_PASSWORD="$owner_pw" docker exec -e NTFY_PASSWORD frank-owner-ntfy ntfy user add owner >/dev/null 2>&1 || NTFY_PASSWORD="$owner_pw" docker exec -e NTFY_PASSWORD frank-owner-ntfy ntfy user change-pass owner >/dev/null
NTFY_PASSWORD="$publisher_pw" docker exec -e NTFY_PASSWORD frank-owner-ntfy ntfy user add publisher >/dev/null 2>&1 || NTFY_PASSWORD="$publisher_pw" docker exec -e NTFY_PASSWORD frank-owner-ntfy ntfy user change-pass publisher >/dev/null
for rule in 'owner owner-notifications read-only' 'publisher owner-notifications write-only'; do set -- $rule; docker exec frank-owner-ntfy ntfy access "$1" "$2" "$3" >/dev/null; done
"$script_dir/check.sh"
echo "owner notifications healthy at http://127.0.0.1:$port (topic owner-notifications)"

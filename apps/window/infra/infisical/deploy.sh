#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
compose_file="$script_dir/compose.yml"
secret_file="${INFISICAL_ENV_FILE:-/srv/infisical/secrets/infisical.env}"
secret_dir="$(dirname -- "$secret_file")"

die() { echo "infisical deploy: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

[[ -f "$compose_file" ]] || die "missing compose file: $compose_file"
[[ "$secret_file" != "$script_dir"/* ]] || die "secret file must be outside the tracked bundle"
[[ ! -L "$secret_file" ]] || die "secret file must not be a symlink"
need docker
need openssl
need curl
need python3
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"

install -d -m 0700 -- "$secret_dir"
umask 077

env_value() {
  local key="$1"
  [[ -f "$secret_file" ]] || return 0
  awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$secret_file"
}

if [[ ! -e "$secret_file" ]]; then
  host_port="${INFISICAL_HOST_PORT:-18082}"
  [[ "$host_port" =~ ^[0-9]+$ ]] || die "INFISICAL_HOST_PORT must be numeric"
  (( host_port >= 1024 && host_port <= 65535 )) || die "INFISICAL_HOST_PORT must be between 1024 and 65535"
  db_password="$(openssl rand -hex 32)"
  redis_password="$(openssl rand -hex 32)"
  encryption_key="$(openssl rand -hex 16)"
  auth_secret="$(openssl rand -base64 32 | tr -d '\n')"
  tmp_file="$(mktemp "$secret_dir/.infisical.env.XXXXXX")"
  trap 'rm -f -- "$tmp_file"' EXIT
  cat >"$tmp_file" <<EOF
INFISICAL_HOST_PORT=$host_port
POSTGRES_USER=infisical
POSTGRES_DB=infisical
POSTGRES_PASSWORD=$db_password
REDIS_PASSWORD=$redis_password
ENCRYPTION_KEY=$encryption_key
AUTH_SECRET=$auth_secret
DB_CONNECTION_URI=postgres://infisical:$db_password@db:5432/infisical
REDIS_URL=redis://:$redis_password@redis:6379
SITE_URL=http://127.0.0.1:$host_port
TELEMETRY_ENABLED=false
DISABLE_UPDATE_CHECK=true
EOF
  chmod 0600 -- "$tmp_file"
  mv -- "$tmp_file" "$secret_file"
  trap - EXIT
  echo "created generated Infisical runtime secrets at $secret_file" >&2
elif [[ ! -f "$secret_file" ]]; then
  die "secret path exists but is not a regular file: $secret_file"
fi

chmod 0600 -- "$secret_file"
for key in INFISICAL_HOST_PORT POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD REDIS_PASSWORD ENCRYPTION_KEY AUTH_SECRET DB_CONNECTION_URI REDIS_URL SITE_URL; do
  value="$(env_value "$key")"
  [[ -n "$value" ]] || die "missing required $key in $secret_file"
  [[ "$value" != *GENERATED_AT_DEPLOY* ]] || die "placeholder value remains for $key"
  [[ "$value" != *CHANGE_ME* ]] || die "placeholder value remains for $key"
done

host_port="$(env_value INFISICAL_HOST_PORT)"
[[ "$host_port" =~ ^[0-9]+$ ]] || die "INFISICAL_HOST_PORT must be numeric"
(( host_port >= 1024 && host_port <= 65535 )) || die "INFISICAL_HOST_PORT must be between 1024 and 65535"

config_json="$(INFISICAL_ENV_FILE="$secret_file" docker compose --project-name infisical --env-file "$secret_file" -f "$compose_file" config --format json)" || die "compose configuration is invalid"
printf '%s' "$config_json" | python3 -c '
import json, sys

cfg = json.load(sys.stdin)
services = cfg["services"]
backend_ports = services["backend"].get("ports", [])
if len(backend_ports) != 1:
    raise SystemExit("backend must publish exactly one private port")
port = backend_ports[0]
if port.get("host_ip") not in {"127.0.0.1", "::1"}:
    raise SystemExit("backend port must bind to loopback")
for name in ("db", "redis"):
    if services[name].get("ports"):
        raise SystemExit(f"{name} must not publish a host port")
if "infisical" not in services["backend"].get("networks", {}):
    raise SystemExit("backend must use the private Infisical network")
if set(services["backend"].get("networks", {})) != {"infisical"}:
    raise SystemExit("backend must not join a shared Frank network")
if set(services["db"].get("networks", {})) != {"infisical"} or set(services["redis"].get("networks", {})) != {"infisical"}:
    raise SystemExit("database and Redis must stay on the private Infisical network")
if set(services["db"].get("environment", {})) != {"POSTGRES_USER", "POSTGRES_DB", "POSTGRES_PASSWORD"}:
    raise SystemExit("database must receive only POSTGRES_* variables")
if set(services["redis"].get("environment", {})) != {"REDIS_PASSWORD"}:
    raise SystemExit("Redis must receive only REDIS_PASSWORD")
if services["db"].get("env_file") or services["redis"].get("env_file"):
    raise SystemExit("database and Redis must not receive the backend env file")
' || die "compose network/port policy failed"

running_names="$(docker ps --filter "publish=$host_port" --format '{{.Names}}' || true)"
if [[ -n "$running_names" && "$running_names" != "infisical-backend" ]]; then
  die "loopback port $host_port is already published by: $running_names"
fi
if [[ "$running_names" != "infisical-backend" ]] && curl --silent --output /dev/null --connect-timeout 1 "http://127.0.0.1:$host_port/api/status"; then
  die "loopback port $host_port is already in use"
fi

INFISICAL_ENV_FILE="$secret_file" docker compose --project-name infisical --env-file "$secret_file" -f "$compose_file" up -d
"$script_dir/check.sh"
echo "Infisical CE is running privately at http://127.0.0.1:$host_port"

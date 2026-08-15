#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
compose_file="$script_dir/compose.yml"
secret_file="${INFISICAL_ENV_FILE:-/srv/infisical/secrets/infisical.env}"

die() { echo "infisical check: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || die "missing required command: docker"
command -v curl >/dev/null 2>&1 || die "missing required command: curl"
command -v python3 >/dev/null 2>&1 || die "missing required command: python3"
[[ -f "$secret_file" ]] || die "missing external secret file: $secret_file"
[[ "$(stat -c '%a' "$secret_file")" == "600" ]] || die "secret file must have mode 0600"

env_value() { awk -F= -v wanted="$1" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$secret_file"; }
host_port="$(env_value INFISICAL_HOST_PORT)"
[[ "$host_port" =~ ^[0-9]+$ ]] || die "invalid INFISICAL_HOST_PORT"

config_json="$(INFISICAL_ENV_FILE="$secret_file" docker compose --project-name infisical --env-file "$secret_file" -f "$compose_file" config --format json)" || die "compose configuration is invalid"
printf '%s' "$config_json" | python3 -c '
import json, sys

cfg = json.load(sys.stdin)
services = cfg["services"]
ports = services["backend"].get("ports", [])
if len(ports) != 1 or ports[0].get("host_ip") not in {"127.0.0.1", "::1"}:
    raise SystemExit("the only published Infisical port must be loopback-only")
if services["db"].get("ports") or services["redis"].get("ports"):
    raise SystemExit("database and Redis must not publish host ports")
if set(services["backend"].get("networks", {})) != {"infisical"}:
    raise SystemExit("backend must not join the shared Frank network")
if set(services["db"].get("environment", {})) != {"POSTGRES_USER", "POSTGRES_DB", "POSTGRES_PASSWORD"}:
    raise SystemExit("database must receive only POSTGRES_* variables")
if set(services["redis"].get("environment", {})) != {"REDIS_PASSWORD"}:
    raise SystemExit("Redis must receive only REDIS_PASSWORD")
if services["db"].get("env_file") or services["redis"].get("env_file"):
    raise SystemExit("database and Redis must not receive the backend env file")
' || die "compose port policy failed"

docker inspect infisical-backend infisical-db infisical-redis >/dev/null 2>&1 || die "Infisical containers are not all present"

actual_networks="$(docker inspect --format '{{json .NetworkSettings.Networks}}' infisical-backend)"
printf '%s' "$actual_networks" | python3 -c '
import json
import sys

networks = json.loads(sys.stdin.read())
if set(networks) != {"infisical_private"}:
    raise SystemExit("running backend is attached to a non-private network")
' || die "running backend network policy failed"

actual_bindings="$(docker inspect --format '{{json .HostConfig.PortBindings}}' infisical-backend)"
printf '%s' "$actual_bindings" | python3 -c '
import json
import sys

bindings = json.loads(sys.stdin.read())
published = bindings.get("8080/tcp")
if not published or len(published) != 1 or published[0].get("HostIp") not in {"127.0.0.1", "::1"} or published[0].get("HostPort") != sys.argv[1]:
    raise SystemExit("running backend is not bound to loopback only")
' "$host_port"

backend_status="$(docker inspect --format '{{.State.Health.Status}}' infisical-backend)"
[[ "$backend_status" == "healthy" ]] || die "backend health is $backend_status"
for container in infisical-db infisical-redis; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  [[ "$status" == "healthy" ]] || die "$container health is $status"
done

curl --fail --silent --show-error --connect-timeout 3 "http://127.0.0.1:$host_port/api/status" >/dev/null || die "backend status endpoint failed"
echo "healthy: backend loopback:$host_port, database and Redis internal-only"

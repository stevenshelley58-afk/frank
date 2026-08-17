#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
hermes_home="${HERMES_HOME:-/home/hermes/.hermes}"
hermes_secret_file="${HERMES_KNOWLEDGE_SECRET_FILE:-/srv/hermes/secrets/knowledge.env}"
hermes_runtime_env="${HERMES_RUNTIME_KNOWLEDGE_ENV:-/srv/hermes/secrets/graphiti-runtime.env}"
frank_secret_file="${FRANK_SECRET_FILE:-/srv/frank/secrets/window.env}"
knowledge_root="${FRANK_KNOWLEDGE_ROOT:-/srv/frank/knowledge}"
compose_project="${KNOWLEDGE_COMPOSE_PROJECT:-frank-knowledge}"
export FRANK_KNOWLEDGE_ROOT="$knowledge_root"
die() { echo "knowledge check: $*" >&2; exit 1; }

for tool in docker curl python3 stat find awk systemctl; do command -v "$tool" >/dev/null 2>&1 || die "$tool is required"; done
[[ -f "$hermes_secret_file" && ! -L "$hermes_secret_file" && "$(stat -c '%a' "$hermes_secret_file")" == 600 ]] || die "knowledge secret file is missing or not 0600"
[[ -f "$hermes_runtime_env" && ! -L "$hermes_runtime_env" && "$(stat -c '%a' "$hermes_runtime_env")" == 600 ]] || die "Hermes runtime env is missing or not 0600"
for unit in hermes-gateway.service hermes-serve.service; do
  systemctl is-active --quiet "$unit" || die "$unit is not active"
done
for key in HERMES_GRAPHITI_PROVIDER_TOKEN FRANK_KNOWLEDGE_PROJECTION_TOKEN HERMES_ALLOWED_NAMESPACES FRANK_KNOWLEDGE_ALLOWED_PROJECTS OPENAI_API_KEY NEO4J_PASSWORD NEO4J_IMAGE; do
  grep -q -E "^${key}=[^[:space:]]" "$hermes_secret_file" || die "missing $key"
done
grep -q '^NEO4J_IMAGE=.*@sha256:[0-9a-f]\{64\}$' "$hermes_secret_file" || die "Neo4j image is not immutable"
[[ -d "$knowledge_root" && ! -L "$knowledge_root" ]] || die "knowledge root is unavailable"
[[ "$(stat -c '%u:%g' "$knowledge_root")" == "65532:65532" ]] || die "knowledge root ownership is not 65532:65532"
if find "$knowledge_root" -type f ! -user 65532 -o -type f ! -perm -0040 | grep -q .; then die "knowledge files are not owned/readable by the projection UID"; fi

python3 - "$hermes_secret_file" <<'PY' || exit 1
import re, sys
values = {}
for line in open(sys.argv[1], encoding="utf-8"):
    if "=" in line:
        key, value = line.rstrip("\n").split("=", 1); values[key] = value
for key in ("HERMES_ALLOWED_NAMESPACES", "FRANK_KNOWLEDGE_ALLOWED_PROJECTS"):
    parts = [item.strip() for item in values.get(key, "").split(",") if item.strip()]
    if not parts or len(parts) != len(set(parts)):
        raise SystemExit(f"malformed {key}")
    pattern = r"^project/[a-z0-9][a-z0-9._-]{0,63}$"
    if any(not re.fullmatch(pattern, item) for item in parts):
        raise SystemExit(f"malformed {key} value")
if len([item for item in values["HERMES_ALLOWED_NAMESPACES"].split(",") if item.strip()]) != 1:
    raise SystemExit("Hermes provider requires exactly one namespace")
PY

docker compose --project-name "$compose_project" --env-file "$hermes_secret_file" -f "$script_dir/compose.yml" config >/dev/null || die "compose config failed"
services="$(docker compose --project-name "$compose_project" --env-file "$hermes_secret_file" -f "$script_dir/compose.yml" ps --status running --services)"
for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do echo "$services" | grep -qx "$service" || die "$service is not running"; done
for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do
  container="$(docker compose --project-name "$compose_project" --env-file "$hermes_secret_file" -f "$script_dir/compose.yml" ps -q "$service")"
  [[ "$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null || true)" == "healthy" ]] || die "$service is not healthy"
done
curl --fail --silent --show-error --connect-timeout 3 http://127.0.0.1:8091/readyz >/dev/null || die "provider is not ready"
projection_token="$(awk -F= '$1 == "FRANK_KNOWLEDGE_PROJECTION_TOKEN" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
projection_project="$(awk -F= '$1 == "FRANK_KNOWLEDGE_ALLOWED_PROJECTS" {sub(/^[^=]*=/, ""); split($0, values, ","); print values[1]; exit}' "$hermes_secret_file")"
provider_token="$(awk -F= '$1 == "HERMES_GRAPHITI_PROVIDER_TOKEN" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
namespace="$(awk -F= '$1 == "HERMES_ALLOWED_NAMESPACES" {sub(/^[^=]*=/, ""); split($0, values, ","); print values[1]; exit}' "$hermes_secret_file")"
runtime_namespace="$(awk -F= '$1 == "HERMES_GRAPHITI_NAMESPACE" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_runtime_env")"
grep -q '^HERMES_GRAPHITI_PROVIDER_URL=http://127.0.0.1:8091$' "$hermes_runtime_env" || die "Hermes provider URL is not loopback-only"
[[ "$runtime_namespace" == "$namespace" ]] || die "Hermes runtime namespace does not match the allow-list"

curl --fail --silent --show-error --connect-timeout 3 --header "Authorization: Bearer $provider_token" --header "X-Hermes-Namespace: $namespace" --header 'Content-Type: application/json' --data '{"request_id":"check-00000001","query":"health","limit":1}' http://127.0.0.1:8091/v1/search >/dev/null || die "Hermes provider search path failed"

frank_container="$(docker ps --filter label=com.docker.compose.service=frank-window --format '{{.ID}}' | head -n 1)"
[[ -n "$frank_container" ]] || die "Frank container was not found"
  docker exec -e "CHECK_PROJECTION_TOKEN=$projection_token" -e "CHECK_PROJECTION_PROJECT=$projection_project" "$frank_container" python -c 'import json,os,urllib.request; u="http://frank-knowledge-projection:8092/v2/knowledge/projection?project="+os.environ["CHECK_PROJECTION_PROJECT"]+"&lens=knowledge.combined"; q=urllib.request.Request(u,headers={"Authorization":"Bearer "+os.environ["CHECK_PROJECTION_TOKEN"]}); print(urllib.request.urlopen(q,timeout=3).read().decode())' \
  | python3 -c 'import json,sys; p=json.load(sys.stdin); assert p.get("schema")=="schema://frank.graph/v2"; assert p.get("lens")=="knowledge.combined"; assert p.get("subject",{}).get("kind")=="project"' \
  || die "Frank-to-projection v2 path failed"

grep -q -E '^[[:space:]]+provider:[[:space:]]+frank-graphiti-memory[[:space:]]*$' "$hermes_home/config.yaml" || die "Hermes default profile does not select frank-graphiti-memory"
if command -v ss >/dev/null 2>&1; then
  ss -ltn | awk '$4 ~ /:7687$/ && $4 !~ /127.0.0.1:7687$/ {bad=1} END {exit bad}' || die "Neo4j is not private"
fi
echo "healthy: private Neo4j, Hermes mutation gateway, dedicated Frank projection, v2 contract, ownership and runtime checks"

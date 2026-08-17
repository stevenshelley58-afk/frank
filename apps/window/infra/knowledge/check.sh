#!/usr/bin/env bash
set -euo pipefail
IFS=$' \t\n'
umask 077

readonly SCRIPT_DIR=/projects/frank/apps/window/infra/knowledge
readonly HERMES_HOME=/home/hermes/.hermes
readonly HERMES_SECRET_FILE=/srv/hermes/secrets/knowledge.env
readonly HERMES_RUNTIME_ENV=/srv/hermes/secrets/graphiti-runtime.env
readonly FRANK_SECRET_FILE=/srv/frank/secrets/window.env
readonly KNOWLEDGE_ROOT=/srv/frank/knowledge
readonly COMPOSE_PROJECT=frank-knowledge
readonly FIXED_PROJECT=project/frank
readonly PROJECTION_URL=http://frank-knowledge-projection:8092/v2/knowledge/projection

die() { echo "knowledge check: $*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || die "run as root"
[[ $# -eq 0 ]] || die "arguments are not accepted"
for tool in docker curl python3 stat find awk systemctl; do command -v "$tool" >/dev/null 2>&1 || die "$tool is required"; done
python3 "$SCRIPT_DIR/secret_env.py" "$HERMES_SECRET_FILE" knowledge >/dev/null || die "knowledge secret validation failed"
python3 "$SCRIPT_DIR/secret_env.py" "$FRANK_SECRET_FILE" frank >/dev/null || die "Frank secret validation failed"
python3 "$SCRIPT_DIR/secret_env.py" "$HERMES_RUNTIME_ENV" runtime >/dev/null || die "Hermes runtime env validation failed"
[[ -f "$HERMES_RUNTIME_ENV" && ! -L "$HERMES_RUNTIME_ENV" && "$(stat -c '%a' "$HERMES_RUNTIME_ENV")" == 600 ]] || die "Hermes runtime env is missing or not 0600"
for unit in hermes-gateway.service hermes-serve.service; do systemctl is-active --quiet "$unit" || die "$unit is not active"; done
[[ -d "$KNOWLEDGE_ROOT" && ! -L "$KNOWLEDGE_ROOT" ]] || die "knowledge root is unavailable"
[[ "$(stat -c '%u:%g' "$KNOWLEDGE_ROOT")" == "65532:65532" ]] || die "knowledge root ownership is not 65532:65532"
if find "$KNOWLEDGE_ROOT" -type f \( ! -user 65532 -o ! -perm -0040 \) -print -quit | grep -q .; then die "knowledge files are not owned/readable by the projection UID"; fi

read_key() { awk -F= -v wanted="$1" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$HERMES_SECRET_FILE"; }
[[ "$(read_key HERMES_ALLOWED_NAMESPACES)" == "$FIXED_PROJECT" ]] || die "Hermes namespace is not fixed to project/frank"
[[ "$(read_key FRANK_KNOWLEDGE_ALLOWED_PROJECTS)" == "$FIXED_PROJECT" ]] || die "Frank project allow-list is not fixed to project/frank"
[[ "$(read_key NEO4J_IMAGE)" =~ @sha256:[0-9a-f]{64}$ ]] || die "Neo4j image is not immutable"
grep -q '^HERMES_GRAPHITI_PROVIDER_URL=http://127.0.0.1:8091$' "$HERMES_RUNTIME_ENV" || die "Hermes provider URL is not loopback-only"
grep -q '^HERMES_GRAPHITI_NAMESPACE=project/frank$' "$HERMES_RUNTIME_ENV" || die "Hermes runtime namespace is not fixed"

docker compose --project-name "$COMPOSE_PROJECT" --env-file "$HERMES_SECRET_FILE" -f "$SCRIPT_DIR/compose.yml" config >/dev/null || die "compose config failed"
services="$(docker compose --project-name "$COMPOSE_PROJECT" --env-file "$HERMES_SECRET_FILE" -f "$SCRIPT_DIR/compose.yml" ps --status running --services)"
for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do echo "$services" | grep -qx "$service" || die "$service is not running"; done
for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do
  container="$(docker compose --project-name "$COMPOSE_PROJECT" --env-file "$HERMES_SECRET_FILE" -f "$SCRIPT_DIR/compose.yml" ps -q "$service")"
  [[ "$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null || true)" == healthy ]] || die "$service is not healthy"
done
curl --fail --silent --show-error --connect-timeout 3 http://127.0.0.1:8091/readyz >/dev/null || die "provider is not ready"

frank_container="$(docker ps --filter label=com.docker.compose.service=frank-window --format '{{.ID}}' | head -n 1)"
[[ -n "$frank_container" ]] || die "Frank container was not found"
projection_token="$(read_key FRANK_KNOWLEDGE_PROJECTION_TOKEN)"
docker exec -e "CHECK_PROJECTION_TOKEN=$projection_token" "$frank_container" python -c 'import json,os,urllib.request; u="http://frank-knowledge-projection:8092/v2/knowledge/projection?project=project/frank&lens=knowledge.combined"; q=urllib.request.Request(u,headers={"Authorization":"Bearer "+os.environ["CHECK_PROJECTION_TOKEN"]}); p=json.load(urllib.request.urlopen(q,timeout=3)); assert p.get("schema")=="schema://frank.graph/v2" and p.get("lens")=="knowledge.combined" and p.get("subject")=={"kind":"project","id":"frank"}; print("projection accepted: nodes=%d edges=%d"%(len(p.get("nodes",[])),len(p.get("edges",[]))))' \
  | python3 -c 'import sys; line=sys.stdin.read().strip(); assert len(line)<160 and line.startswith("projection accepted: nodes="); print(line)' \
  || die "Frank-to-projection v2 path failed"

grep -q -E '^[[:space:]]+provider:[[:space:]]+frank-graphiti-memory[[:space:]]*$' "$HERMES_HOME/config.yaml" || die "Hermes default profile does not select frank-graphiti-memory"
if command -v ss >/dev/null 2>&1; then ss -ltn | awk '$4 ~ /:7687$/ && $4 !~ /127.0.0.1:7687$/ {bad=1} END {exit bad}' || die "Neo4j is not private"; fi
echo "healthy: fixed project/frank, private Neo4j, Hermes gateway, projection contract"

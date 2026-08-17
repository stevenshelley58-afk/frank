#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd -P)"
hermes_home="${HERMES_HOME:-/home/hermes/.hermes}"
hermes_user="${HERMES_USER:-hermes}"
hermes_group="${HERMES_GROUP:-hermes}"
hermes_secret_file="${HERMES_KNOWLEDGE_SECRET_FILE:-/srv/hermes/secrets/knowledge.env}"
hermes_runtime_env="${HERMES_RUNTIME_KNOWLEDGE_ENV:-/srv/hermes/secrets/graphiti-runtime.env}"
frank_secret_file="${FRANK_SECRET_FILE:-/srv/frank/secrets/window.env}"
knowledge_root="${FRANK_KNOWLEDGE_ROOT:-/srv/frank/knowledge}"
compose_project="${KNOWLEDGE_COMPOSE_PROJECT:-frank-knowledge}"
export FRANK_KNOWLEDGE_ROOT="$knowledge_root"

die() { echo "knowledge deploy: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ -d "$repo_root/.git" ]] || die "run from a committed Frank checkout"
[[ -f "$script_dir/compose.yml" && -f "$script_dir/hermes_plugin/plugin.yaml" ]] || die "deployment bundle is incomplete"
id "$hermes_user" >/dev/null 2>&1 || die "Hermes user does not exist"
command -v openssl >/dev/null 2>&1 || die "openssl is required"
command -v docker >/dev/null 2>&1 || die "docker is required"
command -v systemctl >/dev/null 2>&1 || die "systemctl is required"
command -v sudo >/dev/null 2>&1 || die "sudo is required"
[[ -f "$hermes_home/config.yaml" && ! -L "$hermes_home/config.yaml" ]] || die "Hermes default profile config is unavailable"
[[ -x "$hermes_home/hermes-agent/venv/bin/python" ]] || die "Hermes default profile Python runtime is unavailable"
[[ -f "$frank_secret_file" && ! -L "$frank_secret_file" ]] || die "Frank secret file is unavailable"

# Never deploy from a dirty checkout. This keeps the knowledge stack tied to
# the same committed Frank revision as the Window release.
[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]] || die "Frank checkout has uncommitted changes"

hermes_secret_dir="$(dirname -- "$hermes_secret_file")"
runtime_env_dir="$(dirname -- "$hermes_runtime_env")"
[[ -d "$hermes_secret_dir" ]] || die "Hermes secrets directory is unavailable"
[[ -d "$runtime_env_dir" ]] || die "Hermes runtime environment directory is unavailable"
for unit in hermes-gateway.service hermes-serve.service; do
  systemctl cat "$unit" >/dev/null 2>&1 || die "required Hermes unit is unavailable: $unit"
done

[[ ! -L "$hermes_secret_file" ]] || die "knowledge secret file must not be a symlink"
if [[ ! -e "$hermes_secret_file" ]]; then
  install -o "$hermes_user" -g "$hermes_group" -m 0600 /dev/null "$hermes_secret_file"
fi
chown "$hermes_user:$hermes_group" "$hermes_secret_file"
chmod 0600 "$hermes_secret_file"

ensure_secret() {
  local key="$1" value tmp
  value="$(awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
  if [[ -z "$value" ]]; then
    value="$(openssl rand -hex 32)"
    tmp="$(mktemp "$(dirname -- "$hermes_secret_file")/.knowledge.XXXXXX")"
    awk -F= -v wanted="$key" '$1 != wanted {print}' "$hermes_secret_file" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
    chown "$hermes_user:$hermes_group" "$tmp"; chmod 0600 "$tmp"
    mv -- "$tmp" "$hermes_secret_file"
  fi
}

ensure_secret HERMES_GRAPHITI_PROVIDER_TOKEN
ensure_secret FRANK_KNOWLEDGE_PROJECTION_TOKEN
ensure_secret NEO4J_PASSWORD
grep -q '^HERMES_ALLOWED_NAMESPACES=[^[:space:]]' "$hermes_secret_file" || die "set exact HERMES_ALLOWED_NAMESPACES first"
grep -q '^FRANK_KNOWLEDGE_ALLOWED_PROJECTS=[^[:space:]]' "$hermes_secret_file" || die "set exact FRANK_KNOWLEDGE_ALLOWED_PROJECTS first"
namespace_count="$(awk -F= '$1 == "HERMES_ALLOWED_NAMESPACES" {sub(/^[^=]*=/, ""); count=split($0, values, ","); print count; exit}' "$hermes_secret_file")"
[[ "$namespace_count" == "1" ]] || die "the current Hermes MemoryProvider requires exactly one explicit project namespace"
for key in OPENAI_API_KEY NEO4J_PASSWORD; do
  grep -q "^${key}=[^[:space:]]" "$hermes_secret_file" || die "missing $key"
done
grep -q '^NEO4J_IMAGE=.*@sha256:[0-9a-f]\{64\}$' "$hermes_secret_file" || die "NEO4J_IMAGE must be pinned to an immutable sha256 digest"
install -d -o 65532 -g 65532 -m 0750 -- "$knowledge_root"
chown -R 65532:65532 -- "$knowledge_root"
find "$knowledge_root" -type d -exec chmod 0750 {} +
find "$knowledge_root" -type f -exec chmod 0640 {} +

# The Frank env receives only the dedicated projection token and endpoint.
projection_token="$(awk -F= '$1 == "FRANK_KNOWLEDGE_PROJECTION_TOKEN" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
tmp_frank="$(mktemp "$(dirname -- "$frank_secret_file")/.window.XXXXXX")"
awk -F= '$1 != "FRANK_KNOWLEDGE_PROJECTION_TOKEN" && $1 != "FRANK_KNOWLEDGE_PROJECTION_URL" && $1 != "FRANK_KNOWLEDGE_ALLOWED_PROJECTS" {print}' "$frank_secret_file" >"$tmp_frank"
allowed_projects="$(awk -F= '$1 == "FRANK_KNOWLEDGE_ALLOWED_PROJECTS" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
printf 'FRANK_KNOWLEDGE_PROJECTION_TOKEN=%s\nFRANK_KNOWLEDGE_PROJECTION_URL=http://frank-knowledge-projection:8092/v2/knowledge/projection\nFRANK_KNOWLEDGE_ALLOWED_PROJECTS=%s\n' "$projection_token" "$allowed_projects" >>"$tmp_frank"
chown --reference="$frank_secret_file" "$tmp_frank"; chmod 0600 "$tmp_frank"; mv -- "$tmp_frank" "$frank_secret_file"

# The knowledge deploy is intentionally ordered after the committed Window
# deploy. Refuse to create a new Window here; this lane may only recreate the
# already deployed Frank container so the env-file change takes effect.
frank_compose="$repo_root/apps/window/docker-compose.yml"
[[ -f "$frank_compose" ]] || die "Frank compose file is unavailable"
frank_container="$(docker ps -aq --filter name='^/frank-window$' | head -n 1)"
[[ -n "$frank_container" ]] || die "Frank Window is not deployed; run apps/window/deploy.sh for this committed revision first"

docker compose --project-name "$compose_project" --env-file "$hermes_secret_file" -f "$script_dir/compose.yml" config >/dev/null || die "knowledge compose config failed"
docker compose --project-name "$compose_project" --env-file "$hermes_secret_file" -f "$script_dir/compose.yml" up -d --build

# Wait for the compose services before restarting Hermes. This is only a
# readiness gate; the contract and cross-network checks remain in check.sh.
for _ in $(seq 1 60); do
  ready=1
  for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do
    container="$(docker compose --project-name "$compose_project" --env-file "$hermes_secret_file" -f "$script_dir/compose.yml" ps -q "$service" 2>/dev/null || true)"
    health="$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null || true)"
    [[ "$health" == "healthy" ]] || ready=0
  done
  [[ "$ready" == "1" ]] && break
  sleep 2
done
for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do
  container="$(docker compose --project-name "$compose_project" --env-file "$hermes_secret_file" -f "$script_dir/compose.yml" ps -q "$service" 2>/dev/null || true)"
  [[ "$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null || true)" == "healthy" ]] || die "knowledge service is not healthy: $service"
done

# Now refresh only the already deployed Window so it receives the projection
# endpoint and allow-list. This does not create another Frank service or store.
docker compose --project-name frank -f "$frank_compose" up -d --no-build frank-window || die "Frank window restart failed"
for _ in $(seq 1 30); do
  frank_health="$(docker inspect frank-window --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  [[ "$frank_health" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect frank-window --format '{{.State.Health.Status}}' 2>/dev/null || true)" == "healthy" ]] || die "Frank window did not become healthy after projection env update"

# Install into Hermes' existing default profile only.  Back up config before
# the Hermes plugin command is allowed to update its provider selection.
plugin_dir="$hermes_home/plugins/frank-graphiti-memory"
install -d -o "$hermes_user" -g "$hermes_group" -m 0755 -- "$plugin_dir"
install -o "$hermes_user" -g "$hermes_group" -m 0644 -- "$script_dir/hermes_plugin/plugin.yaml" "$plugin_dir/plugin.yaml"
install -o "$hermes_user" -g "$hermes_group" -m 0644 -- "$script_dir/hermes_plugin/__init__.py" "$plugin_dir/__init__.py"
backup="$hermes_home/config.yaml.knowledge.$(date -u +%Y%m%dT%H%M%SZ)-$$.bak"
cp -a -- "$hermes_home/config.yaml" "$backup"
chown --reference="$hermes_home/config.yaml" "$backup"

# Select the provider in the one existing default profile with Hermes' own
# config command.  A general plugin-enable command only discovers a plugin;
# it does not select memory.provider.
sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" \
  "$hermes_home/hermes-agent/venv/bin/python" -m hermes_cli.main config set memory.provider frank-graphiti-memory >/dev/null \
  || die "Hermes memory.provider selection failed"

# Hermes receives only the provider runtime settings, never the Graphiti or
# Neo4j secrets.  A systemd drop-in is used when the existing service is
# present; no second profile or runtime is created.
namespace="$(awk -F= '$1 == "HERMES_ALLOWED_NAMESPACES" {sub(/^[^=]*=/, ""); split($0, values, ","); print values[1]; exit}' "$hermes_secret_file")"
provider_token="$(awk -F= '$1 == "HERMES_GRAPHITI_PROVIDER_TOKEN" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
umask 077
tmp_runtime="$(mktemp "$(dirname -- "$hermes_runtime_env")/.graphiti-runtime.XXXXXX")"
printf 'HERMES_GRAPHITI_PROVIDER_URL=http://127.0.0.1:8091\nHERMES_GRAPHITI_PROVIDER_TOKEN=%s\nHERMES_GRAPHITI_NAMESPACE=%s\nHERMES_GRAPHITI_ALLOWED_HOSTS=127.0.0.1,localhost\n' "$provider_token" "$namespace" >"$tmp_runtime"
chown "$hermes_user:$hermes_group" "$tmp_runtime"; chmod 0600 "$tmp_runtime"; mv -- "$tmp_runtime" "$hermes_runtime_env"
units="hermes-gateway.service hermes-serve.service"
for unit in $units; do
  dropin="/etc/systemd/system/"$unit".d/graphiti-memory.conf"
  install -d -m 0755 -- "$(dirname -- "$dropin")"
  printf '[Service]\nEnvironmentFile=%s\n' "$hermes_runtime_env" >"$dropin"
done
systemctl daemon-reload
systemctl restart hermes-gateway.service hermes-serve.service \
  || die "Hermes restart failed; provider config backup is $backup; rerun apps/window/infra/knowledge/deploy.sh after fixing the units"
systemctl is-active --quiet hermes-gateway.service || die "Hermes gateway is not active after restart; provider config backup is $backup"
systemctl is-active --quiet hermes-serve.service || die "Hermes serve is not active after restart; provider config backup is $backup"
"$script_dir/check.sh"
echo "Hermes default profile knowledge provider configured; config backup: $backup"

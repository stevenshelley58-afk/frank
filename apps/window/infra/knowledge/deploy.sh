#!/usr/bin/env bash
set -euo pipefail
IFS=$' \t\n'
umask 077

# All paths and the one supported namespace are release-owned constants. The
# root helper invokes this file with a scrubbed environment; direct calls are
# still held to the same fixed contract.
readonly SCRIPT_DIR=/projects/frank/apps/window/infra/knowledge
readonly REPO_ROOT=/projects/frank
readonly HERMES_HOME=/home/hermes/.hermes
readonly HERMES_USER=hermes
readonly HERMES_GROUP=hermes
readonly HERMES_SECRET_FILE=/srv/hermes/secrets/knowledge.env
readonly HERMES_RUNTIME_ENV=/srv/hermes/secrets/graphiti-runtime.env
readonly FRANK_SECRET_FILE=/srv/frank/secrets/window.env
readonly KNOWLEDGE_ROOT=/srv/frank/knowledge
readonly COMPOSE_PROJECT=frank-knowledge
readonly APPROVED_SHA=/var/lib/frank/release/approved-sha
readonly LOCK_FILE=/run/lock/frank-knowledge-deploy.lock
readonly FIXED_PROJECT=project/frank
readonly PROJECTION_URL=http://frank-knowledge-projection:8092/v2/knowledge/projection

die() { echo "knowledge deploy: $*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || die "run as root"
[[ $# -eq 0 ]] || die "arguments are not accepted"
[[ "$(realpath -e -- "$REPO_ROOT")" == "$REPO_ROOT" ]] || die "canonical Frank checkout is unavailable"
[[ "$(realpath -e -- "$SCRIPT_DIR")" == "$SCRIPT_DIR" ]] || die "canonical knowledge bundle is unavailable"
[[ -f "$SCRIPT_DIR/compose.yml" && -f "$SCRIPT_DIR/hermes_plugin/plugin.yaml" ]] || die "deployment bundle is incomplete"
[[ -f "$SCRIPT_DIR/secret_env.py" && -f "$SCRIPT_DIR/check.sh" ]] || die "fixed acceptance artifacts are incomplete"
command -v flock >/dev/null 2>&1 || die "flock is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required"
command -v docker >/dev/null 2>&1 || die "docker is required"
command -v systemctl >/dev/null 2>&1 || die "systemctl is required"
command -v sudo >/dev/null 2>&1 || die "sudo is required"
command -v openssl >/dev/null 2>&1 || die "openssl is required"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another knowledge activation is already running"

[[ -f "$APPROVED_SHA" && ! -L "$APPROVED_SHA" ]] || die "approved Frank release receipt is unavailable"
[[ "$(stat -c '%u:%g:%a' -- "$APPROVED_SHA")" == "0:0:644" ]] || die "approved release receipt ownership or mode is invalid"
release_sha="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null)" || die "Frank revision is unavailable"
approved_sha="$(tr -d '\n' <"$APPROVED_SHA")"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ && "$approved_sha" == "$release_sha" ]] || die "Frank revision is not approved for knowledge activation"
[[ -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all)" ]] || die "Frank checkout has uncommitted changes"

for unit in hermes-gateway.service hermes-serve.service; do
  systemctl cat "$unit" >/dev/null 2>&1 || die "required Hermes unit is unavailable: $unit"
done
[[ -f "$HERMES_HOME/config.yaml" && ! -L "$HERMES_HOME/config.yaml" ]] || die "Hermes default profile config is unavailable"
[[ -x "$HERMES_HOME/hermes-agent/venv/bin/python" ]] || die "Hermes default profile runtime is unavailable"
[[ -f "$FRANK_SECRET_FILE" && ! -L "$FRANK_SECRET_FILE" ]] || die "Frank secret file is unavailable"
[[ -d /srv/hermes/secrets && -d /srv/frank/secrets ]] || die "fixed secret directories are unavailable"

python3 "$SCRIPT_DIR/secret_env.py" "$HERMES_SECRET_FILE" knowledge --allow-missing >/dev/null
python3 "$SCRIPT_DIR/secret_env.py" "$FRANK_SECRET_FILE" frank >/dev/null

transaction="$(mktemp -d /var/lib/frank/.knowledge-activation.XXXXXX)"
chmod 0700 "$transaction"
backup="$transaction/backup"
stage="$transaction/stage"
mkdir -m 0700 "$backup" "$stage"
# The transaction contains the same timestamped config backup naming used by
# the release runbook (config.yaml.knowledge.<timestamp>), without exposing it
# to callers or allowing a caller to select a destination.
config_backup_name="config.yaml.knowledge.$(date -u +%Y%m%dT%H%M%SZ)"
committed=0
frank_restarted=0
hermes_restarted=0

restore_path() {
  local target="$1" saved="$2"
  if [[ -f "$saved" ]]; then
    cp -a -- "$saved" "${target}.rollback"
    mv -f -- "${target}.rollback" "$target"
  else
    rm -f -- "$target"
  fi
}

rollback() {
  local status=$?
  [[ "$committed" == 1 ]] && return "$status"
  set +e
  systemctl daemon-reload >/dev/null 2>&1
  restore_path "$HERMES_SECRET_FILE" "$backup/hermes-secret"
  restore_path "$FRANK_SECRET_FILE" "$backup/frank-secret"
  restore_path "$HERMES_RUNTIME_ENV" "$backup/runtime-env"
  restore_path "$HERMES_HOME/config.yaml" "$backup/$config_backup_name"
  for unit in hermes-gateway.service hermes-serve.service; do
    dropin="/etc/systemd/system/$unit.d/graphiti-memory.conf"
    restore_path "$dropin" "$backup/$(basename "$unit")-dropin"
  done
  if [[ -d "$backup/plugin" ]]; then
    rm -rf -- "$HERMES_HOME/plugins/frank-graphiti-memory"
    cp -a -- "$backup/plugin" "$HERMES_HOME/plugins/frank-graphiti-memory"
  else
    rm -rf -- "$HERMES_HOME/plugins/frank-graphiti-memory"
  fi
  if [[ "$hermes_restarted" == 1 ]]; then
    systemctl restart hermes-gateway.service hermes-serve.service >/dev/null 2>&1
  fi
  if [[ "$frank_restarted" == 1 ]]; then
    docker compose --project-name frank -f "$REPO_ROOT/apps/window/docker-compose.yml" up -d --no-build frank-window >/dev/null 2>&1
  fi
  rm -rf -- "$transaction"
  return "$status"
}
trap rollback EXIT INT TERM

for pair in \
  "$HERMES_SECRET_FILE hermes-secret" \
  "$FRANK_SECRET_FILE frank-secret" \
  "$HERMES_RUNTIME_ENV runtime-env" \
  "$HERMES_HOME/config.yaml config"; do
  target="${pair% *}"; name="${pair##* }"
  if [[ "$target" == "$HERMES_HOME/config.yaml" ]]; then name="$config_backup_name"; fi
  [[ ! -L "$target" ]] || die "activation target is a symlink: $target"
  [[ -f "$target" ]] && cp -a -- "$target" "$backup/$name"
done
for unit in hermes-gateway.service hermes-serve.service; do
  dropin="/etc/systemd/system/$unit.d/graphiti-memory.conf"
  [[ ! -L "$dropin" ]] || die "Hermes drop-in is a symlink"
  [[ -f "$dropin" ]] && cp -a -- "$dropin" "$backup/$(basename "$unit")-dropin"
done
if [[ -d "$HERMES_HOME/plugins/frank-graphiti-memory" ]]; then
  cp -a -- "$HERMES_HOME/plugins/frank-graphiti-memory" "$backup/plugin"
fi

hermes_stage="$stage/knowledge.env"
if [[ -f "$HERMES_SECRET_FILE" ]]; then cp -a -- "$HERMES_SECRET_FILE" "$hermes_stage"; else install -o root -g root -m 0600 /dev/null "$hermes_stage"; fi
ensure_secret() {
  local key="$1" value
  value="$(awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$hermes_stage")"
  if [[ -z "$value" ]]; then
    value="$(openssl rand -hex 32)"
    printf '%s=%s\n' "$key" "$value" >>"$hermes_stage"
  fi
}
ensure_secret HERMES_GRAPHITI_PROVIDER_TOKEN
ensure_secret FRANK_KNOWLEDGE_PROJECTION_TOKEN
ensure_secret NEO4J_PASSWORD
chown root:root "$hermes_stage"; chmod 0600 "$hermes_stage"
python3 "$SCRIPT_DIR/secret_env.py" "$hermes_stage" knowledge >/dev/null

read_key() { awk -F= -v wanted="$1" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$hermes_stage"; }
namespace="$(read_key HERMES_ALLOWED_NAMESPACES)"
projects="$(read_key FRANK_KNOWLEDGE_ALLOWED_PROJECTS)"
[[ "$namespace" == "$FIXED_PROJECT" ]] || die "HERMES_ALLOWED_NAMESPACES must be exactly project/frank"
[[ "$projects" == "$FIXED_PROJECT" ]] || die "FRANK_KNOWLEDGE_ALLOWED_PROJECTS must be exactly project/frank"
for key in OPENAI_API_KEY NEO4J_PASSWORD; do [[ -n "$(read_key "$key")" ]] || die "missing $key"; done
[[ "$(read_key NEO4J_IMAGE)" =~ @sha256:[0-9a-f]{64}$ ]] || die "NEO4J_IMAGE must be pinned to an immutable digest"

install -d -o 65532 -g 65532 -m 0750 -- "$KNOWLEDGE_ROOT"
chown -R 65532:65532 -- "$KNOWLEDGE_ROOT"
find "$KNOWLEDGE_ROOT" -type d -exec chmod 0750 {} +
find "$KNOWLEDGE_ROOT" -type f -exec chmod 0640 {} +

frank_stage="$stage/window.env"
awk -F= '$1 !~ /^FRANK_KNOWLEDGE_(PROJECTION_TOKEN|PROJECTION_URL|ALLOWED_PROJECTS)$/ {print}' "$FRANK_SECRET_FILE" >"$frank_stage"
printf 'FRANK_KNOWLEDGE_PROJECTION_TOKEN=%s\nFRANK_KNOWLEDGE_PROJECTION_URL=%s\nFRANK_KNOWLEDGE_ALLOWED_PROJECTS=%s\n' "$(read_key FRANK_KNOWLEDGE_PROJECTION_TOKEN)" "$PROJECTION_URL" "$FIXED_PROJECT" >>"$frank_stage"
chown root:root "$frank_stage"; chmod 0600 "$frank_stage"
python3 "$SCRIPT_DIR/secret_env.py" "$frank_stage" frank >/dev/null

docker compose --project-name "$COMPOSE_PROJECT" --env-file "$hermes_stage" -f "$SCRIPT_DIR/compose.yml" config >/dev/null || die "knowledge compose config failed"
docker compose --project-name "$COMPOSE_PROJECT" --env-file "$hermes_stage" -f "$SCRIPT_DIR/compose.yml" up -d --build
for _ in $(seq 1 60); do
  ready=1
  for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do
    container="$(docker compose --project-name "$COMPOSE_PROJECT" --env-file "$hermes_stage" -f "$SCRIPT_DIR/compose.yml" ps -q "$service" 2>/dev/null || true)"
    [[ "$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null || true)" == healthy ]] || ready=0
  done
  [[ "$ready" == 1 ]] && break
  sleep 2
done
for service in hermes-graphiti-provider frank-knowledge-projection neo4j; do
  container="$(docker compose --project-name "$COMPOSE_PROJECT" --env-file "$hermes_stage" -f "$SCRIPT_DIR/compose.yml" ps -q "$service" 2>/dev/null || true)"
  [[ "$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null || true)" == healthy ]] || die "knowledge service is not healthy: $service"
done

install -o root -g root -m 0600 -- "$hermes_stage" "$HERMES_SECRET_FILE"
install -o root -g root -m 0600 -- "$frank_stage" "$FRANK_SECRET_FILE"
docker compose --project-name frank -f "$REPO_ROOT/apps/window/docker-compose.yml" up -d --no-build frank-window || die "Frank window restart failed"
frank_restarted=1
for _ in $(seq 1 30); do
  [[ "$(docker inspect frank-window --format '{{.State.Health.Status}}' 2>/dev/null || true)" == healthy ]] && break
  sleep 2
done
[[ "$(docker inspect frank-window --format '{{.State.Health.Status}}' 2>/dev/null || true)" == healthy ]] || die "Frank window did not become healthy"

plugin_dir="$HERMES_HOME/plugins/frank-graphiti-memory"
install -d -o "$HERMES_USER" -g "$HERMES_GROUP" -m 0755 -- "$plugin_dir"
install -o "$HERMES_USER" -g "$HERMES_GROUP" -m 0644 -- "$SCRIPT_DIR/hermes_plugin/plugin.yaml" "$plugin_dir/plugin.yaml"
install -o "$HERMES_USER" -g "$HERMES_GROUP" -m 0644 -- "$SCRIPT_DIR/hermes_plugin/__init__.py" "$plugin_dir/__init__.py"
hermes_restarted=1
sudo -u "$HERMES_USER" -H env HERMES_HOME="$HERMES_HOME" "$HERMES_HOME/hermes-agent/venv/bin/python" -m hermes_cli.main config set memory.provider frank-graphiti-memory >/dev/null || die "Hermes memory.provider selection failed"

provider_token="$(read_key HERMES_GRAPHITI_PROVIDER_TOKEN)"
runtime_stage="$stage/graphiti-runtime.env"
printf 'HERMES_GRAPHITI_PROVIDER_URL=http://127.0.0.1:8091\nHERMES_GRAPHITI_PROVIDER_TOKEN=%s\nHERMES_GRAPHITI_NAMESPACE=%s\nHERMES_GRAPHITI_ALLOWED_HOSTS=127.0.0.1,localhost\n' "$provider_token" "$FIXED_PROJECT" >"$runtime_stage"
chown "$HERMES_USER:$HERMES_GROUP" "$runtime_stage"; chmod 0600 "$runtime_stage"
install -d -m 0755 -- /etc/systemd/system/hermes-gateway.service.d /etc/systemd/system/hermes-serve.service.d
printf '[Service]\nEnvironmentFile=%s\n' "$HERMES_RUNTIME_ENV" >"$stage/gateway-dropin"
printf '[Service]\nEnvironmentFile=%s\n' "$HERMES_RUNTIME_ENV" >"$stage/serve-dropin"
install -o root -g root -m 0644 -- "$stage/gateway-dropin" /etc/systemd/system/hermes-gateway.service.d/graphiti-memory.conf
install -o root -g root -m 0644 -- "$stage/serve-dropin" /etc/systemd/system/hermes-serve.service.d/graphiti-memory.conf
install -o "$HERMES_USER" -g "$HERMES_GROUP" -m 0600 -- "$runtime_stage" "$HERMES_RUNTIME_ENV"
systemctl daemon-reload
systemctl restart hermes-gateway.service hermes-serve.service || die "Hermes restart failed"
systemctl is-active --quiet hermes-gateway.service || die "Hermes gateway is not active"
systemctl is-active --quiet hermes-serve.service || die "Hermes serve is not active"

"$SCRIPT_DIR/check.sh"
committed=1
rm -rf -- "$transaction"
trap - EXIT INT TERM
echo "knowledge activation accepted for $FIXED_PROJECT at $release_sha"

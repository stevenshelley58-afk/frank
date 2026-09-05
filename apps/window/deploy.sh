#!/usr/bin/env bash
set -euo pipefail

repo="${FRANK_REPO:-/projects/frank}"
app="$repo/apps/window"
# Shared, individually testable deployment checks.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/deploy_lib.sh"

# Exclusive host deployment lock: concurrent deployments must fail
# immediately, before any build or container mutation.
frank_acquire_deploy_lock || exit 1

[[ "$(realpath -e -- "$repo")" == "/projects/frank" ]] || {
  echo "refusing non-canonical Frank repository: $repo" >&2
  exit 1
}
git -C "$repo" diff --quiet HEAD -- || {
  echo "refusing to deploy an uncommitted Frank revision" >&2
  exit 1
}

# Self-check mode: run identity and preflight validation only, exit before
# any directory, secret, build, or container mutation.
if [[ "${FRANK_DEPLOY_DRY_RUN:-0}" == "1" ]]; then
  candidate_sha="$(frank_candidate_sha)"
  frank_verify_source_identity "$candidate_sha"
  export FRANK_WINDOW_IMAGE_TAG="$candidate_sha"
  export FRANK_AGENTTRAIL_IMAGE_TAG="$candidate_sha"
  frank_verify_tag_encodes_sha "frank-window:${FRANK_WINDOW_IMAGE_TAG}" "$candidate_sha"
  frank_verify_tag_encodes_sha "frank-agenttrail:${FRANK_AGENTTRAIL_IMAGE_TAG}" "$candidate_sha"
  echo "dry-run ok: identity and preflight validation passed for $candidate_sha"
  exit 0
fi
secret_dir="/srv/frank/secrets"
secret_file="$secret_dir/window.env"
hermes_api_key_file="$secret_dir/hermes-api-key"
caddy_secret_file="$secret_dir/caddy.env"
data_dir="/srv/frank/data/window"
template_release_dir="$data_dir/releases/ad-template-generator"
control_graph_dir="$data_dir/control-graph"
release_dir="/var/lib/frank/release"
flags_file="$release_dir/feature-flags.env"
preview_dir="/srv/frank/previews"
mini_preview_dir="$preview_dir/mini"
mini_workspace_dir="$data_dir/mini-shared/workspaces"
legacy_mini_project_dir="/projects/mini-frank/customer-projects"

[[ "$(realpath -e -- "$repo")" == "/projects/frank" ]] || {
  echo "refusing non-canonical Frank repository: $repo" >&2
  exit 1
}
git -C "$repo" diff --quiet HEAD -- || {
  echo "refusing to deploy an uncommitted Frank revision" >&2
  exit 1
}

install -d -m 0700 -- "$secret_dir"
# Frank writes short-lived upload staging here and Hermes ingests it directly
# on the host. Keep the directory private to root + the existing Hermes group;
# setgid preserves that boundary for newly-created staging directories.
install -d -o root -g hermes -m 2750 -- "$data_dir"
install -d -o hermes -g hermes -m 2755 -- "$template_release_dir"
install -d -o root -g hermes -m 0750 -- "$control_graph_dir"
install -d -m 0755 -- "$preview_dir"
install -d -o root -g root -m 0755 -- "$release_dir"
install -d -o root -g root -m 0750 -- /srv/frank/backups/control-plane
if [[ -e "$flags_file" || -L "$flags_file" ]]; then
  [[ -f "$flags_file" && ! -L "$flags_file" ]] || { echo "invalid feature flag file" >&2; exit 1; }
  [[ "$(stat -c '%a' -- "$flags_file")" == "600" ]] || { echo "feature flag file must be mode 0600" >&2; exit 1; }
else
  flags_tmp="$(mktemp "$release_dir/.feature-flags.XXXXXX")"
  for flag in live_view map_view control_read reconciliation_schedules runtime_monitoring safe_actions operational_actions source_actions cleanup_jobs discovery_jobs evaluation_jobs chat_pattern_candidates retention_restore_drills; do
    printf 'FRANK_FEATURE_FLAG_%s=0\n' "${flag^^}" >> "$flags_tmp"
  done
  chmod 0600 "$flags_tmp"; chown root:root "$flags_tmp"; mv -f -- "$flags_tmp" "$flags_file"
fi
while IFS='=' read -r key value; do
  [[ "$key" =~ ^FRANK_FEATURE_FLAG_(LIVE_VIEW|MAP_VIEW|CONTROL_READ|RECONCILIATION_SCHEDULES|RUNTIME_MONITORING|SAFE_ACTIONS|OPERATIONAL_ACTIONS|SOURCE_ACTIONS|CLEANUP_JOBS|DISCOVERY_JOBS|EVALUATION_JOBS|CHAT_PATTERN_CANDIDATES|RETENTION_RESTORE_DRILLS)$ && "$value" =~ ^[01]$ ]] || { echo "invalid feature flag entry" >&2; exit 1; }
done < "$flags_file"
# Hermes provisions new project workspaces before their first turn. Keep the
# canonical parent root-owned while granting the sole agent runtime a setgid
# directory in which it can create isolated /projects/<slug> children.
id hermes >/dev/null 2>&1 || {
  echo "Hermes user is required for project workspace provisioning" >&2
  exit 1
}
# Hermes/provider workers stage customer-ops snapshots outside the Frank
# runtime. Window consumes them through the dedicated read-only compose mount.
install -d -o root -g root -m 0755 -- "$mini_preview_dir"
install -d -o root -g hermes -m 2750 -- "$data_dir/mini-shared" "$mini_workspace_dir"
install -d -o root -g hermes -m 2775 -- /projects
# This is the retired Mini's exact per-customer root. Window receives only this
# narrow path writable so migrated retention deadlines can erase old private
# source/result data; the rest of /projects remains read-only in Window.
install -d -o hermes -g hermes -m 0750 -- "$legacy_mini_project_dir"

# Expose the native loopback Hindsight API only to Frank's existing private
# Docker network. This is a socket proxy, not another memory service or store.
bash "$app/infra/memory/expose.sh"

if [[ -e "$secret_file" || -L "$secret_file" ]]; then
  [[ -f "$secret_file" && ! -L "$secret_file" ]] || {
    echo "refusing non-regular Frank secret file: $secret_file" >&2
    exit 1
  }
  [[ "$(stat -c '%a' -- "$secret_file")" == "600" ]] || {
    echo "Frank secret file must be mode 0600: $secret_file" >&2
    exit 1
  }
fi

if [[ ! -f "$secret_file" ]]; then
  tmp="$(mktemp "$secret_dir/.window.env.XXXXXX")"
  trap 'rm -f -- "$tmp"' EXIT
  for key in HERMES_API_KEY FRANK_BASIC_AUTH_USER FRANK_BASIC_AUTH_HASH; do
    value=""
    for source in /frank/window/.env /frank/deployed/infra/.env; do
      [[ -f "$source" ]] || continue
      value="$(grep -m1 -E "^${key}=" "$source" || true)"
      [[ -n "$value" ]] && break
    done
    [[ -n "$value" ]] || {
      echo "missing required $key in the existing Frank secret sources" >&2
      exit 1
    }
    printf '%s\n' "$value" >> "$tmp"
  done
  # Private Hermes extensions are optional until their separately deployed
  # routes exist. Preserve exact values when an existing source has them, but
  # never invent a key or broker URL merely to make a release pass.
  for key in HERMES_CONNECTIONS_AGENT_KEY HERMES_VAULT_BROKER_KEY HERMES_VAULT_BROKER_URL MINI_TIP_PROVIDER_URL; do
    for source in /frank/window/.env /frank/deployed/infra/.env; do
      [[ -f "$source" ]] || continue
      value="$(grep -m1 -E "^${key}=" "$source" || true)"
      if [[ -n "$value" ]]; then
        printf '%s\n' "$value" >> "$tmp"
        break
      fi
    done
  done
  mini_rate_limit_key="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  printf 'MINI_RATE_LIMIT_KEY=%s\n' "$mini_rate_limit_key" >> "$tmp"
  unset mini_rate_limit_key
  chmod 0600 "$tmp"
  mv -f -- "$tmp" "$secret_file"
  trap - EXIT
fi

# Older installations predate the public Mini Frank boundary. Add its private
# rate-limit key once, atomically, while preserving every existing secret.
if ! grep -q -E '^MINI_RATE_LIMIT_KEY=[^[:space:]]' "$secret_file"; then
  tmp="$(mktemp "$secret_dir/.window.env.XXXXXX")"
  trap 'rm -f -- "$tmp"' EXIT
  cp -- "$secret_file" "$tmp"
  mini_rate_limit_key="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  printf 'MINI_RATE_LIMIT_KEY=%s\n' "$mini_rate_limit_key" >> "$tmp"
  unset mini_rate_limit_key
  chmod 0600 "$tmp"
  mv -f -- "$tmp" "$secret_file"
  trap - EXIT
fi

mini_rate_limit_key="$(grep -E '^MINI_RATE_LIMIT_KEY=' "$secret_file" | tail -n 1 | cut -d= -f2- || true)"
[[ "$mini_rate_limit_key" =~ ^[A-Za-z0-9_-]{43,}$ ]] || {
  echo "MINI_RATE_LIMIT_KEY in $secret_file must be a URL-safe secret of at least 43 characters" >&2
  exit 1
}
unset mini_rate_limit_key

# Validate the core Window boundary before any build or container replacement.
# Private Hermes extensions remain fail-closed when their exact deployment
# contract is absent; placeholders and guessed URLs are never accepted.
for key in HERMES_API_KEY FRANK_BASIC_AUTH_USER FRANK_BASIC_AUTH_HASH; do
  grep -q -E "^${key}=[^[:space:]]" "$secret_file" || {
    echo "missing required $key in $secret_file" >&2
    exit 1
  }
done

# The dispatcher reads Hermes credentials through a dedicated file inside the
# Window container. Derive it atomically from the existing root-only secret
# source; never print or pass the credential as a command argument.
if [[ -e "$hermes_api_key_file" || -L "$hermes_api_key_file" ]]; then
  [[ -f "$hermes_api_key_file" && ! -L "$hermes_api_key_file" ]] || { echo "refusing non-regular Hermes API key file" >&2; exit 1; }
  [[ "$(stat -c '%a' -- "$hermes_api_key_file")" == "600" ]] || { echo "Hermes API key file must be mode 0600" >&2; exit 1; }
else
  hermes_api_key="$(grep -m1 -E '^HERMES_API_KEY=' "$secret_file" | cut -d= -f2- || true)"
  [[ -n "$hermes_api_key" ]] || { echo "missing Hermes API key for dedicated credential file" >&2; exit 1; }
  hermes_tmp="$(mktemp "$secret_dir/.hermes-api-key.XXXXXX")"
  printf '%s\n' "$hermes_api_key" > "$hermes_tmp"
  unset hermes_api_key
  chmod 0600 "$hermes_tmp"
  mv -f -- "$hermes_tmp" "$hermes_api_key_file"
fi

if ! grep -q -E '^HERMES_CONNECTIONS_AGENT_KEY=[^[:space:]]' "$secret_file"; then
  echo "Connections Agent ingress is not configured; authenticated agent routes remain disabled." >&2
fi
if ! grep -q -E '^HERMES_VAULT_BROKER_KEY=[^[:space:]]' "$secret_file" \
  || ! grep -q -E '^HERMES_VAULT_BROKER_URL=[^[:space:]]' "$secret_file"; then
  echo "Hermes vault broker is not configured; vault/provider status remains setup_needed." >&2
fi
if ! grep -q -E '^MINI_TIP_PROVIDER_URL=https://[^[:space:]]+' "$secret_file"; then
  echo "Mini Frank tip provider is not configured; the explicit tip CTA remains honestly unavailable." >&2
fi

# Caddy receives only the values required by its basic-auth directives: the
# operator pair and the dedicated browser-acceptance harness pair. The harness
# credentials are provisioned once, atomically, without ever disturbing the
# operator's password; their plaintext lives only in /secure (mode 0600) and is
# never printed, logged, or committed.
if ! grep -q -E '^FRANK_ACCEPTANCE_AUTH_USER=[^[:space:]]' "$secret_file" \
  || ! grep -q -E '^FRANK_ACCEPTANCE_AUTH_HASH=' "$secret_file"; then
  acceptance_tmp="$(mktemp "$secret_dir/.window.env.XXXXXX")"
  trap 'rm -f -- "$acceptance_tmp"' EXIT
  cp -- "$secret_file" "$acceptance_tmp"
  grep -q -E '^FRANK_ACCEPTANCE_AUTH_USER=' "$acceptance_tmp" \
    || printf 'FRANK_ACCEPTANCE_AUTH_USER=frank-acceptance\n' >> "$acceptance_tmp"
  if ! grep -q -E '^FRANK_ACCEPTANCE_AUTH_HASH=' "$acceptance_tmp"; then
    acceptance_password="$(python3 -c 'import secrets; print(secrets.token_urlsafe(36))')"
    acceptance_hash="$(docker run --rm caddy:2.8-alpine caddy hash-password --plaintext "$acceptance_password" | sed 's/\$/\$\$/g')"
    printf 'FRANK_ACCEPTANCE_AUTH_HASH=%s\n' "$acceptance_hash" >> "$acceptance_tmp"
    install -d -o root -g root -m 0700 -- /secure
    secure_tmp="$(mktemp /secure/.frank-acceptance.env.XXXXXX)"
    { printf 'FRANK_BROWSER_BASIC_AUTH_USER=frank-acceptance\n'
      printf 'FRANK_BROWSER_BASIC_AUTH_PASSWORD=%s\n' "$acceptance_password"; } > "$secure_tmp"
    chmod 0600 "$secure_tmp"; mv -f -- "$secure_tmp" /secure/frank-acceptance.env
    unset acceptance_password
  fi
  chmod 0600 "$acceptance_tmp"; mv -f -- "$acceptance_tmp" "$secret_file"
  trap - EXIT
fi

caddy_tmp="$(mktemp "$secret_dir/.caddy.env.XXXXXX")"
trap 'rm -f -- "$caddy_tmp"' EXIT
grep -E '^(FRANK_BASIC_AUTH_USER|FRANK_BASIC_AUTH_HASH|FRANK_ACCEPTANCE_AUTH_USER|FRANK_ACCEPTANCE_AUTH_HASH)=' "$secret_file" > "$caddy_tmp" || {
  echo "missing Caddy basic-auth settings in $secret_file" >&2
  exit 1
}
chmod 0600 "$caddy_tmp"
mv -f -- "$caddy_tmp" "$caddy_secret_file"
trap - EXIT

if [[ -d /frank/window/data ]]; then
  cp -a -n -- /frank/window/data/. "$data_dir/"
fi
if [[ -d /frank/deployed/static/preview ]]; then
  cp -a -n -- /frank/deployed/static/preview/. "$preview_dir/"
fi

migrate_volume() {
  local old="$1" new="$2"
  docker volume create "$new" >/dev/null
  if docker volume inspect "$old" >/dev/null 2>&1; then
    docker run --rm -v "$old:/from:ro" -v "$new:/to" alpine:3.20 \
      sh -c 'test -n "$(ls -A /to 2>/dev/null)" || cp -a /from/. /to/'
  fi
}
migrate_volume frank_frank_caddy_data frank_caddy_data
migrate_volume frank_frank_caddy_config frank_caddy_config

cd "$app"
bash "$app/infra/control_plane/install.sh" --preserve-active-release
# Public Mini builds are deliberately networkless at runtime. Bake their
# document, spreadsheet, PDF, image, and headless-browser tools ahead of time.
docker build \
  --tag frank-mini-builder:mini-v1 \
  --file "$app/infra/mini_builder/Dockerfile" \
  "$app/infra/mini_builder"

# Immutable deployment identity: both images are tagged with the exact
# full source SHA. The compose file resolves these through the environment
# and can never name the mutable :current tag as a deployment identity.
candidate_sha="$(frank_candidate_sha)"
export SOURCE_SHA="$candidate_sha"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export FRANK_WINDOW_IMAGE_TAG="$candidate_sha"
export FRANK_AGENTTRAIL_IMAGE_TAG="$candidate_sha"
docker compose build \
  --build-arg SOURCE_SHA="$candidate_sha" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  frank-window frank-agenttrail

# Validate everything about the freshly built, immutably tagged images
# before any container is replaced.
frank_verify_source_identity "$candidate_sha"
frank_verify_image_exists "frank-window:$candidate_sha"
frank_verify_image_exists "frank-agenttrail:$candidate_sha"
frank_verify_image_label "frank-window:$candidate_sha" "$candidate_sha"
frank_verify_image_label "frank-agenttrail:$candidate_sha" "$candidate_sha"
window_digests="$(frank_image_digests "frank-window:$candidate_sha")"
agenttrail_digests="$(frank_image_digests "frank-agenttrail:$candidate_sha")"
frank_verify_compose_images "$candidate_sha"
docker compose config --quiet
docker run --rm \
  --env-file "$caddy_secret_file" \
  --volume "$app/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.8-alpine caddy validate --config /etc/caddy/Caddyfile
frank_verify_image_critical_manifest "frank-window:$candidate_sha"

# Workspace estate mounts: regenerate the read-only Compose override from the
# workspace registry and validate the merged compose config BEFORE any
# container is replaced. A failed generation aborts here with the running
# containers untouched.
workspaces_override="${FRANK_WORKSPACES_OVERRIDE:-/srv/frank/compose/workspaces-override.yml}"
python3 "$app/scripts/generate_workspace_override.py" --output "$workspaces_override"
docker compose -f docker-compose.yml -f "$workspaces_override" config --quiet

# Record the previously approved revision and running image identities so a
# failed cutover can restore them; the previous images are immutable-tagged
# and are never retagged or deleted.
frank_record_rollback_receipt "$release_dir" "$repo"

# Only after all validation: refresh the convenience pointer tag (never the
# deployment identity) and cut over.
docker tag "frank-window:$candidate_sha" frank-window:current
docker tag "frank-agenttrail:$candidate_sha" frank-agenttrail:current

# The previous Window and Caddy were created by two retired compose projects.
# Build first, then make the shortest possible atomic cutover to this one stack.
docker rm -f frank-window-sessions-candidate >/dev/null 2>&1 || true
docker rm -f frank-agenttrail >/dev/null 2>&1 || true
docker rm -f frank-window frank-caddy frank-frank-caddy-1 >/dev/null 2>&1 || true

if ! docker compose -f docker-compose.yml -f "$workspaces_override" up -d --remove-orphans; then
  echo "new Frank stack failed to start; restoring the previous runtime" >&2
  # Rollback only re-creates the previous stack from its recorded receipt;
  # it never modifies the approved-sha file.
  frank_restore_previous_runtime "$release_dir" \
    "/frank/window/docker-compose.yml:frank-window" \
    "/frank/deployed/infra/docker-compose.dev.yml:frank-caddy"
  exit 1
fi

for _ in $(seq 1 30); do
  status="$(docker inspect frank-window --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect frank-window --format '{{.State.Health.Status}}')" == "healthy" ]] || {
  docker compose logs --tail 100 frank-window >&2
  exit 1
}
for _ in $(seq 1 30); do
  caddy_running="$(docker inspect frank-caddy --format '{{.State.Running}}' 2>/dev/null || true)"
  [[ "$caddy_running" == "true" ]] && break
  sleep 1
done
[[ "$(docker inspect frank-caddy --format '{{.State.Running}}')" == "true" ]] || {
  docker compose logs --tail 100 frank-caddy >&2
  exit 1
}

docker exec frank-window python -c \
  "import connections_agent, home_platform, server, tool_apps; import memory_inspector, mini, mini_frank; assert connections_agent and home_platform and server and tool_apps and memory_inspector and mini and mini_frank"
docker exec frank-window python -c \
  "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=5)); assert data['ok'] is True"

# Prove the public canonical Mini surface reached this Window before recording
# the revision as approved. The main Frank root remains behind Caddy auth.
mini_canary_file="$(mktemp)"
trap 'rm -f -- "$mini_canary_file"' EXIT
curl --fail --silent --show-error \
  --retry 10 --retry-delay 2 --retry-all-errors \
  --output "$mini_canary_file" \
  https://frank.fail/mini-frank/
grep -Fq '<title>Mini Frank' "$mini_canary_file" || {
  echo "Mini Frank canary returned the wrong document" >&2
  exit 1
}
rm -f -- "$mini_canary_file"
trap - EXIT

release_dir=/var/lib/frank/release
install -d -o root -g root -m 0755 -- "$release_dir"
# Approved only now: the new containers are healthy and every in-script
# health, import, API, and Mini-canary check has passed.
frank_write_approved_sha "$candidate_sha" "$release_dir"
frank_verify_approved_sha "$candidate_sha" "$release_dir/approved-sha"
curl --fail --silent --show-error --output /dev/null \
  --retry 10 --retry-delay 2 --retry-all-errors \
  https://frank.fail/frank/
# Publish both fixed-input reconciliation scopes after every healthy release.
# A collector failure has its own immutable failure receipt and must not turn
# an already-promoted, healthy application into an ambiguously failed deploy.
if ! bash "$app/infra/control_plane/post-deploy.sh"; then
  echo "warning: post-deploy control-plane reconciliation failed; the healthy release remains current" >&2
fi
echo "deployed $(git -C "$repo" rev-parse HEAD)"

#!/usr/bin/env bash
set -euo pipefail

repo="${FRANK_REPO:-/projects/frank}"
app="$repo/apps/window"
secret_dir="/srv/frank/secrets"
secret_file="$secret_dir/window.env"
caddy_secret_file="$secret_dir/caddy.env"
data_dir="/srv/frank/data/window"
template_release_dir="$data_dir/releases/ad-template-generator"
preview_dir="/srv/frank/previews"
mini_preview_dir="$preview_dir/mini"

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
install -d -o hermes -g hermes -m 0755 -- "$template_release_dir"
install -d -m 0755 -- "$preview_dir"
# Hermes provisions new project workspaces before their first turn. Keep the
# canonical parent root-owned while granting the sole agent runtime a setgid
# directory in which it can create isolated /projects/<slug> children.
id hermes >/dev/null 2>&1 || {
  echo "Hermes user is required for project workspace provisioning" >&2
  exit 1
}
install -d -o hermes -g hermes -m 0755 -- "$mini_preview_dir"
install -d -o root -g hermes -m 2775 -- /projects

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
  for key in HERMES_CONNECTIONS_AGENT_KEY HERMES_VAULT_BROKER_KEY HERMES_VAULT_BROKER_URL; do
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

if ! grep -q -E '^HERMES_CONNECTIONS_AGENT_KEY=[^[:space:]]' "$secret_file"; then
  echo "Connections Agent ingress is not configured; authenticated agent routes remain disabled." >&2
fi
if ! grep -q -E '^HERMES_VAULT_BROKER_KEY=[^[:space:]]' "$secret_file" \
  || ! grep -q -E '^HERMES_VAULT_BROKER_URL=[^[:space:]]' "$secret_file"; then
  echo "Hermes vault broker is not configured; vault/provider status remains setup_needed." >&2
fi

# Caddy receives only the two values required by its basic-auth directive.
# Rebuild this derived file without ever passing Window or Hermes credentials
# into the public proxy container.
caddy_tmp="$(mktemp "$secret_dir/.caddy.env.XXXXXX")"
trap 'rm -f -- "$caddy_tmp"' EXIT
grep -E '^(FRANK_BASIC_AUTH_USER|FRANK_BASIC_AUTH_HASH)=' "$secret_file" > "$caddy_tmp" || {
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
docker compose build frank-window

# The previous Window and Caddy were created by two retired compose projects.
# Build first, then make the shortest possible atomic cutover to this one stack.
docker rm -f frank-window-sessions-candidate >/dev/null 2>&1 || true
docker rm -f frank-window frank-frank-caddy-1 >/dev/null 2>&1 || true

if ! docker compose up -d --remove-orphans; then
  echo "new Frank stack failed to start; restoring the previous runtime" >&2
  if [[ -f /frank/window/docker-compose.yml ]]; then
    docker compose -f /frank/window/docker-compose.yml up -d frank-window || true
  fi
  if [[ -f /frank/deployed/infra/docker-compose.dev.yml ]]; then
    docker compose -f /frank/deployed/infra/docker-compose.dev.yml up -d frank-caddy || true
  fi
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

docker exec frank-window python -c \
  "import connections_agent, home_platform, server, tool_apps; import memory_inspector, mini_frank; assert connections_agent and home_platform and server and tool_apps and memory_inspector and mini_frank"
docker exec frank-window python -c \
  "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=5)); assert data['ok'] is True"
release_dir=/var/lib/frank/release
install -d -o root -g root -m 0755 -- "$release_dir"
release_tmp="$(mktemp "$release_dir/.approved-sha.XXXXXX")"
printf '%s\n' "$(git -C "$repo" rev-parse HEAD)" >"$release_tmp"
chown root:root "$release_tmp"; chmod 0644 "$release_tmp"; mv -f -- "$release_tmp" "$release_dir/approved-sha"
curl --fail --silent --show-error --output /dev/null \
  --retry 10 --retry-delay 2 --retry-all-errors \
  https://preview.frank.fail/frank-vps-file-explorer-v1/
echo "deployed $(git -C "$repo" rev-parse HEAD)"

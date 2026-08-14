#!/usr/bin/env bash
set -euo pipefail

repo="${FRANK_REPO:-/projects/frank}"
app="$repo/apps/window"
secret_dir="/srv/frank/secrets"
secret_file="$secret_dir/window.env"
data_dir="/srv/frank/data/window"
preview_dir="/srv/frank/previews"

[[ "$(realpath -e -- "$repo")" == "/projects/frank" ]] || {
  echo "refusing non-canonical Frank repository: $repo" >&2
  exit 1
}
git -C "$repo" diff --quiet HEAD -- || {
  echo "refusing to deploy an uncommitted Frank revision" >&2
  exit 1
}

install -d -m 0700 -- "$secret_dir"
install -d -m 0750 -- "$data_dir"
install -d -m 0755 -- "$preview_dir"

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
  chmod 0600 "$tmp"
  mv -f -- "$tmp" "$secret_file"
  trap - EXIT
fi

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
  "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=5)); assert data['ok'] is True"
curl --fail --silent --show-error --output /dev/null \
  --retry 10 --retry-delay 2 --retry-all-errors \
  https://preview.frank.fail/frank-vps-file-explorer-v1/
echo "deployed $(git -C "$repo" rev-parse HEAD)"

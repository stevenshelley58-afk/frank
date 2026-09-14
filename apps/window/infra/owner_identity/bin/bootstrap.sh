#!/usr/bin/env bash
# Run the idempotent authentik provisioner inside the running server container.
#
# It uses `exec`, never `run`: `docker compose run server` would start a second
# authentik server and race the migration lock against the one already running.
# Secrets reach the process through `-e`, so they never appear in an image
# reference, a URL or a log line.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
repo_root=$(cd "$root_dir/../../../.." && pwd)
secret_file=/srv/frank/secrets/owner-identity.env

# Every key the provisioner needs. A missing one is a hard failure: a bootstrap
# that silently skips the owner password produces an account nobody can use.
REQUIRED_KEYS=(
  OWNER_IDENTITY_BOOTSTRAP_TOKEN
  OWNER_IDENTITY_OWNER_PASSWORD
  OWNER_IDENTITY_OWNER_EMAIL
  OWNER_IDENTITY_OWNER_NAME
  OWNER_IDENTITY_HOST
  OWNER_FRANK_ORIGIN
  OWNER_CRM_ORIGIN
  OWNER_MARKETING_ORIGIN
  OWNER_WEBMAIL_ORIGIN
  OWNER_IDENTITY_SESSION_DURATION
  OWNER_IDENTITY_MAUTIC_SP_ENTITY_ID
  OWNER_IDENTITY_MAUTIC_ACS_URL
)

fail() { echo "bootstrap: $*" >&2; exit 1; }
value() { sed -n "s/^$1=//p" "$secret_file" | tail -n1; }

test -f "$secret_file" && test ! -L "$secret_file" || fail "missing regular secret file"
test "$(stat -c %a "$secret_file")" = 600 && test "$(stat -c %u "$secret_file")" = 0 || fail "secret file is unsafe"

env_args=()
for key in "${REQUIRED_KEYS[@]}"; do
  v=$(value "$key")
  test -n "$v" || fail "$key must be set in $secret_file"
  env_args+=(-e "$key=$v")
done

export OWNER_IDENTITY_SOURCE_SHA=$(git -C "$repo_root" rev-parse HEAD)
compose=(docker compose --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/compose.yaml")

server_id=$("${compose[@]}" ps -q server)
test -n "$server_id" || fail "the owner identity server is not running; run 'owner-identity up' first"
test "$(docker inspect -f '{{.State.Health.Status}}' "$server_id")" = healthy \
  || fail "the owner identity server is not healthy"

"${compose[@]}" exec -T "${env_args[@]}" server python3 - < "$script_dir/bootstrap.py"

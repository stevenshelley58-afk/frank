#!/usr/bin/env bash
# Runtime evidence for the owner identity provider.
#
# A green Compose configuration is not evidence. This script requires the
# containers to be running at the pinned commit, the database to be healthy,
# the authentik server to answer its own readiness probe, and the embedded
# outpost to answer the exact endpoint Caddy forward-auths against.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
repo_root=$(cd "$root_dir/../../../.." && pwd)
secret_file=/srv/frank/secrets/owner-identity.env
runtime_root=/srv/frank/owner-identity
project=owner-identity
ingress_network=${project}_owner-identity-ingress

wait_seconds=0
case ${1:-} in
  ""|--no-wait) ;;
  --wait) wait_seconds=${2:-240} ;;
  *) echo "usage: owner-identity health [--wait [seconds]]" >&2; exit 2 ;;
esac

fail() { echo "health: $*" >&2; exit 1; }

test -f "$secret_file" && test ! -L "$secret_file" || fail "missing regular owner identity secret file"
test "$(stat -c %a "$secret_file")" = 600 && test "$(stat -c %u "$secret_file")" = 0 \
  || fail "owner identity secret file is unsafe"
test -f "$runtime_root/.owner-identity-runtime" && test ! -L "$runtime_root/.owner-identity-runtime" \
  || fail "owner identity runtime root is not marked"

source_sha=$(git -C "$repo_root" rev-parse HEAD)
# The Compose file requires this variable for its runtime labels, so it must be
# exported here too, not only in bin/owner-identity. Without it every command in
# this script fails to interpolate and health reports a false negative.
compose() {
  OWNER_IDENTITY_SOURCE_SHA=$source_sha \
  docker compose --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/compose.yaml" "$@"
}

inspect() { docker inspect -f "$2" "$(compose ps -q "$1")"; }

wait_for() {
  local deadline=$((SECONDS + wait_seconds)) what=$1; shift
  until "$@"; do
    (( SECONDS < deadline )) || return 1
    sleep 5
  done
}

check_running() {
  local service
  for service in postgresql server worker; do
    local id
    id=$(compose ps -q "$service")
    test -n "$id" || return 1
    test "$(docker inspect -f '{{.State.Status}}' "$id")" = running || return 1
    test "$(docker inspect -f '{{index .Config.Labels "io.frank.owner-identity.applied-source-sha"}}' "$id")" = "$source_sha" || return 1
  done
}

check_healthy() {
  local service
  for service in postgresql server; do
    test "$(inspect "$service" '{{.State.Health.Status}}')" = healthy || return 1
  done
}

check_ready() {
  compose exec -T server python3 -c "
import sys, urllib.request
try:
    r = urllib.request.urlopen('http://127.0.0.1:9000/-/health/ready/', timeout=5)
except Exception:
    sys.exit(1)
sys.exit(0 if r.status == 200 else 1)
" >/dev/null 2>&1
}

# The exact path Caddy forward-auths against. An unauthenticated request must
# be answered by the outpost (401 or a redirect), never by a connection error
# and never by a 200.
check_outpost() {
  # An unauthenticated request must be answered by the outpost itself: a 3xx to
  # the authorize endpoint, or 401/403. The redirect must NOT be followed - its
  # target is the public https hostname, which inside this network resolves to
  # nothing, so following it turns a correct answer into a TLS error.
  compose exec -T server python3 -c "
import sys, urllib.error, urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect)
req = urllib.request.Request(
    'http://127.0.0.1:9000/outpost.goauthentik.io/auth/caddy',
    # Probe with a host that actually HAS a proxy provider. The identity
    # provider's own host deliberately does not, so probing it would return 404
    # and prove nothing about the path Caddy forward-auths against.
    headers={'X-Forwarded-Host': 'frank.fail', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Uri': '/'},
)
try:
    code = opener.open(req, timeout=8).status
except urllib.error.HTTPError as exc:
    code = exc.code
except Exception:
    sys.exit(1)
sys.exit(0 if code in (301, 302, 303, 307, 308, 401, 403) else 1)
" >/dev/null 2>&1
}

check_edge_attached() {
  docker network inspect "$ingress_network" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | grep -qw frank-caddy
}

check_pinned_images() {
  test "$(docker inspect -f '{{.Config.Image}}' "$(compose ps -q server)")" \
    = "ghcr.io/goauthentik/server:2026.8.2@sha256:ff8489a5af4f4fe415ffd180a8e3c10b120bc2592d13d79dac050d977f7b9ecd" \
    || return 1
}

if (( wait_seconds > 0 )); then
  wait_for "owner identity containers" check_running \
    || { compose ps; fail "owner identity containers did not start at $source_sha"; }
  wait_for "owner identity health" check_healthy \
    || { compose ps; fail "postgresql or the authentik server never became healthy"; }
  wait_for "authentik readiness" check_ready \
    || { compose logs --tail 60 server; fail "authentik never answered /-/health/ready/"; }
fi

check_running        || fail "one or more owner identity containers are not running at $source_sha"
check_healthy        || fail "postgresql or the authentik server is not healthy"
check_pinned_images  || fail "the running server image is not the pinned digest"
check_ready          || fail "authentik does not answer /-/health/ready/ inside the container"
check_outpost        || fail "the embedded outpost does not answer /outpost.goauthentik.io/auth/caddy"
check_edge_attached  || fail "frank-caddy is not attached to $ingress_network, so no request can reach the owner session boundary"

version=$(compose exec -T server ak --version 2>/dev/null | tail -n1 || true)
echo "owner identity is healthy: authentik ${version:-2026.8.2} is serving the embedded outpost on auth.frank.fail"

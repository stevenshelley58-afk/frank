#!/usr/bin/env bash
# Start, inspect or stop the acceptance edge.
#
# The acceptance edge is a second Caddy that serves the *committed* site blocks
# from apps/window/Caddyfile on loopback ports 9443/9080. It exists so the owner
# sign-in round trip and the framed native application can be proven with a real
# browser without deploying to production and without asking Let's Encrypt for
# a certificate that frank-caddy is already serving.
#
# It binds only 127.0.0.1. It is never reachable off-host and is removed when
# the proof is finished.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
repo_root=$(cd "$root_dir/../../../.." && pwd)
runtime=/srv/frank/owner-identity/acceptance

usage() { echo "usage: acceptance-edge {up|down|status|config}" >&2; exit 2; }
install -d -m 0700 -o root -g root "$runtime" 2>/dev/null || true

case ${1:-} in
  up)
    install -d -m 0700 -o root -g root "$runtime"
    "$script_dir/make-acceptance-caddyfile.py" \
      "$repo_root/apps/window/Caddyfile" "$runtime/Caddyfile"
    # --force-recreate, because the Caddyfile is a bind mount: Caddy reads it
    # once at start, so re-running `up` against an unchanged Compose file would
    # silently keep serving the previous revision.
    docker compose --project-directory "$root_dir/acceptance" \
      -f "$root_dir/acceptance/compose.yaml" up -d --force-recreate
    for _ in $(seq 1 20); do
      # Any HTTP status proves the TLS listener is up; the response itself is
      # expected to be a redirect to the identity provider.
      if curl -sk -o /dev/null --max-time 3 \
           --resolve frank.fail:9443:127.0.0.1 https://frank.fail:9443/ 2>/dev/null; then
        break
      fi
      sleep 1
    done
    echo "acceptance edge listening on 127.0.0.1:9443 (https) and 127.0.0.1:9080 (http)"
    ;;
  down)
    docker compose --project-directory "$root_dir/acceptance" \
      -f "$root_dir/acceptance/compose.yaml" down 2>/dev/null || true
    rm -f "$runtime/Caddyfile"
    echo "acceptance edge removed"
    ;;
  status)
    docker compose --project-directory "$root_dir/acceptance" \
      -f "$root_dir/acceptance/compose.yaml" ps
    ;;
  config)
    install -d -m 0700 -o root -g root "$runtime"
    "$script_dir/make-acceptance-caddyfile.py" \
      "$repo_root/apps/window/Caddyfile" "$runtime/Caddyfile"
    docker run --rm -v "$runtime/Caddyfile:/etc/caddy/Caddyfile:ro" \
      caddy:2.8-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    ;;
  *) usage ;;
esac

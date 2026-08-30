#!/usr/bin/env bash
set -euo pipefail

# Shared fixed-input hook for successful Frank and Blockwise deployments.
# It accepts no paths, commands, or dynamic scope: the versioned host collector
# owns the complete allowlist and de-duplicates the full reconciliation.
repo="/projects/frank"
[[ "$(realpath -e -- "$repo")" == "$repo" ]] || {
  echo "canonical Frank checkout is unavailable" >&2
  exit 1
}
exec /usr/bin/python3 "$repo/apps/window/scripts/control_reconcile.py" post_deploy

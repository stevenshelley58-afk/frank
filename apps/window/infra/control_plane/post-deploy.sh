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
/usr/bin/python3 "$repo/apps/window/scripts/control_reconcile.py" post_deploy

# Promotion is deliberately opt-in: a deploy remains healthy when no validated
# preview receipt is present, while a supplied receipt is still fail-closed.
receipt="${FRANK_MAP_PREVIEW_RECEIPT:-}"
if [[ -n "$receipt" && -f "$receipt" ]]; then
  /usr/bin/python3 "$repo/apps/window/scripts/promote_map_release.py" "$receipt" \
    --production-root "${FRANK_MAP_PRODUCTION_ROOT:-/srv/frank/data/window/maps}" || {
      echo "map preview promotion rejected; leaving last-known-good pointer" >&2
    }
fi

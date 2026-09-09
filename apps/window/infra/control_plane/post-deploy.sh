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
if [[ -n "${FRANK_EXPECTED_REVISION:-}" ]]; then
  expected="$(git -C "$repo" rev-parse --verify --end-of-options "${FRANK_EXPECTED_REVISION}^{commit}")" \
    || { echo "invalid expected immutable revision" >&2; exit 1; }
  [[ "$expected" == "$FRANK_EXPECTED_REVISION" ]] || { echo "expected immutable revision must be a full SHA" >&2; exit 1; }
  git -C "$repo" diff --quiet "$expected" -- apps/window/infra/control_plane apps/window/scripts apps/window/graph governance/control-plane \
    || { echo "canonical post-deploy hook differs from expected immutable revision" >&2; exit 1; }
  [[ -z "$(git -C "$repo" ls-files --others --exclude-standard -- apps/window/infra/control_plane apps/window/scripts apps/window/graph governance/control-plane)" ]] \
    || { echo "canonical post-deploy hook closure has untracked inputs" >&2; exit 1; }
fi
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

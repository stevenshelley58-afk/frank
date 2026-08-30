#!/usr/bin/env bash
set -euo pipefail

preserve_active_release=false
if [[ "${1:-}" == "--preserve-active-release" ]]; then
  preserve_active_release=true
  shift
fi
[[ "$#" == "0" ]] || { echo "usage: install.sh [--preserve-active-release]" >&2; exit 2; }

# Install the exact Step 2 units. Direct runs keep the disabled-by-default
# rollout state; deploy.sh may preserve a validated active release explicitly.
[[ "$(id -u)" == "0" ]] || {
  echo "control-plane unit installation requires root" >&2
  exit 1
}

/usr/bin/python3 -c 'import yaml, jsonschema, rfc8785' >/dev/null 2>&1 || {
  echo "missing host collector prerequisites; install python3-yaml/python3-jsonschema and pinned rfc8785==0.1.4" >&2
  echo "then rerun this installer; do not continue with partially installed units" >&2
  exit 1
}

source_dir="/projects/frank/apps/window/infra/control_plane"
unit_dir="/etc/systemd/system"
control_graph_dir="/srv/frank/data/window/control-graph"
backup_dir="/srv/frank/backups/control-plane"
install_units() {
  local source="$1"; shift
  for unit in "$@"; do
    [[ -f "$source/$unit" && ! -L "$source/$unit" ]] || { echo "missing regular unit: $unit" >&2; exit 1; }
    install -o root -g root -m 0644 -- "$source/$unit" "$unit_dir/$unit"
  done
}
units=(
  frank-control-reconcile-fast.service
  frank-control-reconcile-fast.timer
  frank-control-reconcile-full.service
  frank-control-reconcile-full.timer
)
install_units "$source_dir" "${units[@]}"
install_units /projects/frank/apps/window/infra/cleanup frank-cleanup-report.service frank-cleanup-report.timer
install_units /projects/frank/apps/window/infra/discovery frank-discovery-refresh.service frank-discovery-refresh.timer
install_units /projects/frank/apps/window/infra/evaluations frank-chat-pattern.timer frank-evaluation.service frank-evaluation.timer
install_units /projects/frank/apps/window/infra/retention frank-restore-drill.service frank-restore-drill.timer

install -d -o root -g hermes -m 0750 -- "$control_graph_dir"
install -d -o root -g root -m 0750 -- "$backup_dir"
systemctl daemon-reload

current_release_id() {
  PYTHONPATH=/projects/frank/apps/window /usr/bin/python3 - <<'PY'
from pathlib import Path
from graph.release_state import ReleaseStateStore

try:
    current = ReleaseStateStore(Path("/var/lib/frank/release")).read_current()
except (OSError, ValueError, TypeError):
    raise SystemExit(1)
if current is None:
    raise SystemExit(1)
print(current["release_id"])
PY
}

# Direct installer runs are fail-safe. Routine deploys re-apply a validated
# current release so its flags and cumulative timer set cannot silently drift.
current_release=""
if [[ "$preserve_active_release" == true ]] && current_release="$(current_release_id)"; then
  /usr/bin/python3 /projects/frank/apps/window/scripts/promote_control_release.py \
    /dev/null --rollback --release-id "$current_release"
  echo "reconciled timers and flags for validated current release: $current_release"
else
  for timer in frank-control-reconcile-fast.timer frank-control-reconcile-full.timer; do
    systemctl disable "$timer" >/dev/null 2>&1 || true
    systemctl stop "$timer" >/dev/null 2>&1 || true
  done
  for timer in frank-cleanup-report.timer frank-discovery-refresh.timer frank-chat-pattern.timer frank-evaluation.timer frank-restore-drill.timer; do
    systemctl disable "$timer" >/dev/null 2>&1 || true
    systemctl stop "$timer" >/dev/null 2>&1 || true
  done
fi

systemd-analyze verify \
  "$unit_dir/frank-control-reconcile-fast.service" \
  "$unit_dir/frank-control-reconcile-fast.timer" \
  "$unit_dir/frank-control-reconcile-full.service" \
  "$unit_dir/frank-control-reconcile-full.timer" \
  "$unit_dir/frank-restore-drill.service" \
  "$unit_dir/frank-restore-drill.timer"
echo "installed Step 2 control-plane units"

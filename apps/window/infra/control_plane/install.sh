#!/usr/bin/env bash
set -euo pipefail

# Install the exact Step 2 units without changing their disabled-by-default
# rollout state.  This is intentionally separate from Frank application
# deploys so the collector can be deployed and rolled back independently.
[[ "$(id -u)" == "0" ]] || {
  echo "control-plane unit installation requires root" >&2
  exit 1
}

/usr/bin/python3 -c 'import yaml, jsonschema' >/dev/null 2>&1 || {
  echo "missing host collector prerequisites; run: apt-get install -y python3-yaml python3-jsonschema" >&2
  exit 1
}

source_dir="/projects/frank/apps/window/infra/control_plane"
unit_dir="/etc/systemd/system"
control_graph_dir="/srv/frank/data/window/control-graph"
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
systemctl daemon-reload

# Never enable the timers in Step 2.  Stop and disable any prior installation
# so rerunning this script is an idempotent rollback to the safe default.
for timer in frank-control-reconcile-fast.timer frank-control-reconcile-full.timer; do
  systemctl disable "$timer" >/dev/null 2>&1 || true
  systemctl stop "$timer" >/dev/null 2>&1 || true
done
for timer in frank-cleanup-report.timer frank-discovery-refresh.timer frank-chat-pattern.timer frank-evaluation.timer frank-restore-drill.timer; do
  systemctl disable "$timer" >/dev/null 2>&1 || true
  systemctl stop "$timer" >/dev/null 2>&1 || true
done

systemd-analyze verify \
  "$unit_dir/frank-control-reconcile-fast.service" \
  "$unit_dir/frank-control-reconcile-fast.timer" \
  "$unit_dir/frank-control-reconcile-full.service" \
  "$unit_dir/frank-control-reconcile-full.timer"
echo "installed Step 2 control-plane units; timers remain disabled and stopped"

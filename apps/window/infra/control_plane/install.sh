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
units=(
  frank-control-reconcile-fast.service
  frank-control-reconcile-fast.timer
  frank-control-reconcile-full.service
  frank-control-reconcile-full.timer
)

for unit in "${units[@]}"; do
  [[ -f "$source_dir/$unit" && ! -L "$source_dir/$unit" ]] || {
    echo "missing regular control-plane unit: $unit" >&2
    exit 1
  }
  install -o root -g root -m 0644 -- "$source_dir/$unit" "$unit_dir/$unit"
done

install -d -o root -g hermes -m 0750 -- "$control_graph_dir"
systemctl daemon-reload

# Never enable the timers in Step 2.  Stop and disable any prior installation
# so rerunning this script is an idempotent rollback to the safe default.
for timer in frank-control-reconcile-fast.timer frank-control-reconcile-full.timer; do
  systemctl disable "$timer" >/dev/null 2>&1 || true
  systemctl stop "$timer" >/dev/null 2>&1 || true
done

systemd-analyze verify \
  "$unit_dir/frank-control-reconcile-fast.service" \
  "$unit_dir/frank-control-reconcile-fast.timer" \
  "$unit_dir/frank-control-reconcile-full.service" \
  "$unit_dir/frank-control-reconcile-full.timer"
echo "installed Step 2 control-plane units; timers remain disabled and stopped"

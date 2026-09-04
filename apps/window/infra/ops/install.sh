#!/usr/bin/env bash
set -euo pipefail

# Ops publication is a separate read-only scheduler. Keeping its enablement
# here preserves the control-plane installer's disabled-by-default contract.
[[ "$(id -u)" == "0" ]] || { echo "ops publisher installation requires root" >&2; exit 1; }
source_dir="/projects/frank/apps/window/infra/ops"
unit_dir="/etc/systemd/system"
data_dir="/srv/frank/data/window"
auth_path="/srv/frank/secrets/blockwise-internal-auth.secret"
[[ -f "$auth_path" && ! -L "$auth_path" ]] || { echo "missing Blockwise internal auth secret file" >&2; exit 1; }
[[ "$(stat -c '%a' -- "$auth_path")" == "640" ]] || { echo "Blockwise internal auth secret must be mode 0640" >&2; exit 1; }
[[ "$(stat -c '%U:%G' -- "$auth_path")" == "root:hermes" ]] || { echo "Blockwise internal auth secret must be root:hermes" >&2; exit 1; }
for unit in frank-ops-projections.service frank-ops-projections.timer; do
  [[ -f "$source_dir/$unit" && ! -L "$source_dir/$unit" ]] || { echo "missing regular unit: $unit" >&2; exit 1; }
  install -o root -g root -m 0644 -- "$source_dir/$unit" "$unit_dir/$unit"
done
install -d -o hermes -g hermes -m 0750 -- "$data_dir/ops-source" "$data_dir/ops-projections"
systemctl daemon-reload
systemd-analyze verify "$unit_dir/frank-ops-projections.service" "$unit_dir/frank-ops-projections.timer"
systemctl enable --now frank-ops-projections.timer >/dev/null
echo "installed and enabled Frank ops projection publisher"

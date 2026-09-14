#!/usr/bin/env bash
set -Eeuo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$source_dir" rev-parse --show-toplevel)"
sha="$(git -C "$repo" rev-parse HEAD)"
[[ -z "$(git -C "$repo" status --porcelain)" ]] || { echo 'Requires clean committed source' >&2; exit 1; }
dest="/srv/frank/ops/docker-retention/$sha"
mkdir -p "$dest"
git -C "$repo" archive "$sha" apps/window/infra/cleanup | tar -x -C "$dest"
cat > /etc/systemd/system/docker-prune.service <<EOF
[Unit]
Description=Bound Docker cache and unused owned image versions
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $dest/apps/window/infra/cleanup/docker-runtime-retention.py --apply
EOF
cat > /etc/systemd/system/docker-prune.timer <<'EOF'
[Unit]
Description=Hourly bounded Docker retention
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now docker-prune.timer
systemctl is-active docker-prune.timer

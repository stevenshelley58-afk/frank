#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || { echo 'run as root' >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
[[ -z $(git -C "$REPO" status --porcelain -- apps/window/infra/backup_retention) ]] || { echo 'commit retention source first' >&2; exit 2; }
install -m 0750 "$HERE/retain-two.py" /usr/local/libexec/vps-backup-retention
cat > /etc/systemd/system/vps-backup-retention.service <<'EOF'
[Unit]
Description=Keep two verified complete backups per declared VPS series
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/libexec/vps-backup-retention --apply
User=root
UMask=0077
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
PrivateTmp=true
TimeoutStartSec=2h
EOF
cat > /etc/systemd/system/vps-backup-retention.timer <<'EOF'
[Unit]
Description=Hourly safety-checked two-backup retention
[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=5m
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now vps-backup-retention.timer
cmp "$HERE/retain-two.py" /usr/local/libexec/vps-backup-retention
printf 'installed committed backup retention revision=%s\n' "$(git -C "$REPO" rev-parse HEAD)"

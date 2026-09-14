#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID == 0 ]] || exit 2
SOURCE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$SOURCE" rev-parse --show-toplevel)"
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || { echo 'clean committed source required' >&2; exit 2; }
SHA="$(git -C "$ROOT" rev-parse HEAD)"
DEST="/srv/frank/ops-releases/template-retention/$SHA"
install -d -m 755 "$DEST"
install -m 755 "$SOURCE/prune.py" "$DEST/prune.py"
ln -sfn "$DEST/prune.py" /usr/local/libexec/template-draft-retention
cat > /etc/systemd/system/template-draft-retention.service <<'EOF'
[Unit]
Description=Prune settled published template draft raster media
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/libexec/template-draft-retention --apply
User=root
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/hermes/.hermes/tool_runs/ad-template-generator /srv/cleanup-evidence/ephemeral-cleanup-20260914 /run
EOF
cat > /etc/systemd/system/template-draft-retention.timer <<'EOF'
[Unit]
Description=Hourly published template draft retention
[Timer]
OnCalendar=hourly
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
EOF
install -d -m 700 /srv/cleanup-evidence/ephemeral-cleanup-20260914
systemctl daemon-reload
systemctl enable --now template-draft-retention.timer

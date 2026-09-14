#!/bin/sh
set -eu
ROOT=${1:?immutable component path required}
test -f "$ROOT/browser-profile-retention.py"
cat > /etc/systemd/system/ad-radar-browser-retention.service <<EOF
[Unit]
Description=Retain only recent inactive Ad Radar per-run browser profiles
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $ROOT/browser-profile-retention.py --apply --result /srv/cleanup-evidence/browser-retention-latest.json
Nice=10
IOSchedulingClass=idle
EOF
cat > /etc/systemd/system/ad-radar-browser-retention.timer <<'EOF'
[Unit]
Description=Hourly Ad Radar per-run browser profile retention
[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now ad-radar-browser-retention.timer

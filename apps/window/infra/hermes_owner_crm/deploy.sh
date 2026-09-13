#!/usr/bin/env bash
set -euo pipefail
base=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); home=/home/hermes/.hermes; secret=/srv/hermes/secrets/owner-crm-sync.env
test "$(id -u)" = 0; test -f "$secret" && test ! -L "$secret" && test "$(stat -c %U:%G:%a "$secret")" = hermes:hermes:600
for key in OWNER_CRM_SNAPSHOT_AUTH_SECRET OWNER_CRM_FRAPPE_API_KEY OWNER_CRM_FRAPPE_API_SECRET HERMES_OWNER_CRM_SYNC_SNAPSHOT_URL HERMES_OWNER_CRM_SYNC_FRAPPE_URL; do grep -q -E "^${key}=[^[:space:]]" "$secret" || { echo "missing $key" >&2; exit 1; }; done
install -d -o hermes -g hermes -m 0755 "$home/plugins/owner-crm-sync" "$home/scripts" /srv/hermes/owner-crm-sync
install -o hermes -g hermes -m 0755 "$base/connector.py" "$base/run.py" /srv/hermes/owner-crm-sync/
install -o hermes -g hermes -m 0755 "$base/connector.py" "$home/scripts/owner-crm-contact-sync.py"
install -o hermes -g hermes -m 0644 "$base/plugin/plugin.yaml" "$base/plugin/__init__.py" "$home/plugins/owner-crm-sync/"
sudo -u hermes -H env HERMES_HOME="$home" /home/hermes/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main plugins enable owner-crm-sync >/dev/null
echo 'installed; native Hermes no-agent cron is intentionally not created until explicit activation'

#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
secret_file=/srv/frank/secrets/owner-crm.env
runtime_root=/srv/frank/owner-crm
site=owner.crm.internal
port=18081

test -f "$secret_file" && test ! -L "$secret_file" || { echo "missing regular owner CRM secret file" >&2; exit 1; }
test "$(stat -c %a "$secret_file")" = 600 && test "$(stat -c %u "$secret_file")" = 0 || { echo "owner CRM secret file is unsafe" >&2; exit 1; }
test -f "$runtime_root/.owner-crm-site-created" && test ! -L "$runtime_root/.owner-crm-site-created" || { echo "owner CRM site has not been provisioned" >&2; exit 1; }
compose=(docker compose --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/compose.yaml")
"${compose[@]}" ps --status running --services | grep -qx frontend
curl --fail --silent --show-error -H "Host: $site" "http://127.0.0.1:$port/api/method/ping" >/dev/null
apps=$("${compose[@]}" exec -T backend bench --site "$site" list-apps)
printf '%s\n' "$apps" | grep -qx crm
printf '%s\n' "$apps" | grep -qx telephony
printf '%s\n' "$apps" | grep -qx helpdesk
jq -e '.mute_emails == 1 and .enable_scheduler == 0' "$runtime_root/sites/common_site_config.json" >/dev/null
jq -e '.mute_emails == 1 and .enable_scheduler == 0' "$runtime_root/sites/$site/site_config.json" >/dev/null
echo "owner CRM is healthy; CRM, Telephony and Helpdesk are installed; mail and scheduler remain disabled"

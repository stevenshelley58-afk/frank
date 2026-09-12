#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
secret_file=${OWNER_CRM_SECRET_FILE:-/srv/frank/secrets/owner-crm.env}
test -r "$secret_file" || { echo "missing owner CRM secret file" >&2; exit 1; }
value() { sed -n "s/^$1=//p" "$secret_file" | tail -n1; }
site=$(value OWNER_CRM_SITE)
port=$(value OWNER_CRM_PORT)
runtime_root=$(value OWNER_CRM_RUNTIME_ROOT)
test -n "$site" && test -n "$port" && test -n "$runtime_root" || { echo "site, port or runtime root missing from secret file" >&2; exit 1; }
compose=(docker compose --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/compose.yaml")
"${compose[@]}" ps --status running --services | grep -qx frontend
curl --fail --silent --show-error -H "Host: $site" "http://127.0.0.1:$port/api/method/ping" >/dev/null
apps=$("${compose[@]}" exec -T backend bench --site "$site" list-apps)
printf '%s\n' "$apps" | grep -qx crm
printf '%s\n' "$apps" | grep -qx telephony
printf '%s\n' "$apps" | grep -qx helpdesk
# Read only the two safe flags directly; never stream complete site config.
jq -e '.mute_emails == 1 and .enable_scheduler == 0' "$runtime_root/sites/common_site_config.json" >/dev/null
jq -e '.mute_emails == 1 and .enable_scheduler == 0' "$runtime_root/sites/$site/site_config.json" >/dev/null
echo "owner CRM is healthy; CRM, Telephony and Helpdesk are installed; mail and scheduler remain disabled"

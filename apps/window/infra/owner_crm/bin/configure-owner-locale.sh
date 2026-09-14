#!/usr/bin/env bash
# Native owner-only locale and reachable private login links; no custom auth.
set -euo pipefail
[[ ${1:-} == --apply ]] || { echo "preview: set owner CRM URL ${OWNER_CRM_PUBLIC_URL:-https://crm.frank.fail} and Australia/Perth locale"; exit 0; }
container=owner-crm-backend-1
site=owner.crm.internal
# The owner-facing origin is the workspace hostname. The private Tailscale Serve
# address stays available as a fallback transport but is no longer the base URL,
# because every link, asset and redirect the app generates must point at the
# origin the owner's browser actually uses.
url=${OWNER_CRM_PUBLIC_URL:-https://crm.frank.fail}
docker exec "$container" bench --site "$site" set-config host_name "$url"
docker exec "$container" bench --site "$site" execute frappe.client.set_value --kwargs '{"doctype":"System Settings","name":"System Settings","fieldname":{"time_zone":"Australia/Perth","country":"Australia","language":"en","date_format":"dd/mm/yyyy"}}' >/dev/null
# Run the native setup stages, rather than bypassing the wizard-completion flags.
# Existing owner user, roles, password and historical records are untouched.
docker exec "$container" bench --site "$site" execute frappe.desk.page.setup_wizard.setup_wizard.setup_complete --kwargs '{"args":{"language":"English","country":"Australia","timezone":"Australia/Perth","currency":"AUD","enable_telemetry":0}}' >/dev/null
docker exec "$container" bench --site "$site" clear-cache
echo 'Native owner locale and private login URL configured'

#!/usr/bin/env bash
# Native owner-only locale and reachable private login links; no custom auth.
set -euo pipefail
[[ ${1:-} == --apply ]] || { echo 'preview: set private owner CRM URL and Australia/Perth locale'; exit 0; }
container=owner-crm-backend-1
site=owner.crm.internal
url=https://srv1625369.tail3084c0.ts.net:8445
docker exec "$container" bench --site "$site" set-config host_name "$url"
docker exec "$container" bench --site "$site" execute frappe.client.set_value --kwargs '{"doctype":"System Settings","name":"System Settings","fieldname":{"time_zone":"Australia/Perth","country":"Australia","language":"en","date_format":"dd/mm/yyyy"}}' >/dev/null
docker exec "$container" bench --site "$site" clear-cache
echo 'Native owner locale and private login URL configured'

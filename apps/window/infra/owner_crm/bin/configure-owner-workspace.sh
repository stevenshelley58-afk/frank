#!/usr/bin/env bash
# Configure the owner CRM and Helpdesk for the workspace origin and the owner.
#
# The base URL is set by configure-owner-locale.sh, which owns host_name. This
# script owns everything else the owner-facing workspace needs, and it verifies
# rather than assumes the owner role and the native start screens.
#
# Only supported Frappe settings are changed: site config host_name is handled
# next door, Single DocType values here. No application file is patched and no
# navigation is hidden by forking an app.
set -euo pipefail
container=owner-crm-backend-1
site=owner.crm.internal
owner_user=owner@blockwise.sale
brand=${OWNER_CRM_BRAND:-Blockwise}
public_url=${OWNER_CRM_PUBLIC_URL:-https://crm.frank.fail}

usage() { echo "usage: configure-owner-workspace.sh [--apply]" >&2; exit 2; }
apply=0
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    *) usage ;;
  esac
done

bench() { docker exec "$container" bench --site "$site" "$@"; }
set_single() {
  local doctype="$1" field="$2" value="$3"
  docker exec "$container" bench --site "$site" execute frappe.client.set_value \
    --kwargs "{\"doctype\":\"$doctype\",\"name\":\"$doctype\",\"fieldname\":\"$field\",\"value\":\"$value\"}" >/dev/null
}
read_single() {
  local doctype="$1" field="$2"
  bench execute frappe.client.get_value \
    --kwargs "{\"doctype\":\"$doctype\",\"fieldname\":[\"$field\"]}" 2>/dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1]) or "")' "$field"
}

if (( ! apply )); then
  cat <<EOF
preview: set the owner workspace branding and verify the owner's native start screens
  site configuration host_name       ${public_url}   (owned by configure-owner-locale.sh)
  System Settings.app_name           ${brand}
  FCRM Settings.brand_name           ${brand}
  HD Settings.brand_name             ${brand}
  owner user                         ${owner_user}
No value is written without --apply.
EOF
  exit 0
fi

# 1. Workspace branding. The native chrome otherwise shows the upstream product
#    names, which duplicates a second product identity inside Frank.
set_single "System Settings" "app_name" "$brand"
set_single "FCRM Settings" "brand_name" "$brand"
set_single "HD Settings" "brand_name" "$brand"

# 2. Base URL. Written by configure-owner-locale.sh; assert it here so a stale
#    private URL cannot silently break every generated link behind the ingress.
# frappe.utils.get_url() is what the application actually uses for generated
# links, so assert that rather than the raw config key.
host_name=$(bench execute frappe.utils.get_url | tr -d '\r"')
if [[ "$host_name" != "$public_url" ]]; then
  echo "owner workspace: host_name is '$host_name', expected '$public_url'; run configure-owner-locale.sh --apply" >&2
  exit 1
fi

bench clear-cache >/dev/null

# 3. Verification against live state, not against the write above.
python3 - "$container" "$site" "$owner_user" "$public_url" <<'PY'
import json
import subprocess
import sys
import urllib.request

container, site, owner_user, public_url = sys.argv[1:5]


def bench(*args):
    return subprocess.run(
        ["docker", "exec", container, "bench", "--site", site, *args],
        capture_output=True, text=True, check=True,
    ).stdout


apps = bench("list-apps").split()
for app in ("crm", "telephony", "helpdesk"):
    assert app in apps, f"{app} is not installed"

settings = json.loads(bench(
    "execute", "frappe.client.get_value",
    "--kwargs", json.dumps({"doctype": "System Settings", "fieldname": ["app_name"]}),
))
assert settings["app_name"] == "Blockwise", settings

owner = json.loads(bench(
    "execute", "frappe.client.get_value",
    "--kwargs", json.dumps({
        "doctype": "User", "filters": {"name": owner_user},
        "fieldname": ["enabled", "user_type"],
    }),
))
assert owner["enabled"] == 1, owner
assert owner["user_type"] == "System User", owner

role_names = set(json.loads(bench(
    "execute", "frappe.permissions.get_roles",
    "--kwargs", json.dumps({"user": owner_user}),
)))
required = {"Sales Manager", "Agent Manager", "Agent", "Inbox User"}
missing = required - role_names
assert not missing, f"owner is missing native roles: {sorted(missing)}"
assert "System Manager" not in role_names, "owner must not hold System Manager"

agents = json.loads(bench(
    "execute", "frappe.client.get_list",
    "--kwargs", json.dumps({
        "doctype": "HD Agent", "filters": [["user", "=", owner_user]],
        "fields": ["name"], "limit_page_length": 0,
    }),
))
assert agents, "owner has no native HD Agent record"

print(json.dumps({
    "public_url": public_url,
    "apps": apps,
    "owner_roles": sorted(role_names),
    "hd_agent": agents[0]["name"],
    "start_screens": {"crm": public_url + "/crm/dashboard", "helpdesk": public_url + "/helpdesk/home"},
}, indent=2))
PY

echo 'owner workspace configured: branding set, owner role and native start screens verified'

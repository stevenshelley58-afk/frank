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
mode="${1:-disabled}"
case "$mode" in
  disabled|"") ;;
  --mail-enabled) mode=mail-enabled ;;
  *) echo "usage: owner-crm health [--mail-enabled]" >&2; exit 2 ;;
esac
export OWNER_CRM_SOURCE_SHA=$(git -C "$root_dir" rev-parse HEAD)
compose=(docker compose --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/compose.yaml")
services=(db redis-cache redis-queue backend websocket queue-short queue-long frontend)
[[ "$mode" == mail-enabled ]] && services+=(scheduler)
for service in "${services[@]}"; do
  if [[ "$service" == scheduler ]]; then
    container_id=$("${compose[@]}" --profile owner-mail ps -q "$service")
  else
    container_id=$("${compose[@]}" ps -q "$service")
  fi
  test -n "$container_id"
  test "$(docker inspect -f '{{.State.Status}}' "$container_id")" = running
  test "$(docker inspect -f '{{index .Config.Labels "io.frank.owner-crm.applied-source-sha"}}' "$container_id")" = "$OWNER_CRM_SOURCE_SHA"
done
for service in db redis-cache redis-queue backend frontend; do
  container_id=$("${compose[@]}" ps -q "$service")
  test "$(docker inspect -f '{{.State.Health.Status}}' "$container_id")" = healthy
done
curl --fail --silent --show-error -H "Host: $site" "http://127.0.0.1:$port/api/method/ping" >/dev/null
apps=$("${compose[@]}" exec -T backend bench --site "$site" list-apps)
for app in crm telephony helpdesk; do
  printf '%s\n' "$apps" | grep -Eq "^${app}([[:space:]]|$)"
done
if [[ "$mode" == mail-enabled ]]; then
  jq -e '.mute_emails == 1 and .enable_scheduler == 0' "$runtime_root/sites/common_site_config.json" >/dev/null
  jq -e '.mute_emails == 0 and .enable_scheduler == 1' "$runtime_root/sites/$site/site_config.json" >/dev/null
  echo "owner CRM is healthy; native owner mail mode is enabled and scheduler is running"
else
  jq -e '.mute_emails == 1 and .enable_scheduler == 0' "$runtime_root/sites/common_site_config.json" >/dev/null
  jq -e '.mute_emails == 1 and .enable_scheduler == 0' "$runtime_root/sites/$site/site_config.json" >/dev/null
  echo "owner CRM is healthy; CRM, Telephony and Helpdesk are installed; mail and scheduler remain disabled"
fi

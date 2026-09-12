#!/usr/bin/env bash
# Restore drill only. It never targets the live owner site or its compose project.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
secret_file=/srv/frank/secrets/owner-crm.env
backup_root=/srv/frank/backups/owner-crm
drill_root_base=/srv/frank/owner-crm-restore-drill
frappe_uid=1000
frappe_gid=1000
mariadb_uid=999
mariadb_gid=999
redis_uid=999
redis_gid=1000
fail() { echo "owner-crm restore-drill: $*" >&2; exit 1; }

free_gib=$(df -BG / | awk 'NR==2 {gsub(/G/, "", $4); print $4}')
[[ "$free_gib" =~ ^[0-9]+$ ]] && (( free_gib >= 15 )) || fail "refusing restore drill below 15 GiB free disk"
test -f "$backup_root/LATEST" && test ! -L "$backup_root/LATEST" || fail "no local backup receipt is available"
run_id=$(cat "$backup_root/LATEST")
[[ "$run_id" =~ ^local-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || fail "unsafe backup id"
archive="$backup_root/$run_id"
test -d "$archive" && test ! -L "$archive" || fail "backup archive is not a regular directory"
test "$(stat -c %u:%a "$backup_root")" = 0:700 || fail "backup root must remain root-owned mode 0700"
test "$(stat -c %u:%a "$archive")" = 0:700 || fail "backup archive must remain root-owned mode 0700"
(
  cd "$archive"
  sha256sum -c SHA256SUMS
)
sql=$(jq -r '.native.sql' "$archive/receipt.json")
public=$(jq -r '.native.public_files' "$archive/receipt.json")
private=$(jq -r '.native.private_files' "$archive/receipt.json")
config=$(jq -r '.native.site_config' "$archive/receipt.json")
for artifact in "$sql" "$public" "$private" "$config" custom-fields.json public-files.members private-files.members; do
  [[ "$artifact" != */* && "$artifact" != .* ]] || fail "unsafe artifact name"
  test -f "$archive/$artifact" && test ! -L "$archive/$artifact" || fail "missing regular archive artifact: $artifact"
done
restore_id="restore-${run_id#local-}"
[[ "$restore_id" =~ ^restore-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || fail "unsafe restore id"
drill_root="$drill_root_base/$restore_id"
site="$restore_id.crm.internal"
project="owner-crm-$restore_id"
install -d -m 0700 -o root -g root "$drill_root_base"
test ! -L "$drill_root_base" || fail "drill root base must not be a symlink"
test ! -e "$drill_root" || fail "drill root already exists; preserve it for investigation"
install -d -m 0700 -o root -g root "$drill_root"
printf '%s\n' "$restore_id" > "$drill_root/.owner-crm-restore-drill"
chmod 0600 "$drill_root/.owner-crm-restore-drill"
for d in sites logs input; do install -d -m 0700 -o "$frappe_uid" -g "$frappe_gid" "$drill_root/$d"; done
install -d -m 0700 -o "$mariadb_uid" -g "$mariadb_gid" "$drill_root/mariadb"
install -d -m 0700 -o "$redis_uid" -g "$redis_gid" "$drill_root/redis-queue"
cp -a "$archive/$sql" "$archive/$public" "$archive/$private" "$drill_root/input/"
chown "$frappe_uid:$frappe_gid" "$drill_root/input/"*
compose=(docker compose --project-name "$project" --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/restore-drill.compose.yaml")
cleanup() {
  rc=$?
  set +e
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1
  if (( rc == 0 )); then
    test -f "$drill_root/.owner-crm-restore-drill" && test ! -L "$drill_root/.owner-crm-restore-drill" && grep -Fxq "$restore_id" "$drill_root/.owner-crm-restore-drill" || exit 1
    case "$(readlink -f "$drill_root")" in "$drill_root_base"/*) rm -rf -- "$drill_root" ;; *) exit 1 ;; esac
  else
    echo "owner-crm restore-drill: preserved failed drill resources at $drill_root" >&2
  fi
  exit "$rc"
}
trap cleanup EXIT
export OWNER_CRM_DRILL_ROOT="$drill_root"
export OWNER_CRM_DRILL_SITE="$site"
export OWNER_CRM_BACKUP_SQL="/backup/$sql"
export OWNER_CRM_BACKUP_PUBLIC="/backup/$public"
export OWNER_CRM_BACKUP_PRIVATE="/backup/$private"
"${compose[@]}" up -d db redis-cache redis-queue
"${compose[@]}" run --rm restore
apps=$("${compose[@]}" run --rm verify-apps)
printf '%s\n' "$apps" | grep -Eq '^frappe([[:space:]]|$)' || fail "restored Frappe app is absent"
for app in crm telephony helpdesk; do printf '%s\n' "$apps" | grep -Eq "^${app}([[:space:]]|$)" || fail "restored $app app is absent"; done
kwargs=$(jq -cn --argjson names "$(jq -c 'map(.name)' "$archive/custom-fields.json")" '{doctype:"Custom Field",filters:{name:["in",$names]},fields:["name","dt","fieldname","label","fieldtype","options","insert_after","reqd","hidden","read_only"],order_by:"name asc"}')
"${compose[@]}" run --rm -e "OWNER_CRM_CUSTOM_FIELDS_KWARGS=$kwargs" verify-custom-fields | jq -S . > "$drill_root/restored-custom-fields.json"
cmp -s "$archive/custom-fields.json" "$drill_root/restored-custom-fields.json" || fail "restored custom-field definitions differ from backup manifest"
"${compose[@]}" run --rm verify-safety
source_custom_sha=$(sha256sum "$archive/custom-fields.json" | awk '{print $1}')
restored_custom_sha=$(sha256sum "$drill_root/restored-custom-fields.json" | awk '{print $1}')
jq --arg restore_id "$restore_id" --arg site "$site" --arg apps_sha "$(printf '%s\n' "$apps" | sha256sum | awk '{print $1}')" --arg source_custom_sha "$source_custom_sha" --arg restored_custom_sha "$restored_custom_sha" \
  '. + {restore_drill:{restore_id:$restore_id,site:$site,network:"internal-only temporary compose project",mail_disabled:true,scheduler_disabled:true,apps_sha256:$apps_sha,custom_fields_source_sha256:$source_custom_sha,custom_fields_restored_sha256:$restored_custom_sha,custom_fields_match:($source_custom_sha == $restored_custom_sha),cleanup:"completed"}}' "$archive/receipt.json" > "$drill_root/receipt.json"
install -m 0600 -o root -g root "$drill_root/receipt.json" "$archive/drill-receipt.json"
echo "isolated local restore drill passed; receipt: $archive/drill-receipt.json"

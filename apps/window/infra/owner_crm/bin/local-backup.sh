#!/usr/bin/env bash
# Manual local-only native Frappe backup. It intentionally has no schedule or off-host transport.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
secret_file=/srv/frank/secrets/owner-crm.env
runtime_root=/srv/frank/owner-crm
backup_root=/srv/frank/backups/owner-crm
stage_root="$backup_root/.staging"
site=owner.crm.internal
frappe_uid=1000
frappe_gid=1000
custom_field_names='["CRM Lead-custom_blockwise_eligibility","CRM Lead-custom_blockwise_evidence_refs","CRM Lead-custom_blockwise_prospect_source_uuid","Contact-custom_blockwise_access_status","Contact-custom_blockwise_last_synced_at","Contact-custom_blockwise_profile_uuid","Contact-custom_blockwise_subscription_status","Contact-custom_blockwise_workspace_uuid"]'
fail() { echo "owner-crm backup: $*" >&2; exit 1; }

free_gib=$(df -BG / | awk 'NR==2 {gsub(/G/, "", $4); print $4}')
[[ "$free_gib" =~ ^[0-9]+$ ]] && (( free_gib >= 15 )) || fail "refusing backup below 15 GiB free disk"
test -f "$runtime_root/.owner-crm-site-created" && test ! -L "$runtime_root/.owner-crm-site-created" || fail "owner site is not marked created"
test -d "$backup_root" || install -d -m 0700 -o root -g root "$backup_root"
test -d "$backup_root" && test ! -L "$backup_root" || fail "backup root must be a regular directory"
test "$(stat -c %u:%a "$backup_root")" = 0:700 || fail "backup root must be root-owned mode 0700"
install -d -m 0700 -o "$frappe_uid" -g "$frappe_gid" "$stage_root"
test ! -L "$stage_root" || fail "backup staging path must not be a symlink"
run_id="local-$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$root_dir" rev-parse --short=12 HEAD)"
[[ "$run_id" =~ ^local-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || fail "unsafe generated backup id"
stage="$stage_root/$run_id"
final="$backup_root/$run_id"
test ! -e "$stage" && test ! -e "$final" || fail "backup id already exists"
install -d -m 0700 -o "$frappe_uid" -g "$frappe_gid" "$stage"
compose=(docker compose --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/compose.yaml")
"${compose[@]}" --profile tools run --rm -e "OWNER_CRM_BACKUP_PATH=/backups/$run_id" backup

sql=$(find "$stage" -maxdepth 1 -type f -name '*.sql.gz' -printf '%f\n' | sort)
public=$(find "$stage" -maxdepth 1 -type f -name '*-files.tar' ! -name '*-private-files.tar' -printf '%f\n' | sort)
private=$(find "$stage" -maxdepth 1 -type f -name '*-private-files.tar' -printf '%f\n' | sort)
config=$(find "$stage" -maxdepth 1 -type f -name '*site_config_backup.json' -printf '%f\n' | sort)
[[ $(printf '%s\n' "$sql" | sed '/^$/d' | wc -l) -eq 1 ]] || fail "expected one native SQL backup"
[[ $(printf '%s\n' "$public" | sed '/^$/d' | wc -l) -eq 1 ]] || fail "expected one public-files archive"
[[ $(printf '%s\n' "$private" | sed '/^$/d' | wc -l) -eq 1 ]] || fail "expected one private-files archive"
[[ $(printf '%s\n' "$config" | sed '/^$/d' | wc -l) -eq 1 ]] || fail "expected one native site-config archive"
tar -tf "$stage/$public" | LC_ALL=C sort > "$stage/public-files.members"
tar -tf "$stage/$private" | LC_ALL=C sort > "$stage/private-files.members"
jq -e . "$stage/$config" >/dev/null
kwargs=$(jq -cn --argjson names "$custom_field_names" '{doctype:"Custom Field",filters:{name:["in",$names]},fields:["name","dt","fieldname","label","fieldtype","options","insert_after","reqd","hidden","read_only"],order_by:"name asc"}')
"${compose[@]}" exec -T backend bench --site "$site" execute frappe.get_all --kwargs "$kwargs" | jq -S . > "$stage/custom-fields.json"
jq -e --argjson expected "$custom_field_names" 'length == 8 and (map(.name) == $expected)' "$stage/custom-fields.json" >/dev/null || fail "the exact eight expected custom fields are not present"
(
  cd "$stage"
  sha256sum "$sql" "$public" "$private" "$config" custom-fields.json public-files.members private-files.members > SHA256SUMS
)
source_sha=$(git -C "$root_dir" rev-parse HEAD)
jq -n --arg backup_id "$run_id" --arg site "$site" --arg source_sha "$source_sha" \
  --arg sql "$sql" --arg public "$public" --arg private "$private" --arg config "$config" \
  --arg custom_fields_sha "$(sha256sum "$stage/custom-fields.json" | awk '{print $1}')" \
  --arg public_members_sha "$(sha256sum "$stage/public-files.members" | awk '{print $1}')" \
  --arg private_members_sha "$(sha256sum "$stage/private-files.members" | awk '{print $1}')" \
  '{backup_id:$backup_id,site:$site,source_sha:$source_sha,scope:"local-only",off_host:false,rpo_claim:false,native:{sql:$sql,public_files:$public,private_files:$private,site_config:$config},manifests:{custom_fields_sha256:$custom_fields_sha,public_files_members_sha256:$public_members_sha,private_files_members_sha256:$private_members_sha}}' > "$stage/receipt.json"
chown -R root:root "$stage"
chmod -R go-rwx "$stage"
mv "$stage" "$final"
printf '%s\n' "$run_id" > "$backup_root/LATEST"
chown root:root "$backup_root/LATEST"
chmod 0600 "$backup_root/LATEST"
echo "local-only native backup recorded at $final"

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
file_manifest() {
  python3 - "$1" <<'PY'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1])
if not root.is_dir():
    raise SystemExit("missing restored files directory")
items = []
for path in sorted(p for p in root.rglob("*") if p.is_file()):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    items.append({"path": str(path.relative_to(root)), "sha256": digest})
print(json.dumps(items, sort_keys=True, separators=(",", ":")))
PY
}

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
restore_id="restore-$(printf '%s' "${run_id#local-}" | tr '[:upper:]' '[:lower:]')"
[[ "$restore_id" =~ ^restore-[0-9]{8}t[0-9]{6}z-[0-9a-f]{12}$ ]] || fail "unsafe restore id"
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
install -d -m 0700 -o root -g root "$drill_root/expected-public" "$drill_root/expected-private"
cp -a "$archive/$sql" "$archive/$public" "$archive/$private" "$archive/$config" "$drill_root/input/"
chown "$frappe_uid:$frappe_gid" "$drill_root/input/"*
for artifact in "$public" "$private"; do
  tar -tf "$archive/$artifact" | grep -Eq '^(\./.*)?$' || fail "native archive has an unsupported files-root layout"
done
tar --no-same-owner --no-same-permissions -xf "$archive/$public" -C "$drill_root/expected-public"
tar --no-same-owner --no-same-permissions -xf "$archive/$private" -C "$drill_root/expected-private"
compose=(docker compose --project-name "$project" --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/restore-drill.compose.yaml")
on_failure() {
  rc=$?
  trap - EXIT
  if (( rc != 0 )); then
    "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
    echo "owner-crm restore-drill: preserved failed drill resources at $drill_root" >&2
  fi
  exit "$rc"
}
trap on_failure EXIT
export OWNER_CRM_DRILL_ROOT="$drill_root"
export OWNER_CRM_DRILL_SITE="$site"
export OWNER_CRM_BACKUP_SQL="/backup/$sql"
export OWNER_CRM_BACKUP_PUBLIC="/backup/$public"
export OWNER_CRM_BACKUP_PRIVATE="/backup/$private"
export OWNER_CRM_BACKUP_CONFIG="/backup/$config"
"${compose[@]}" up -d db redis-cache redis-queue
"${compose[@]}" run --rm restore
apps=$("${compose[@]}" run --rm verify-apps)
printf '%s\n' "$apps" | grep -Eq '^frappe([[:space:]]|$)' || fail "restored Frappe app is absent"
for app in crm telephony helpdesk; do printf '%s\n' "$apps" | grep -Eq "^${app}([[:space:]]|$)" || fail "restored $app app is absent"; done
kwargs=$(jq -cn --argjson names "$(jq -c 'map(.name)' "$archive/custom-fields.json")" '{doctype:"Custom Field",filters:{name:["in",$names]},fields:["name","dt","fieldname","label","fieldtype","options","insert_after","reqd","hidden","read_only","unique"],order_by:"name asc"}')
"${compose[@]}" run --rm -e "OWNER_CRM_CUSTOM_FIELDS_KWARGS=$kwargs" verify-custom-fields | jq -S 'sort_by(.name)' > "$drill_root/restored-custom-fields.json"
cmp -s "$archive/custom-fields.json" "$drill_root/restored-custom-fields.json" || fail "restored custom-field definitions differ from backup manifest"
restored_config="$drill_root/sites/$site/site_config.json"
test -f "$restored_config" && test ! -L "$restored_config" || fail "restored site config is missing"
for key in db_type mute_emails enable_scheduler; do
  source_value=$(jq -c --arg key "$key" '.[$key]' "$archive/$config")
  restored_value=$(jq -c --arg key "$key" '.[$key]' "$restored_config")
  test "$source_value" = "$restored_value" || fail "restored safe config key differs: $key"
done
file_manifest "$drill_root/expected-public" > "$drill_root/expected-public-content.json"
file_manifest "$drill_root/expected-private" > "$drill_root/expected-private-content.json"
file_manifest "$drill_root/sites/$site/public/files" > "$drill_root/restored-public-content.json"
file_manifest "$drill_root/sites/$site/private/files" > "$drill_root/restored-private-content.json"
cmp -s "$drill_root/expected-public-content.json" "$drill_root/restored-public-content.json" || fail "restored public files differ from native archive"
cmp -s "$drill_root/expected-private-content.json" "$drill_root/restored-private-content.json" || fail "restored private files differ from native archive"
source_custom_sha=$(sha256sum "$archive/custom-fields.json" | awk '{print $1}')
restored_custom_sha=$(sha256sum "$drill_root/restored-custom-fields.json" | awk '{print $1}')
public_content_sha=$(sha256sum "$drill_root/restored-public-content.json" | awk '{print $1}')
private_content_sha=$(sha256sum "$drill_root/restored-private-content.json" | awk '{print $1}')
public_file_count=$(jq 'length' "$drill_root/restored-public-content.json")
private_file_count=$(jq 'length' "$drill_root/restored-private-content.json")
# Fixture provenance: these harmless files and encrypted value are created only in
# this restored temporary source site, then captured in a second native backup.
fixture_site="fixture-$restore_id.crm.internal"
[[ "$fixture_site" =~ ^fixture-restore-[0-9]{8}t[0-9]{6}z-[0-9a-f]{12}\.crm\.internal$ ]] || fail "unsafe fixture site"
install -d -m 0700 -o "$frappe_uid" -g "$frappe_gid" "$drill_root/fixture-input" "$drill_root/fixture-backup"
printf '%s' 'owner-crm staged public attachment fixture' > "$drill_root/fixture-input/public.txt"
printf '%s' 'owner-crm staged private attachment fixture' > "$drill_root/fixture-input/private.txt"
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())' > "$drill_root/fixture-input/encryption-key"
openssl rand -hex 32 > "$drill_root/fixture-input/secret"
chown "$frappe_uid:$frappe_gid" "$drill_root/fixture-input/"*
chmod 0600 "$drill_root/fixture-input/"*
export OWNER_CRM_FIXTURE_SITE="$fixture_site"
"${compose[@]}" run --rm fixture-seed
"${compose[@]}" run --rm fixture-backup
fixture_config=$(find "$drill_root/fixture-backup" -maxdepth 1 -type f -name '*site_config_backup.json' -print -quit)
test -n "$fixture_config" && test ! -L "$fixture_config" || fail "fixture native config backup is missing"
test -n "$(jq -r '.encryption_key // empty' "$fixture_config")" || fail "fixture native backup did not capture encryption key"
"${compose[@]}" run --rm fixture-restore
"${compose[@]}" run --rm fixture-verify
fixture_config_key_sha=$(jq -r '.encryption_key' "$fixture_config" | sha256sum | awk '{print $1}')
fixture_restored_key_sha=$(jq -r '.encryption_key' "$drill_root/sites/$fixture_site/site_config.json" | sha256sum | awk '{print $1}')
test "$fixture_config_key_sha" = "$fixture_restored_key_sha" || fail "fixture encryption key differs after restore"
fixture_public_count=$(find "$drill_root/sites/$fixture_site/public/files" -type f -name 'owner-crm-fixture-public*' | wc -l)
fixture_private_count=$(find "$drill_root/sites/$fixture_site/private/files" -type f -name 'owner-crm-fixture-private*' | wc -l)
fixture_public_total=$(find "$drill_root/sites/$fixture_site/public/files" -type f | wc -l)
fixture_private_total=$(find "$drill_root/sites/$fixture_site/private/files" -type f | wc -l)
test "$fixture_public_count" -ge 1 && test "$fixture_private_count" -ge 1 || fail "fixture attachments are absent after restore"
"${compose[@]}" down --volumes --remove-orphans || fail "temporary compose cleanup failed; no success receipt was published"
test -f "$drill_root/.owner-crm-restore-drill" && test ! -L "$drill_root/.owner-crm-restore-drill" && grep -Fxq "$restore_id" "$drill_root/.owner-crm-restore-drill" || fail "temporary drill marker changed"
case "$(readlink -f "$drill_root")" in "$drill_root_base"/*) rm -rf -- "$drill_root" ;; *) fail "refusing to retire an unexpected drill path" ;; esac
test ! -e "$drill_root" || fail "temporary drill root remains; no success receipt was published"
trap - EXIT
tmp_receipt="$archive/.drill-receipt.$$"
test ! -e "$tmp_receipt" || fail "temporary receipt path already exists"
jq --arg restore_id "$restore_id" --arg site "$site" --arg apps_sha "$(printf '%s\n' "$apps" | sha256sum | awk '{print $1}')" --arg source_custom_sha "$source_custom_sha" --arg restored_custom_sha "$restored_custom_sha" --arg public_content_sha "$public_content_sha" --arg private_content_sha "$private_content_sha" --argjson public_file_count "$public_file_count" --argjson private_file_count "$private_file_count" --arg fixture_config_key_sha "$fixture_config_key_sha" --arg fixture_restored_key_sha "$fixture_restored_key_sha" --argjson fixture_public_count "$fixture_public_count" --argjson fixture_private_count "$fixture_private_count" --argjson fixture_public_total "$fixture_public_total" --argjson fixture_private_total "$fixture_private_total" \
  '. + {restore_drill:{restore_id:$restore_id,site:$site,network:"internal-only temporary compose project",mail_disabled:true,scheduler_disabled:true,apps_sha256:$apps_sha,custom_fields_source_sha256:$source_custom_sha,custom_fields_restored_sha256:$restored_custom_sha,custom_fields_match:($source_custom_sha == $restored_custom_sha),files:{public_content_sha256:$public_content_sha,private_content_sha256:$private_content_sha,public_file_count:$public_file_count,private_file_count:$private_file_count,content_match:true,nonempty_attachment_recovery_verified:(($public_file_count + $private_file_count) > 0)},config:{safe_keys_verified:["db_type","mute_emails","enable_scheduler"],database_credentials_restored:false,encryption_key_roundtrip_verified:false,encrypted_credentials_roundtrip_verified:false},staged_fixture:{provenance:"created only after base backup restore in temporary source site; not claimed as live backup content",native_backup_with_files:true,encryption_key_source_sha256:$fixture_config_key_sha,encryption_key_restored_sha256:$fixture_restored_key_sha,encryption_key_match:($fixture_config_key_sha == $fixture_restored_key_sha),encrypted_secret_roundtrip_verified:true,file_url_content_verified:true,public_attachment_count:$fixture_public_count,private_attachment_count:$fixture_private_count,public_file_total:$fixture_public_total,private_file_total:$fixture_private_total,nonempty_attachment_roundtrip_verified:(($fixture_public_count + $fixture_private_count) > 0)},cleanup:"verified and completed"}}' "$archive/receipt.json" > "$tmp_receipt"
chown root:root "$tmp_receipt"
chmod 0600 "$tmp_receipt"
mv "$tmp_receipt" "$archive/drill-receipt.json"
echo "isolated local restore drill passed; receipt: $archive/drill-receipt.json"

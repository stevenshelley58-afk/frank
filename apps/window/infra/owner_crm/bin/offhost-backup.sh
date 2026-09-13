#!/usr/bin/env bash
# Manual, fail-closed off-host copy of native owner recovery artifacts.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
secret=/srv/frank/secrets/owner-backup-r2.env
backup_root=/srv/frank/backups/owner-crm
fail(){ echo "owner-crm offhost backup: $*" >&2; exit 2; }
[[ ${1:-} == --offhost ]] || { echo 'preview: off-host backup disabled; pass --offhost with an escrowed R2/restic configuration'; exit 0; }
[[ -f $secret && ! -L $secret && $(stat -c '%u:%a' "$secret") == 0:600 ]] || fail 'missing or unsafe root-only R2 configuration'
set -a; source "$secret"; set +a
[[ ${OWNER_BACKUP_OFFHOST_ENABLED:-0} == 1 ]] || fail 'off-host backup is explicitly disabled'
[[ ${RESTIC_REPOSITORY:-} =~ ^s3:https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com/[a-z0-9][a-z0-9-]{2,62}(/[-a-zA-Z0-9_/]+)?$ ]] || fail 'RESTIC_REPOSITORY must be an explicit R2 S3 target'
[[ -f ${RESTIC_PASSWORD_FILE:-} && ! -L ${RESTIC_PASSWORD_FILE:-/missing} && $(stat -c '%u:%a' "$RESTIC_PASSWORD_FILE") == 0:600 ]] || fail 'missing restic password escrow file'
command -v restic >/dev/null || fail 'restic is not installed'
"$root/bin/local-backup.sh"
local_id=$(cat "$backup_root/LATEST")
local_dir="$backup_root/$local_id"
[[ -d $local_dir && ! -L $local_dir ]] || fail 'native Frappe archive missing'
# Mautic and ntfy additions are supplied only by explicit root-owned paths; no broad host traversal.
for item in "${OWNER_BACKUP_MAUTIC_DUMP:-}" "${OWNER_BACKUP_MAUTIC_CONFIG:-}" "${OWNER_BACKUP_MAUTIC_MEDIA:-}" "${OWNER_BACKUP_NTFY_STATE:-}"; do
 [[ -n $item && -e $item && ! -L $item ]] || fail 'required explicit Mautic/ntfy artifact missing'
done
manifest=$(mktemp "$backup_root/.offhost-manifest.XXXXXX")
trap 'rm -f "$manifest"' EXIT
printf '%s\n' "$local_dir" "$OWNER_BACKUP_MAUTIC_DUMP" "$OWNER_BACKUP_MAUTIC_CONFIG" "$OWNER_BACKUP_MAUTIC_MEDIA" "$OWNER_BACKUP_NTFY_STATE" > "$manifest"
restic backup --tag owner-crm --tag "$local_id" --files-from "$manifest"
restic snapshots --tag "$local_id" --json > "$local_dir/offhost-restic-snapshot.json"
chmod 0600 "$local_dir/offhost-restic-snapshot.json"
echo "off-host restic snapshot recorded for $local_id"

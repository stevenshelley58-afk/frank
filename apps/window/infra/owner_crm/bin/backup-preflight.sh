#!/usr/bin/env bash
# No backup is created here. This gate prevents pretending that a local dump is
# protected before an off-host age identity and a restore exercise exist.
set -euo pipefail
secret_file=${OWNER_CRM_SECRET_FILE:-/srv/frank/secrets/owner-crm.env}
test -r "$secret_file" || { echo "missing owner CRM secret file" >&2; exit 1; }
value() { sed -n "s/^$1=//p" "$secret_file" | tail -n1; }
recipient=$(value OWNER_CRM_BACKUP_RECIPIENT)
backup_root=$(value OWNER_CRM_BACKUP_ROOT)
command -v age >/dev/null || { echo "age is not installed; encrypted backup is not ready" >&2; exit 1; }
printf '%s' "$recipient" | grep -Eq '^age1[0-9a-z]+$' || { echo "OWNER_CRM_BACKUP_RECIPIENT must be an age public recipient" >&2; exit 1; }
test -n "$backup_root" || { echo "OWNER_CRM_BACKUP_ROOT is required" >&2; exit 1; }
test "$(dirname "$backup_root")" != /srv/frank/owner-crm || { echo "backup root must not be inside the live runtime root" >&2; exit 1; }
echo "backup prerequisites are present. Do not enable scheduled backups until the off-host age identity is escrowed and a restore is recorded."

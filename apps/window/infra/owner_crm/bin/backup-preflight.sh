#!/usr/bin/env bash
# No backup is created here. This gate prevents calling a local dump protected
# before an off-host age identity and a restore exercise exist.
set -euo pipefail
secret_file=/srv/frank/secrets/owner-crm.env
runtime_root=/srv/frank/owner-crm
test -f "$secret_file" && test ! -L "$secret_file" || { echo "missing regular owner CRM secret file" >&2; exit 1; }
test "$(stat -c %a "$secret_file")" = 600 && test "$(stat -c %u "$secret_file")" = 0 || { echo "owner CRM secret file is unsafe" >&2; exit 1; }
value() { sed -n "s/^$1=//p" "$secret_file" | tail -n1; }
recipient=$(value OWNER_CRM_BACKUP_RECIPIENT)
backup_root=$(value OWNER_CRM_BACKUP_ROOT)
command -v age >/dev/null || { echo "age is not installed; encrypted backup is not ready" >&2; exit 1; }
printf '%s' "$recipient" | grep -Eq '^age1[0-9a-z]+$' || { echo "OWNER_CRM_BACKUP_RECIPIENT must be an age public recipient" >&2; exit 1; }
test -n "$backup_root" || { echo "OWNER_CRM_BACKUP_ROOT is required" >&2; exit 1; }
backup_root=$(readlink -m "$backup_root")
runtime_root=$(readlink -m "$runtime_root")
test ! -L "$backup_root" || { echo "backup root must not be a symlink" >&2; exit 1; }
case "$backup_root" in "$runtime_root"|"$runtime_root"/*) echo "backup root must be outside the live runtime root" >&2; exit 1;; esac
echo "backup prerequisites are present. Do not enable scheduled backups until the off-host age identity is escrowed and a restore is recorded."

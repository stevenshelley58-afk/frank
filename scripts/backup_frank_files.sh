#!/usr/bin/env bash
set -euo pipefail

read_env() {
  key="$1"
  default="$2"
  value=""
  if [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//')"
  fi
  printf '%s' "${value:-$default}"
}

BACKUP_ROOT="$(read_env FRANK_BACKUP_ROOT /opt/frank-backups)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/files"
backup_path="${backup_dir}/frank-files-${timestamp}.tar.gz"

mkdir -p "${backup_dir}"

tar \
  --exclude='./node_modules' \
  --exclude='./.turbo' \
  --exclude='./apps/*/dist' \
  --exclude='./packages/*/dist' \
  --exclude='./runtime/hermes' \
  --exclude='./runtime/artifacts' \
  --exclude='./runtime/backups' \
  --exclude='./workspaces' \
  -czf "${backup_path}" \
  -C . .

if [ ! -s "${backup_path}" ]; then
  echo "File backup was not created or is empty." >&2
  exit 1
fi

echo "${backup_path}"

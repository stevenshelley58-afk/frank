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
POSTGRES_DB="$(read_env POSTGRES_DB frank)"
POSTGRES_USER="$(read_env POSTGRES_USER frank)"
POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD "")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/postgres"
backup_path="${backup_dir}/frank-postgres-${timestamp}.dump"

if [ -z "${POSTGRES_PASSWORD}" ]; then
  echo "POSTGRES_PASSWORD is missing." >&2
  exit 1
fi

mkdir -p "${backup_dir}"

docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc -f "/tmp/frank-postgres-${timestamp}.dump"

docker compose cp "postgres:/tmp/frank-postgres-${timestamp}.dump" "${backup_path}" >/dev/null
docker compose exec -T postgres rm -f "/tmp/frank-postgres-${timestamp}.dump" >/dev/null

if [ ! -s "${backup_path}" ]; then
  echo "Postgres backup was not created or is empty." >&2
  exit 1
fi

echo "${backup_path}"

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/import_c_dev_projects.sh --dry-run
  bash scripts/import_c_dev_projects.sh --apply

Registers the C:\Dev inventory as Frank Hub projects. Project workspaces are
created as registry records under /opt/frank-projects/<slug>; the original
Windows paths are stored as metadata only.
USAGE
}

read_env() {
  key="$1"
  default="$2"
  value="${!key:-}"

  if [ -z "${value}" ] && [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//')"
  fi

  printf '%s' "${value:-$default}"
}

mode="${1:-}"
case "${mode}" in
  --dry-run)
    dry_run=true
    ;;
  --apply)
    dry_run=false
    ;;
  -h|--help|"")
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

sql_file="dev/c-dev-projects.seed.sql"
if [ ! -f "${sql_file}" ]; then
  echo "Missing ${sql_file}. Run this from the Frank repo root or pull the latest repo." >&2
  exit 1
fi

POSTGRES_DB="$(read_env POSTGRES_DB frank)"
POSTGRES_USER="$(read_env POSTGRES_USER frank)"
POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD "")"

if [ -z "${POSTGRES_PASSWORD}" ]; then
  echo "POSTGRES_PASSWORD is missing. Set it in .env or the shell before running this importer." >&2
  exit 1
fi

if [ "${dry_run}" = "true" ]; then
  echo "Dry-running C:\\Dev project import..."
else
  echo "Applying C:\\Dev project import..."
fi

docker compose exec -T \
  -e PGPASSWORD="${POSTGRES_PASSWORD}" \
  postgres \
  psql \
    -v ON_ERROR_STOP=1 \
    -v dry_run="${dry_run}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
  < "${sql_file}"

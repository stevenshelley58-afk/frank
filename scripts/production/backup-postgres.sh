#!/usr/bin/env bash

# Produce one atomic, checksummed logical backup set for the live FRANK database.
# This script reads database credentials only from the container's existing runtime
# environment and never prints or copies those values.

set +x
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="$(basename -- "${BASH_SOURCE[0]}")"

log() {
  local -r level="$1"
  shift
  printf '%s %s %s: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$PROGRAM_NAME" "$*" >&2
}

die() {
  log ERROR "$*"
  exit 1
}

on_error() {
  local -r status="$1"
  local -r line="$2"
  log ERROR "failed at line ${line} with exit status ${status}"
  return "$status"
}

trap 'on_error "$?" "$LINENO"' ERR

staging_dir=""
backup_root=""

cleanup() {
  local -r status="$?"
  trap - EXIT

  if [[ -n "$staging_dir" && -n "$backup_root" && -d "$staging_dir" ]]; then
    case "$staging_dir" in
      "$backup_root"/.frank-postgres-*.partial.*)
        rm -r --one-file-system -- "$staging_dir"
        ;;
      *)
        log ERROR "refusing to remove unexpected temporary path"
        ;;
    esac
  fi

  exit "$status"
}

trap cleanup EXIT

require_command() {
  local -r command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "required command is unavailable: $command_name"
}

for command_name in awk basename chmod date docker find flock git gzip install mktemp mv realpath rm sha256sum stat; do
  require_command "$command_name"
done

readonly container="${FRANK_DB_CONTAINER:-frank-frank-db-1}"
readonly configured_backup_root="${FRANK_BACKUP_DIR:-/frank/deployed/backups/postgres}"
readonly retention_days="${FRANK_BACKUP_RETENTION_DAYS:-35}"
readonly repo_path="${FRANK_REPO_PATH:-/projects/frank}"

[[ "$container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "FRANK_DB_CONTAINER is not a valid container name"
[[ "$configured_backup_root" == /* ]] || die "FRANK_BACKUP_DIR must be an absolute path"
[[ "$retention_days" =~ ^[0-9]+$ ]] || die "FRANK_BACKUP_RETENTION_DAYS must be an integer"
(( retention_days >= 1 && retention_days <= 3650 )) || die "FRANK_BACKUP_RETENTION_DAYS must be between 1 and 3650"

install -d -m 0700 -- "$configured_backup_root"
backup_root="$(realpath -e -- "$configured_backup_root")"

case "$backup_root" in
  /|/root|/srv|/frank/deployed|/frank/deployed/backups|/var|/var/backups)
    die "FRANK_BACKUP_DIR resolves to a path that is too broad for retention cleanup"
    ;;
esac

exec 9>"$backup_root/.backup.lock"
flock -n 9 || die "another FRANK PostgreSQL backup is already running"

docker info >/dev/null 2>&1 || die "Docker daemon is unavailable"
docker inspect "$container" >/dev/null 2>&1 || die "database container does not exist: $container"

readonly container_state="$(docker inspect --format '{{.State.Status}}' "$container")"
[[ "$container_state" == "running" ]] || die "database container is not running"

readonly container_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")"
[[ "$container_health" == "none" || "$container_health" == "healthy" ]] || die "database container health is not healthy"

docker exec "$container" sh -ceu '
  test -n "${POSTGRES_USER:-}"
  test -n "${POSTGRES_DB:-}"
  command -v pg_dump >/dev/null
' >/dev/null 2>&1 || die "database runtime prerequisites are unavailable"

readonly created_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
readonly timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
readonly stem="frank-postgres-${timestamp}"
readonly backup_filename="${stem}.sql.gz"
readonly final_dir="$backup_root/$stem"

[[ ! -e "$final_dir" ]] || die "backup destination already exists for timestamp $timestamp"

staging_dir="$(mktemp -d -p "$backup_root" ".${stem}.partial.XXXXXX")"
readonly staged_backup="$staging_dir/$backup_filename"
readonly staged_checksums="$staging_dir/SHA256SUMS"
readonly staged_manifest="$staging_dir/manifest.env"

log INFO "creating logical backup from container $container"
docker exec "$container" sh -ceu '
  exec pg_dump \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --format=plain \
    --encoding=UTF8 \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges
' | gzip -9 > "$staged_backup"

[[ -s "$staged_backup" ]] || die "pg_dump produced an empty backup"
gzip -t -- "$staged_backup"

readonly backup_sha256="$(sha256sum "$staged_backup" | awk '{print $1}')"
readonly backup_bytes="$(stat -c '%s' "$staged_backup")"
readonly container_image_id="$(docker inspect --format '{{.Image}}' "$container")"

source_commit="unavailable"
if [[ -d "$repo_path/.git" || -f "$repo_path/.git" ]]; then
  source_commit="$(git -C "$repo_path" rev-parse HEAD 2>/dev/null || printf 'unavailable')"
fi
readonly source_commit

printf '%s  %s\n' "$backup_sha256" "$backup_filename" > "$staged_checksums"
printf '%s\n' \
  'format=frank-postgres-backup-v1' \
  "created_at_utc=$created_at" \
  "backup_file=$backup_filename" \
  "sha256=$backup_sha256" \
  "bytes=$backup_bytes" \
  "container=$container" \
  "container_image_id=$container_image_id" \
  "source_commit=$source_commit" \
  "retention_days=$retention_days" > "$staged_manifest"

chmod 0600 -- "$staged_backup" "$staged_checksums" "$staged_manifest"
(
  cd -- "$staging_dir"
  sha256sum --check --status SHA256SUMS
)

mv -- "$staging_dir" "$final_dir"
staging_dir=""

readonly retention_minutes="$((retention_days * 24 * 60))"
pruned_count=0
while IFS= read -r -d '' candidate; do
  candidate_name="${candidate##*/}"
  [[ "$candidate_name" =~ ^frank-postgres-[0-9]{8}T[0-9]{6}Z$ ]] || die "retention selected an unexpected directory name"

  candidate_real="$(realpath -e -- "$candidate")"
  [[ "${candidate_real%/*}" == "$backup_root" ]] || die "retention selected a path outside the backup root"

  rm -r --one-file-system -- "$candidate_real"
  ((pruned_count += 1))
done < <(
  find "$backup_root" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -name 'frank-postgres-20??????T??????Z' \
    -mmin "+$retention_minutes" \
    -print0
)

log INFO "backup completed and verified; pruned $pruned_count expired backup set(s)"
printf 'backup_set=%s\n' "$final_dir"
printf 'backup_file=%s\n' "$final_dir/$backup_filename"
printf 'sha256_file=%s\n' "$final_dir/SHA256SUMS"
printf 'manifest_file=%s\n' "$final_dir/manifest.env"
printf 'sha256=%s\n' "$backup_sha256"
printf 'bytes=%s\n' "$backup_bytes"
printf 'retention_pruned=%s\n' "$pruned_count"

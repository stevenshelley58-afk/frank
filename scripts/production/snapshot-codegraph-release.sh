#!/usr/bin/env bash

# Capture the complete pre-Graphify application rollback unit before mutation.
set +x
set -Eeuo pipefail
umask 077

die() { printf 'snapshot-codegraph-release: %s\n' "$*" >&2; exit 1; }
for command_name in date docker install jq realpath sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || die "missing command: $command_name"
done

readonly backup_root="${FRANK_CODEGRAPH_BACKUP_ROOT:-/srv/frank/backups/codegraph}"
readonly release_id="${FRANK_RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
readonly overlay="${FRANK_PRE_RELEASE_OVERLAY:-/srv/frank/repo/infra/production/docker-compose.app.yml}"
readonly caddyfile="${FRANK_PRE_RELEASE_CADDYFILE:-/srv/frank/infra/Caddyfile}"
readonly volume_override="${FRANK_CODEGRAPH_PHYSICAL_VOLUME:-}"
readonly logical_volume="${FRANK_CODEGRAPH_LOGICAL_VOLUME:-frank_codegraph_data}"
readonly compose_project="${FRANK_COMPOSE_PROJECT_NAME:-frank}"
readonly api_container="${FRANK_API_CONTAINER:-frank-frank-api-1}"
readonly web_container="${FRANK_WEB_CONTAINER:-frank-web}"
readonly codegraph_container="${FRANK_CODEGRAPH_CONTAINER:-frank-codegraph}"

[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "FRANK_RELEASE_ID is invalid"
[[ "$backup_root" == '/srv/frank/backups/codegraph' ]] || die "refusing unexpected backup root"
[[ "$logical_volume" == 'frank_codegraph_data' ]] || die "refusing unexpected logical codegraph volume"
[[ "$compose_project" == 'frank' ]] || die "refusing unexpected Compose project"
[[ -z "$volume_override" || "$volume_override" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$ ]] || die "invalid physical volume override"
[[ -f "$overlay" && ! -L "$overlay" ]] || die "pre-release overlay must be a regular non-linked file"
[[ "$caddyfile" == '/srv/frank/infra/Caddyfile' ]] || die "refusing unexpected pre-release Caddyfile"
[[ -f "$caddyfile" && ! -L "$caddyfile" ]] || die "pre-release Caddyfile must be a regular non-linked file"

declare -a matching_volumes=()
while IFS= read -r candidate_volume; do
  [[ -n "$candidate_volume" ]] || continue
  candidate_logical="$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "$candidate_volume" 2>/dev/null || true)"
  if [[ "$candidate_logical" == "$logical_volume" ]]; then
    matching_volumes+=("$candidate_volume")
  fi
done < <(docker inspect "$codegraph_container" | jq -r '.[0].Mounts[] | select(.Type == "volume") | .Name')
(( ${#matching_volumes[@]} == 1 )) || die "expected exactly one mounted Compose codegraph volume"
discovered_volume="${matching_volumes[0]}"
[[ "$discovered_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$ ]] || die "discovered physical volume name is invalid"
if [[ -n "$volume_override" && "$volume_override" != "$discovered_volume" ]]; then
  die "FRANK_CODEGRAPH_PHYSICAL_VOLUME does not match the running codegraph mount"
fi
readonly volume="${volume_override:-$discovered_volume}"
readonly discovered_logical="$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "$volume")"
readonly discovered_project="$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume")"
[[ "$discovered_logical" == "$logical_volume" ]] || die "physical volume has the wrong Compose logical-volume label"
[[ "$discovered_project" == "$compose_project" ]] || die "physical volume has the wrong Compose project label"

install -d -m 0700 -- "$backup_root"
readonly backup_root_real="$(realpath -e -- "$backup_root")"
readonly snapshot="$backup_root/$release_id"
[[ ! -e "$snapshot" ]] || die "snapshot already exists: $snapshot"
install -d -m 0700 -- "$snapshot"
readonly snapshot_real="$(realpath -e -- "$snapshot")"
[[ "$snapshot_real" == "$backup_root_real/$release_id" ]] || die "snapshot escaped backup root"

install -m 0600 -- "$overlay" "$snapshot_real/pre-release-overlay.yml"
install -m 0600 -- "$caddyfile" "$snapshot_real/pre-release-Caddyfile"
printf 'service\tcontainer\tconfigured_image\timage_id\n' > "$snapshot_real/images.tsv"

declare -a image_references=()
codegraph_image=''
for entry in \
  "frank-api:$api_container" \
  "frank-web:$web_container" \
  "frank-codegraph:$codegraph_container"; do
  service="${entry%%:*}"
  container="${entry#*:}"
  configured_image="$(docker inspect --format '{{.Config.Image}}' "$container")"
  image_id="$(docker inspect --format '{{.Image}}' "$container")"
  [[ "$configured_image" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]+$ ]] || die "unsafe image reference for $container"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "invalid image identity for $container"
  docker image inspect "$configured_image" >/dev/null 2>&1 || die "image is unavailable: $configured_image"
  printf '%s\t%s\t%s\t%s\n' "$service" "$container" "$configured_image" "$image_id" >> "$snapshot_real/images.tsv"
  image_references+=("$configured_image")
  [[ "$service" != 'frank-codegraph' ]] || codegraph_image="$configured_image"
done

docker image save --output "$snapshot_real/application-images.tar" "${image_references[@]}"
docker volume inspect "$volume" --format '{{.Name}}' > "$snapshot_real/codegraph-volume.txt"
printf 'physical\tlogical\tproject\n%s\t%s\t%s\n' \
  "$volume" "$discovered_logical" "$discovered_project" \
  > "$snapshot_real/codegraph-volume-labels.tsv"

# The pre-release codegraph image is the most reliable archive tool already
# present on the host. It receives only a read-only source volume, no network,
# and a dedicated root-owned backup directory. Briefly pause the sole writer so
# the archive is a point-in-time filesystem image, and always unpause on error.
paused=false
unpause_writer() {
  if [[ "$paused" == "true" ]]; then
    docker unpause "$codegraph_container" >/dev/null 2>&1 || true
  fi
}
trap unpause_writer EXIT
docker pause "$codegraph_container" >/dev/null
paused=true
docker run --rm --network none --user 0:0 --entrypoint /bin/sh \
  --mount "type=volume,source=$volume,target=/source,readonly" \
  --mount "type=bind,source=$snapshot_real,target=/backup" \
  "$codegraph_image" -ceu 'tar -C /source -czf /backup/codegraph-volume.tar.gz .'
docker unpause "$codegraph_container" >/dev/null
paused=false
trap - EXIT

printf 'schema_version=2\n' > "$snapshot_real/SNAPSHOT_COMPLETE"

(
  cd -- "$snapshot_real"
  sha256sum application-images.tar codegraph-volume.tar.gz images.tsv \
    pre-release-overlay.yml pre-release-Caddyfile codegraph-volume.txt \
    codegraph-volume-labels.tsv SNAPSHOT_COMPLETE > SHA256SUMS
  sha256sum --check SHA256SUMS >/dev/null
)

printf 'snapshot=%s\n' "$snapshot_real"
printf 'snapshot=passed\n'

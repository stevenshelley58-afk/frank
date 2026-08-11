#!/usr/bin/env bash

# Restore API, web, legacy Node codegraph, and its named volume as one unit.
set +x
set -Eeuo pipefail
umask 077

die() { printf 'rollback-codegraph-release: %s\n' "$*" >&2; exit 1; }
for command_name in awk cmp docker install jq mktemp mv realpath sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || die "missing command: $command_name"
done

readonly backup_root="${FRANK_CODEGRAPH_BACKUP_ROOT:-/srv/frank/backups/codegraph}"
readonly snapshot_input="${1:-}"
readonly base_compose="${FRANK_BASE_COMPOSE:-/srv/frank/infra/docker-compose.dev.yml}"
readonly caddyfile="${FRANK_CADDYFILE:-/srv/frank/infra/Caddyfile}"
readonly volume_override="${FRANK_CODEGRAPH_PHYSICAL_VOLUME:-}"
readonly logical_volume="${FRANK_CODEGRAPH_LOGICAL_VOLUME:-frank_codegraph_data}"
readonly compose_project="${FRANK_COMPOSE_PROJECT_NAME:-frank}"
readonly codegraph_container="${FRANK_CODEGRAPH_CONTAINER:-frank-codegraph}"
[[ -n "$snapshot_input" ]] || die "usage: rollback-codegraph-release.sh /srv/frank/backups/codegraph/<timestamp>"
[[ "$backup_root" == '/srv/frank/backups/codegraph' ]] || die "refusing unexpected backup root"
[[ "$logical_volume" == 'frank_codegraph_data' ]] || die "refusing unexpected logical codegraph volume"
[[ "$compose_project" == 'frank' ]] || die "refusing unexpected Compose project"
[[ -z "$volume_override" || "$volume_override" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$ ]] || die "invalid physical volume override"
[[ "$caddyfile" == '/srv/frank/infra/Caddyfile' ]] || die "refusing unexpected live Caddyfile"
[[ -d "${caddyfile%/*}" && ! -L "${caddyfile%/*}" ]] || die "live Caddy directory is unsafe"
readonly backup_root_real="$(realpath -e -- "$backup_root")"
readonly snapshot="$(realpath -e -- "$snapshot_input")"
[[ "${snapshot%/*}" == "$backup_root_real" ]] || die "snapshot is outside the bounded backup root"
[[ "${snapshot##*/}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "snapshot name is invalid"
[[ -f "$base_compose" && ! -L "$base_compose" ]] || die "base Compose file is unavailable"

for required_file in \
  SHA256SUMS SNAPSHOT_COMPLETE application-images.tar codegraph-volume.tar.gz \
  images.tsv pre-release-overlay.yml pre-release-Caddyfile codegraph-volume.txt \
  codegraph-volume-labels.tsv; do
  [[ -f "$snapshot/$required_file" && ! -L "$snapshot/$required_file" ]] \
    || die "snapshot is incomplete or unsafe: $required_file"
done
[[ "$(<"$snapshot/SNAPSHOT_COMPLETE")" == 'schema_version=2' ]] \
  || die "snapshot completeness marker is invalid"
for hashed_file in \
  application-images.tar codegraph-volume.tar.gz images.tsv pre-release-overlay.yml \
  pre-release-Caddyfile codegraph-volume.txt codegraph-volume-labels.tsv SNAPSHOT_COMPLETE; do
  awk -v file="$hashed_file" '
    length($1) == 64 && $1 !~ /[^0-9a-f]/ && $2 == file { matches += 1 }
    END { exit(matches == 1 ? 0 : 1) }
  ' "$snapshot/SHA256SUMS" || die "snapshot checksum manifest is incomplete: $hashed_file"
done

(
  cd -- "$snapshot"
  sha256sum --check SHA256SUMS
)
snapshot_volume="$(<"$snapshot/codegraph-volume.txt")"
[[ "$snapshot_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$ ]] || die "snapshot physical volume name is invalid"
discovered_volume=''
if docker inspect "$codegraph_container" >/dev/null 2>&1; then
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
fi
if [[ -n "$volume_override" ]]; then
  [[ -z "$discovered_volume" || "$volume_override" == "$discovered_volume" ]] || die "physical volume override does not match the running codegraph mount"
  volume="$volume_override"
elif [[ -n "$discovered_volume" ]]; then
  volume="$discovered_volume"
else
  die "codegraph container is absent; set FRANK_CODEGRAPH_PHYSICAL_VOLUME to the audited physical volume name"
fi
readonly volume
[[ "$snapshot_volume" == "$volume" ]] || die "snapshot volume identity does not match the active physical volume"
readonly discovered_logical="$(docker volume inspect --format '{{index .Labels "com.docker.compose.volume"}}' "$volume")"
readonly discovered_project="$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume")"
[[ "$discovered_logical" == "$logical_volume" ]] || die "physical volume has the wrong Compose logical-volume label"
[[ "$discovered_project" == "$compose_project" ]] || die "physical volume has the wrong Compose project label"
awk -F '\t' -v physical="$volume" -v logical="$discovered_logical" -v project="$discovered_project" '
  NR == 2 && $1 == physical && $2 == logical && $3 == project { matched = 1 }
  END { exit(matched ? 0 : 1) }
' "$snapshot/codegraph-volume-labels.tsv" || die "snapshot Compose volume labels do not match the active volume"

api_image="$(awk -F '\t' '$1 == "frank-api" {print $3}' "$snapshot/images.tsv")"
web_image="$(awk -F '\t' '$1 == "frank-web" {print $3}' "$snapshot/images.tsv")"
codegraph_image="$(awk -F '\t' '$1 == "frank-codegraph" {print $3}' "$snapshot/images.tsv")"
[[ -n "$api_image" && -n "$web_image" && -n "$codegraph_image" ]] || die "snapshot image manifest is incomplete"
for image in "$api_image" "$web_image" "$codegraph_image"; do
  [[ "$image" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]+$ ]] || die "snapshot contains an unsafe image reference"
done

docker image load --input "$snapshot/application-images.tar" >/dev/null
for image in "$api_image" "$web_image" "$codegraph_image"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "restored image is missing: $image"
done

override="$(mktemp "$snapshot/.rollback-images.XXXXXX.yml")"
caddy_tmp=''
cleanup() { rm -f -- "${override:-}" "${caddy_tmp:-}"; }
trap cleanup EXIT
printf '%s\n' \
  'services:' \
  '  frank-api:' \
  "    image: \"$api_image\"" \
  '  frank-web:' \
  "    image: \"$web_image\"" \
  '  frank-codegraph:' \
  "    image: \"$codegraph_image\"" \
  > "$override"

compose=(docker compose -f "$base_compose" -f "$snapshot/pre-release-overlay.yml" -f "$override")
"${compose[@]}" config --quiet
caddy_tmp="$(mktemp "${caddyfile%/*}/.Caddyfile.rollback.XXXXXX")"
install -o root -g root -m 0644 -- "$snapshot/pre-release-Caddyfile" "$caddy_tmp"
cmp -s -- "$snapshot/pre-release-Caddyfile" "$caddy_tmp" || die "staged Caddy restore differs from snapshot"
"${compose[@]}" stop frank-web frank-api frank-codegraph
"${compose[@]}" rm -f frank-web frank-api frank-codegraph

# The target is the exact audited named volume. The container has no network
# and no host filesystem mount other than the read-only snapshot directory.
docker run --rm --network none --user 0:0 --entrypoint /bin/sh \
  --mount "type=volume,source=$volume,target=/target" \
  --mount "type=bind,source=$snapshot,target=/backup,readonly" \
  "$codegraph_image" -ceu \
  'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -C /target -xzf /backup/codegraph-volume.tar.gz'

mv -f -- "$caddy_tmp" "$caddyfile"
caddy_tmp=''
cmp -s -- "$snapshot/pre-release-Caddyfile" "$caddyfile" || die "restored Caddyfile differs from snapshot"

"${compose[@]}" up -d --no-build --force-recreate --wait --wait-timeout 180 \
  frank-codegraph frank-api frank-web frank-caddy

printf 'rollback_snapshot=%s\n' "$snapshot"
printf 'rollback=passed\n'

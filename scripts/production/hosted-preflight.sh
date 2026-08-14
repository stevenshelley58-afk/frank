#!/usr/bin/env bash

# Read-only release preflight for the hosted FRANK production server.
# Secret values are checked for presence by variable name and are never printed.

set +x
set -Eeuo pipefail

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

require_command() {
  local -r command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "required command is unavailable: $command_name"
}

decimal_lte() {
  local -r value="$1"
  local -r maximum="$2"
  (( ${#value} < ${#maximum} )) || \
    { (( ${#value} == ${#maximum} )) && [[ "$value" < "$maximum" || "$value" == "$maximum" ]]; }
}

for command_name in awk date df docker git jq realpath; do
  require_command "$command_name"
done

readonly repo_path="${FRANK_REPO_PATH:-/projects/frank}"
readonly compose_file="${FRANK_COMPOSE_FILE:-/frank/deployed/infra/docker-compose.dev.yml}"
readonly data_path="${FRANK_DATA_PATH:-/frank/deployed}"
readonly expected_commit="${FRANK_EXPECTED_COMMIT:-}"
readonly expected_branch="${FRANK_EXPECTED_BRANCH:-main}"
readonly required_network="${FRANK_REQUIRED_NETWORK:-frank}"
readonly codegraph_network="${FRANK_CODEGRAPH_NETWORK:-frank-codegraph-internal}"
readonly codegraph_container="${FRANK_CODEGRAPH_CONTAINER:-frank-codegraph}"
readonly allow_legacy_codegraph_network="${FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK:-false}"
readonly disk_gate_mode="${FRANK_DISK_GATE_MODE:-percent}"
readonly disk_gate_phase="${FRANK_DISK_GATE_PHASE:-full}"
readonly max_disk_percent="${FRANK_MAX_DISK_PERCENT:-75}"
readonly min_free_gib="${FRANK_MIN_FREE_GIB:-20}"
readonly release_required_bytes_raw="${FRANK_RELEASE_REQUIRED_BYTES:-}"
readonly rollback_headroom_bytes_raw="${FRANK_ROLLBACK_HEADROOM_BYTES:-}"
readonly release_manifest_file="${FRANK_RELEASE_MANIFEST_FILE:-}"
readonly post_pull_image_proof_file="${FRANK_POST_PULL_IMAGE_PROOF_FILE:-}"
readonly require_upstream_sync="${FRANK_REQUIRE_UPSTREAM_SYNC:-true}"
readonly required_secret_vars_raw="${FRANK_REQUIRED_SECRET_VARS:-FRANK_DB_PASSWORD FRANK_SESSION_SIGNING_KEY FRANK_ENVELOPE_SIGNING_KEY GOOSE_ACP_SECRET}"
readonly required_containers_raw="${FRANK_REQUIRED_CONTAINERS:-frank-frank-db-1 frank-frank-redis-1 frank-frank-api-1 frank-web frank-codegraph frank-frank-caddy-1}"
readonly required_images_raw="${FRANK_REQUIRED_IMAGES:-postgres:17-alpine valkey/valkey:8-alpine caddy:2.8-alpine frank-frank-api frank-frank-web frank-frank-codegraph}"
readonly image_lock_file="${FRANK_IMAGE_LOCK_FILE:-}"
readonly api_image="${FRANK_API_IMAGE:-}"
readonly web_image="${FRANK_WEB_IMAGE:-}"
readonly codegraph_image="${FRANK_CODEGRAPH_IMAGE:-}"
readonly workbench_image="${FRANK_WORKBENCH_IMAGE:-}"
readonly pre_pull_release_required_bytes=21932447888
readonly post_pull_release_required_bytes=11697632908
readonly production_rollback_headroom_bytes=23862108519

[[ "$repo_path" == /* ]] || die "FRANK_REPO_PATH must be absolute"
[[ "$compose_file" == /* ]] || die "FRANK_COMPOSE_FILE must be absolute"
[[ "$data_path" == /* ]] || die "FRANK_DATA_PATH must be absolute"
[[ "$expected_commit" =~ ^[0-9A-Fa-f]{40}$ ]] || die "FRANK_EXPECTED_COMMIT must be a full 40-character commit ID"
[[ "$expected_branch" =~ ^[A-Za-z0-9._/-]+$ ]] || die "FRANK_EXPECTED_BRANCH is invalid"
[[ "$required_network" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "FRANK_REQUIRED_NETWORK is invalid"
[[ "$codegraph_network" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "FRANK_CODEGRAPH_NETWORK is invalid"
[[ "$codegraph_container" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "FRANK_CODEGRAPH_CONTAINER is invalid"
[[ "$allow_legacy_codegraph_network" == "true" || "$allow_legacy_codegraph_network" == "false" ]] || die "FRANK_ALLOW_LEGACY_CODEGRAPH_NETWORK must be true or false"
[[ "$disk_gate_mode" == "percent" || "$disk_gate_mode" == "absolute" ]] || die "FRANK_DISK_GATE_MODE must be percent or absolute"
[[ "$disk_gate_phase" == "full" || "$disk_gate_phase" == "pre-pull" || "$disk_gate_phase" == "post-pull" ]] || die "FRANK_DISK_GATE_PHASE must be full, pre-pull, or post-pull"
[[ "$max_disk_percent" =~ ^[0-9]+$ ]] || die "FRANK_MAX_DISK_PERCENT must be an integer"
[[ "$min_free_gib" =~ ^[0-9]+$ ]] || die "FRANK_MIN_FREE_GIB must be an integer"
(( max_disk_percent >= 1 && max_disk_percent <= 99 )) || die "FRANK_MAX_DISK_PERCENT must be between 1 and 99"
(( min_free_gib >= 1 )) || die "FRANK_MIN_FREE_GIB must be at least 1"
[[ "$require_upstream_sync" == "true" || "$require_upstream_sync" == "false" ]] || die "FRANK_REQUIRE_UPSTREAM_SYNC must be true or false"
[[ "$workbench_image" =~ ^ghcr\.io/[a-z0-9][a-z0-9._-]*/frank-workbench@sha256:[a-f0-9]{64}$ ]] || die "FRANK_WORKBENCH_IMAGE must be a digest-pinned GHCR frank-workbench image"

repo_real="$(realpath -e -- "$repo_path")" || die "repository path does not exist"
compose_real="$(realpath -e -- "$compose_file")" || die "Compose file does not exist"
data_real="$(realpath -e -- "$data_path")" || die "data path does not exist"
readonly repo_real compose_real data_real

git -C "$repo_real" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "FRANK_REPO_PATH is not a Git worktree"

readonly dirty_count="$(git -C "$repo_real" status --porcelain=v1 --untracked-files=normal | awk 'END {print NR + 0}')"
(( dirty_count == 0 )) || die "production worktree is dirty ($dirty_count changed or untracked path(s))"

readonly actual_commit="$(git -C "$repo_real" rev-parse HEAD)"
[[ "$actual_commit" == "${expected_commit,,}" ]] || die "production commit does not match FRANK_EXPECTED_COMMIT"

readonly actual_branch="$(git -C "$repo_real" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'DETACHED')"
[[ "$actual_branch" == "$expected_branch" ]] || die "production branch is $actual_branch, expected $expected_branch"

upstream_ref="$(git -C "$repo_real" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)"
ahead_count="not-checked"
behind_count="not-checked"
if [[ "$require_upstream_sync" == "true" ]]; then
  [[ -n "$upstream_ref" ]] || die "production branch has no configured upstream"
  ahead_count="$(git -C "$repo_real" rev-list --count "${upstream_ref}..HEAD")"
  behind_count="$(git -C "$repo_real" rev-list --count "HEAD..${upstream_ref}")"
  (( ahead_count == 0 && behind_count == 0 )) || die "production branch is not synchronized with its locally known upstream"
fi
readonly upstream_ref ahead_count behind_count

read -r disk_total_kib disk_used_kib disk_available_kib disk_used_percent disk_mount < <(
  df -Pk -- "$data_real" | awk 'NR == 2 {gsub(/%/, "", $5); print $2, $3, $4, $5, $6}'
)
[[ "$disk_used_percent" =~ ^[0-9]+$ ]] || die "could not parse disk usage"
[[ "$disk_available_kib" =~ ^(0|[1-9][0-9]{0,15})$ ]] || die "could not parse free disk space"
decimal_lte "$disk_available_kib" 9007199254740991 || die "free disk space exceeds the signed 64-bit byte range"
disk_available_bytes="$(df -B1 --output=avail -- "$data_real" | awk 'NR == 2 {gsub(/[[:space:]]/, "", $0); print}')"
[[ "$disk_available_bytes" =~ ^(0|[1-9][0-9]{0,18})$ ]] || die "could not parse exact free disk bytes"
decimal_lte "$disk_available_bytes" 9223372036854775807 || die "exact free disk bytes exceed the signed 64-bit range"

readonly min_free_kib="$((min_free_gib * 1024 * 1024))"
readonly disk_available_bytes

release_required_bytes=0
rollback_headroom_bytes=0
release_total_required_bytes=0
case "$disk_gate_mode" in
  percent)
    [[ "$disk_gate_phase" == "full" ]] || die "phase-specific disk gates require FRANK_DISK_GATE_MODE=absolute"
    [[ -z "$release_required_bytes_raw" && -z "$rollback_headroom_bytes_raw" ]] || \
      die "absolute byte inputs require FRANK_DISK_GATE_MODE=absolute"
    (( disk_used_percent <= max_disk_percent )) || \
      die "disk use is ${disk_used_percent}%, above the ${max_disk_percent}% release limit"
    ;;
  absolute)
    [[ "$release_required_bytes_raw" =~ ^[1-9][0-9]{0,18}$ ]] || \
      die "FRANK_RELEASE_REQUIRED_BYTES must be a positive canonical decimal byte count"
    [[ "$rollback_headroom_bytes_raw" =~ ^[1-9][0-9]{0,18}$ ]] || \
      die "FRANK_ROLLBACK_HEADROOM_BYTES must be a positive canonical decimal byte count"
    release_required_bytes="$release_required_bytes_raw"
    rollback_headroom_bytes="$rollback_headroom_bytes_raw"
    decimal_lte "$release_required_bytes" 9223372036854775807 || \
      die "FRANK_RELEASE_REQUIRED_BYTES exceeds the signed 64-bit range"
    decimal_lte "$rollback_headroom_bytes" 9223372036854775807 || \
      die "FRANK_ROLLBACK_HEADROOM_BYTES exceeds the signed 64-bit range"
    (( rollback_headroom_bytes <= 9223372036854775807 - release_required_bytes )) || \
      die "release disk byte requirement overflows the signed 64-bit range"
    release_total_required_bytes="$((release_required_bytes + rollback_headroom_bytes))"
    case "$disk_gate_phase" in
      full|pre-pull)
        (( release_required_bytes == pre_pull_release_required_bytes )) || \
          die "pre-pull release requirement must be ${pre_pull_release_required_bytes} bytes"
        ;;
      post-pull)
        (( release_required_bytes == post_pull_release_required_bytes )) || \
          die "post-pull release requirement must be ${post_pull_release_required_bytes} bytes"
        ;;
    esac
    (( rollback_headroom_bytes == production_rollback_headroom_bytes )) || \
      die "rollback headroom must remain ${production_rollback_headroom_bytes} bytes"
    ;;
esac
readonly release_required_bytes rollback_headroom_bytes release_total_required_bytes

(( disk_available_kib >= min_free_kib )) || die "free disk space is below the ${min_free_gib} GiB release minimum"
if [[ "$disk_gate_mode" == "absolute" ]]; then
  (( disk_available_bytes >= release_total_required_bytes )) || \
    die "free disk bytes ${disk_available_bytes} are below release requirement ${release_total_required_bytes}"
fi

if [[ "$disk_gate_phase" == "pre-pull" ]]; then
  log INFO "pre-pull capacity gate passed"
  printf 'capacity_preflight=passed\n'
  printf 'disk_gate_mode=%s\n' "$disk_gate_mode"
  printf 'disk_gate_phase=%s\n' "$disk_gate_phase"
  printf 'disk_available_bytes=%s\n' "$disk_available_bytes"
  printf 'release_required_bytes=%s\n' "$release_required_bytes"
  printf 'rollback_headroom_bytes=%s\n' "$rollback_headroom_bytes"
  printf 'release_total_required_bytes=%s\n' "$release_total_required_bytes"
  exit 0
fi

if [[ "$disk_gate_phase" == "post-pull" ]]; then
  [[ "$release_manifest_file" == /* ]] || die "FRANK_RELEASE_MANIFEST_FILE must be absolute for post-pull"
  [[ "$post_pull_image_proof_file" == /* ]] || die "FRANK_POST_PULL_IMAGE_PROOF_FILE must be absolute for post-pull"
  release_manifest_real="$(realpath -e -- "$release_manifest_file")" || die "release manifest does not exist"
  post_pull_image_proof_real="$(realpath -e -- "$post_pull_image_proof_file")" || die "post-pull image proof does not exist"
  [[ "$release_manifest_real" == "$release_manifest_file" ]] || die "release manifest path must not contain links"
  [[ "$post_pull_image_proof_real" == "$post_pull_image_proof_file" ]] || die "post-pull image proof path must not contain links"
  [[ -f "$release_manifest_real" && ! -L "$release_manifest_file" ]] || die "release manifest must be a real file"
  [[ -f "$post_pull_image_proof_real" && ! -L "$post_pull_image_proof_file" ]] || die "post-pull image proof must be a real file"

  declare -a manifest_services=(api web codegraph workbench)
  declare -a expected_images=("$api_image" "$web_image" "$codegraph_image" "$workbench_image")
  declare -A expected_image_ids=()
  for image_index in "${!manifest_services[@]}"; do
    service_name="${manifest_services[$image_index]}"
    expected_image="${expected_images[$image_index]}"
    manifest_image="$(jq -er --arg service "$service_name" \
      '.images[$service] | .reference + "@" + .digest' "$release_manifest_real")" || \
      die "release manifest is missing image: $service_name"
    [[ "$expected_image" == "$manifest_image" ]] || die "post-pull image is not bound to release manifest: $service_name"
    actual_image_id="$(docker image inspect --format '{{.Id}}' "$expected_image" 2>/dev/null || true)"
    [[ "$actual_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "post-pull image is unavailable: $service_name"
    expected_image_ids["$expected_image"]="$actual_image_id"
  done

  declare -A proven_image_ids=()
  proven_image_count=0
  while IFS=$'\t' read -r proven_reference proven_image_id proven_extra || [[ -n "$proven_reference" ]]; do
    [[ -n "$proven_reference" && -n "$proven_image_id" && -z "$proven_extra" ]] || \
      die "post-pull image proof entries must contain exactly one reference and image ID"
    [[ -z "${proven_image_ids[$proven_reference]+present}" ]] || die "post-pull image proof contains a duplicate reference"
    [[ "$proven_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "post-pull image proof contains an invalid image ID"
    proven_image_ids["$proven_reference"]="$proven_image_id"
    ((proven_image_count += 1))
  done < "$post_pull_image_proof_real"
  (( proven_image_count == 4 )) || die "post-pull image proof must contain exactly four images"
  for expected_image in "${expected_images[@]}"; do
    [[ "${proven_image_ids[$expected_image]:-}" == "${expected_image_ids[$expected_image]}" ]] || \
      die "post-pull image proof does not match the local manifest-bound image: $expected_image"
  done
fi

IFS=', ' read -r -a required_secret_vars <<< "$required_secret_vars_raw"
missing_secret_count=0
checked_secret_count=0
for variable_name in "${required_secret_vars[@]}"; do
  [[ -n "$variable_name" ]] || continue
  [[ "$variable_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid secret variable name in FRANK_REQUIRED_SECRET_VARS"
  ((checked_secret_count += 1))

  if [[ ! -v $variable_name ]]; then
    log ERROR "required secret variable is missing or empty: $variable_name"
    ((missing_secret_count += 1))
  elif [[ -z "${!variable_name}" ]]; then
    log ERROR "required secret variable is missing or empty: $variable_name"
    ((missing_secret_count += 1))
  else
    log INFO "required secret variable is present: $variable_name"
  fi
done
(( checked_secret_count > 0 )) || die "FRANK_REQUIRED_SECRET_VARS did not contain any variable names"
(( missing_secret_count == 0 )) || die "$missing_secret_count required secret variable(s) are unavailable"

docker info >/dev/null 2>&1 || die "Docker daemon is unavailable"
docker compose -f "$compose_real" config --quiet >/dev/null 2>&1 || die "Compose configuration is invalid"

readonly network_driver="$(docker network inspect --format '{{.Driver}}' "$required_network" 2>/dev/null || true)"
[[ -n "$network_driver" ]] || die "required Docker network does not exist: $required_network"
[[ "$network_driver" == "bridge" ]] || die "required Docker network is not a bridge network"
if [[ "$allow_legacy_codegraph_network" == "false" ]]; then
  readonly codegraph_network_driver="$(docker network inspect --format '{{.Driver}}' "$codegraph_network" 2>/dev/null || true)"
  readonly codegraph_network_internal="$(docker network inspect --format '{{.Internal}}' "$codegraph_network" 2>/dev/null || true)"
  [[ "$codegraph_network_driver" == "bridge" ]] || die "codegraph network is missing or not a bridge network"
  [[ "$codegraph_network_internal" == "true" ]] || die "codegraph network must be internal"
fi

IFS=', ' read -r -a required_containers <<< "$required_containers_raw"
checked_container_count=0
for container_name in "${required_containers[@]}"; do
  [[ -n "$container_name" ]] || continue
  [[ "$container_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "invalid container name in FRANK_REQUIRED_CONTAINERS"
  docker inspect "$container_name" >/dev/null 2>&1 || die "required container does not exist: $container_name"

  container_state="$(docker inspect --format '{{.State.Status}}' "$container_name")"
  [[ "$container_state" == "running" ]] || die "required container is not running: $container_name"

  container_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_name")"
  [[ "$container_health" == "none" || "$container_health" == "healthy" ]] || die "required container is not healthy: $container_name"

  container_networks="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$container_name")"
  expected_network="$required_network"
  if [[ "$container_name" == "$codegraph_container" && "$allow_legacy_codegraph_network" == "false" ]]; then
    expected_network="$codegraph_network"
  fi
  jq -e --arg network "$expected_network" 'has($network)' <<< "$container_networks" >/dev/null || die "required container is not attached to $expected_network: $container_name"
  if [[ "$container_name" == "$codegraph_container" && "$allow_legacy_codegraph_network" == "false" ]]; then
    jq -e --arg network "$required_network" 'has($network) | not' <<< "$container_networks" >/dev/null || die "codegraph must not have the general egress network"
  fi

  ((checked_container_count += 1))
  log INFO "container check passed: $container_name"
done
(( checked_container_count > 0 )) || die "FRANK_REQUIRED_CONTAINERS did not contain any container names"

IFS=', ' read -r -a required_images <<< "$required_images_raw"
checked_image_count=0
workbench_image_checked=false
for image_reference in "${required_images[@]}"; do
  [[ -n "$image_reference" ]] || continue
  image_id="$(docker image inspect --format '{{.Id}}' "$image_reference" 2>/dev/null || true)"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "required Docker image is unavailable: $image_reference"
  if [[ "$image_reference" == "$workbench_image" ]]; then
    workbench_image_checked=true
  fi
  ((checked_image_count += 1))
  log INFO "image check passed: $image_reference (${image_id:7:12})"
done
(( checked_image_count > 0 )) || die "FRANK_REQUIRED_IMAGES did not contain any image references"
[[ "$workbench_image_checked" == "true" ]] || die "FRANK_REQUIRED_IMAGES must include FRANK_WORKBENCH_IMAGE"

if [[ -n "$image_lock_file" ]]; then
  [[ "$image_lock_file" == /* ]] || die "FRANK_IMAGE_LOCK_FILE must be absolute"
  image_lock_real="$(realpath -e -- "$image_lock_file")" || die "image lock file does not exist"

  locked_image_count=0
  while IFS= read -r lock_line || [[ -n "$lock_line" ]]; do
    lock_line="${lock_line%%#*}"
    read -r locked_reference locked_expected_id lock_extra <<< "$lock_line"
    [[ -n "${locked_reference:-}" ]] || continue
    [[ -z "${lock_extra:-}" ]] || die "image lock entries must contain exactly two fields"
    [[ "${locked_expected_id:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || die "image lock contains an invalid image ID"

    locked_actual_id="$(docker image inspect --format '{{.Id}}' "$locked_reference" 2>/dev/null || true)"
    [[ "$locked_actual_id" == "$locked_expected_id" ]] || die "image lock mismatch: $locked_reference"
    ((locked_image_count += 1))
  done < "$image_lock_real"
  (( locked_image_count > 0 )) || die "image lock file contained no image entries"
  log INFO "validated $locked_image_count locked image ID(s)"
fi

readonly disk_available_gib="$((disk_available_kib / 1024 / 1024))"
readonly checked_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

log INFO "hosted preflight passed"
printf 'preflight=passed\n'
printf 'checked_at_utc=%s\n' "$checked_at"
printf 'commit=%s\n' "$actual_commit"
printf 'branch=%s\n' "$actual_branch"
printf 'upstream=%s\n' "${upstream_ref:-none}"
printf 'ahead=%s\n' "$ahead_count"
printf 'behind=%s\n' "$behind_count"
printf 'disk_mount=%s\n' "$disk_mount"
printf 'disk_gate_mode=%s\n' "$disk_gate_mode"
printf 'disk_gate_phase=%s\n' "$disk_gate_phase"
printf 'disk_used_percent=%s\n' "$disk_used_percent"
printf 'disk_available_gib=%s\n' "$disk_available_gib"
printf 'disk_available_bytes=%s\n' "$disk_available_bytes"
printf 'release_required_bytes=%s\n' "$release_required_bytes"
printf 'rollback_headroom_bytes=%s\n' "$rollback_headroom_bytes"
printf 'release_total_required_bytes=%s\n' "$release_total_required_bytes"
printf 'network=%s\n' "$required_network"
printf 'codegraph_network=%s\n' "$codegraph_network"
printf 'legacy_codegraph_network_allowed=%s\n' "$allow_legacy_codegraph_network"
printf 'containers_checked=%s\n' "$checked_container_count"
printf 'images_checked=%s\n' "$checked_image_count"
printf 'secret_names_checked=%s\n' "$checked_secret_count"

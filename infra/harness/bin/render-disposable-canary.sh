#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 1 ]] || { echo "usage: $0 candidate.env" >&2; exit 64; }
candidate="$1"; [[ -f "$candidate" ]] || { echo 'candidate slot not found' >&2; exit 65; }
script_dir="$(cd "$(dirname "$0")" && pwd)"; harness_dir="$(cd "$script_dir/.." && pwd)"
set -a; source "$candidate"; set +a
: "${FRANK_LITELLM_CANDIDATE_IMAGE:?}" "${FRANK_SEAWEEDFS_CANDIDATE_IMAGE:?}" "${FRANK_TUSD_CANDIDATE_IMAGE:?}" "${FRANK_CLAMAV_CANDIDATE_IMAGE:?}"
for image in "$FRANK_LITELLM_CANDIDATE_IMAGE" "$FRANK_SEAWEEDFS_CANDIDATE_IMAGE" "$FRANK_TUSD_CANDIDATE_IMAGE" "$FRANK_CLAMAV_CANDIDATE_IMAGE"; do [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'canary images must be digest-pinned' >&2; exit 65; }; done
: "${FRANK_HARNESS_CANARY_PROJECT:=frank-harness-canary-${RANDOM}${RANDOM}}"; export FRANK_HARNESS_CANARY_PROJECT
docker compose -f "$harness_dir/docker-compose.canary.yml" config --format json

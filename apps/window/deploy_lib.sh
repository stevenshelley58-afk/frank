#!/usr/bin/env bash
# Testable Frank deployment checks. deploy.sh sources this file; the unittest
# suite sources the same functions with stubbed commands on PATH. Nothing in
# here mutates containers or the release directory unless a caller asks it to.

frank_lock_file() {
  printf '%s\n' "${FRANK_DEPLOY_LOCK_FILE:-/var/lock/frank-deploy.lock}"
}

# Exclusive host deployment lock. A second concurrent deployment must fail
# immediately with a clear message and non-zero exit.
frank_acquire_deploy_lock() {
  local lock_file
  lock_file="$(frank_lock_file)"
  if [[ ! -e "$lock_file" ]]; then
    ( umask 077; : > "$lock_file" ) || { echo "cannot create deployment lock $lock_file" >&2; return 1; }
  fi
  # The production lock file is root-owned and private.
  if [[ "$lock_file" == "/var/lock/frank-deploy.lock" && "$(id -u)" == "0" ]]; then
    chown root:root "$lock_file" 2>/dev/null || true
    chmod 0600 "$lock_file" 2>/dev/null || true
  fi
  exec 9>>"$lock_file" || { echo "cannot open deployment lock $lock_file" >&2; return 1; }
  flock -n 9 || {
    echo "another Frank deployment is in progress" >&2
    return 1
  }
}

frank_repo_dir() {
  printf '%s\n' "${FRANK_REPO:-/projects/frank}"
}

frank_candidate_sha() {
  git -C "$(frank_repo_dir)" rev-parse HEAD
}

# (a) The candidate revision is exactly HEAD, committed, and pushed to origin.
frank_verify_source_identity() {
  local repo candidate head_sha
  repo="$(frank_repo_dir)"
  candidate="$1"
  head_sha="$(git -C "$repo" rev-parse HEAD)"
  [[ "$head_sha" == "$candidate" ]] || {
    echo "refusing deploy: HEAD $head_sha != candidate revision $candidate" >&2
    return 1
  }
  git -C "$repo" diff --quiet HEAD -- || {
    echo "refusing to deploy an uncommitted Frank revision" >&2
    return 1
  }
  git -C "$repo" fetch --quiet origin
  git -C "$repo" merge-base --is-ancestor "$candidate" origin/main || {
    echo "refusing to deploy an unpushed Frank revision: $candidate" >&2
    return 1
  }
}

# The immutable deployment identity must encode the exact candidate SHA; the
# mutable :current tag is never acceptable as a deployment identity.
frank_verify_tag_encodes_sha() {
  local image="$1" candidate="$2" tag="${1##*:}"
  [[ "$tag" == "$candidate" ]] || {
    echo "refusing deploy: image tag on $image does not encode candidate revision $candidate" >&2
    return 1
  }
}

frank_verify_image_exists() {
  local image="$1"
  docker image inspect "$image" >/dev/null 2>&1 || {
    echo "refusing deploy: built image $image is missing" >&2
    return 1
  }
}

# (c) The image revision label must equal the candidate SHA.
frank_verify_image_label() {
  local image="$1" candidate="$2" label
  label="$(docker image inspect "$image" \
    --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" || {
    echo "refusing deploy: cannot inspect revision label of $image" >&2
    return 1
  }
  [[ "$label" == "$candidate" ]] || {
    echo "refusing deploy: image $image label $label != candidate revision $candidate" >&2
    return 1
  }
}

frank_image_digests() {
  docker image inspect "$1" --format '{{json .RepoDigests}}'
}

frank_compose_service_image() {
  local service="$1" json
  json="$(docker compose config --format json)" || return 1
  printf '%s' "$json" | service="$service" python3 -c \
    'import json, os, sys; cfg = json.load(sys.stdin); svc = cfg["services"].get(os.environ["service"]); sys.stdout.write(svc["image"] + "\n" if svc and svc.get("image") else "")'
}

# (b)+(identity) The compose-resolved images for the two Frank services must
# carry the exact immutable candidate tags, never a mutable :current tag.
frank_verify_compose_images() {
  local candidate="$1" service image
  for service in frank-window frank-agenttrail; do
    image="$(frank_compose_service_image "$service")"
    [[ -n "$image" ]] || {
      echo "refusing deploy: compose service $service declares no image" >&2
      return 1
    }
    [[ "$image" != *:current ]] || {
      echo "refusing deploy: compose still names mutable tag $image for $service" >&2
      return 1
    }
    frank_verify_tag_encodes_sha "$image" "$candidate" || return 1
  done
}

# (f) The Dockerfile bakes a critical-file hash manifest at /app; the release
# identity proof is only valid when the manifest exists and covers the server.
frank_verify_image_critical_manifest() {
  local image="$1"
  docker run --rm --entrypoint /bin/sh "$image" -c \
    'test -s /app/CRITICAL_MANIFEST.sha256 && grep -Eq "(^|[[:space:]])/app/server.py$" /app/CRITICAL_MANIFEST.sha256' || {
    echo "refusing deploy: image $image lacks a valid critical-file manifest" >&2
    return 1
  }
  docker run --rm "$image" python -c \
    'import server, connections_agent, home_platform, tool_apps' || {
    echo "refusing deploy: image $image is missing critical runtime modules" >&2
    return 1
  }
}

frank_approved_sha_file() {
  printf '%s\n' "${1:-/var/lib/frank/release/approved-sha}"
}

frank_read_approved_sha() {
  local file
  file="$(frank_approved_sha_file "${1:-}")"
  [[ -f "$file" ]] || return 1
  local sha
  sha="$(tr -d '[:space:]' < "$file")"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
    echo "invalid approved-sha file: $file" >&2
    return 1
  }
  printf '%s\n' "$sha"
}

# (d) Detects when the recorded approved SHA disagrees with the candidate.
frank_verify_approved_sha() {
  local candidate="$1" file current
  file="$(frank_approved_sha_file "${2:-}")"
  if ! current="$(frank_read_approved_sha "$file")"; then
    echo "approved-sha file is missing or invalid: $file" >&2
    return 1
  fi
  [[ "$current" == "$candidate" ]] || {
    echo "approved-sha disagreement: recorded $current != candidate $candidate" >&2
    return 1
  }
}

# Written only after the new stack is healthy and every post-deploy check has
# passed; until then the previously approved revision stays authoritative.
frank_write_approved_sha() {
  local candidate="$1" release_dir="$2" tmp
  [[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || {
    echo "refusing to record a non-revision approved-sha: $candidate" >&2
    return 1
  }
  if [[ "$(id -u)" == "0" ]]; then
    install -d -o root -g root -m 0755 -- "$release_dir"
  else
    mkdir -p -- "$release_dir"
  fi
  tmp="$(mktemp "$release_dir/.approved-sha.XXXXXX")"
  printf '%s\n' "$candidate" > "$tmp"
  if [[ "$(id -u)" == "0" ]]; then chown root:root "$tmp"; fi
  chmod 0644 "$tmp"
  mv -f -- "$tmp" "$release_dir/approved-sha"
}

# Rollback receipt: the previously approved revision and the exact image
# identities that were running before the cutover. The previous images are
# immutable-tagged by SHA, so restoring never retags or deletes them.
frank_write_rollback_receipt() {
  local release_dir="$1" prev_sha="$2" prev_window_image="$3" prev_window_digests="$4" \
    prev_trail_image="$5" prev_trail_digests="$6" tmp
  tmp="$(mktemp "$release_dir/.rollback-receipt.XXXXXX")"
  {
    printf 'previous_sha=%s\n' "$prev_sha"
    printf 'previous_window_image=%s\n' "$prev_window_image"
    printf 'previous_window_digests=%s\n' "$prev_window_digests"
    printf 'previous_trail_image=%s\n' "$prev_trail_image"
    printf 'previous_trail_digests=%s\n' "$prev_trail_digests"
  } > "$tmp"
  chmod 0644 "$tmp"
  mv -f -- "$tmp" "$release_dir/rollback-receipt.env"
}

frank_record_rollback_receipt() {
  local release_dir="$1" repo="$2"
  local prev_sha prev_window_image prev_trail_image prev_window_digests="" prev_trail_digests=""
  prev_sha="$(frank_read_approved_sha "$release_dir/approved-sha" 2>/dev/null || true)"
  prev_window_image="$(docker inspect frank-window --format '{{.Image}}' 2>/dev/null || true)"
  prev_trail_image="$(docker inspect frank-agenttrail --format '{{.Image}}' 2>/dev/null || true)"
  if [[ -n "$prev_window_image" ]]; then
    prev_window_digests="$(frank_image_digests "$prev_window_image" 2>/dev/null || true)"
  fi
  if [[ -n "$prev_trail_image" ]]; then
    prev_trail_digests="$(frank_image_digests "$prev_trail_image" 2>/dev/null || true)"
  fi
  frank_write_rollback_receipt "$release_dir" "$prev_sha" \
    "$prev_window_image" "$prev_window_digests" "$prev_trail_image" "$prev_trail_digests"
}

# Restore the previously running stack after a failed cutover. Reads the
# recorded receipt for provenance and only ever starts containers from the
# previous stack files; it never retags or deletes the previous images and
# never touches the approved-sha file.
frank_restore_previous_runtime() {
  local release_dir="$1"; shift
  local receipt="$release_dir/rollback-receipt.env"
  if [[ -f "$receipt" ]]; then
    local prev_sha prev_window_image
    prev_sha="$(sed -n 's/^previous_sha=//p' "$receipt" | head -n 1)"
    prev_window_image="$(sed -n 's/^previous_window_image=//p' "$receipt" | head -n 1)"
    echo "previous approved revision ${prev_sha:-unknown} remains available as image ${prev_window_image:-unknown}; restoring it untouched" >&2
  fi
  local entry compose_file service
  for entry in "$@"; do
    compose_file="${entry%%:*}"
    service="${entry#*:}"
    [[ -f "$compose_file" ]] || continue
    docker compose -f "$compose_file" up -d "$service" || true
  done
}

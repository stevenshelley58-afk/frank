#!/usr/bin/env bash
# Bound the number of Frank release and deploy worktrees that stay on disk.
#
# Every release or laptop-side deploy adds a worktree of the canonical checkout
# under /opt/releases, /srv/frank and friends. Rollback needs the revision that is
# serving traffic and the one the receipt records behind it, but nothing ever
# removed the older ones, so they accumulate silently.
#
# This keeps the live revision, the recorded rollback revision and the newest N,
# then retires the rest. A worktree that is dirty, that holds commits which are
# not in the target branch, or that does not sit at the revision its own name
# encodes is never removed: it is either a broken release or someone's work, and
# neither is this script's to delete.
set -Eeuo pipefail
umask 077

readonly CANONICAL="${FRANK_CHECKOUT_CANONICAL:-/projects/frank}"
readonly SESSION_PARENT="${FRANK_CHECKOUT_SESSION_PARENT:-/projects/frank-worktrees}"
readonly TARGET_REF="${FRANK_CHECKOUT_TARGET:-origin/main}"
readonly RELEASE_ENV="${FRANK_RELEASE_ENV:-/var/lib/frank/release}"
readonly SHA_RE='^[a-f0-9]{40}$'

KEEP=3
APPLY=false

usage() {
  cat <<'USAGE'
Usage: frank-release-prune.sh [--keep <n>] [--apply]

Kept regardless of age: the worktree at the approved revision, the worktree at
the recorded rollback revision, and the newest <n> (default 3). Every other
release worktree is removable only when it is clean, merged into the target
branch, and sitting at the revision its own name encodes.
USAGE
}

while (($# > 0)); do
  case "$1" in
  --keep)
    [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || {
      usage >&2
      exit 2
    }
    KEEP="$2"
    shift 2
    ;;
  --apply)
    APPLY=true
    shift
    ;;
  --help | -h)
    usage
    exit 0
    ;;
  *)
    printf 'unknown option: %s\n' "$1" >&2
    usage >&2
    exit 2
    ;;
  esac
done

gitc() { git -c safe.directory='*' -C "$CANONICAL" "$@"; }
gitp() { git -c safe.directory='*' -C "$1" "${@:2}"; }
human() { numfmt --to=iec -- "${1:-0}"; }
path_bytes() { du -sb -- "$1" 2>/dev/null | cut -f1 || echo 0; }

read_approved_sha() {
  local file="$RELEASE_ENV/approved-sha" sha=""
  [[ -f "$file" ]] && sha="$(tr -d '[:space:]' <"$file" 2>/dev/null || true)"
  [[ "$sha" =~ $SHA_RE ]] && printf '%s\n' "$sha"
}

read_rollback_sha() {
  local file="$RELEASE_ENV/rollback-receipt.env" sha=""
  [[ -f "$file" ]] || return 0
  sha="$(sed -n 's/^previous_sha=//p' "$file" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  [[ "$sha" =~ $SHA_RE ]] && printf '%s\n' "$sha"
}

LIVE_SHA="$(read_approved_sha || true)"
ROLLBACK_SHA="$(read_rollback_sha || true)"

[[ -d "$CANONICAL" ]] || {
  printf 'frank release prune: canonical checkout %s is missing\n' "$CANONICAL" >&2
  exit 1
}
gitc fetch --quiet origin 2>/dev/null || true
gitc rev-parse --verify --quiet "$TARGET_REF" >/dev/null 2>&1 || {
  printf 'frank release prune: cannot resolve %s; nothing removed\n' "$TARGET_REF" >&2
  exit 1
}

# Release and deploy worktrees are the registered worktrees of the canonical
# checkout that are neither the canonical checkout itself nor a session claim.
release_root="$(realpath -m -- "$SESSION_PARENT")"
mapfile -t all_worktrees < <(gitc worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')

candidates=()
for path in ${all_worktrees+"${all_worktrees[@]}"}; do
  [[ -n "$path" && "$path" != "$CANONICAL" ]] || continue
  resolved="$(realpath -m -- "$path")"
  [[ "$resolved" == "$release_root" || "$resolved" == "$release_root"/* ]] && continue
  [[ -e "$path/.git" ]] || continue
  candidates+=("$path")
done

# Newest first, by the revision each worktree sits on. The directory mtime is not
# used: reading a directory updates it.
removed=0
kept=0
freed=0
notes=()
# Disposable worktrees, with the revision time each one sits on.
safe_entries=()

for path in ${candidates+"${candidates[@]}"}; do
  name="$(basename -- "$path")"
  head="$(gitp "$path" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$head" ]]; then
    notes+=("$name|not a readable git checkout")
    kept=$((kept + 1))
    continue
  fi

  if [[ -n "$LIVE_SHA" && "$head" == "$LIVE_SHA" ]]; then
    notes+=("$name|serving revision ${head:0:12}")
    kept=$((kept + 1))
    continue
  fi
  if [[ -n "$ROLLBACK_SHA" && "$head" == "$ROLLBACK_SHA" ]]; then
    notes+=("$name|rollback revision ${head:0:12}")
    kept=$((kept + 1))
    continue
  fi
  if ! gitc merge-base --is-ancestor "$head" "$TARGET_REF" 2>/dev/null; then
    ahead="$(gitc rev-list --count "$TARGET_REF..$head" 2>/dev/null || echo '?')"
    notes+=("$name|has $ahead commit(s) not in ${TARGET_REF#origin/}")
    kept=$((kept + 1))
    continue
  fi
  if ! gitp "$path" diff --quiet HEAD -- 2>/dev/null; then
    notes+=("$name|has uncommitted tracked changes")
    kept=$((kept + 1))
    continue
  fi
  # A worktree named for a revision must sit at that revision.
  if [[ "$name" =~ -([0-9a-f]{7,40})$ ]]; then
    encoded="${BASH_REMATCH[1]}"
    if [[ "$head" != "$encoded"* ]]; then
      notes+=("$name|not at the revision its name encodes")
      kept=$((kept + 1))
      continue
    fi
  fi
  commit_time="$(gitp "$path" log -1 --format=%ct 2>/dev/null || echo 0)"
  [[ "$commit_time" =~ ^[0-9]+$ ]] || commit_time=0
  safe_entries+=("$(printf '%012d\t%s' "$commit_time" "$path")")
done

# The retention count applies to the disposable release worktrees only. A
# worktree that has to be kept for another reason does not consume the budget
# that protects the newest ones, so the newest N merged releases always survive.
safe_sorted=()
if ((${#safe_entries[@]} > 0)); then
  mapfile -t safe_sorted < <(printf '%s\n' "${safe_entries[@]}" | sort -rn | cut -f2-)
fi
newest_safe=()
if ((${#safe_sorted[@]} > 0)); then
  newest_safe=("${safe_sorted[@]:0:KEEP}")
fi

is_within_keep() {
  local candidate="$1" kept_path
  for kept_path in ${newest_safe+"${newest_safe[@]}"}; do
    [[ "$kept_path" == "$candidate" ]] && return 0
  done
  return 1
}

for path in ${safe_sorted+"${safe_sorted[@]}"}; do
  name="$(basename -- "$path")"
  if is_within_keep "$path"; then
    notes+=("$name|within the newest $KEEP releasable")
    kept=$((kept + 1))
    continue
  fi

  size="$(path_bytes "$path")"
  freed=$((freed + size))
  removed=$((removed + 1))
  if $APPLY; then
    if gitc worktree remove --force -- "$path" 2>/dev/null; then
      printf 'removed release worktree %s (%s)\n' "$name" "$(human "$size")"
    else
      printf 'skip %s: worktree remove failed\n' "$name"
      removed=$((removed - 1))
      freed=$((freed - size))
      kept=$((kept + 1))
    fi
  else
    printf 'would remove release worktree %s (%s)\n' "$name" "$(human "$size")"
  fi
done

if $APPLY; then
  gitc worktree prune >/dev/null 2>&1 || true
fi

printf 'frank release prune: live %s, rollback %s, keeping newest %s plus both\n' \
  "${LIVE_SHA:0:12}" "${ROLLBACK_SHA:0:12}" "$KEEP"
printf '%s %s release worktree(s), %s retained, %s reclaimed\n' \
  "$($APPLY && echo removed || echo 'would remove')" "$removed" "$kept" "$(human "$freed")"
if ((${#notes[@]} > 0)); then
  printf '\nretained:\n'
  for note in "${notes[@]}"; do
    printf '  %-58s %s\n' "${note%%|*}" "${note##*|}"
  done
fi
$APPLY || printf '\nrun again with --apply to remove them\n'

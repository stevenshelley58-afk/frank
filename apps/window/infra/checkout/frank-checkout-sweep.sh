#!/usr/bin/env bash
# Retire Frank checkouts that are provably finished with.
#
# Sessions claim a worktree under $SESSION_PARENT and leave it behind once the
# work merges, and dated snapshot checkouts from earlier workflows accumulated in
# the same way. This reports them with the facts needed to judge, and removes one
# only when all three hold:
#
#   1. every commit in it is already in the target branch,
#   2. nothing tracked is uncommitted,
#   3. it has been idle for the whole stale window.
#
# Everything else is reported with its reason and left alone. That includes a
# checkout whose link into the canonical repository was already deleted: its
# content cannot be attributed to a commit, so it is never treated as disposable.
#
# Two signals are deliberately not used. The directory mtime is not idle time:
# reading or indexing a checkout updates it, which made months-old snapshots look
# active. Untracked files are not uncommitted work when they are regenerable:
# ignored build output, caches and banner-rewritten rule files would otherwise
# keep a dead checkout alive forever. Untracked files that are *not* ignored are
# real content and do keep the checkout.
#
# Removal of a registered worktree always goes through `git worktree remove`, so
# no administrative registration is left behind. A run that changes nothing logs
# one line; kept entries are listed only when something changed or --report asks.
set -Eeuo pipefail
umask 077

readonly CANONICAL="${FRANK_CHECKOUT_CANONICAL:-/projects/frank}"
readonly SESSION_PARENT="${FRANK_CHECKOUT_SESSION_PARENT:-/projects/frank-worktrees}"
readonly TARGET_REF="${FRANK_CHECKOUT_TARGET:-origin/main}"
# Roots used by earlier workflows. They are scanned, never assumed. An explicit
# empty value disables the legacy scan, which is what the tests do.
readonly LEGACY_ROOTS="${FRANK_CHECKOUT_LEGACY_ROOTS-/projects/frank-* /root/work/frank-* /root/frank-*}"

STALE_HOURS=24
APPLY=false
QUIET=false
REPORT=false

usage() {
  cat <<'USAGE'
Usage: frank-checkout-sweep.sh [--hours <n>] [--quiet] [--report] [--apply]

  --hours <n>  idle window before a finished checkout is removable (default 24)
  --quiet      log one line when nothing changed, for the hourly timer
  --report     always list what was kept and why, for the periodic backstop
  --apply      remove; without it nothing is deleted and nothing is reported

A checkout is removable only when every commit is in the target branch, nothing
tracked is uncommitted, and it has been idle for the window. Anything else is
reported with its reason.
USAGE
}

while (($# > 0)); do
  case "$1" in
  --hours)
    [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || {
      usage >&2
      exit 2
    }
    STALE_HOURS="$2"
    shift 2
    ;;
  --quiet)
    QUIET=true
    shift
    ;;
  --report)
    REPORT=true
    shift
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

readonly NOW="$(date +%s)"
readonly STALE_SECONDS=$((STALE_HOURS * 3600))

# The canonical checkout and the worktrees under it are owned by the agent
# accounts, while this runs as root. Every path below comes from the fixed roots
# configured above, never from user input.
gitc() { git -c safe.directory='*' -C "$CANONICAL" "$@"; }
gitp() { git -c safe.directory='*' -C "$1" "${@:2}"; }

human() { numfmt --to=iec -- "${1:-0}"; }

# Bytes a path occupies, for the reclaimed total.
path_bytes() { du -sb -- "$1" 2>/dev/null | cut -f1 || echo 0; }

# Administrative registrations still on disk. `find` fails on a missing directory,
# and under `set -o pipefail` that failure would abort the run without a message.
admin_registration_count() {
  [[ -d "$CANONICAL/.git/worktrees" ]] || {
    printf '0\n'
    return 0
  }
  find "$CANONICAL/.git/worktrees" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l
}

# Creation time of a claimed worktree, used as an idle floor so that a worktree
# claimed from an old revision moments ago is never treated as abandoned.
claim_epoch() {
  local path="$1" git_dir birth
  git_dir="$(gitp "$path" rev-parse --absolute-git-dir 2>/dev/null || true)"
  [[ -n "$git_dir" ]] || return 1
  birth="$(stat -c %W -- "$git_dir" 2>/dev/null || true)"
  if [[ ! "$birth" =~ ^[0-9]+$ ]] || ((birth <= 0)); then
    birth="$(stat -c %Y -- "$git_dir/HEAD" 2>/dev/null || true)"
  fi
  [[ "$birth" =~ ^[0-9]+$ ]] && ((birth > 0)) || return 1
  printf '%s\n' "$birth"
}

# Idle seconds: from the last commit, floored by the claim. Never the directory
# mtime.
idle_seconds() {
  local path="$1" commit claim floor
  commit="$(gitp "$path" log -1 --format=%ct 2>/dev/null || true)"
  [[ "$commit" =~ ^[0-9]+$ ]] && ((commit > 0)) || commit=0
  floor="$commit"
  if claim="$(claim_epoch "$path")" && ((claim > floor)); then
    floor="$claim"
  fi
  ((floor == 0)) && floor="$NOW"
  printf '%s\n' "$((NOW - floor))"
}

# Untracked files that are not ignored: git already hides regenerable artifacts
# such as __pycache__, node_modules and build output from this list.
untracked_work() {
  gitp "$1" ls-files --others --exclude-standard 2>/dev/null | grep -cEv '^$' || true
}

# Tooling rewrites a banner into the rule and doc files of a dated checkout.
# Those edits are not a person's work, so they do not keep a checkout alive.
readonly BANNER_PATHS=(':(exclude)AGENTS.md' ':(exclude)CLAUDE.md' ':(exclude)docs/**')

tracked_modified() {
  gitp "$1" diff --name-only HEAD -- . "${BANNER_PATHS[@]}" 2>/dev/null | grep -cEv '^$' || true
}

# A checkout that is registered as a worktree of the canonical repository.
is_registered() {
  gitc worktree list --porcelain 2>/dev/null | grep -qxF "worktree $1"
}

# A directory left behind when its worktree registration was removed. It still
# points at the canonical repository, but git can no longer read it.
is_orphan_of_canonical() {
  local path="$1" link
  [[ -f "$path/.git" ]] || return 1
  link="$(head -c 512 -- "$path/.git" 2>/dev/null || true)"
  [[ "$link" == "gitdir: $CANONICAL/.git/worktrees/"* ]]
}

# Proof that an orphan directory is exactly a committed revision already in the
# target branch. Its tree is built in a scratch object store, so the canonical
# repository gains no objects. Prints "<sha> <commit-time>" on success.
orphan_committed_revision() {
  local path="$1" scratch tree match status=0
  scratch="$(mktemp -d)"
  mkdir -p -- "$scratch/objects"
  if ! GIT_DIR="$CANONICAL/.git" \
    GIT_OBJECT_DIRECTORY="$scratch/objects" \
    GIT_ALTERNATE_OBJECT_DIRECTORIES="$CANONICAL/.git/objects" \
    GIT_INDEX_FILE="$scratch/index" \
    git -c safe.directory='*' --work-tree="$path" add -A >/dev/null 2>&1; then
    status=1
  else
    tree="$(GIT_DIR="$CANONICAL/.git" GIT_OBJECT_DIRECTORY="$scratch/objects" \
      GIT_ALTERNATE_OBJECT_DIRECTORIES="$CANONICAL/.git/objects" \
      GIT_INDEX_FILE="$scratch/index" git write-tree 2>/dev/null || true)"
    if [[ -n "$tree" ]]; then
      match="$(gitc log --format='%H %T %ct' "$TARGET_REF" 2>/dev/null |
        awk -v t="$tree" '$2 == t { print $1, $3; exit }' || true)"
      [[ -n "$match" ]] || status=1
    else
      status=1
    fi
  fi
  rm -rf -- "$scratch"
  ((status == 0)) || return 1
  printf '%s\n' "$match"
}

removed_paths=0
removed_branches=0
freed_bytes=0
pruned_admins=0
kept_entries=()
changed=false

remove_registered_worktree() {
  local path="$1" size="$2" note="$3"
  freed_bytes=$((freed_bytes + size))
  removed_paths=$((removed_paths + 1))
  changed=true
  if $APPLY; then
    if gitc worktree remove --force -- "$path" 2>/dev/null; then
      printf 'removed worktree %s (%s; %s)\n' "$path" "$(human "$size")" "$note"
    else
      removed_paths=$((removed_paths - 1))
      freed_bytes=$((freed_bytes - size))
      kept_entries+=("$path|worktree remove failed")
      printf 'kept %s (%s; worktree remove failed)\n' "$path" "$(human "$size")"
    fi
  else
    printf 'would remove worktree %s (%s; %s)\n' "$path" "$(human "$size")" "$note"
  fi
}

remove_orphan_directory() {
  local path="$1" size="$2" note="$3"
  freed_bytes=$((freed_bytes + size))
  removed_paths=$((removed_paths + 1))
  changed=true
  if $APPLY; then
    if rm -rf -- "$path"; then
      printf 'removed leftover %s (%s; %s)\n' "$path" "$(human "$size")" "$note"
    else
      removed_paths=$((removed_paths - 1))
      freed_bytes=$((freed_bytes - size))
      kept_entries+=("$path|remove failed")
    fi
  else
    printf 'would remove leftover %s (%s; %s)\n' "$path" "$(human "$size")" "$note"
  fi
}

# Finish a checkout: all commits in the target branch, nothing tracked
# uncommitted, no untracked non-regenerable content, and idle.
audit_worktree() {
  local path="$1" size head ahead idle modified untracked
  head="$(gitp "$path" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$head" ]]; then
    kept_entries+=("$path|not a readable git checkout")
    return 0
  fi
  if ! gitc merge-base --is-ancestor "$head" "$TARGET_REF" 2>/dev/null; then
    ahead="$(gitc rev-list --count "$TARGET_REF..$head" 2>/dev/null || echo '?')"
    kept_entries+=("$path|has $ahead commit(s) not in ${TARGET_REF#origin/}")
    return 0
  fi
  modified="$(tracked_modified "$path")"
  if ((modified > 0)); then
    kept_entries+=("$path|$modified uncommitted tracked file(s)")
    return 0
  fi
  untracked="$(untracked_work "$path")"
  if ((untracked > 0)); then
    kept_entries+=("$path|$untracked untracked file(s) that are not regenerable")
    return 0
  fi
  idle="$(idle_seconds "$path")"
  if ((idle < STALE_SECONDS)); then
    kept_entries+=("$path|active $((idle / 3600))h ago")
    return 0
  fi
  size="$(path_bytes "$path")"
  remove_registered_worktree "$path" "$size" "idle $((idle / 3600))h, merged"
}

audit_orphan() {
  local path="$1" size match sha idle
  if ! match="$(orphan_committed_revision "$path")"; then
    kept_entries+=("$path|cannot be read by git; content is not any single committed revision")
    return 0
  fi
  sha="${match%% *}"
  # Even a perfectly committed orphan is left alone while it looks active.
  idle="$(idle_seconds "$path")"
  if ((idle < STALE_SECONDS)); then
    kept_entries+=("$path|active $((idle / 3600))h ago")
    return 0
  fi
  size="$(path_bytes "$path")"
  remove_orphan_directory "$path" "$size" "leftover of an earlier removal, exactly ${sha:0:12}, merged"
}

# Candidates: claimed worktrees under the session parent, plus every root an
# earlier workflow left Frank checkouts in.
collect_candidates() {
  local path
  if [[ -d "$SESSION_PARENT" ]]; then
    for path in "$SESSION_PARENT"/*; do
      [[ -d "$path" ]] && printf '%s\n' "$path"
    done
  fi
  local glob
  for glob in $LEGACY_ROOTS; do
    for path in $glob; do
      [[ -d "$path" && "$path" != "$CANONICAL" && "$path" != "$SESSION_PARENT" ]] || continue
      printf '%s\n' "$path"
    done
  done
}

if [[ ! -d "$CANONICAL" ]]; then
  printf 'frank checkout sweep: canonical checkout %s is missing\n' "$CANONICAL" >&2
  exit 1
fi

# Best effort: a sweep must still be able to retire local residue while the
# network or the remote is unavailable.
gitc fetch --quiet origin 2>/dev/null || true
if ! gitc rev-parse --verify --quiet "$TARGET_REF" >/dev/null 2>&1; then
  printf 'frank checkout sweep: cannot resolve %s; nothing removed\n' "$TARGET_REF" >&2
  exit 1
fi

self="$(realpath -m -- "${PWD:-/}")"

while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  [[ "$path" != "$CANONICAL" ]] || continue
  # Never remove the checkout this run is standing in, or one that contains it.
  resolved="$(realpath -m -- "$path")"
  [[ "$self" == "$resolved" || "$self" == "$resolved"/* ]] && {
    kept_entries+=("$path|is the working directory of this run")
    continue
  }
  if [[ ! -e "$path/.git" ]]; then
    continue
  fi
  if is_registered "$path"; then
    audit_worktree "$path"
  elif is_orphan_of_canonical "$path"; then
    audit_orphan "$path"
  elif [[ -d "$path/.git" ]]; then
    # A separate clone, not a worktree: a dated snapshot, and not this sweep's to
    # delete. Reported so it stays visible.
    kept_entries+=("$path|separate clone, not a worktree of the canonical checkout")
  fi
done < <(collect_candidates)

# Administrative registrations whose directory was deleted by something that did
# not use `git worktree remove`. They can never be used again.
before_admins="$(admin_registration_count)"
if $APPLY; then
  gitc worktree prune >/dev/null 2>&1 || true
  after_admins="$(admin_registration_count)"
  if ((after_admins < before_admins)); then
    pruned_admins=$((before_admins - after_admins))
    changed=true
    printf 'pruned %s stale worktree registration(s)\n' "$pruned_admins"
  fi
fi

# Merged branches whose worktree is gone are the other half of the residue: the
# worktree is removed and the branch stays forever. Only a branch provably
# contained in the target branch and checked out nowhere is deleted.
live_worktrees="$(gitc worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' || true)"
while IFS= read -r ref; do
  [[ -n "$ref" && "$ref" != "refs/heads/main" ]] || continue
  gitc merge-base --is-ancestor "$ref" "$TARGET_REF" 2>/dev/null || continue
  short="${ref#refs/heads/}"
  branch_path=""
  while IFS= read -r wt; do
    [[ -n "$wt" ]] || continue
    if [[ "$(gitp "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || true)" == "$short" ]]; then
      branch_path="$wt"
      break
    fi
  done <<<"$live_worktrees"
  [[ -z "$branch_path" ]] || continue
  changed=true
  if $APPLY; then
    if gitc branch -d -- "$short" >/dev/null 2>&1; then
      removed_branches=$((removed_branches + 1))
      printf 'removed merged branch %s\n' "$short"
    else
      changed=false
      kept_entries+=("branch $short|delete failed")
    fi
  else
    removed_branches=$((removed_branches + 1))
    printf 'would remove merged branch %s\n' "$short"
  fi
done < <(gitc for-each-ref --format='%(refname)' refs/heads/ 2>/dev/null || true)

verb="$($APPLY && echo removed || echo 'would remove')"
worktree_count="$(gitc worktree list --porcelain 2>/dev/null | grep -c '^worktree ' || true)"

# A run that changed nothing logs one line, so the log shows events rather than
# the same kept list every hour. The weekly backstop re-runs with --report, which
# is where a checkout that only ever gets kept says so out loud.
if $QUIET && ! $REPORT && ! $changed; then
  printf 'frank checkout sweep: nothing removed, %s checkout(s) retained\n' "${worktree_count:-0}"
  exit 0
fi

printf 'frank checkout sweep: %s %s checkout(s), %s branch(es), %s reclaimed; %s checkout(s) retained\n' \
  "$verb" "$removed_paths" "$removed_branches" "$(human "$freed_bytes")" "${worktree_count:-0}"

if ((${#kept_entries[@]} > 0)) && { $REPORT || $changed || ! $QUIET; }; then
  printf '\nkept:\n'
  for entry in "${kept_entries[@]}"; do
    printf '  %-58s %s\n' "${entry%%|*}" "${entry##*|}"
  done
fi
$APPLY || printf '\nrun again with --apply to remove them\n'

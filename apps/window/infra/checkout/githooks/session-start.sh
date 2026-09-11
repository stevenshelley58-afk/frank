# Shared session-start bookkeeping for the Frank commit guard.
#
# Sourced by the pre-commit and post-checkout hooks. This is not itself a git
# hook: git only invokes the hook names it knows.
#
# The guard needs one fact: when did the current session start in this checkout?
# Files modified before that moment cannot be this session's work.
#
#   * A linked worktree is claimed by exactly one session, so the worktree's
#     creation time is that session's start. Reading it keeps the guard precise:
#     every file the session edits is newer than its own claim.
#   * The canonical checkout at /projects/frank is shared by every session, so it
#     has no per-session claim to read. There the first guard run records the
#     start instead, and a commit made in the same run cannot be age-checked.

frank_now() {
  date +%s
}

# Print the claim time of the current linked worktree, or return non-zero when
# this checkout has no per-session claim (the shared canonical checkout, or a
# filesystem that does not report birth times).
frank_worktree_claim_epoch() {
  local git_dir common now birth
  now="$(frank_now)"
  git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [[ -n "$git_dir" && -n "$common" && "$git_dir" != "$common" ]] || return 1
  birth="$(stat -c %W -- "$git_dir" 2>/dev/null || true)"
  if [[ ! "$birth" =~ ^[0-9]+$ ]] || ((birth <= 0)); then
    # No birth time: the administrative HEAD is written once, when the worktree
    # is created, so its mtime is the next best claim signal.
    birth="$(stat -c %Y -- "$git_dir/HEAD" 2>/dev/null || true)"
  fi
  [[ "$birth" =~ ^[0-9]+$ ]] || return 1
  ((birth > 0 && birth <= now)) || return 1
  printf '%s\n' "$birth"
}

# Where this checkout records its session start. Git resolves this per worktree,
# so two sessions never share one marker.
frank_session_marker() {
  git rev-parse --git-path frank-session-start 2>/dev/null || true
}

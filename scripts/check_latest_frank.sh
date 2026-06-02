#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

remote="${FRANK_UPDATE_GITHUB_REMOTE:-origin}"
branch="${FRANK_UPDATE_GITHUB_BRANCH:-main}"

git fetch --quiet "${remote}" "${branch}"
current_commit="$(git rev-parse HEAD)"
remote_commit="$(git rev-parse "${remote}/${branch}")"
current_branch="$(git branch --show-current)"

if [ "${current_commit}" = "${remote_commit}" ]; then
  update_available=false
else
  update_available=true
fi

printf '{"updateAvailable":%s,"currentBranch":"%s","currentCommit":"%s","remote":"%s","branch":"%s","remoteCommit":"%s"}\n' \
  "${update_available}" \
  "${current_branch}" \
  "${current_commit}" \
  "${remote}" \
  "${branch}" \
  "${remote_commit}"

#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

branch="${1:-}"
if [ -z "${branch}" ]; then
  branch="$(git branch --show-current)"
fi

if [ -z "${branch}" ] || [ "${branch}" = "HEAD" ]; then
  echo "Usage: ./scripts/deploy_from_github.sh <branch>" >&2
  exit 1
fi

case "${branch}" in
  -*|*' '*|*'..'*|*'~'*|*'^'*|*':'*|*'?'*|*'['*|*'\'*)
    echo "Refusing unsafe branch name: ${branch}" >&2
    exit 1
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing deploy: local worktree has uncommitted changes." >&2
  git status --short >&2
  exit 1
fi

echo "Fetching ${branch} from GitHub..."
git fetch origin "${branch}"

if git show-ref --verify --quiet "refs/heads/${branch}"; then
  git checkout "${branch}"
else
  git checkout --track "origin/${branch}"
fi

git pull --ff-only origin "${branch}"

./scripts/deploy.sh
./scripts/healthcheck.sh

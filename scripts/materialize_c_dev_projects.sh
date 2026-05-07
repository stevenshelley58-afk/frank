#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/materialize_c_dev_projects.sh --dry-run
  bash scripts/materialize_c_dev_projects.sh --apply

Creates real VPS workspaces for the C:\Dev project inventory under
${FRANK_PROJECT_ROOT:-/opt/frank-projects}. Projects with Git remotes are cloned.
Projects without Git remotes get empty workspace folders.
USAGE
}

mode="${1:-}"
case "${mode}" in
  --dry-run)
    dry_run=true
    ;;
  --apply)
    dry_run=false
    ;;
  -h|--help|"")
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

project_root="${FRANK_PROJECT_ROOT:-/opt/frank-projects}"
case "${project_root}" in
  ""|"/"|"/root"|"/etc"|"/boot"|"/var"|"/var/lib"|"/var/lib/docker"|"/var/lib/postgresql")
    echo "Refusing unsafe FRANK_PROJECT_ROOT: ${project_root}" >&2
    exit 1
    ;;
esac

if [ "${dry_run}" = "true" ]; then
  echo "Dry-running workspace materialization under ${project_root}..."
else
  echo "Creating workspace root ${project_root}..."
  mkdir -p "${project_root}"
fi

project_manifest() {
  cat <<'PROJECTS'
skills|
tmp-ecc|https://github.com/affaan-m/everything-claude-code.git
allvibes|
asf|
audit|
bhm|https://github.com/stevenshelley58-afk/bhm-website
bhm-pulse|https://github.com/stevenshelley58-afk/bhm-pulse.git
bhm-preview-emdwgq|
bhm-preview-ym5tap|
bhm-pulse-release-main-jiiugd|https://github.com/stevenshelley58-afk/bhm-pulse.git
bis|
blockwise|
catalog-auditor|
cc-mirror|
dashboard|https://github.com/stevenshelley58-afk/Dashboard.git
devo|
dream-crusher-9000|
ecc-reference|https://github.com/affaan-m/everything-claude-code.git
em-box|
everything-claude-code|https://github.com/affaan-m/everything-claude-code.git
frank|https://github.com/stevenshelley58-afk/frank.git
frank-stage3-task-execution-foundation|
hunter|
hyperframes|
jenny|https://github.com/stevenshelley58-afk/Jenny
labcast-audit|https://github.com/stevenshelley58-afk/labcast-audit.git
lcaudit|https://github.com/stevenshelley58-afk/lcaudit.git
lcbuilder|https://github.com/stevenshelley58-afk/lcbuilder.git
liss|https://github.com/stevenshelley58-afk/liss.git
marketingskills|https://github.com/coreyhaines31/marketingskills.git
master|https://github.com/stevenshelley58-afk/master.git
mirror|
planner|
render-vault-gemini|https://github.com/stevenshelley58-afk/redner-vault
review|
see-it|
see-it-copy|
see-it-2|
see-it-old|https://github.com/stevenshelley58-afk/See-It.git
snappa|
stack-calculator|
storeworks|
storeworks-catalog|
temp|
theme|
wetblob|https://github.com/stevenshelley58-afk/wetblob.git
PROJECTS
}

created_count=0
cloned_count=0
failed_clone_count=0
skipped_count=0

while IFS='|' read -r slug repo_remote; do
  [ -n "${slug}" ] || continue

  target="${project_root%/}/${slug}"

  if [ -z "${repo_remote}" ]; then
    if [ "${dry_run}" = "true" ]; then
      echo "mkdir ${target}"
    else
      mkdir -p "${target}"
    fi
    created_count=$((created_count + 1))
    continue
  fi

  if [ -d "${target}/.git" ]; then
    echo "skip existing Git workspace ${target}"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if [ -e "${target}" ] && [ "$(find "${target}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    echo "skip non-empty existing workspace ${target}" >&2
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if [ "${dry_run}" = "true" ]; then
    echo "git clone ${repo_remote} ${target}"
  else
    if ! GIT_TERMINAL_PROMPT=0 git clone "${repo_remote}" "${target}"; then
      echo "clone failed for ${slug}; leaving an empty workspace for direct sync" >&2
      mkdir -p "${target}"
      failed_clone_count=$((failed_clone_count + 1))
      continue
    fi
  fi
  cloned_count=$((cloned_count + 1))
done < <(project_manifest)

echo "Workspace materialization complete: ${cloned_count} cloned, ${created_count} directories created, ${failed_clone_count} clone failures, ${skipped_count} skipped."

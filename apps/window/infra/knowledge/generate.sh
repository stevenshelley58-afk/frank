#!/usr/bin/env bash
set -euo pipefail

slug="${1:-}"
[[ "$slug" =~ ^[a-z0-9][a-z0-9-]{0,79}$ ]] || {
  echo "usage: frank-project-wiki <project-slug>" >&2
  exit 2
}

repo="/projects/$slug"
knowledge_root="/srv/frank/data/window/knowledge"
runtime_root="/var/lib/frank/knowledge"
codewiki="/opt/frank-knowledge/codewiki/venv/bin/codewiki"

[[ -x "$codewiki" ]] || { echo "CodeWiki is not installed" >&2; exit 1; }
[[ -d "$repo/.git" || -f "$repo/.git" ]] || { echo "project repository is unavailable: $repo" >&2; exit 1; }
[[ "$(realpath -e -- "$repo")" == "$repo" ]] || { echo "project path is not canonical" >&2; exit 1; }

install -d -o root -g root -m 0755 -- "$knowledge_root" "$runtime_root"
source_dir="$(mktemp -d "$runtime_root/${slug}.source.XXXXXX")"
stage_dir="$(mktemp -d "$knowledge_root/.${slug}.stage.XXXXXX")"
cleanup() {
  case "$source_dir" in "$runtime_root/${slug}.source."*) rm -rf -- "$source_dir" ;; esac
  case "$stage_dir" in "$knowledge_root/.${slug}.stage."*) rm -rf -- "$stage_dir" ;; esac
}
trap cleanup EXIT

git clone --quiet --no-hardlinks --single-branch -- "$repo" "$source_dir/repository"
revision="$(git -C "$source_dir/repository" rev-parse HEAD)"
output="$stage_dir/output"

cd "$source_dir/repository"
CODEWIKI_NO_KEYRING=1 "$codewiki" generate \
  --output "$output" \
  --doc-type architecture \
  --instructions "Write for a product owner. Explain what the app does, how requests and data move through it, major components, external services, deployment boundaries, and important rules. Include Mermaid architecture, data-flow, and sequence diagrams. Cite exact source files and label uncertainty."

[[ -s "$output/overview.md" ]] || { echo "CodeWiki did not produce overview.md" >&2; exit 1; }
printf '%s\n' "$revision" > "$output/source-revision.txt"
find "$output" -type d -exec chmod 0755 {} +
find "$output" -type f -exec chmod 0644 {} +

destination="$knowledge_root/$slug"
previous="$knowledge_root/.${slug}.previous"
[[ ! -e "$previous" ]] || rm -rf -- "$previous"
if [[ -e "$destination" ]]; then mv -- "$destination" "$previous"; fi
mv -- "$output" "$destination"
[[ ! -e "$previous" ]] || rm -rf -- "$previous"
echo "generated: $slug at $revision"

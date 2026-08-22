#!/usr/bin/env bash
set -euo pipefail

source_root="/projects/mini-frank"
frank_root="/projects/frank"
knowledge_root="/srv/frank/data/window/knowledge"
runtime_root="/var/lib/frank/knowledge"
compiler="$frank_root/apps/window/infra/knowledge/mini_frank_knowledge.py"

[[ "$(realpath -e -- "$source_root")" == "$source_root" ]] || { echo "Mini Frank project is unavailable" >&2; exit 1; }
[[ -d "$source_root/knowledge" ]] || { echo "Mini Frank knowledge source is unavailable" >&2; exit 1; }
[[ -d "$source_root/.git" || -f "$source_root/.git" ]] || { echo "Mini Frank project is not versioned" >&2; exit 1; }
[[ -z "$(git -C "$source_root" status --porcelain)" ]] || { echo "Mini Frank project has uncommitted files" >&2; exit 1; }
[[ -f "$compiler" ]] || { echo "Mini Frank knowledge compiler is unavailable" >&2; exit 1; }
source_revision="$(git -C "$source_root" rev-parse HEAD)"

install -d -o root -g root -m 0755 -- "$knowledge_root" "$runtime_root"
stage_dir="$(mktemp -d "$knowledge_root/.mini-frank.stage.XXXXXX")"
cleanup() {
  case "$stage_dir" in "$knowledge_root/.mini-frank.stage."*) rm -rf -- "$stage_dir" ;; esac
}
trap cleanup EXIT

python3 "$compiler" build \
  --source "$source_root" \
  --output "$stage_dir/output" \
  --as-of "$(date -u +%F)" \
  --verify-local-sources \
  --repo-root "$frank_root"
printf '%s\n' "$source_revision" > "$stage_dir/output/source-revision.txt"
find "$stage_dir/output" -type d -exec chmod 0755 {} +
find "$stage_dir/output" -type f -exec chmod 0644 {} +

destination="$knowledge_root/mini-frank"
previous="$knowledge_root/.mini-frank.previous"
[[ ! -e "$previous" ]] || rm -rf -- "$previous"
if [[ -e "$destination" ]]; then mv -- "$destination" "$previous"; fi
mv -- "$stage_dir/output" "$destination"
[[ ! -e "$previous" ]] || rm -rf -- "$previous"
echo "generated: mini-frank knowledge"

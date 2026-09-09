#!/usr/bin/env bash
set -euo pipefail

# Repeatable local/CI verification for the Window. Run from any directory as
# npm run verify in apps/window, or invoke this script directly.
window_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$window_root"

verify_tmp=$(mktemp -d "${TMPDIR:-/tmp}/frank-window-verify.XXXXXX")
trap 'rm -rf "$verify_tmp"' EXIT
export CHAT_STORE_DIR="$verify_tmp/data"
export MINI_PREVIEW_ROOT="$verify_tmp/previews"
export MINI_LEGACY_PROJECT_ROOT="$verify_tmp/legacy"
mkdir -p "$CHAT_STORE_DIR" "$MINI_PREVIEW_ROOT" "$MINI_LEGACY_PROJECT_ROOT"

echo "Python syntax and unit tests"
python -m py_compile server.py mini_frank.py
python -m compileall -q mini
python -m unittest discover -s tests

echo "JavaScript/MJS syntax (all Window files, excluding vendored dependencies)"
while IFS= read -r -d '' file; do
  node --check "$file"
done < <(find . -type f \( -name '*.js' -o -name '*.mjs' \) \
  -not -path './node_modules/*' -not -path './vendor/*' -print0 | sort -z)

echo "Non-browser JavaScript tests"
mapfile -d '' js_tests < <(find tests -maxdepth 1 -type f -name '*.test.mjs' \
  -not -name 'graph_browser.test.mjs' -print0 | sort -z)
node --test "${js_tests[@]}"

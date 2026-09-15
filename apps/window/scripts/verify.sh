#!/usr/bin/env bash
set -uo pipefail

# Repeatable local/CI verification for the Window. Run from any directory as
# npm run verify in apps/window, or invoke this script directly.
#
# Every suite always runs. This script deliberately does not use `set -e`: it
# used to abort at the first failing step, so a red Python suite silently
# skipped both the JavaScript syntax check and the entire JavaScript test
# suite. A failure in one step must never hide the others.
window_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$window_root"

verify_tmp=$(mktemp -d "${TMPDIR:-/tmp}/frank-window-verify.XXXXXX")
trap 'rm -rf "$verify_tmp"' EXIT
export CHAT_STORE_DIR="$verify_tmp/data"
export MINI_PREVIEW_ROOT="$verify_tmp/previews"
export MINI_LEGACY_PROJECT_ROOT="$verify_tmp/legacy"
mkdir -p "$CHAT_STORE_DIR" "$MINI_PREVIEW_ROOT" "$MINI_LEGACY_PROJECT_ROOT"

failed=()

step() {
  local name="$1"
  shift
  echo
  echo "== $name"
  if "$@"; then
    echo "-- PASS: $name"
  else
    echo "-- FAIL: $name"
    failed+=("$name")
  fi
}

python_syntax() {
  python -m py_compile server.py mini_frank.py &&
    python -m compileall -q mini
}

js_syntax() {
  local status=0 file
  while IFS= read -r -d '' file; do
    node --check "$file" || status=1
  done < <(find . -type f \( -name '*.js' -o -name '*.mjs' \) \
    -not -path './node_modules/*' -not -path './vendor/*' -print0 | sort -z)
  return "$status"
}

run_js_tests() {
  local -a js_tests=()
  mapfile -d '' js_tests < <(find tests -maxdepth 1 -type f -name '*.test.mjs' \
    -not -name 'graph_browser.test.mjs' -print0 | sort -z)
  node --test "${js_tests[@]}"
}

step "Shared shadcn theme parity" node scripts/sync-window-theme.mjs --check
step "Python syntax" python_syntax
step "Python unit tests" python -m unittest discover -s tests
step "JavaScript/MJS syntax (all Window files, excluding vendored dependencies)" js_syntax
step "Non-browser JavaScript tests" run_js_tests

echo
if [ "${#failed[@]}" -gt 0 ]; then
  echo "VERIFY FAILED: ${#failed[@]} step(s) failed: ${failed[*]}"
  exit 1
fi
echo "VERIFY PASSED: every step passed"

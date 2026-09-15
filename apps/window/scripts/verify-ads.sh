#!/usr/bin/env bash
# The Ads workspace acceptance run.
#
# One command, one receipt. It runs every layer the owner's brief asks for, in
# the order a defect would be caught: the rules (no browser), the wire-level
# journey (the production modules against controlled HTTP answers), and the
# entry journey (the real application, a fresh browser, the exact link).
#
# The entry journey needs a running Frank instance. Point it at one with
# ADS_BASE_URL (default: the local review instance on 127.0.0.1:18090). If that
# instance is not answering, the stage is reported as skipped rather than
# passed, because "the browser journey did not run" is not evidence.
#
# Usage:
#   bash scripts/verify-ads.sh [--out <evidence-dir>]
#
# Exit code is 0 only when every stage that ran succeeded.
set -uo pipefail

window_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$window_root"

out="/srv/frank/verification/ads-plan-a-20260914"
while (($#)); do
  case "$1" in
    --out) out="${2:?--out needs a directory}"; shift 2 ;;
    --help) echo "usage: verify-ads.sh [--out <evidence-dir>]"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$out"

base_url="${ADS_BASE_URL:-http://127.0.0.1:18090}"
python_bin="${ADS_PYTHON:-/srv/frank/acceptance-venv/bin/python}"
failures=0
declare -a summary=()

stage() {
  local name="$1"; shift
  echo
  echo "== $name"
  if "$@"; then
    summary+=("PASS  $name")
  else
    summary+=("FAIL  $name")
    failures=$((failures + 1))
  fi
}

stage_skip() {
  summary+=("SKIP  $1")
  echo
  echo "== $1"
  echo "skipped: $2"
}

# ---------------------------------------------------------------------------
# 1. Syntax. A parse error in one module takes the whole workspace down, which
#    is the blank screen this run exists to prevent, so it is checked first.
# ---------------------------------------------------------------------------
check_syntax() {
  local file
  while IFS= read -r -d '' file; do
    node --check "$file" || return 1
  done < <(find web/js/ads -type f -name '*.js' -print0 | sort -z)
}
stage "syntax: every ads module parses" check_syntax

# ---------------------------------------------------------------------------
# 2. Rule tests. No browser, no network.
# ---------------------------------------------------------------------------
run_rule_tests() {
  node --test tests/ads_identity.test.mjs tests/ads_drafts.test.mjs tests/ads_workspace_contract.test.mjs tests/ads_tracking.test.mjs
}
stage "rules: identity, drafts, contract, tracking" run_rule_tests

run_server_tests() {
  python3 -m pytest tests/test_owner_ads.py -q
}
stage "rules: the reader contract, server half" run_server_tests

# ---------------------------------------------------------------------------
# 3. The wire-level journey: the production modules in a real browser, with the
#    server's answers (throttling, a failed refresh, a slow read) controlled.
# ---------------------------------------------------------------------------
run_harness_journey() {
  "$python_bin" acceptance/ads_journey.py --root . --out "$out/ads-harness"
}
stage "browser: the wire-level journey" run_harness_journey

# ---------------------------------------------------------------------------
# 4. The entry journey: the exact link, a fresh browser, the real shell.
# ---------------------------------------------------------------------------
if curl -fsS -o /dev/null --max-time 5 "$base_url/api/health"; then
  run_entry_journey() {
    "$python_bin" acceptance/ads_entry_journey.py --base-url "$base_url" --out "$out"
  }
  stage "browser: the real entry, all six screens, phone and keyboard" run_entry_journey
else
  stage_skip "browser: the real entry, all six screens, phone and keyboard" "no Frank instance answering at $base_url"
fi

# ---------------------------------------------------------------------------
# Receipt.
# ---------------------------------------------------------------------------
echo
echo "== summary"
for line in "${summary[@]}"; do echo "  $line"; done
{
  printf '{\n  "generatedAt": "%s",\n  "baseUrl": "%s",\n  "stages": [\n' "$(date -Iseconds)" "$base_url"
  for index in "${!summary[@]}"; do
    line="${summary[$index]}"
    printf '    {"result": "%s", "stage": "%s"}%s\n' "${line%% *}" "${line#*  }" "$([ "$index" -lt $((${#summary[@]} - 1)) ] && echo ,)"
  done
  printf '  ],\n  "failed": %d\n}\n' "$failures"
} > "$out/ads-acceptance.json"
echo
echo "receipt: $out/ads-acceptance.json"
exit "$failures"

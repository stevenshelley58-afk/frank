#!/usr/bin/env bash
set -euo pipefail
s="$(cd -- "$(dirname -- "$0")" && pwd -P)"
python3 -m py_compile "$s/mautic_flows.py" "$s/test_mautic_flows.py"
python3 "$s/test_mautic_flows.py"
bash -n "$s/apply.sh" "$s/verify.sh"
grep -q 'cold_local_audit' "$s/mautic_flows.py"
grep -q 'doNotContact' "$s/mautic_flows.py"
grep -q 'unsubscribe_url' "$s/mautic_flows.py"
echo 'owner-email-flows tests passed'

#!/usr/bin/env bash
set -euo pipefail
s="$(cd -- "$(dirname -- "$0")" && pwd -P)"
python3 -m py_compile "$s/mautic_flows.py" "$s/test_mautic_flows.py" "$s/source_adapter.py" "$s/source_operate.py" "$s/source_scheduled.py" "$s/activate_source_adapter.py"
python3 "$s/test_mautic_flows.py"
python3 "$s/test_source_adapter.py"
bash -n "$s/apply.sh" "$s/verify.sh"
grep -q 'cold_local_audit' "$s/mautic_flows.py"
grep -q 'doNotContact' "$s/mautic_flows.py"
grep -q 'unsubscribe_url' "$s/mautic_flows.py"
grep -q 'marketingConsent' "$s/source_adapter.py"
echo 'owner-email-flows tests passed'

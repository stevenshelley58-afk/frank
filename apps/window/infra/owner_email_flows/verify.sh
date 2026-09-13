#!/usr/bin/env bash
set -euo pipefail
s="$(cd -- "$(dirname -- "$0")" && pwd -P)"
secret=/srv/frank/secrets/owner-marketing/owner-marketing.env
[[ -f "$secret" && ! -L "$secret" ]] || { echo "owner-email-flows: missing owner-marketing secret" >&2; exit 2; }
set -a; source "$secret"; set +a
python3 "$s/mautic_flows.py" verify

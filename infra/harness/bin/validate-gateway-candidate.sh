#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
compose="$root/harness/docker-compose.gateway.yml"
forbidden='(latest|1\.82\.7|1\.82\.8)'
rg -n 'ports:|privileged:|network_mode: host|FRANK_OPENFGA|insecure|skip.*verify' "$compose" && { echo 'unsafe gateway compose token'; exit 1; } || true
rg -n 'frank-attachment-staging|frank-objects|frank-object-previews|frank-previews' "$compose" "$root/harness" | grep -q 'frank-attachment-staging'
rg -n 'disable-download|max-size=2147483648|hooks-http=' "$compose" >/dev/null
rg -n 'CURRENT_IMAGE=.*(latest|1\.82\.7|1\.82\.8)' "$compose" && { echo 'forbidden mutable/compromised current image'; exit 1; } || true
for var in LITELLM SEAWEEDFS TUSD CLAMAV GOOSE HERMES LETTA; do
  key="FRANK_${var}_CURRENT_IMAGE"
  image="${!key:-}"
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "FRANK_${var}_CURRENT_IMAGE needs an OCI digest"; exit 1; }
done
echo 'gateway candidate manifest is structurally fail-closed'

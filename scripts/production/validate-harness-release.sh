#!/usr/bin/env bash
set -euo pipefail
# Read-only release gate. A harness promotion cannot proceed until every image is a digest.
: "${FRANK_BASE_COMPOSE:?}" "${FRANK_APP_OVERLAY:?}" "${FRANK_HARNESS_OVERLAY:?}"
for name in LITELLM SEAWEEDFS TUSD CLAMAV LETTA HERMES; do
  key="FRANK_${name}_CURRENT_IMAGE"; value="${!key:-}"
  [[ "$value" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "$key must be an OCI digest" >&2; exit 1; }
done
available_kib="$(df -Pk "${FRANK_DATA_PATH:-/srv/frank}" | awk 'NR==2{print $4}')"
(( available_kib >= 30*1024*1024 )) || { echo 'attachment pool refused: less than 30 GiB free' >&2; exit 1; }
docker compose -f "$FRANK_BASE_COMPOSE" -f "$FRANK_APP_OVERLAY" -f "$FRANK_HARNESS_OVERLAY" config --quiet
echo 'harness-release-config=passed; planned attachment pool=50GiB; no allocation was performed'

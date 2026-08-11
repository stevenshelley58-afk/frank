#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
compose="$root/infra/production/docker-compose.harness.yml"
caddy="$root/infra/production/Caddyfile.frank-production"
for token in 'ports:' 'frank-previews' 'FRANK_OPENFGA' 'insecure-skip-verify' 'tls-skip-verify'; do
  if rg -n "$token" "$compose"; then echo "forbidden: $token"; exit 1; fi
done
rg -q 'FRANK_LETTA_INTERNAL_URL.*frank-letta-server:8283' "$root/infra/production/docker-compose.app.yml"
rg -q 'handle /v1/uploads/tus/\*' "$caddy"
rg -q 'disable-download' "$compose"
rg -q 'max-size=2147483648' "$compose"
rg -q 'http://frank-seaweedfs:8333' "$compose"
rg -q 'frank-model' "$compose"
rg -q 'X-Tusd-Gate-Secret|X-Forwarded-Method|X-Forwarded-Uri|X-Frank-Upload-Capability|X-Frank-Tusd-Hook-Secret' "$root/infra/production/Caddyfile.frank-production"
rg -q 'forward_auth always issues GET' "$caddy"
rg -q 'uri /private/tusd/gate' "$caddy"
! rg -q 'header_up X-Forwarded-Method' "$caddy"
! rg -q 'header_up X-Forwarded-Uri' "$caddy"
echo 'gateway static security assertions passed'

#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
compose="$root/infra/production/docker-compose.harness.yml"
caddy="$root/infra/production/Caddyfile.frank-production"
for token in 'ports:' 'frank-previews' 'FRANK_OPENFGA' 'insecure-skip-verify' 'tls-skip-verify'; do
  if rg -n "$token" "$compose"; then echo "forbidden: $token"; exit 1; fi
done
rg -q 'FRANK_LETTA_INTERNAL_URL.*http://frank-letta:8283' "$root/infra/production/docker-compose.app.yml"
rg -q 'http://127.0.0.1:8283/v1/health' "$compose"
rg -q 'handle /v1/uploads/tus/\*' "$caddy"
rg -q 'disable-download' "$compose"
rg -q 'max-size=2147483648' "$compose"
rg -q 'http://frank-seaweedfs:8333' "$compose"
rg -q 'frank-model' "$compose"
rg -q 'X-Tusd-Gate-Secret|X-Tusd-Original-Method|X-Tusd-Original-Uri' "$root/infra/production/Caddyfile.frank-production"
echo 'gateway static security assertions passed'

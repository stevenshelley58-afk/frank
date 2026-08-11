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
rg -q 'header_up X-Forwarded-Method \{method\}' "$caddy"
rg -q 'header_up X-Forwarded-Uri \{uri\}' "$caddy"
promote="$root/infra/harness/bin/promote-gateway-candidate.sh"
state_root="$(mktemp -d)"
trap 'rm -rf -- "$state_root"' EXIT
candidate="$state_root/candidate.env"; current="$state_root/current.env"; rollback="$state_root/rollback.env"; manifest="$state_root/evidence-manifest.json"
digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
for service in LITELLM SEAWEEDFS TUSD CLAMAV; do printf 'FRANK_%s_CANDIDATE_IMAGE=example.invalid/%s@%s\n' "$service" "${service,,}" "$digest" >> "$candidate"; done
: > "$current"; : > "$rollback"
write_manifest() {
  local release="$1"
  node --input-type=module - "$manifest" "$release" "$digest" <<'NODE'
import {writeFileSync} from 'node:fs';
const [path, release, digest] = process.argv.slice(2);
const services = ['litellm', 'seaweedfs', 'tusd', 'clamav'].map((service) => ({service, release_url: `https://evidence.invalid/${service}`, tag: 'immutable', oci_digest: digest, license: 'test', provenance_method: 'test', sbom_sha256: digest, server_command: 'test', hosted_canary_url: `https://canary.invalid/${service}`, config_sha256: digest}));
writeFileSync(path, `${JSON.stringify({release, services})}\n`);
NODE
}
write_manifest 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
FRANK_RELEASE_STATE_ROOT="$state_root" "$promote" "$candidate" "$current" "$rollback" 'https://evidence.invalid/run' "$manifest" >/dev/null
write_manifest 'gggggggggggggggggggggggggggggggggggggggg'
if FRANK_RELEASE_STATE_ROOT="$state_root" "$promote" "$candidate" "$current" "$rollback" 'https://evidence.invalid/run' "$manifest" >/dev/null 2>&1; then
  echo 'non-hex manifest release was accepted'; exit 1
fi
echo 'gateway static security assertions passed'

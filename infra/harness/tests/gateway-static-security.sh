#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
compose="$root/infra/production/docker-compose.harness.yml"
app_compose="$root/infra/production/docker-compose.app.yml"
caddy="$root/infra/production/Caddyfile.frank-production"
litellm_config="$root/infra/harness/litellm/config.yaml"
litellm_bootstrap="$root/scripts/production/bootstrap-litellm-virtual-key.sh"
release_runbook="$root/docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md"
for token in 'frank-previews' 'FRANK_OPENFGA' 'insecure-skip-verify' 'tls-skip-verify'; do
  if grep -En "$token" "$compose"; then echo "forbidden: $token"; exit 1; fi
done
grep -Eq 'FRANK_LETTA_INTERNAL_URL.*frank-letta-server:8283' "$root/infra/production/docker-compose.app.yml"
grep -Eq 'handle /v1/uploads/tus/\*' "$caddy"
grep -Eq 'disable-download' "$compose"
grep -Eq 'max-size=2147483648' "$compose"
grep -Eq 'http://frank-seaweedfs:8333' "$compose"
grep -Eq 'frank-model' "$compose"
grep -Eq 'X-Tusd-Gate-Secret|X-Forwarded-Method|X-Forwarded-Uri|X-Frank-Upload-Capability|X-Frank-Tusd-Hook-Secret' "$root/infra/production/Caddyfile.frank-production"
grep -Eq 'forward_auth always issues GET' "$caddy"
grep -Eq 'uri /private/tusd/gate' "$caddy"
grep -Eq 'header_up X-Forwarded-Method \{method\}' "$caddy"
grep -Eq 'header_up X-Forwarded-Uri \{uri\}' "$caddy"
grep -Eq '^  for image_var in FRANK_LITELLM_CURRENT_IMAGE FRANK_SEAWEEDFS_CURRENT_IMAGE FRANK_TUSD_CURRENT_IMAGE FRANK_CLAMAV_CURRENT_IMAGE; do$' "$release_runbook"
if grep -Eq 'for image_var.*FRANK_(LETTA|HERMES)_CURRENT_IMAGE' "$release_runbook"; then echo 'stale non-core harness image in executable release path'; exit 1; fi
grep -Eq 'disable_spend_logs: false' "$litellm_config"
grep -Eq '^router_settings:' "$litellm_config"
grep -Eq '^  num_retries: 0$' "$litellm_config"
grep -Eq '^  fallbacks: \[\]$' "$litellm_config"
grep -Eq 'FRANK_LITELLM_VIRTUAL_KEY:.*restricted LiteLLM virtual key required' "$compose"
grep -Eq 'FRANK_TUSD_GATE_SECRET:.*distinct Caddy-to-gate credential required' "$compose"
grep -Eq 'FRANK_TUSD_HOOK_SECRET:.*Caddy-to-tusd hook credential required' "$compose"
test "$(grep -Ec '^[[:space:]]+FRANK_TUSD_GATE_SECRET:' "$compose")" -eq 2
test "$(grep -Ec '^[[:space:]]+FRANK_TUSD_HOOK_SECRET:' "$compose")" -eq 2
if grep -Eq 'FRANK_LITELLM_VIRTUAL_KEY|FRANK_TUSD_(GATE|HOOK)_SECRET|^[[:space:]]+- frank-(model|attachments)$' "$app_compose"; then echo 'harness-only secret or network blocks the disabled app render path'; exit 1; fi
if grep -Eq '^[[:space:]]+LITELLM_ADMIN_KEY:' "$app_compose"; then echo 'LiteLLM admin key leaked into API overlay'; exit 1; fi
test "$(grep -El 'LITELLM_ADMIN_KEY' "$compose" "$litellm_config" "$litellm_bootstrap" | wc -l)" -eq 3
grep -Eq 'http://127\.0\.0\.1:4000/key/generate' "$litellm_bootstrap"
grep -Eq "key_type: 'llm_api'" "$litellm_bootstrap"
grep -Eq "models: \['frank-openai-direct', 'frank-gemini-direct', 'frank-concentrate', 'frank-deepseek-direct'\]" "$litellm_bootstrap"
grep -Eq "allowed_routes: \['/chat/completions', '/v1/chat/completions', '/responses', '/v1/responses'\]" "$litellm_bootstrap"
grep -Eq 'provider request ID' "$release_runbook"
grep -Eq 'Enterprise-only custom spend metadata' "$release_runbook"
grep -Eq 'test "\$FRANK_TUSD_GATE_SECRET" != "\$FRANK_TUSD_HOOK_SECRET"' "$release_runbook"
grep -Eq 'Required host commands are Bash 4\.3\+, Node\.js 22' "$release_runbook"
grep -Eq 'not before 1\.83\.7' "$root/infra/harness/README.md"
grep -Eq 'SeaweedFS 4\.41, tusd v2\.10\.0, and ClamAV' "$root/infra/harness/README.md"
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

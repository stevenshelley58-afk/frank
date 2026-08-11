#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
compose="$root/infra/production/docker-compose.harness.yml"
app_compose="$root/infra/production/docker-compose.app.yml"
caddy="$root/infra/production/Caddyfile.frank-production"
litellm_config="$root/infra/harness/litellm/config.yaml"
litellm_bootstrap="$root/scripts/production/bootstrap-litellm-virtual-key.sh"
bucket_bootstrap="$root/scripts/production/bootstrap-attachment-buckets.sh"
s3_canary="$root/scripts/production/s3-policy-canary.sh"
seaweed_renderer="$root/scripts/production/render-seaweedfs-s3-config.sh"
release_runbook="$root/docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
for token in 'frank-previews' 'FRANK_OPENFGA' 'insecure-skip-verify' 'tls-skip-verify'; do
  if grep -En "$token" "$compose"; then echo "forbidden: $token"; exit 1; fi
done
grep -Eq 'FRANK_LETTA_INTERNAL_URL.*frank-letta-server:8283' "$root/infra/production/docker-compose.app.yml"
grep -Eq '@frank_tusd_upload path /v1/uploads/tus /v1/uploads/tus/ /v1/uploads/tus/\*' "$caddy"
grep -Eq 'handle @frank_tusd_upload' "$caddy"
grep -Eq 'disable-download' "$compose"
grep -Eq 'max-size=2147483648' "$compose"
grep -Eq 'http://frank-seaweedfs:8333' "$compose"
grep -Eq 'frank-model' "$compose"
grep -Eq 'X-Forwarded-Method|X-Forwarded-Uri|X-Frank-Upload-Capability|X-Frank-Tusd-Hook-Secret' "$root/infra/production/Caddyfile.frank-production"
grep -Eq 'header_up X-Frank-Tusd-Gate-Secret \{\$FRANK_TUSD_GATE_SECRET\}' "$caddy"
if grep -Eq 'header_up X-Tusd-Gate-Secret' "$caddy"; then echo 'Caddy gate header does not match the API contract'; exit 1; fi
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
if grep -Eq 'FRANK_LITELLM_VIRTUAL_KEY|FRANK_TUSD_(GATE|HOOK)_SECRET|FRANK_ATTACHMENT_PROMOTER_BEARER|^[[:space:]]+- frank-(model|attachments)$' "$app_compose"; then echo 'harness-only secret or network blocks the disabled app render path'; exit 1; fi
grep -Fq 'if $harness then' "$release_runbook"
grep -Fq 'has("FRANK_LITELLM_VIRTUAL_KEY") | not' "$release_runbook"
if grep -Eq '^[[:space:]]+LITELLM_ADMIN_KEY:' "$app_compose"; then echo 'LiteLLM admin key leaked into API overlay'; exit 1; fi
test "$(grep -El 'LITELLM_ADMIN_KEY' "$compose" "$litellm_config" "$litellm_bootstrap" | wc -l)" -eq 3
grep -Eq 'http://127\.0\.0\.1:4000/key/generate' "$litellm_bootstrap"
grep -Eq "key_type: 'llm_api'" "$litellm_bootstrap"
grep -Eq "models: \['frank-openai-direct', 'frank-gemini-direct', 'frank-concentrate', 'frank-deepseek-direct'\]" "$litellm_bootstrap"
grep -Eq "allowed_routes: \['/chat/completions', '/v1/chat/completions', '/responses', '/v1/responses'\]" "$litellm_bootstrap"
grep -Eq 'provider request ID' "$release_runbook"
grep -Eq 'Enterprise-only custom spend metadata' "$release_runbook"
grep -Eq 'test "\$FRANK_TUSD_GATE_SECRET" != "\$FRANK_TUSD_HOOK_SECRET"' "$release_runbook"
grep -Fq "export FRANK_TUSD_HOOK_URL='http://frank-api:3000/private/tusd/hooks'" "$release_runbook"
grep -Fq '${FRANK_TUSD_HOOK_URL:-http://frank-api:3000/private/tusd/hooks}' "$compose"
grep -Eq 'Required host commands are Bash 4\.3\+, Node\.js 22' "$release_runbook"
grep -Fq -- '-e FRANK_API_INTERNAL_URL \' "$release_runbook"
grep -Fq -- '-e FRANK_WEB_INTERNAL_URL \' "$release_runbook"
grep -Fq -- '-e FRANK_TUSD_INTERNAL_URL=http://frank-tusd:1080 \' "$release_runbook"
grep -Fq -- '-e FRANK_UPLOAD_GATE_INTERNAL_URL=http://frank-api:3000 \' "$release_runbook"
grep -Fq -- '-e FRANK_TUSD_GATE_SECRET=validation-only-gate-sentinel \' "$release_runbook"
grep -Fq -- '-e FRANK_TUSD_HOOK_SECRET=validation-only-hook-sentinel \' "$release_runbook"
grep -Fq "actions:['Admin']" "$seaweed_renderer"
grep -Fq 'render-seaweedfs-s3-config.sh"' "$bucket_bootstrap"
grep -Fq -- '--force-recreate --no-deps --wait' "$bucket_bootstrap"
grep -Fq 'temporary Seaweed bootstrap credential survived scoped recreate' "$bucket_bootstrap"
grep -Fq 'FRANK_ROOT_RUNTIME_ENV' "$bucket_bootstrap"
if grep -Eq '(^|[[:space:]])rg([[:space:]]|$)' "$root/infra/harness/bin/validate-gateway-candidate.sh"; then echo 'candidate validator requires unavailable ripgrep'; exit 1; fi
test "$(grep -Ec 'delete-object --bucket frank-(attachment-staging|objects|object-previews)' "$s3_canary")" -eq 3
grep -Fq 'object canary cleanup failed' "$s3_canary"
grep -Fq 'preview canary cleanup failed' "$s3_canary"
grep -Eq 'not before 1\.83\.7' "$root/infra/harness/README.md"
grep -Eq 'SeaweedFS 4\.41, tusd v2\.10\.0, and ClamAV' "$root/infra/harness/README.md"
harness_up_line="$(grep -n 'harness-compose-up.log' "$release_runbook" | cut -d: -f1)"
bucket_bootstrap_line="$(grep -n 'bootstrap-attachment-buckets.sh' "$release_runbook" | cut -d: -f1)"
test "$bucket_bootstrap_line" -gt "$harness_up_line"

# Render the production overlays on the hosted Linux runner. The first render deliberately
# has no harness-only variables; the second proves the complete atomic harness contract.
compose_base="$scratch/docker-compose.base.yml"
cat > "$compose_base" <<'YAML'
name: frank-render-contract
services:
  frank-api: { image: "example.invalid/base:1" }
  frank-web: { image: "example.invalid/base:1" }
  frank-caddy: { image: "example.invalid/base:1" }
  frank-db: { image: "example.invalid/base:1" }
  frank-redis: { image: "example.invalid/base:1" }
networks:
  frank: { name: frank }
volumes:
  frank_codegraph_data: {}
YAML
digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
export FRANK_API_IMAGE="ghcr.io/example/frank-api@$digest"
export FRANK_WEB_IMAGE="ghcr.io/example/frank-web@$digest"
export FRANK_CODEGRAPH_IMAGE="ghcr.io/example/frank-codegraph@$digest"
export FRANK_WORKBENCH_IMAGE="ghcr.io/example/frank-workbench@$digest"
export FRANK_CELL_ID='validation-cell' FRANK_OWNER_ID='validation-owner'
export FRANK_API_AUDIENCE='validation-audience' FRANK_PUBLIC_URL='https://frank.invalid'
export FRANK_DATABASE_URL='postgres://frank:validation@frank-db/frank'
export FRANK_REDIS_URL='redis://frank-redis:6379/0'
export FRANK_SESSION_SIGNING_KEY='validation-session' FRANK_ENVELOPE_SIGNING_KEY='validation-envelope'
export FRANK_DOMAIN_SERVICE_TOKEN='validation-domain' FRANK_PACK_SIGNING_KEY='validation-pack'
export FRANK_LOG_LEVEL='info' FRANK_MAX_BODY_BYTES='8388608'
export FRANK_WORKBENCH_RUNNER_ENABLED='true' FRANK_WORKBENCH_CONCURRENCY='1'
export FRANK_WORKBENCH_MODEL_PROVIDER='validation' FRANK_WORKBENCH_MODEL_BASE_URL='https://model.invalid'
export FRANK_WORKBENCH_MODEL='validation-model' DEEPSEEK_API_KEY='validation-model-key'
export FRANK_MISSION_ORCHESTRATOR_ENABLED='true' FRANK_MISSION_WORKSPACE_SOURCE='/srv/frank/workspaces/central'
export FRANK_MISSION_PLANNER_MODEL='validation-model' FRANK_MISSION_CHEAP_MODEL='validation-model'
export FRANK_MISSION_STRONG_MODEL='validation-model' FRANK_EXPECTED_MODEL='validation-model'
export GOOSE_ACP_URL='https://goose.invalid' GOOSE_ACP_SECRET='validation-goose'
export GOOSE_PROVIDER='validation' GOOSE_MODEL='validation-model'
export FRANK_DOCKER_SOCKET_GID='999' FRANK_WORKSPACE_SOURCE_HOST_PATH="$root" FRANK_RELEASE_SOURCE="$root"
export FRANK_API_MEMORY_LIMIT='1g' FRANK_API_CPU_LIMIT='1.0'
export FRANK_WEB_MEMORY_LIMIT='1g' FRANK_WEB_CPU_LIMIT='1.0'
export FRANK_LOG_MAX_SIZE='10m' FRANK_LOG_MAX_FILES='3'
export FRANK_BASIC_AUTH_USER='validation' FRANK_BASIC_AUTH_HASH='validation-only-hash'
export FRANK_API_INTERNAL_URL='http://frank-api:3000' FRANK_WEB_INTERNAL_URL='http://frank-web:3001'
export FRANK_CODEGRAPH_CONTROL_TOKEN_FILE="$scratch/codegraph-control-token"
unset FRANK_ATTACHMENT_PROMOTER_BEARER FRANK_LITELLM_VIRTUAL_KEY FRANK_TUSD_GATE_SECRET FRANK_TUSD_HOOK_SECRET FRANK_TUSD_HOOK_URL
disabled_render="$scratch/disabled.json"
docker compose -f "$compose_base" -f "$app_compose" config --format json > "$disabled_render"
export FRANK_LITELLM_VIRTUAL_KEY='validation-only-virtual-key'
export FRANK_TUSD_GATE_SECRET='validation-only-gate-secret' FRANK_TUSD_HOOK_SECRET='validation-only-hook-secret'
export FRANK_LITELLM_CURRENT_IMAGE="example.invalid/litellm@$digest"
export FRANK_SEAWEEDFS_CURRENT_IMAGE="example.invalid/seaweedfs@$digest"
export FRANK_TUSD_CURRENT_IMAGE="example.invalid/tusd@$digest"
export FRANK_CLAMAV_CURRENT_IMAGE="example.invalid/clamav@$digest"
export LITELLM_ADMIN_KEY='validation-only-admin-key'
export LITELLM_DATABASE_URL='postgres://litellm:validation@frank-db/litellm'
export FRANK_LITELLM_OPENAI_MODEL='validation-model' FRANK_LITELLM_GEMINI_MODEL='validation-model'
export FRANK_LITELLM_CONCENTRATE_MODEL='validation-model' FRANK_LITELLM_DEEPSEEK_MODEL='validation-model'
export FRANK_ATTACHMENT_STAGING_ACCESS_KEY='validation-staging-access'
export FRANK_ATTACHMENT_STAGING_SECRET_KEY='validation-staging-secret'
enabled_render="$scratch/enabled.json"
docker compose -f "$compose_base" -f "$app_compose" -f "$compose" config --format json > "$enabled_render"
node --input-type=module - "$disabled_render" "$enabled_render" <<'NODE'
import {readFileSync} from 'node:fs';
const [disabledPath, enabledPath] = process.argv.slice(2);
const disabled = JSON.parse(readFileSync(disabledPath, 'utf8'));
const enabled = JSON.parse(readFileSync(enabledPath, 'utf8'));
for (const name of ['FRANK_LITELLM_VIRTUAL_KEY', 'FRANK_TUSD_GATE_SECRET', 'FRANK_TUSD_HOOK_SECRET', 'FRANK_ATTACHMENT_PROMOTER_BEARER']) {
  if (Object.hasOwn(disabled.services['frank-api'].environment, name)) throw new Error(`disabled API retained ${name}`);
}
if (disabled.services['frank-tusd']) throw new Error('disabled render retained tusd');
if (Object.hasOwn(disabled.services['frank-caddy'].environment, 'FRANK_TUSD_GATE_SECRET')) throw new Error('disabled Caddy retained tusd gate secret');
const command = enabled.services['frank-tusd'].command;
if (!Array.isArray(command) || !command.includes('-hooks-http=http://frank-api:3000/private/tusd/hooks')) throw new Error('enabled tusd private hook URL missing');
if (enabled.services['frank-api'].environment.FRANK_TUSD_GATE_SECRET !== enabled.services['frank-caddy'].environment.FRANK_TUSD_GATE_SECRET) throw new Error('enabled gate secrets differ');
if (Object.hasOwn(enabled.services['frank-api'].environment, 'FRANK_ATTACHMENT_PROMOTER_BEARER')) throw new Error('enabled API retained unused promoter bearer');
for (const service of ['frank-api', 'frank-tusd']) {
  if (!Object.hasOwn(enabled.services[service].networks, 'frank-attachments')) throw new Error(`${service} lacks private attachment network`);
}
NODE
printf '%s\n' 'compose-render-contract=passed; disabled harness absent; enabled private tus hook present'

promote="$root/infra/harness/bin/promote-gateway-candidate.sh"
state_root="$scratch/release-state"
mkdir -p -- "$state_root"
candidate="$state_root/candidate.env"; current="$state_root/current.env"; rollback="$state_root/rollback.env"; manifest="$state_root/evidence-manifest.json"
export FRANK_LITELLM_CURRENT_IMAGE="example.invalid/litellm@$digest"
export FRANK_SEAWEEDFS_CURRENT_IMAGE="example.invalid/seaweedfs@$digest"
export FRANK_TUSD_CURRENT_IMAGE="example.invalid/tusd@$digest"
export FRANK_CLAMAV_CURRENT_IMAGE="example.invalid/clamav@$digest"
"$root/infra/harness/bin/validate-gateway-candidate.sh" >/dev/null
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

#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
compose="$root/infra/production/docker-compose.harness.yml"
app_compose="$root/infra/production/docker-compose.app.yml"
caddy="$root/infra/production/Caddyfile.frank-production"
foundation_compose="$root/infra/compose/docker-compose.yml"
seaweed_template="$root/infra/compose/seaweedfs/s3.json.tmpl"
litellm_config="$root/infra/harness/litellm/config.yaml"
litellm_bootstrap="$root/scripts/production/bootstrap-litellm-virtual-key.sh"
bucket_bootstrap="$root/scripts/production/bootstrap-attachment-buckets.sh"
s3_canary="$root/scripts/production/s3-policy-canary.sh"
seaweed_renderer="$root/scripts/production/render-seaweedfs-s3-config.sh"
release_runbook="$root/docs/runbooks/AUTONOMOUS_FRANK_RELEASE.md"
release_validator="$root/scripts/production/validate-harness-release.sh"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
for token in 'frank-previews' 'FRANK_OPENFGA' 'insecure-skip-verify' 'tls-skip-verify'; do
  if grep -En "$token" "$compose"; then echo "forbidden: $token"; exit 1; fi
done
grep -Eq 'FRANK_LETTA_INTERNAL_URL.*frank-letta-server:8283' "$root/infra/production/docker-compose.app.yml"
grep -Eq 'LETTA_URL:.*frank-letta-server:8283' "$app_compose"
grep -Fq "export FRANK_LETTA_EXPECTED_IMAGE='<REVIEWED_LETTA_REPOSITORY>@sha256:<64_HEX_DIGEST>'" "$release_runbook"
grep -Fq 'fetch(`${base}/v1/health/`' "$release_runbook"
grep -Fq 'letta_private_health_http=200' "$release_runbook"
grep -Fq 'Letta is not a harness image or promotion slot' "$release_runbook"
grep -Fq 'Hermes has no Wave 1 runtime or image slot' "$root/infra/harness/README.md"
grep -Fq 'every other live block, including the active Pavone route' "$release_runbook"
grep -Fq 'release_total_required_bytes=45794556407' "$release_runbook"
grep -Fq 'release_total_required_bytes=35559741427' "$release_runbook"
grep -Eq '@frank_tusd_upload path /v1/uploads/tus /v1/uploads/tus/ /v1/uploads/tus/\*' "$caddy"
grep -Eq 'handle @frank_tusd_upload' "$caddy"
grep -Eq 'disable-download' "$compose"
grep -Eq 'max-size=2147483648' "$compose"
grep -Eq 'http://frank-seaweedfs:8333' "$compose"
grep -Eq 'frank-model' "$compose"
grep -Eq 'X-Forwarded-Method|X-Forwarded-Uri|X-Frank-Upload-Capability|X-Frank-Tusd-Hook-Secret' "$root/infra/production/Caddyfile.frank-production"
grep -Fq 'header_up x-frank-tusd-gate-secret {$FRANK_TUSD_GATE_SECRET}' "$caddy"
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
grep -Fq '"Write:frank-attachment-staging","Read:frank-objects","Write:frank-objects"' "$seaweed_template"
grep -Fq '"actions":["Read:frank-objects","Read:frank-object-previews"]' "$seaweed_template"
grep -Fq 'get-object --bucket frank-objects --key "$object" "$readback"' "$s3_canary"
grep -Fq 'delete-object --bucket frank-attachment-staging --key "$key"' "$s3_canary"
grep -Fq 'downloader delete overreach' "$s3_canary"
grep -Fq 'healthcheck: { test: ["CMD", "clamdcheck.sh"]' "$compose"
grep -Fq '"/run:rw,nosuid,nodev,noexec,size=16m"' "$compose"
grep -Fq 'LocalSocket /run/clamav/clamd.sock' "$root/infra/harness/clamav/clamd.conf"
if grep -Fq 'clamdscan --version' "$compose"; then echo 'ClamAV healthcheck does not reach clamd'; exit 1; fi
grep -Fq 'FRANK_HARNESS_EVIDENCE_MANIFEST' "$release_validator"
grep -Fq 'promote-gateway-candidate.sh' "$release_validator"
grep -Fq 'does not match reviewed candidate evidence' "$release_validator"
grep -Fq 'HTTPS URL for hosted four-core candidate evidence required' "$release_runbook"
for credential in STAGING PROMOTER DOWNLOADER; do
  grep -Fq "__ATTACHMENT_${credential}_ACCESS_KEY__" "$seaweed_template"
  grep -Fq "__ATTACHMENT_${credential}_SECRET_KEY__" "$seaweed_template"
  grep -Fq "FRANK_ATTACHMENT_${credential}_ACCESS_KEY" "$foundation_compose"
  grep -Fq "FRANK_ATTACHMENT_${credential}_SECRET_KEY" "$foundation_compose"
done
if grep -Eq '"(Read|Write|List|Tagging|Admin)"|"name"[[:space:]]*:[[:space:]]*"frank-cell"|"(Read|Write|List|Tagging):[^"]*lake-' "$seaweed_template"; then echo 'shared Seaweed attachment policy overreaches'; exit 1; fi
grep -Fq 'partially configured lake credentials cannot prove mutual denial' "$s3_canary"
grep -Fq 'must_deny_lake' "$s3_canary"
grep -Fq 'must_deny_attachments' "$s3_canary"
grep -Fq 'for bucket in frank-attachment-staging frank-objects frank-object-previews; do' "$bucket_bootstrap"
grep -Fq 'put-bucket-lifecycle-configuration --bucket frank-attachment-staging' "$bucket_bootstrap"
if env -u FRANK_LAKE_WORKER_ACCESS_KEY -u FRANK_LAKE_WORKER_SECRET_KEY \
  -u FRANK_LAKE_QUERY_ACCESS_KEY -u FRANK_LAKE_QUERY_SECRET_KEY \
  FRANK_S3_ENDPOINT='http://evidence.invalid' \
  FRANK_STAGING_ACCESS_KEY='staging' FRANK_STAGING_SECRET_KEY='staging-secret' \
  FRANK_PROMOTER_ACCESS_KEY='promoter' FRANK_PROMOTER_SECRET_KEY='promoter-secret' \
  FRANK_DOWNLOADER_ACCESS_KEY='downloader' FRANK_DOWNLOADER_SECRET_KEY='downloader-secret' \
  FRANK_LAKE_BUCKET='partial-lake' \
  bash "$s3_canary" >/dev/null 2>"$scratch/partial-lake.log"; then
  echo 'partial lake configuration did not fail closed'; exit 1
fi
grep -Fq 'partially configured lake credentials cannot prove mutual denial' "$scratch/partial-lake.log"
if grep -Eq '(^|[[:space:]])rg([[:space:]]|$)' "$root/infra/harness/bin/validate-gateway-candidate.sh"; then echo 'candidate validator requires unavailable ripgrep'; exit 1; fi
test "$(grep -Ec '^aws_for "\$FRANK_PROMOTER_ACCESS_KEY".*delete-object --bucket frank-(attachment-staging|objects|object-previews)' "$s3_canary")" -eq 3
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
  frank_explorer_cache: {}
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
export FRANK_CODEGRAPH_REGISTRY_HOST_PATH="$scratch/projects.json"
export FRANK_CODEGRAPH_PROJECT_FRANK_HOST_PATH="$scratch/repository"
unset FRANK_ATTACHMENT_RUNTIME_ENABLED FRANK_ATTACHMENT_PROMOTER_BEARER FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY FRANK_ATTACHMENT_PROMOTER_SECRET_KEY FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY FRANK_UPLOAD_CAPABILITY_KEY FRANK_UPLOAD_CAPABILITY_PREVIOUS_KEY FRANK_LITELLM_VIRTUAL_KEY FRANK_TUSD_GATE_SECRET FRANK_TUSD_HOOK_SECRET FRANK_TUSD_HOOK_URL
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
export FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY='validation-promoter-access'
export FRANK_ATTACHMENT_PROMOTER_SECRET_KEY='validation-promoter-secret'
export FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY='validation-downloader-access'
export FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY='validation-downloader-secret'
export FRANK_UPLOAD_CAPABILITY_KEY='dmFsaWRhdGlvbi1vbmx5LWhtYWMta2V5LTMyeC1ieXRlcy0tLS0='
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
if (disabled.services['frank-api'].environment.FRANK_LETTA_INTERNAL_URL !== 'http://frank-letta-server:8283') throw new Error('disabled API Letta seam drifted');
if (disabled.services['frank-web'].environment.LETTA_URL !== 'http://frank-letta-server:8283') throw new Error('disabled web Letta probe seam drifted');
for (const model of [disabled, enabled]) {
  if (model.services['frank-letta-server'] || model.services['frank-hermes']) throw new Error('external/later harness duplicated in Wave 1');
  for (const service of ['frank-api', 'frank-codegraph']) {
    if (!model.services[service].volumes.some((volume) => volume.source === process.env.FRANK_CODEGRAPH_REGISTRY_HOST_PATH)) throw new Error(`${service} lost staged Graphify registry`);
  }
}
const command = enabled.services['frank-tusd'].command;
if (!Array.isArray(command) || !command.includes('-hooks-http=http://frank-api:3000/private/tusd/hooks')) throw new Error('enabled tusd private hook URL missing');
const clamav = enabled.services['frank-clamav'];
if (JSON.stringify(clamav.healthcheck?.test) !== JSON.stringify(['CMD', 'clamdcheck.sh'])) throw new Error('ClamAV daemon PING healthcheck missing');
if (!clamav.tmpfs?.some((mount) => String(mount).startsWith('/run:'))) throw new Error('ClamAV runtime socket tmpfs missing');
if (!clamav.volumes?.some((volume) => volume.target === '/etc/clamav/clamd.conf' && volume.read_only)) throw new Error('ClamAV reviewed config mount missing');
if (enabled.services['frank-api'].environment.FRANK_TUSD_GATE_SECRET !== enabled.services['frank-caddy'].environment.FRANK_TUSD_GATE_SECRET) throw new Error('enabled gate secrets differ');
if (Object.hasOwn(enabled.services['frank-api'].environment, 'FRANK_ATTACHMENT_PROMOTER_BEARER')) throw new Error('enabled API retained unused promoter bearer');
if (enabled.services['frank-api'].environment.FRANK_ATTACHMENT_RUNTIME_ENABLED !== 'true') throw new Error('enabled API attachment runtime flag missing');
for (const name of ['FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY', 'FRANK_ATTACHMENT_PROMOTER_SECRET_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY', 'FRANK_UPLOAD_CAPABILITY_KEY']) if (!enabled.services['frank-api'].environment[name]) throw new Error(`enabled API missing ${name}`);
for (const name of ['FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY', 'FRANK_ATTACHMENT_PROMOTER_SECRET_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY', 'FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY', 'FRANK_UPLOAD_CAPABILITY_KEY']) if (Object.hasOwn(enabled.services['frank-tusd'].environment, name)) throw new Error(`tusd retained API-only ${name}`);
for (const service of ['frank-api', 'frank-tusd']) {
  if (!Object.hasOwn(enabled.services[service].networks, 'frank-attachments')) throw new Error(`${service} lacks private attachment network`);
}
NODE
printf '%s\n' 'compose-render-contract=passed; disabled harness absent; enabled private tus hook present'

promote="$root/infra/harness/bin/promote-gateway-candidate.sh"
state_root="$scratch/release-state"
mkdir -p -- "$state_root"
candidate="$state_root/candidate.env"; current="$state_root/current.env"; rollback="$state_root/rollback.env"; manifest="$state_root/evidence-manifest.json"
export FRANK_LITELLM_CURRENT_IMAGE="ghcr.io/stevenshelley58-afk/litellm@$digest"
export FRANK_SEAWEEDFS_CURRENT_IMAGE="ghcr.io/stevenshelley58-afk/seaweedfs@$digest"
export FRANK_TUSD_CURRENT_IMAGE="ghcr.io/stevenshelley58-afk/tusd@$digest"
export FRANK_CLAMAV_CURRENT_IMAGE="ghcr.io/stevenshelley58-afk/clamav@$digest"
"$root/infra/harness/bin/validate-gateway-candidate.sh" >/dev/null
for service in LITELLM SEAWEEDFS TUSD CLAMAV; do printf 'FRANK_%s_CANDIDATE_IMAGE=ghcr.io/stevenshelley58-afk/%s@%s\n' "$service" "${service,,}" "$digest" >> "$candidate"; done
: > "$current"; : > "$rollback"
litellm_config_sha256="sha256:$(sha256sum -- "$root/infra/harness/litellm/config.yaml" | awk '{print $1}')"
seaweed_config_sha256="sha256:$(sha256sum -- "$root/infra/compose/seaweedfs/s3.json.tmpl" | awk '{print $1}')"
tusd_config_sha256="sha256:$(sha256sum -- "$root/infra/production/docker-compose.harness.yml" | awk '{print $1}')"
clamav_config_sha256="sha256:$(sha256sum -- "$root/infra/harness/clamav/clamd.conf" | awk '{print $1}')"
write_manifest() {
  local release="$1" provenance="${2:-github-attestation-verified}"
  node --input-type=module - "$manifest" "$release" "$digest" "$provenance" \
    "$litellm_config_sha256" "$seaweed_config_sha256" "$tusd_config_sha256" "$clamav_config_sha256" <<'NODE'
import {writeFileSync} from 'node:fs';
const [path, release, digest, provenance, litellmConfig, seaweedConfig, tusdConfig, clamavConfig] = process.argv.slice(2);
const metadata = {
  litellm: ['v1.96.0', 'MIT', 'BerriAI/litellm', litellmConfig],
  seaweedfs: ['4.41', 'Apache-2.0', 'seaweedfs/seaweedfs', seaweedConfig],
  tusd: ['v2.10.0', 'MIT', 'tus/tusd', tusdConfig],
  clamav: ['1.5.4', 'GPL-2.0-only', 'Cisco-Talos/clamav', clamavConfig],
};
const services = Object.entries(metadata).map(([service, [tag, license, repository, config]]) => ({
  service, release_url: `https://github.com/${repository}/releases/tag/${service === 'clamav' ? 'clamav-1.5.4' : tag}`, tag,
  oci_digest: digest, license, provenance_method: provenance, sbom_sha256: digest,
  server_command: '{"entrypoint":["/usr/bin/server"],"cmd":[]}',
  hosted_canary_url: 'https://github.com/stevenshelley58-afk/frank/actions/runs/1', config_sha256: config,
}));
writeFileSync(path, `${JSON.stringify({release, services})}\n`);
NODE
}
export FRANK_RELEASE_COMMIT='abcdefabcdefabcdefabcdefabcdefabcdefabcd'
write_manifest "$FRANK_RELEASE_COMMIT"
FRANK_RELEASE_STATE_ROOT="$state_root" "$promote" "$candidate" "$current" "$rollback" 'https://github.com/stevenshelley58-afk/frank/actions/runs/1' "$manifest" >/dev/null
if FRANK_RELEASE_STATE_ROOT="$state_root" "$promote" "$candidate" "$current" "$rollback" 'https://evidence.invalid/run' "$manifest" >/dev/null 2>&1; then
  echo 'placeholder evidence URL was accepted'; exit 1
fi
node --input-type=module - "$manifest" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs'; const path=process.argv[2]; const manifest=JSON.parse(readFileSync(path));
manifest.services[0].config_sha256=`sha256:${'0'.repeat(64)}`; writeFileSync(path, `${JSON.stringify(manifest)}\n`);
NODE
if FRANK_RELEASE_STATE_ROOT="$state_root" "$promote" "$candidate" "$current" "$rollback" 'https://github.com/stevenshelley58-afk/frank/actions/runs/1' "$manifest" >/dev/null 2>&1; then
  echo 'mismatched reviewed config hash was accepted'; exit 1
fi
write_manifest "$FRANK_RELEASE_COMMIT" pending
if FRANK_RELEASE_STATE_ROOT="$state_root" "$promote" "$candidate" "$current" "$rollback" 'https://github.com/stevenshelley58-afk/frank/actions/runs/1' "$manifest" >/dev/null 2>&1; then
  echo 'placeholder evidence was accepted'; exit 1
fi
write_manifest 'gggggggggggggggggggggggggggggggggggggggg'
if FRANK_RELEASE_STATE_ROOT="$state_root" "$promote" "$candidate" "$current" "$rollback" 'https://github.com/stevenshelley58-afk/frank/actions/runs/1' "$manifest" >/dev/null 2>&1; then
  echo 'non-hex manifest release was accepted'; exit 1
fi
echo 'gateway static security assertions passed'

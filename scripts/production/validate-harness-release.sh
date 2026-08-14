#!/usr/bin/env bash
set -euo pipefail
# Read-only release gate. A harness promotion cannot proceed until every image is a digest.
: "${FRANK_BASE_COMPOSE:?}" "${FRANK_APP_OVERLAY:?}" "${FRANK_HARNESS_OVERLAY:?}"
: "${FRANK_RELEASE_STATE_ROOT:?}" "${FRANK_HARNESS_CANDIDATE_SLOT:?}" "${FRANK_HARNESS_CURRENT_SLOT:?}" "${FRANK_HARNESS_ROLLBACK_SLOT:?}" "${FRANK_HARNESS_EVIDENCE_URL:?}" "${FRANK_HARNESS_EVIDENCE_MANIFEST:?}" "${FRANK_RELEASE_COMMIT:?}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
candidate_preparation_receipt="$(bash "$repo_root/infra/harness/bin/promote-gateway-candidate.sh" \
  "$FRANK_HARNESS_CANDIDATE_SLOT" "$FRANK_HARNESS_CURRENT_SLOT" \
  "$FRANK_HARNESS_ROLLBACK_SLOT" "$FRANK_HARNESS_EVIDENCE_URL" \
  "$FRANK_HARNESS_EVIDENCE_MANIFEST")"
[[ "${FRANK_ATTACHMENT_POOL_GIB:-50}" == 50 && "${FRANK_ATTACHMENT_RESERVED_GIB:-50}" == 50 ]] || { echo 'attachment pool/reservation must both be exactly 50GiB' >&2; exit 1; }
[[ "${FRANK_ATTACHMENT_USED_GIB:-0}" =~ ^[0-9]+$ ]] && (( FRANK_ATTACHMENT_USED_GIB <= 50 )) || { echo 'attachment used capacity is invalid' >&2; exit 1; }
[[ "$FRANK_BASE_COMPOSE" == /frank/deployed/infra/docker-compose.dev.yml ]] || { echo 'base must be live docker-compose.dev.yml' >&2; exit 1; }
[[ "$FRANK_HARNESS_OVERLAY" == */infra/production/docker-compose.harness.yml ]] || { echo 'only authoritative production harness overlay is accepted' >&2; exit 1; }
for name in LITELLM SEAWEEDFS TUSD CLAMAV; do
  key="FRANK_${name}_CURRENT_IMAGE"; value="${!key:-}"
  [[ "$value" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "$key must be an OCI digest" >&2; exit 1; }
  candidate_key="FRANK_${name}_CANDIDATE_IMAGE"
  candidate_value="$(awk -F= -v key="$candidate_key" '
    $1 == key { count += 1; value = substr($0, index($0, "=") + 1) }
    END { if (count != 1) exit 42; print value }
  ' "$FRANK_HARNESS_CANDIDATE_SLOT")"
  [[ "$value" == "$candidate_value" ]] || { echo "$key does not match reviewed candidate evidence" >&2; exit 1; }
done
available_kib="$(df -Pk "${FRANK_DATA_PATH:-/frank/deployed}" | awk 'NR==2{print $4}')"
(( available_kib >= 30*1024*1024 )) || { echo 'attachment pool refused: less than 30 GiB free' >&2; exit 1; }
rendered="$(mktemp)"; trap 'rm -f -- "$rendered"' EXIT
docker compose -f "$FRANK_BASE_COMPOSE" -f "$FRANK_APP_OVERLAY" -f "$FRANK_HARNESS_OVERLAY" config --format json > "$rendered"
node --input-type=module - "$rendered" <<'NODE'
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const required = ['frank-seaweedfs','frank-litellm','frank-tusd','frank-clamav'];
const started = ['frank-seaweedfs','frank-litellm','frank-tusd','frank-clamav'];
for (const n of required) { const s=c.services?.[n]; if (!s?.image?.match(/@sha256:[a-f0-9]{64}$/) || s.ports?.length) throw new Error(`unsafe/missing harness service: ${n}`); }
for (const n of required) if (!c.services[n].read_only || !c.services[n].cap_drop?.includes('ALL') || !c.services[n].restart || !c.services[n].init) throw new Error(`hardening incomplete: ${n}`);
for (const n of started) if (!c.services[n].healthcheck) throw new Error(`healthcheck incomplete: ${n}`);
const has=(n,net)=>{ const v=c.services[n]?.networks; return Array.isArray(v) ? v.includes(net) : Boolean(v?.[net]); };
if (!has('frank-api','frank-model')||!has('frank-api','frank-attachments')||!has('frank-caddy','frank-attachments')) throw new Error('API/Caddy seam missing');
if (has('frank-tusd','frank')) throw new Error('private network denial violated');
const tusdCommand=c.services['frank-tusd'].command;
if(!Array.isArray(tusdCommand)||!tusdCommand.includes('-hooks-http=http://frank-api:3000/private/tusd/hooks')) throw new Error('private tusd hook target missing');
const apiEnv=c.services['frank-api'].environment; const caddyEnv=c.services['frank-caddy'].environment;
if(!apiEnv.FRANK_TUSD_GATE_SECRET||!apiEnv.FRANK_TUSD_HOOK_SECRET||
  apiEnv.FRANK_TUSD_GATE_SECRET===apiEnv.FRANK_TUSD_HOOK_SECRET||
  apiEnv.FRANK_TUSD_GATE_SECRET!==caddyEnv.FRANK_TUSD_GATE_SECRET||
  apiEnv.FRANK_TUSD_HOOK_SECRET!==caddyEnv.FRANK_TUSD_HOOK_SECRET) throw new Error('tusd gate/hook secret separation failed');
const clamav=c.services['frank-clamav'];
if(JSON.stringify(clamav.healthcheck?.test)!==JSON.stringify(['CMD','clamdcheck.sh'])||
  !clamav.tmpfs?.some(mount=>String(mount).startsWith('/run:'))||
  !clamav.volumes?.some(volume=>volume.target==='/etc/clamav/clamd.conf'&&volume.read_only)) throw new Error('ClamAV daemon reachability contract missing');
if (!c.services['frank-seaweedfs'].volumes?.some(v => String(v.source)==='frank-cell-seaweedfs-data')) throw new Error('Seaweed must reuse audited volume');
if (JSON.stringify(c.services['frank-seaweedfs'].environment).includes('frank-cell') || JSON.stringify(c).match(/FRANK_OPENFGA|\bports:/)) throw new Error('legacy credential/public port leaked');
NODE
printf '%s\n' "$candidate_preparation_receipt"
echo 'harness-release-config=passed; attachment pool=50GiB reserved; free floor=30GiB; third unit atomic'

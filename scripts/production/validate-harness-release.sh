#!/usr/bin/env bash
set -euo pipefail
# Read-only release gate. A harness promotion cannot proceed until every image is a digest.
: "${FRANK_BASE_COMPOSE:?}" "${FRANK_APP_OVERLAY:?}" "${FRANK_HARNESS_OVERLAY:?}"
[[ "${FRANK_ATTACHMENT_POOL_GIB:-50}" == 50 && "${FRANK_ATTACHMENT_RESERVED_GIB:-50}" == 50 ]] || { echo 'attachment pool/reservation must both be exactly 50GiB' >&2; exit 1; }
[[ "${FRANK_ATTACHMENT_USED_GIB:-0}" =~ ^[0-9]+$ ]] && (( FRANK_ATTACHMENT_USED_GIB <= 50 )) || { echo 'attachment used capacity is invalid' >&2; exit 1; }
[[ "$FRANK_BASE_COMPOSE" == /srv/frank/infra/docker-compose.dev.yml ]] || { echo 'base must be live docker-compose.dev.yml' >&2; exit 1; }
[[ "$FRANK_HARNESS_OVERLAY" == */infra/production/docker-compose.harness.yml ]] || { echo 'only authoritative production harness overlay is accepted' >&2; exit 1; }
for name in LITELLM SEAWEEDFS TUSD CLAMAV LETTA HERMES; do
  key="FRANK_${name}_CURRENT_IMAGE"; value="${!key:-}"
  [[ "$value" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "$key must be an OCI digest" >&2; exit 1; }
done
available_kib="$(df -Pk "${FRANK_DATA_PATH:-/srv/frank}" | awk 'NR==2{print $4}')"
(( available_kib >= 30*1024*1024 )) || { echo 'attachment pool refused: less than 30 GiB free' >&2; exit 1; }
rendered="$(mktemp)"; trap 'rm -f -- "$rendered"' EXIT
docker compose -f "$FRANK_BASE_COMPOSE" -f "$FRANK_APP_OVERLAY" -f "$FRANK_HARNESS_OVERLAY" config --format json > "$rendered"
node --input-type=module - "$rendered" <<'NODE'
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const required = ['frank-seaweedfs','frank-litellm','frank-tusd','frank-clamav','frank-letta','frank-hermes'];
const started = ['frank-seaweedfs','frank-litellm','frank-tusd','frank-clamav'];
for (const n of required) { const s=c.services?.[n]; if (!s?.image?.match(/@sha256:[a-f0-9]{64}$/) || s.ports?.length) throw new Error(`unsafe/missing harness service: ${n}`); }
for (const n of required) if (!c.services[n].read_only || !c.services[n].cap_drop?.includes('ALL') || !c.services[n].restart || !c.services[n].init) throw new Error(`hardening incomplete: ${n}`);
for (const n of started) if (!c.services[n].healthcheck) throw new Error(`healthcheck incomplete: ${n}`);
const has=(n,net)=>{ const v=c.services[n]?.networks; return Array.isArray(v) ? v.includes(net) : Boolean(v?.[net]); };
if (!has('frank-api','frank-model')||!has('frank-api','frank-attachments')||!has('frank-caddy','frank-attachments')) throw new Error('API/Caddy seam missing');
if (has('frank-tusd','frank')||has('frank-hermes','frank')) throw new Error('private network denial violated');
if (!c.services['frank-seaweedfs'].volumes?.some(v => String(v.source)==='frank-cell-seaweedfs-data')) throw new Error('Seaweed must reuse audited volume');
if (JSON.stringify(c.services['frank-seaweedfs'].environment).includes('frank-cell') || JSON.stringify(c).match(/FRANK_OPENFGA|\bports:/)) throw new Error('legacy credential/public port leaked');
NODE
echo 'harness-release-config=passed; attachment pool=50GiB reserved; free floor=30GiB; third unit atomic'

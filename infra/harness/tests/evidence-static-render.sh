#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
compose="$root/infra/harness/docker-compose.canary.yml"
validator="$root/infra/harness/bin/validate-harness-evidence.sh"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT

grep -Fq 'sealed-promotion' "$root/infra/harness/evidence-manifest.schema.json"
grep -Fq 'generated-digest-bound-sbom' "$root/infra/harness/evidence-manifest.schema.json"
grep -Fq 'generated-source-license-record' "$root/infra/harness/evidence-manifest.schema.json"
grep -Fq 'approved-exception' "$root/infra/harness/evidence-manifest.schema.json"
grep -Fq "docker compose -f \"\$harness_dir/docker-compose.canary.yml\" config --format json" "$root/infra/harness/bin/render-disposable-canary.sh"
if grep -Eq 'external:|name:[[:space:]]*frank($|[-_])|frank-cell-seaweedfs-data|frank-attachments|networks:[[:space:]]*\[frank' "$compose"; then
  echo 'canary compose can attach production state'; exit 1
fi
grep -Eq '^  clamav:$' "$compose"
grep -Fq -- '-base-path=/v1/uploads/tus/' "$compose"
grep -Fq -- '-disable-download' "$compose"
grep -Fq 's3-endpoint=http://seaweedfs:8333' "$compose"
grep -Fq 'gate:' "$compose"
grep -Fq 'probe:' "$compose"
grep -Fq '1.5.4' "$root/infra/harness/README.md"
test -x "$validator" || { echo 'evidence validator is not executable'; exit 1; }

digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
for service in LITELLM SEAWEEDFS TUSD CLAMAV; do
  printf 'FRANK_%s_CANDIDATE_IMAGE=registry.example/%s@%s\n' "$service" "${service,,}" "$digest"
done > "$scratch/candidate.env"
node --input-type=module - "$root" "$scratch/manifest.json" "$digest" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs'; import {createHash} from 'node:crypto';
const [root,path,digest]=process.argv.slice(2); const hash=p=>`sha256:${createHash('sha256').update(readFileSync(`${root}/${p}`)).digest('hex')}`;
const rows=[['litellm','v1.96.0','MIT','infra/harness/litellm/config.yaml'],['seaweedfs','4.41','Apache-2.0','infra/compose/seaweedfs/s3.json.tmpl'],['tusd','v2.10.0','MIT','infra/production/docker-compose.harness.yml'],['clamav','1.5.4','GPL-2.0-only','infra/harness/clamav/clamd.conf']];
writeFileSync(path,JSON.stringify({phase:'candidate',release:'abcdefabcdefabcdefabcdefabcdefabcdefabcd',services:rows.map(([service,tag,license,config])=>({service,tag,release_url:`https://github.com/example/${service}/releases/tag/${tag}`,oci_digest:digest,config_sha256:hash(config),source_license_record:{kind:'generated-source-license-record',sha256:digest,source_url:`https://github.com/example/${service}`,license},sbom_record:{kind:'generated-digest-bound-sbom',sha256:digest,subject_digest:digest,generator:'syft'},upstream_oci_provenance:{status:'verified',method:'cosign verify',evidence_url:`https://github.com/example/${service}/attestations`}}))}));
NODE
"$validator" candidate "$scratch/manifest.json" "$scratch/candidate.env" >/dev/null
node --input-type=module - "$scratch/manifest.json" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs'; const p=process.argv[2],m=JSON.parse(readFileSync(p));m.services[0].hosted_canary_url='https://example.com/fake';writeFileSync(p,JSON.stringify(m));
NODE
if "$validator" candidate "$scratch/manifest.json" "$scratch/candidate.env" >/dev/null 2>&1; then
  echo 'candidate accepted a fake canary URL'; exit 1
fi
FRANK_HARNESS_CANARY_PROJECT="frank-harness-test-${RANDOM}${RANDOM}" "$root/infra/harness/bin/render-disposable-canary.sh" "$scratch/candidate.env" > "$scratch/render.json"
node --input-type=module - "$scratch/render.json" <<'NODE'
import {readFileSync} from 'node:fs';const c=JSON.parse(readFileSync(process.argv[2]));
for(const s of Object.values(c.services)) if((s.networks && Object.keys(s.networks).some(n=>n.startsWith('frank'))) || s.volumes?.some(v=>String(v.source).includes('frank-cell'))) throw Error('production attachment escaped into canary render');
NODE
echo 'hosted static/render evidence contract passed'

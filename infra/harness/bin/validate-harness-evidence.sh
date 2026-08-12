#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 3 ]] || { echo "usage: $0 candidate|sealed-promotion evidence-manifest.json candidate.env" >&2; exit 64; }
phase="$1"; manifest="$2"; candidate="$3"
[[ "$phase" == candidate || "$phase" == sealed-promotion ]] || { echo 'invalid evidence phase' >&2; exit 64; }
script_dir="$(cd "$(dirname "$0")" && pwd)"; harness_dir="$(cd "$script_dir/.." && pwd)"; repo_root="$(git -C "$harness_dir" rev-parse --show-toplevel)"
schema="$harness_dir/evidence-manifest.schema.json"
[[ -f "$manifest" && -f "$candidate" && -f "$schema" ]] || { echo 'evidence inputs must exist' >&2; exit 65; }
node --input-type=module - "$phase" "$manifest" "$candidate" "$schema" "$repo_root" <<'NODE'
import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto';
const [phase, manifestPath, candidatePath, schemaPath, root] = process.argv.slice(2);
const fail = message => { throw new Error(message); };
const m = JSON.parse(readFileSync(manifestPath, 'utf8')); const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
if (schema.additionalProperties !== false || m.phase !== phase || !/^[0-9a-f]{40}$/.test(m.release || '')) fail('phase/release/schema invalid');
const expected = { litellm:['v1.96.0','MIT','infra/harness/litellm/config.yaml'], seaweedfs:['4.41','Apache-2.0','infra/compose/seaweedfs/s3.json.tmpl'], tusd:['v2.10.0','MIT','infra/production/docker-compose.harness.yml'], clamav:['1.5.4','GPL-2.0-only','infra/harness/clamav/clamd.conf'] };
const digest = /^sha256:[a-f0-9]{64}$/; const safeUrl = value => /^https:\/\/(?![^/]*\.invalid(?:\/|$))[^\s]+$/.test(value || '');
if (!Array.isArray(m.services) || m.services.length !== 4) fail('exact four-service evidence required');
const candidate = Object.fromEntries(readFileSync(candidatePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => line.split('=', 2)));
for (const [service, [tag, license, config]] of Object.entries(expected)) {
  const x = m.services.filter(item => item.service === service); if (x.length !== 1) fail(`missing/duplicate ${service}`); const item=x[0];
  const allowed = phase === 'candidate' ? ['config_sha256','oci_digest','release_url','sbom_record','service','source_license_record','tag','upstream_oci_provenance'] : ['config_sha256','hosted_canary_url','oci_digest','release_url','sbom_record','server_command','service','source_license_record','tag','upstream_oci_provenance'];
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(allowed) || item.tag !== tag || !safeUrl(item.release_url) || item.source_license_record?.license !== license || !digest.test(item.oci_digest) || item.sbom_record?.subject_digest !== item.oci_digest || !digest.test(item.sbom_record?.sha256) || item.sbom_record?.kind !== 'generated-digest-bound-sbom' || item.source_license_record?.kind !== 'generated-source-license-record' || !digest.test(item.source_license_record?.sha256) || !safeUrl(item.source_license_record?.source_url)) fail(`invalid generated records for ${service}`);
  const configHash = `sha256:${createHash('sha256').update(readFileSync(`${root}/${config}`)).digest('hex')}`; if (item.config_sha256 !== configHash) fail(`config hash mismatch for ${service}`);
  const provenance=item.upstream_oci_provenance; if (!provenance || !safeUrl(provenance.evidence_url) || !provenance.method?.trim()) fail(`missing upstream OCI provenance for ${service}`);
  if (provenance.status === 'approved-exception') { if (!provenance.approved_exception?.trim()) fail(`unapproved provenance exception for ${service}`); } else if (provenance.status !== 'verified' || provenance.approved_exception) fail(`invalid provenance status for ${service}`);
  const key=`FRANK_${service.toUpperCase()}_CANDIDATE_IMAGE`; if (!candidate[key]?.match(/^[^@\s]+@sha256:[a-f0-9]{64}$/) || candidate[key].split('@')[1] !== item.oci_digest) fail(`candidate digest mismatch for ${service}`);
  if (phase === 'candidate' && ('hosted_canary_url' in item || 'server_command' in item)) fail(`candidate must not claim canary evidence for ${service}`);
  if (phase === 'sealed-promotion' && (!safeUrl(item.hosted_canary_url) || !item.server_command?.trim())) fail(`sealed canary evidence missing for ${service}`);
}
NODE
printf 'harness-evidence=%s; exact four-service evidence passed\n' "$phase"

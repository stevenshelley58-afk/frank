#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 5 ]] || { echo "usage: $0 candidate.env current.env rollback.env https://hosted-evidence evidence-manifest.json" >&2; exit 64; }
candidate="$1" current="$2" rollback="$3" evidence="$4" manifest="$5"
state_root="${FRANK_RELEASE_STATE_ROOT:-}"
: "${FRANK_RELEASE_COMMIT:?exact reviewed release commit required}"
[[ "$FRANK_RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo 'FRANK_RELEASE_COMMIT must be a 40-character lowercase hexadecimal commit' >&2; exit 65; }

require_safe_path() {
  local path="$1" root="$2" resolved lexical
  [[ "$path" == /* && "$path" != *'/../'* && "$path" != */.. ]] || return 1
  resolved="$(realpath -e -- "$path")" || return 1
  lexical="$(realpath -ms -- "$path")" || return 1
  [[ "$resolved" == "$lexical" && "$resolved" == "$root"/* ]] || return 1
}

[[ "$state_root" == /* && -d "$state_root" && ! -L "$state_root" ]] || { echo 'FRANK_RELEASE_STATE_ROOT must be an absolute non-symlink directory' >&2; exit 65; }
state_root="$(realpath -e -- "$state_root")"
[[ "$state_root" == "$(realpath -ms -- "$state_root")" ]] || { echo 'invalid release state root' >&2; exit 65; }
require_safe_path "$candidate" "$state_root" && require_safe_path "$current" "$state_root" && require_safe_path "$rollback" "$state_root" && require_safe_path "$manifest" "$state_root" || { echo 'invalid release state paths' >&2; exit 65; }
[[ "$evidence" =~ ^https:// ]] && [[ ! "$evidence" =~ ^https://[^/]*\.invalid(/|$) ]] && [[ -f "$candidate" && -f "$current" && -f "$rollback" && -f "$manifest" ]] || exit 65
# STOP-state preparation only: evidence URL is retained as an explicit input, but this
# repository performs no remote fetch, deployment, pointer mutation, or service recreation.
script_path="$(realpath -e -- "$0")"; [[ "$script_path" == "$(realpath -ms -- "$0")" ]] || exit 65
harness_dir="$(dirname "$(dirname "$script_path")")"
repo_root="$(git -C "$harness_dir" rev-parse --show-toplevel)"
[[ "$harness_dir" == "$(realpath -e -- "$repo_root/infra/harness")" ]] || exit 65
schema="$harness_dir/evidence-manifest.schema.json"; require_safe_path "$schema" "$harness_dir" && test -f "$schema" || exit 65
litellm_config_sha256="sha256:$(sha256sum -- "$harness_dir/litellm/config.yaml" | awk '{print $1}')"
seaweed_config_sha256="sha256:$(sha256sum -- "$repo_root/infra/compose/seaweedfs/s3.json.tmpl" | awk '{print $1}')"
tusd_config_sha256="sha256:$(sha256sum -- "$repo_root/infra/production/docker-compose.harness.yml" | awk '{print $1}')"
clamav_config_sha256="sha256:$(sha256sum -- "$harness_dir/clamav/clamd.conf" | awk '{print $1}')"
node --input-type=module - "$manifest" "$candidate" "$schema" "$evidence" "$FRANK_RELEASE_COMMIT" \
  "$litellm_config_sha256" "$seaweed_config_sha256" "$tusd_config_sha256" "$clamav_config_sha256" <<'NODE'
import {readFileSync} from 'node:fs'; const m=JSON.parse(readFileSync(process.argv[2])); const e=readFileSync(process.argv[3],'utf8'); const s=JSON.parse(readFileSync(process.argv[4],'utf8')); const evidence=process.argv[5];
const [release,litellmConfig,seaweedConfig,tusdConfig,clamavConfig]=process.argv.slice(6);
if(s.additionalProperties!==false||!/^[0-9a-f]{40}$/.test(m.release||'')||m.release!==release||typeof evidence!=='string') throw Error('manifest/schema/release invalid');
const expected={
  LITELLM:{service:'litellm',tag:'v1.96.0',license:'MIT',config:litellmConfig},
  SEAWEEDFS:{service:'seaweedfs',tag:'4.41',license:'Apache-2.0',config:seaweedConfig},
  TUSD:{service:'tusd',tag:'v2.10.0',license:'MIT',config:tusdConfig},
  CLAMAV:{service:'clamav',tag:'clamav-1.5.4',license:'GPL-2.0-only',config:clamavConfig},
};
const names=Object.keys(expected); if (!Array.isArray(m.services)||m.services.length!==names.length) throw Error('exact core evidence set required');
if(JSON.stringify(Object.keys(m).sort())!=='["release","services"]') throw Error('unexpected manifest fields');
const serviceKeys=['config_sha256','hosted_canary_url','license','oci_digest','provenance_method','release_url','sbom_sha256','server_command','service','tag'];
const assignments=[...e.matchAll(/^([A-Z0-9_]+)=/gm)].map(match=>match[1]).sort();
if(JSON.stringify(assignments)!==JSON.stringify(names.map(name=>`FRANK_${name}_CANDIDATE_IMAGE`).sort())) throw Error('candidate assignments are not exact');
const digest=/^sha256:[a-f0-9]{64}$/; const placeholder=/^(?:test|unknown|pending|none|n\/a)$/i;
const seen=new Set;
for(const n of names){
  const wanted=expected[n]; const x=m.services.find(x=>x.service===wanted.service);
  if(!x||JSON.stringify(Object.keys(x).sort())!==JSON.stringify(serviceKeys)||seen.has(x.service)||x.tag!==wanted.tag||x.license!==wanted.license||
    !/^https:\/\/(?![^/]*\.invalid(?:\/|$))/.test(x.release_url)||
    !/^https:\/\/(?![^/]*\.invalid(?:\/|$))/.test(x.hosted_canary_url)||
    !digest.test(x.oci_digest)||!digest.test(x.sbom_sha256)||x.config_sha256!==wanted.config||
    typeof x.provenance_method!=='string'||placeholder.test(x.provenance_method.trim())||
    typeof x.server_command!=='string'||placeholder.test(x.server_command.trim())||!x.server_command.trim()) throw Error('incomplete or placeholder evidence');
  let command; try { command=JSON.parse(x.server_command); } catch { throw Error('server command is not exact JSON'); }
  const commandKeys=Object.keys(command??{}).sort();
  if(JSON.stringify(commandKeys)!=='["cmd","entrypoint"]'||
    !Array.isArray(command.entrypoint)||!Array.isArray(command.cmd)||
    command.entrypoint.length+command.cmd.length===0||
    [...command.entrypoint,...command.cmd].some(value=>typeof value!=='string'||!value||placeholder.test(value.trim()))) throw Error('server command is incomplete');
  seen.add(x.service);
  const candidate=e.match(new RegExp(`^FRANK_${n}_CANDIDATE_IMAGE=([^\\s@]+)@${x.oci_digest}$`,'m'));
  if(!candidate||candidate[1].includes('.invalid'))throw Error('candidate/evidence mismatch');
}
NODE
echo "candidate-preparation=passed; evidence_url=$evidence; no current/rollback pointer was changed; deployment disabled"

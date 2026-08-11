#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 5 ]] || { echo "usage: $0 candidate.env current.env rollback.env https://hosted-evidence evidence-manifest.json" >&2; exit 64; }
candidate="$1" current="$2" rollback="$3" evidence="$4" manifest="$5"
state_root="${FRANK_RELEASE_STATE_ROOT:-}"

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
[[ "$evidence" =~ ^https:// ]] && [[ -f "$candidate" && -f "$current" && -f "$manifest" ]] || exit 65
# STOP-state preparation only: evidence URL is retained as an explicit input, but this
# repository performs no remote fetch, deployment, pointer mutation, or service recreation.
script_path="$(realpath -e -- "$0")"; [[ "$script_path" == "$(realpath -ms -- "$0")" ]] || exit 65
harness_dir="$(dirname "$(dirname "$script_path")")"
repo_root="$(git -C "$harness_dir" rev-parse --show-toplevel)"
[[ "$harness_dir" == "$(realpath -e -- "$repo_root/infra/harness")" ]] || exit 65
schema="$harness_dir/evidence-manifest.schema.json"; require_safe_path "$schema" "$harness_dir" && test -f "$schema" || exit 65
node --input-type=module - "$manifest" "$candidate" "$schema" "$evidence" <<'NODE'
import {readFileSync} from 'node:fs'; const m=JSON.parse(readFileSync(process.argv[2])); const e=readFileSync(process.argv[3],'utf8'); const s=JSON.parse(readFileSync(process.argv[4],'utf8')); const evidence=process.argv[5];
if(s.additionalProperties!==false||!/^[0-9a-f]{40}$/.test(m.release||'')||typeof evidence!=='string') throw Error('manifest/schema/release invalid');
const names=['LITELLM','SEAWEEDFS','TUSD','CLAMAV']; if (!Array.isArray(m.services)||m.services.length!==names.length) throw Error('exact core evidence set required');
const seen=new Set; for(const n of names){const x=m.services.find(x=>x.service===n.toLowerCase()); if(!x||seen.has(x.service)||!/^https:\/\//.test(x.release_url)||!/^https:\/\//.test(x.hosted_canary_url)||!/^sha256:[a-f0-9]{64}$/.test(x.oci_digest)||!/^sha256:[a-f0-9]{64}$/.test(x.sbom_sha256)||!/^sha256:[a-f0-9]{64}$/.test(x.config_sha256)||!x.license||!x.provenance_method||!x.server_command)throw Error('incomplete evidence'); seen.add(x.service); if(!new RegExp(`^FRANK_${n}_CANDIDATE_IMAGE=.*@${x.oci_digest}$`,'m').test(e))throw Error('candidate/evidence mismatch');}
NODE
echo "candidate-preparation=passed; evidence_url=$evidence; no current/rollback pointer was changed; deployment disabled"

#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 5 ]] || { echo "usage: $0 candidate.env current.env rollback.env https://hosted-evidence evidence-manifest.json" >&2; exit 64; }
candidate="$1" current="$2" rollback="$3" evidence="$4" manifest="$5"
[[ "$evidence" =~ ^https:// ]] && [[ -f "$candidate" && -f "$current" && -f "$manifest" ]] || exit 65
# STOP-state preparation only: evidence URL is retained as an explicit input, but this
# repository performs no remote fetch, deployment, pointer mutation, or service recreation.
node --input-type=module - "$manifest" "$candidate" <<'NODE'
import {readFileSync} from 'node:fs'; const m=JSON.parse(readFileSync(process.argv[2])); const e=readFileSync(process.argv[3],'utf8');
const names=['LITELLM','SEAWEEDFS','TUSD','CLAMAV']; if (!Array.isArray(m.services)||m.services.length!==names.length) throw Error('exact core evidence set required');
for(const n of names){const x=m.services.find(x=>x.service===n.toLowerCase()); if(!x||!/^sha256:[a-f0-9]{64}$/.test(x.oci_digest)||!/^sha256:[a-f0-9]{64}$/.test(x.sbom_sha256)||!/^sha256:[a-f0-9]{64}$/.test(x.config_sha256)||!x.license||!x.provenance_method||!x.server_command||!x.hosted_canary_url)throw Error('incomplete evidence'); if(!new RegExp(`^FRANK_${n}_CANDIDATE_IMAGE=.*@${x.oci_digest}$`,'m').test(e))throw Error('candidate/evidence mismatch');}
NODE
test ! -L "$candidate" && test ! -L "$current" && test ! -L "$rollback" && test ! -L "$manifest" || exit 65
echo "candidate-preparation=passed; evidence_url=$evidence; no current/rollback pointer was changed; deployment disabled"

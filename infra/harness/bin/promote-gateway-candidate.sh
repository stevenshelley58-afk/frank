#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 5 ]] || { echo "usage: $0 candidate.env current.env rollback.env https://hosted-evidence sealed-manifest.json" >&2; exit 64; }
candidate="$1"; current="$2"; rollback="$3"; evidence="$4"; manifest="$5"
: "${FRANK_RELEASE_STATE_ROOT:?exact protected release state root required}" "${FRANK_RELEASE_COMMIT:?exact reviewed release commit required}"
[[ "$FRANK_RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ && "$evidence" =~ ^https:// && ! "$evidence" =~ ^https://[^/]*\.invalid(/|$) ]] || { echo 'invalid promotion identity/evidence URL' >&2; exit 65; }
state_root="$(realpath -e -- "$FRANK_RELEASE_STATE_ROOT")"; [[ -d "$state_root" && ! -L "$state_root" ]] || exit 65
for path in "$candidate" "$current" "$rollback" "$manifest"; do
  resolved="$(realpath -e -- "$path")"; [[ "$resolved" == "$state_root"/* && "$resolved" != *'/../'* ]] || { echo 'release state path escapes root' >&2; exit 65; }
done
script_dir="$(cd "$(dirname "$0")" && pwd)"
"$script_dir/validate-harness-evidence.sh" sealed-promotion "$manifest" "$candidate"
node --input-type=module - "$manifest" "$evidence" "$FRANK_RELEASE_COMMIT" <<'NODE'
import {readFileSync} from 'node:fs'; const [path,evidence,release]=process.argv.slice(2); const m=JSON.parse(readFileSync(path,'utf8'));
if (m.release !== release || !m.services.every(service => service.hosted_canary_url === evidence)) throw new Error('sealed evidence must be the exact hosted canary receipt');
NODE
echo "sealed-promotion=passed; hosted_evidence=$evidence; no deployment or pointer mutation was performed"

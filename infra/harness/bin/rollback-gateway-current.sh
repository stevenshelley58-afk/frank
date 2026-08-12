#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 2 ]] || { echo "usage: $0 current.env rollback.env" >&2; exit 64; }; current="$1"; rollback="$2"
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
require_safe_path "$current" "$state_root" && require_safe_path "$rollback" "$state_root" && [[ -s "$rollback" && -f "$current" ]] || { echo 'invalid rollback slot paths' >&2; exit 65; }
node --input-type=module - "$rollback" <<'NODE'
import {readFileSync} from 'node:fs'; const text=readFileSync(process.argv[2],'utf8'); const names=['LITELLM','SEAWEEDFS','TUSD','CLAMAV'];
const lines=text.trim().split(/\r?\n/); if(lines.length!==4) throw Error('exact four rollback slots required');
for(const n of names){ const found=lines.filter(x=>new RegExp(`^FRANK_${n}_CURRENT_IMAGE=.+@sha256:[a-f0-9]{64}$`).test(x)); if(found.length!==1) throw Error(`invalid rollback slot ${n}`); }
NODE
echo 'rollback-preparation=passed; pointer mutation, recreation, and probing are disabled'

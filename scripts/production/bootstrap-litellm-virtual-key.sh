#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

[[ "$(id -u)" -eq 0 ]] || { echo 'LiteLLM virtual-key provisioning must run as root' >&2; exit 77; }
command -v node >/dev/null 2>&1 || { echo 'Node.js is required for fail-closed key contract validation' >&2; exit 69; }
[[ $# -le 1 ]] || { echo "usage: $0 [--rotate]" >&2; exit 64; }
mode="${1:-bootstrap}"
case "$mode" in bootstrap|--rotate) ;; *) echo "usage: $0 [--rotate]" >&2; exit 64;; esac

secret_root="${FRANK_RELEASE_SECRET_ROOT:-/frank/deployed/secrets}"
key_file="${FRANK_LITELLM_VIRTUAL_KEY_FILE:?explicit FRANK_LITELLM_VIRTUAL_KEY_FILE is required}"
container="${FRANK_LITELLM_CONTAINER:-frank-litellm}"
[[ "$secret_root" == /* && -d "$secret_root" && ! -L "$secret_root" ]] || { echo 'invalid release secret root' >&2; exit 65; }
secret_root="$(realpath -e -- "$secret_root")"
[[ "$key_file" == /* && "$key_file" != *'/../'* && "$key_file" != */.. ]] || { echo 'virtual-key path must be absolute and traversal-free' >&2; exit 65; }
key_parent="$(dirname -- "$key_file")"
[[ -d "$key_parent" && ! -L "$key_parent" ]] || { echo 'virtual-key parent must already exist and not be a symlink' >&2; exit 65; }
key_parent="$(realpath -e -- "$key_parent")"
[[ "$key_parent" == "$secret_root"/* && "$(stat -c '%u:%g:%a' -- "$key_parent")" == '0:0:700' ]] || { echo 'virtual-key parent must be root-owned mode 0700 beneath the approved secret root' >&2; exit 65; }
[[ "$(realpath -ms -- "$key_file")" == "$key_parent/$(basename -- "$key_file")" ]] || { echo 'invalid virtual-key path' >&2; exit 65; }
[[ ! -L "$key_file" ]] || { echo 'virtual-key path must not be a symlink' >&2; exit 65; }

operation_alias='frank-api'
previous_file=''
if [[ "$mode" == '--rotate' ]]; then
  rotation_id="${FRANK_LITELLM_ROTATION_ID:?rotation requires FRANK_LITELLM_ROTATION_ID}"
  [[ "$rotation_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'rotation ID must be UTC YYYYMMDDTHHMMSSZ' >&2; exit 65; }
  [[ -f "$key_file" && "$(stat -c '%u:%g:%a' -- "$key_file")" == '0:0:600' ]] || { echo 'rotation requires the current root-0600 virtual key' >&2; exit 65; }
  previous_file="${FRANK_LITELLM_PREVIOUS_VIRTUAL_KEY_FILE:?rotation requires an explicit previous-key path}"
  [[ "$previous_file" == /* && "$previous_file" != *'/../'* && "$previous_file" != */.. && ! -e "$previous_file" && ! -L "$previous_file" ]] || { echo 'previous-key path must be new, absolute, and traversal-free' >&2; exit 65; }
  [[ "$(dirname -- "$(realpath -ms -- "$previous_file")")" == "$key_parent" ]] || { echo 'previous-key path must share the approved root-0700 directory' >&2; exit 65; }
  operation_alias="frank-api-$rotation_id"
else
  [[ ! -e "$key_file" ]] || { echo 'virtual key already exists; use --rotate with an explicit rotation ID and previous-key path' >&2; exit 73; }
fi

lock_file="$key_parent/.frank-litellm-virtual-key.lock"
exec {lock_fd}>"$lock_file"
flock -n "$lock_fd" || { echo 'another LiteLLM key operation is in progress' >&2; exit 75; }
chown root:root "$lock_file"; chmod 0600 "$lock_file"

request_file="$(mktemp "$key_parent/.litellm-key-request.XXXXXX")"
response_file="$(mktemp "$key_parent/.litellm-key-response.XXXXXX")"
key_tmp="$(mktemp "$key_parent/.litellm-key.XXXXXX")"
trap 'rm -f -- "$request_file" "$response_file" "$key_tmp"' EXIT

node --input-type=module - "$request_file" "$operation_alias" <<'NODE'
import {writeFileSync} from 'node:fs';
const [path, keyAlias] = process.argv.slice(2);
const request = {
  key_alias: keyAlias,
  key_type: 'llm_api',
  models: ['frank-openai-direct', 'frank-gemini-direct', 'frank-concentrate', 'frank-deepseek-direct'],
  allowed_routes: ['/chat/completions', '/v1/chat/completions', '/responses', '/v1/responses'],
};
writeFileSync(path, `${JSON.stringify(request)}\n`, {mode: 0o600});
NODE

# The admin credential stays inside the LiteLLM proxy container. Only the response body
# crosses the boundary, directly into a root-only temporary file; nothing secret is logged.
docker exec -i "$container" python -c '
import os, sys, urllib.request
admin = os.environ.get("LITELLM_ADMIN_KEY")
if not admin:
    raise SystemExit("LITELLM_ADMIN_KEY is unavailable at the proxy boundary")
body = sys.stdin.buffer.read(65537)
if not body or len(body) > 65536:
    raise SystemExit("invalid key request size")
request = urllib.request.Request(
    "http://127.0.0.1:4000/key/generate", data=body, method="POST",
    headers={"Authorization": f"Bearer {admin}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=20) as response:
    if response.status < 200 or response.status >= 300:
        raise SystemExit("LiteLLM key generation failed")
    result = response.read(65537)
if not result or len(result) > 65536:
    raise SystemExit("invalid key response size")
sys.stdout.buffer.write(result)
' < "$request_file" > "$response_file"

node --input-type=module - "$request_file" "$response_file" "$key_tmp" <<'NODE'
import {readFileSync, writeFileSync} from 'node:fs';
const [requestPath, responsePath, keyPath] = process.argv.slice(2);
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const response = JSON.parse(readFileSync(responsePath, 'utf8'));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
if (typeof response.key !== 'string' || !/^sk-[A-Za-z0-9_-]{13,}$/.test(response.key) ||
    response.key_alias !== request.key_alias || response.key_type !== request.key_type ||
    !same(response.models, request.models) || !same(response.allowed_routes, request.allowed_routes)) {
  throw new Error('LiteLLM returned an incomplete or over-broad virtual-key contract');
}
writeFileSync(keyPath, `${response.key}\n`, {mode: 0o600});
NODE

chown root:root "$key_tmp"; chmod 0600 "$key_tmp"
if [[ "$mode" == '--rotate' ]]; then
  install -o root -g root -m 0600 -- "$key_file" "$previous_file"
fi
mv -f -- "$key_tmp" "$key_file"
test "$(stat -c '%u:%g:%a' -- "$key_file")" = '0:0:600'
echo 'litellm-virtual-key=provisioned; secret value suppressed; API restart required'

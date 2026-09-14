#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); root_dir=$(cd "$script_dir/.." && pwd)
identity_secret=/srv/frank/secrets/owner-identity.env; device_secret=/srv/frank/secrets/owner-trusted-devices.json
fail(){ echo "trusted-device: $*" >&2; exit 1; }
safe(){ test -f "$1" && test ! -L "$1" || fail "missing regular secret file $1"; test "$(stat -c %a "$1")" = 600 && test "$(stat -c %u "$1")" = 0 || fail "secret file is unsafe: $1"; }
safe "$identity_secret"; safe "$device_secret"
token=$(sed -n 's/^OWNER_IDENTITY_BOOTSTRAP_TOKEN=//p' "$identity_secret" | tail -n1); test -n "$token" || fail "OWNER_IDENTITY_BOOTSTRAP_TOKEN must be set"
proof_hash=$(python3 - "$device_secret" <<'PY'
import hashlib,json,sys
with open(sys.argv[1],encoding="utf-8") as f: proof=json.load(f).get("proof_secret")
if not isinstance(proof,str) or not proof: raise SystemExit("owner-trusted-devices.json needs a non-empty proof_secret")
print(hashlib.sha256(proof.encode()).hexdigest())
PY
)
export OWNER_IDENTITY_SOURCE_SHA="$(git -C "$(cd "$root_dir/../../../.." && pwd)" rev-parse HEAD)"
compose=(docker compose --project-directory "$root_dir" --env-file "$identity_secret" -f "$root_dir/compose.yaml")
server_id=$("${compose[@]}" ps -q server); test -n "$server_id" || fail "the owner identity server is not running"
test "$(docker inspect -f '{{.State.Health.Status}}' "$server_id")" = healthy || fail "the owner identity server is not healthy"
{ printf 'import sys\nbootstrap=sys.modules[__name__]\n'; sed '/^if __name__ == "__main__":/,$d' "$script_dir/bootstrap.py"; cat "$script_dir/provision-trusted-device.py"; } | "${compose[@]}" exec -T -e "OWNER_IDENTITY_BOOTSTRAP_TOKEN=$token" -e "OWNER_TRUSTED_DEVICE_PROOF_SHA256=$proof_hash" server python3 -

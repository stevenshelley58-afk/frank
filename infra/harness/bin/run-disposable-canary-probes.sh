#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 2 ]] || { echo "usage: $0 candidate.env receipt-dir" >&2; exit 64; }
candidate="$1" receipt="$2"; script_dir="$(cd "$(dirname "$0")" && pwd)"; harness_dir="$(cd "$script_dir/.." && pwd)"
set -a; source "$candidate"; set +a
: "${FRANK_HARNESS_CANARY_PROJECT:?set disposable project}"; mkdir -p "$receipt"
cat > "$receipt/s3.json" <<'JSON'
{"identities":[{"name":"canary-staging","credentials":[{"accessKey":"canary-staging","secretKey":"canary-staging-secret"}],"actions":["Read:canary-staging","Write:canary-staging","List:canary-staging"]},{"name":"canary-deny","credentials":[{"accessKey":"canary-deny","secretKey":"canary-deny-secret"}],"actions":[]}]}
JSON
chmod 600 "$receipt/s3.json"; export FRANK_CANARY_S3_CONFIG="$receipt/s3.json"
compose=(docker compose -p "$FRANK_HARNESS_CANARY_PROJECT" -f "$harness_dir/docker-compose.canary.yml")
# Bootstrap Seaweed's only canary bucket from the disposable service itself before
# tusd starts; this never contacts production Seaweed or any external network.
"${compose[@]}" up -d seaweedfs gate litellm clamav probe > "$receipt/up.log" 2>&1
sleep 5
"${compose[@]}" exec -T seaweedfs sh -ec 'echo "s3.bucket.create -name=canary-staging" | weed shell -master=127.0.0.1:9333' > "$receipt/seaweed-bootstrap.txt"
"${compose[@]}" up -d tusd >> "$receipt/up.log" 2>&1
trap '"${compose[@]}" down --volumes --remove-orphans > "$receipt/cleanup.log" 2>&1 || true' EXIT
sleep 20
"${compose[@]}" ps -a > "$receipt/ps.txt"
# Network-side LiteLLM readiness: no package is installed in the target image.
"${compose[@]}" exec -T probe sh -ec 'wget -q -O - http://litellm:4000/health/readiness' > "$receipt/litellm-readiness.json"
# TUSD protocol: POST creates a zero-byte upload; HEAD/PATCH/DELETE prove endpoint semantics.
"${compose[@]}" exec -T probe sh -ec 'wget -qS -O /tmp/post --method=POST --header="Tus-Resumable: 1.0.0" --header="Upload-Length: 0" http://tusd:8080/v1/uploads/tus/ 2>/tmp/post.h; cat /tmp/post.h; test -s /tmp/post' > "$receipt/tusd-post.txt" || true
grep -Eqi "HTTP/.*(201|204)" "$receipt/tusd-post.txt"
# Gate/hook deny proof is synthetic: a malformed request must not yield an upload success.
if "${compose[@]}" exec -T probe sh -ec 'wget -q -O /dev/null --method=POST http://tusd:8080/v1/uploads/tus/'; then echo 'tamper unexpectedly accepted' >&2; exit 1; fi
printf 'tamper-denied\n' > "$receipt/tusd-tamper.txt"
# Seaweed endpoint must be reachable only on the isolated attachment network; no lake identity exists here.
"${compose[@]}" exec -T probe sh -ec 'wget -q -O - http://seaweedfs:8333/status' > "$receipt/seaweed-status.json"
printf 'cross-lake-denial=not-asserted; no lake credentials were supplied to the isolated namespace\n' > "$receipt/seaweed-identity.txt"
# ClamAV daemon protocol, not an assumed scanner binary: PING then INSTREAM EICAR over TCP.
"${compose[@]}" exec -T probe sh -ec 'printf "zPING\\000" | nc clamav 3310 | grep -Fx PONG' > "$receipt/clamav-ping.txt"
if "${compose[@]}" exec -T probe sh -ec 'p="X5O!P%@AP[4\\PZX54(P^)7CC)7}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H+H*"; { printf "zINSTREAM\\000"; printf "%s" "$p" | wc -c | awk "{printf \">%x\\000\", \$1}"; printf "%s" "$p"; printf "\\000"; } | nc clamav 3310 | grep -E "FOUND"'; then :; else echo 'EICAR was not rejected' >&2; exit 1; fi > "$receipt/clamav-eicar.txt"
sha256sum "$receipt"/* > "$receipt/SHA256SUMS"

#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 2 ]] || { echo "usage: $0 candidate.env receipt-dir" >&2; exit 64; }
candidate="$1" receipt="$2"; script_dir="$(cd "$(dirname "$0")" && pwd)"; harness_dir="$(cd "$script_dir/.." && pwd)"
set -a; source "$candidate"; set +a
: "${FRANK_HARNESS_CANARY_PROJECT:?set disposable project}"; mkdir -p "$receipt"
cat > "$receipt/s3.json" <<'JSON'
{"identities":[{"name":"canary-staging","credentials":[{"accessKey":"canary-staging","secretKey":"canary-staging-secret"}],"actions":["Read:canary-staging","Write:canary-staging","List:canary-staging"]},{"name":"canary-deny","credentials":[{"accessKey":"canary-deny","secretKey":"canary-deny-secret"}],"actions":[]}]}
JSON
# Synthetic throwaway keys only; the image runs as an unprivileged user and must read it.
chmod 644 "$receipt/s3.json"; export FRANK_CANARY_S3_CONFIG="$receipt/s3.json"
compose=(docker compose -p "$FRANK_HARNESS_CANARY_PROJECT" -f "$harness_dir/docker-compose.canary.yml")
# Bootstrap Seaweed's only canary bucket from the disposable service itself before
# tusd starts; this never contacts production Seaweed or any external network.
"${compose[@]}" up -d seaweedfs gate litellm clamav probe > "$receipt/up.log" 2>&1
sleep 5
"${compose[@]}" exec -T seaweedfs sh -ec 'echo "s3.bucket.create -name=canary-staging" | weed shell -master=127.0.0.1:9333 -filer=127.0.0.1:8888' > "$receipt/seaweed-bootstrap.txt"
"${compose[@]}" up -d tusd >> "$receipt/up.log" 2>&1
cleanup() {
  "${compose[@]}" down --volumes --remove-orphans > "$receipt/cleanup.log" 2>&1 || true
  {
    docker ps -a --format '{{.Names}}' | grep "^${FRANK_HARNESS_CANARY_PROJECT}-" || true
    docker network ls --format '{{.Name}}' | grep "^${FRANK_HARNESS_CANARY_PROJECT}_" || true
    docker volume ls --format '{{.Name}}' | grep "^${FRANK_HARNESS_CANARY_PROJECT}_" || true
  } > "$receipt/residue-postcheck.txt"
  test ! -s "$receipt/residue-postcheck.txt"
}
trap cleanup EXIT
sleep 20
"${compose[@]}" ps -a > "$receipt/ps.txt"
# Network-side LiteLLM readiness: no package is installed in the target image.
"${compose[@]}" exec -T probe sh -ec 'wget -q -O - http://litellm:4000/health/readiness' > "$receipt/litellm-readiness.json"
# TUSD protocol: POST creates a zero-byte upload; HEAD/PATCH/DELETE prove endpoint semantics.
"${compose[@]}" exec -T probe sh -ec 'printf "POST /v1/uploads/tus/ HTTP/1.1\r\nHost: tusd\r\nTus-Resumable: 1.0.0\r\nUpload-Length: 0\r\nUpload-Metadata: filename Zm9v\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" | nc tusd 8080' > "$receipt/tusd-post.txt"
grep -Eqi "HTTP/.*(201|204)" "$receipt/tusd-post.txt"
upload_url="$(sed -nE 's/^Location: (.*)\r?$/\1/ip' "$receipt/tusd-post.txt" | tr -d '\r' | head -n1)"
[[ "$upload_url" =~ ^/v1/uploads/tus/ ]] || { echo 'tusd POST did not return an upload location' >&2; exit 1; }
"${compose[@]}" exec -T probe sh -ec "printf 'HEAD $upload_url HTTP/1.1\\r\\nHost: tusd\\r\\nTus-Resumable: 1.0.0\\r\\nConnection: close\\r\\n\\r\\n' | nc tusd 8080" > "$receipt/tusd-head.txt"
grep -Eqi 'HTTP/.*200' "$receipt/tusd-head.txt"
"${compose[@]}" exec -T probe sh -ec "printf 'PATCH $upload_url HTTP/1.1\\r\\nHost: tusd\\r\\nTus-Resumable: 1.0.0\\r\\nUpload-Offset: 0\\r\\nContent-Type: application/offset+octet-stream\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n' | nc tusd 8080" > "$receipt/tusd-patch.txt"
grep -Eqi 'HTTP/.*204' "$receipt/tusd-patch.txt"
"${compose[@]}" exec -T probe sh -ec "printf 'DELETE $upload_url HTTP/1.1\\r\\nHost: tusd\\r\\nTus-Resumable: 1.0.0\\r\\nConnection: close\\r\\n\\r\\n' | nc tusd 8080" > "$receipt/tusd-delete.txt"
grep -Eqi 'HTTP/.*204' "$receipt/tusd-delete.txt"
# A syntactically valid upload whose hook payload is marked tamper must be rejected by the hook.
"${compose[@]}" exec -T probe sh -ec 'printf "POST /v1/uploads/tus/ HTTP/1.1\r\nHost: tusd\r\nTus-Resumable: 1.0.0\r\nUpload-Length: 0\r\nUpload-Metadata: filename dGFtcGVy\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" | nc tusd 8080' > "$receipt/tusd-hook-rejection.txt"
grep -Eqi 'HTTP/.*(400|403|409|412|500)' "$receipt/tusd-hook-rejection.txt"
# Seaweed endpoint must be reachable only on the isolated attachment network; no lake identity exists here.
"${compose[@]}" exec -T probe sh -ec 'wget -q -O - http://seaweedfs:8333/status' > "$receipt/seaweed-status.json"
# The deliberately unprivileged identity cannot list or write the disposable bucket.
if "${compose[@]}" exec -T probe sh -ec 'wget -q -O /dev/null --user=canary-deny --password=canary-deny-secret http://seaweedfs:8333/canary-staging/'; then echo 'Seaweed deny identity unexpectedly listed bucket' >&2; exit 1; fi
printf 'canary-deny=list/write denied; disposable canary-staging remains scoped to canary-staging identity\n' > "$receipt/seaweed-identity.txt"
# ClamAV daemon protocol, not an assumed scanner binary: PING then INSTREAM EICAR over TCP.
"${compose[@]}" exec -T probe sh -ec 'printf "zPING\\000" | nc clamav 3310 | grep -Fx PONG' > "$receipt/clamav-ping.txt"
if "${compose[@]}" exec -T probe sh -ec 'p="X5O!P%@AP[4\\PZX54(P^)7CC)7}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H+H*"; test "$(printf %s "$p" | wc -c)" -eq 68; { printf "zINSTREAM\\000\\000\\000\\000D%s\\000" "$p"; } | nc clamav 3310 | grep -E "FOUND"'; then :; else echo 'EICAR was not rejected' >&2; exit 1; fi > "$receipt/clamav-eicar.txt"
sha256sum "$receipt"/* > "$receipt/SHA256SUMS"

#!/usr/bin/env bash
# One-shot, idempotent bucket bootstrap. The first Seaweed start has the temporary admin
# identity; this script creates only attachment buckets, renders scoped-only policy, recreates
# that same service, and proves the old credential is denied.
set -Eeuo pipefail
set +x
[[ "$(id -u)" -eq 0 ]] || { echo 'attachment bucket bootstrap must run as root' >&2; exit 77; }
: "${FRANK_S3_ENDPOINT:?}" "${FRANK_S3_BOOTSTRAP_ACCESS_KEY:?}" "${FRANK_S3_BOOTSTRAP_SECRET_KEY:?}" "${FRANK_BASE_COMPOSE:?}" "${FRANK_APP_OVERLAY:?}" "${FRANK_HARNESS_OVERLAY:?}" "${FRANK_ROOT_RUNTIME_ENV:?}"
[[ "$FRANK_ROOT_RUNTIME_ENV" == /* && -f "$FRANK_ROOT_RUNTIME_ENV" && ! -L "$FRANK_ROOT_RUNTIME_ENV" ]] || { echo 'invalid root runtime env file' >&2; exit 65; }
command -v aws >/dev/null; command -v sha256sum >/dev/null
export AWS_ACCESS_KEY_ID="$FRANK_S3_BOOTSTRAP_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$FRANK_S3_BOOTSTRAP_SECRET_KEY" AWS_DEFAULT_REGION=us-east-1
endpoint=(--endpoint-url "$FRANK_S3_ENDPOINT")
# The temporary identity is supplied only to this process and unset on exit. Removing it
# from runtime configuration prevents new use; it is not a cryptographic revocation claim.
trap 'unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY' EXIT
for bucket in frank-attachment-staging frank-objects frank-object-previews; do
  aws "${endpoint[@]}" s3api head-bucket --bucket "$bucket" 2>/dev/null || aws "${endpoint[@]}" s3api create-bucket --bucket "$bucket"
done
lifecycle='{"Rules":[{"ID":"abort-incomplete-and-quarantine-24h","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1},"Expiration":{"Days":1}}]}'
aws "${endpoint[@]}" s3api put-bucket-lifecycle-configuration --bucket frank-attachment-staging --lifecycle-configuration "$lifecycle"
bash "$(dirname "$0")/render-seaweedfs-s3-config.sh"
scoped_config="${FRANK_SEAWEEDFS_S3_CONFIG:-/frank/deployed/secrets/seaweedfs/s3.json}"
if grep -Fq -- "$FRANK_S3_BOOTSTRAP_ACCESS_KEY" "$scoped_config"; then
  echo 'temporary Seaweed bootstrap identity remains in scoped configuration' >&2; exit 1
fi
compose=(docker compose --env-file "$FRANK_ROOT_RUNTIME_ENV" -f "$FRANK_BASE_COMPOSE" -f "$FRANK_APP_OVERLAY" -f "$FRANK_HARNESS_OVERLAY")
"${compose[@]}" up -d --no-build --force-recreate --no-deps --wait --wait-timeout 180 frank-seaweedfs >/dev/null
seaweed_id="$("${compose[@]}" ps -q frank-seaweedfs)"
[[ -n "$seaweed_id" ]] || { echo 'recreated Seaweed container unavailable' >&2; exit 1; }
seaweed_ip="$(docker inspect --format '{{with index .NetworkSettings.Networks "frank-attachments"}}{{.IPAddress}}{{end}}' "$seaweed_id")"
[[ "$seaweed_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'recreated Seaweed attachment address unavailable' >&2; exit 1; }
endpoint=(--endpoint-url "http://$seaweed_ip:8333")
AWS_ACCESS_KEY_ID="$FRANK_ATTACHMENT_STAGING_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$FRANK_ATTACHMENT_STAGING_SECRET_KEY" \
  aws "${endpoint[@]}" s3api head-bucket --bucket frank-attachment-staging >/dev/null
if aws "${endpoint[@]}" s3api list-buckets >/dev/null 2>&1; then
  echo 'temporary Seaweed bootstrap credential survived scoped recreate' >&2; exit 1
fi
echo 'attachment-buckets=bootstrapped; lifecycle=staging-only; scoped-recreate=passed; temporary-admin=denied'

#!/usr/bin/env bash
# One-shot, idempotent bucket bootstrap. The caller supplies a temporary admin key;
# this script creates only attachment buckets. It never enumerates, deletes, or claims to
# revoke credentials for later lake buckets; credential retirement is an operator action.
set -Eeuo pipefail
set +x
: "${FRANK_S3_ENDPOINT:?}" "${FRANK_S3_BOOTSTRAP_ACCESS_KEY:?}" "${FRANK_S3_BOOTSTRAP_SECRET_KEY:?}"
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
echo 'attachment-buckets=bootstrapped; lifecycle=staging-only; temporary-admin=unset-from-process'

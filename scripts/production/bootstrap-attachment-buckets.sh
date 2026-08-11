#!/usr/bin/env bash
# One-shot, idempotent bucket bootstrap. The caller supplies a temporary admin key;
# this script creates policy then revokes that key before returning.
set -Eeuo pipefail
set +x
: "${FRANK_S3_ENDPOINT:?}" "${FRANK_S3_BOOTSTRAP_ACCESS_KEY:?}" "${FRANK_S3_BOOTSTRAP_SECRET_KEY:?}"
command -v aws >/dev/null; command -v sha256sum >/dev/null
export AWS_ACCESS_KEY_ID="$FRANK_S3_BOOTSTRAP_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$FRANK_S3_BOOTSTRAP_SECRET_KEY" AWS_DEFAULT_REGION=us-east-1
endpoint=(--endpoint-url "$FRANK_S3_ENDPOINT")
# The bootstrap identity exists only in the pre-rendered temporary config. Re-rendering
# the reviewed runtime config without it and recreating Seaweed revokes it deterministically.
trap 'unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY' EXIT
for bucket in frank-attachment-staging frank-objects frank-object-previews; do
  aws "${endpoint[@]}" s3api head-bucket --bucket "$bucket" 2>/dev/null || aws "${endpoint[@]}" s3api create-bucket --bucket "$bucket"
done
# No fourth bucket is tolerated: the account is dedicated to this bounded policy.
actual="$(aws "${endpoint[@]}" s3api list-buckets --query 'Buckets[].Name' --output text | tr '\t' '\n' | sort)"
expected="$(printf '%s\n' frank-attachment-staging frank-object-previews frank-objects | sort)"
[[ "$actual" == "$expected" ]] || { echo 'unexpected bucket set' >&2; exit 1; }
lifecycle='{"Rules":[{"ID":"abort-incomplete-and-quarantine-24h","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1},"Expiration":{"Days":1}}]}'
aws "${endpoint[@]}" s3api put-bucket-lifecycle-configuration --bucket frank-attachment-staging --lifecycle-configuration "$lifecycle"
bash "$(dirname "$0")/render-seaweedfs-s3-config.sh"
echo 'attachment-buckets=bootstrapped; buckets=3; temporary-admin=removed-from-runtime-config'

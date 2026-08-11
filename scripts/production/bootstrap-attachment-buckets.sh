#!/usr/bin/env bash
# One-shot, idempotent bucket bootstrap. The caller supplies a temporary admin key;
# this script creates policy then revokes that key before returning.
set -Eeuo pipefail
set +x
: "${FRANK_S3_ENDPOINT:?}" "${FRANK_S3_BOOTSTRAP_ACCESS_KEY:?}" "${FRANK_S3_BOOTSTRAP_SECRET_KEY:?}" "${FRANK_S3_REVOKE_COMMAND:?}"
command -v aws >/dev/null; command -v sha256sum >/dev/null
export AWS_ACCESS_KEY_ID="$FRANK_S3_BOOTSTRAP_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$FRANK_S3_BOOTSTRAP_SECRET_KEY" AWS_DEFAULT_REGION=us-east-1
endpoint=(--endpoint-url "$FRANK_S3_ENDPOINT")
revoke() { eval "$FRANK_S3_REVOKE_COMMAND"; unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; }
trap revoke EXIT
for bucket in frank-attachment-staging frank-objects frank-object-previews; do
  aws "${endpoint[@]}" s3api head-bucket --bucket "$bucket" 2>/dev/null || aws "${endpoint[@]}" s3api create-bucket --bucket "$bucket"
done
# No fourth bucket is tolerated: the account is dedicated to this bounded policy.
actual="$(aws "${endpoint[@]}" s3api list-buckets --query 'Buckets[].Name' --output text | tr '\t' '\n' | sort)"
expected="$(printf '%s\n' frank-attachment-staging frank-object-previews frank-objects | sort)"
[[ "$actual" == "$expected" ]] || { echo 'unexpected bucket set' >&2; exit 1; }
for bucket in frank-attachment-staging frank-objects frank-object-previews; do
  lifecycle='{"Rules":[{"ID":"abort-incomplete-and-quarantine-24h","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1},"Expiration":{"Days":1}}]}'
  aws "${endpoint[@]}" s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "$lifecycle"
done
echo 'attachment-buckets=bootstrapped; buckets=3; temporary-admin=revoked'

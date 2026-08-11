#!/usr/bin/env bash
# Hosted isolated canary only. It uses supplied ephemeral credentials against a disposable
# SeaweedFS endpoint; it is never run against production or a shared bucket.
set -euo pipefail
: "${S3_ENDPOINT:?}" "${STAGING_ACCESS_KEY:?}" "${STAGING_SECRET_KEY:?}" "${PROMOTER_ACCESS_KEY:?}" "${PROMOTER_SECRET_KEY:?}"
export AWS_EC2_METADATA_DISABLED=true AWS_DEFAULT_REGION=us-east-1
aws=(aws --endpoint-url "$S3_ENDPOINT" s3api)
AWS_ACCESS_KEY_ID="$STAGING_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$STAGING_SECRET_KEY" "${aws[@]}" put-object --bucket frank-attachment-staging --key canary/upload --body /dev/null
AWS_ACCESS_KEY_ID="$PROMOTER_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$PROMOTER_SECRET_KEY" "${aws[@]}" put-object --bucket frank-objects --key sha256/aa/canary --body /dev/null
for bucket in frank-objects frank-object-previews lake-private; do
  if AWS_ACCESS_KEY_ID="$STAGING_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$STAGING_SECRET_KEY" "${aws[@]}" list-objects-v2 --bucket "$bucket" >/dev/null 2>&1; then echo "staging unexpectedly accessed $bucket" >&2; exit 1; fi
done
echo 'hosted SeaweedFS attachment allow/deny probe passed'

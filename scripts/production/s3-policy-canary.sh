#!/usr/bin/env bash
# Hosted disposable canary: the operator injects scoped test credentials, never an admin.
set -Eeuo pipefail
set +x
: "${FRANK_S3_ENDPOINT:?}" "${FRANK_S3_CANARY_ACCESS_KEY:?}" "${FRANK_S3_CANARY_SECRET_KEY:?}"
key="canary/$(openssl rand -hex 32)"; [[ "$key" =~ ^canary/[a-f0-9]{64}$ ]]
export AWS_ACCESS_KEY_ID="$FRANK_S3_CANARY_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$FRANK_S3_CANARY_SECRET_KEY" AWS_DEFAULT_REGION=us-east-1
aws=(aws --endpoint-url "$FRANK_S3_ENDPOINT")
"${aws[@]}" s3api put-object --bucket frank-attachment-staging --key "$key" --body /dev/null
"${aws[@]}" s3api head-object --bucket frank-attachment-staging --key "$key" >/dev/null
"${aws[@]}" s3api delete-object --bucket frank-attachment-staging --key "$key"
# Explicit callers supply the denied commands for promoter/preview/lake roles. They must fail.
for denied in "${FRANK_S3_DENY_STAGING_PROMOTER:?}" "${FRANK_S3_DENY_PREVIEW:?}" "${FRANK_S3_DENY_LAKE_WORKER:?}" "${FRANK_S3_DENY_LAKE_QUERY:?}"; do
  if eval "$denied"; then echo 'scoped S3 denial unexpectedly allowed' >&2; exit 1; fi
done
echo 's3-policy-canary=passed; disposable-key=deleted; no-admin-credential-used'

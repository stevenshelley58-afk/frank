#!/usr/bin/env bash
# Hosted disposable policy canary. All identities are scoped S3 credentials; never admin.
set -Eeuo pipefail; set +x
: "${FRANK_S3_ENDPOINT:?}" "${FRANK_STAGING_ACCESS_KEY:?}" "${FRANK_STAGING_SECRET_KEY:?}" "${FRANK_PROMOTER_ACCESS_KEY:?}" "${FRANK_PROMOTER_SECRET_KEY:?}" "${FRANK_DOWNLOADER_ACCESS_KEY:?}" "${FRANK_DOWNLOADER_SECRET_KEY:?}"
export AWS_DEFAULT_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true
cell="cell-$(openssl rand -hex 8)"; upload="$(uuidgen | tr '[:upper:]' '[:lower:]')"; key="$cell/$upload/object"; hash="$(openssl rand -hex 32)"; object="sha256/${hash:0:2}/$hash"; preview="$hash/thumb/$hash"
aws_for() { AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" aws --endpoint-url "$FRANK_S3_ENDPOINT" s3api "${@:3}"; }
aws_for "$FRANK_STAGING_ACCESS_KEY" "$FRANK_STAGING_SECRET_KEY" put-object --bucket frank-attachment-staging --key "$key" --body /dev/null
aws_for "$FRANK_PROMOTER_ACCESS_KEY" "$FRANK_PROMOTER_SECRET_KEY" copy-object --bucket frank-objects --key "$object" --copy-source "frank-attachment-staging/$key"
aws_for "$FRANK_PROMOTER_ACCESS_KEY" "$FRANK_PROMOTER_SECRET_KEY" put-object --bucket frank-object-previews --key "$preview" --body /dev/null
aws_for "$FRANK_DOWNLOADER_ACCESS_KEY" "$FRANK_DOWNLOADER_SECRET_KEY" head-object --bucket frank-objects --key "$object" >/dev/null
for spec in "frank-objects:$object" "frank-object-previews:$preview"; do
  b="${spec%%:*}"; k="${spec#*:}"; if aws_for "$FRANK_STAGING_ACCESS_KEY" "$FRANK_STAGING_SECRET_KEY" head-object --bucket "$b" --key "$k" >/dev/null 2>&1; then echo 'staging overreach' >&2; exit 1; fi
done
aws_for "$FRANK_PROMOTER_ACCESS_KEY" "$FRANK_PROMOTER_SECRET_KEY" head-object --bucket frank-attachment-staging --key "$key" >/dev/null
if aws_for "$FRANK_PROMOTER_ACCESS_KEY" "$FRANK_PROMOTER_SECRET_KEY" list-objects-v2 --bucket frank-attachment-staging >/dev/null 2>&1; then echo 'promoter staging-list overreach' >&2; exit 1; fi
if aws_for "$FRANK_DOWNLOADER_ACCESS_KEY" "$FRANK_DOWNLOADER_SECRET_KEY" head-object --bucket frank-attachment-staging --key "$key" >/dev/null 2>&1; then echo 'downloader staging-read overreach' >&2; exit 1; fi
if aws_for "$FRANK_DOWNLOADER_ACCESS_KEY" "$FRANK_DOWNLOADER_SECRET_KEY" put-object --bucket frank-objects --key "$object" --body /dev/null 2>&1; then echo 'downloader write overreach' >&2; exit 1; fi
aws_for "$FRANK_STAGING_ACCESS_KEY" "$FRANK_STAGING_SECRET_KEY" delete-object --bucket frank-attachment-staging --key "$key"
echo 's3-policy-canary=passed; scoped identities verified; disposable objects deleted'

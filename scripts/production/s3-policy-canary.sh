#!/usr/bin/env bash
# Hosted disposable policy canary. All identities are scoped S3 credentials; never admin.
set -Eeuo pipefail; set +x
: "${FRANK_S3_ENDPOINT:?}" "${FRANK_STAGING_ACCESS_KEY:?}" "${FRANK_STAGING_SECRET_KEY:?}" "${FRANK_PROMOTER_ACCESS_KEY:?}" "${FRANK_PROMOTER_SECRET_KEY:?}" "${FRANK_DOWNLOADER_ACCESS_KEY:?}" "${FRANK_DOWNLOADER_SECRET_KEY:?}"
export AWS_DEFAULT_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true
lake_vars=(FRANK_LAKE_BUCKET FRANK_LAKE_WORKER_ACCESS_KEY FRANK_LAKE_WORKER_SECRET_KEY FRANK_LAKE_QUERY_ACCESS_KEY FRANK_LAKE_QUERY_SECRET_KEY)
lake_values=0
for lake_var in "${lake_vars[@]}"; do [[ -n "${!lake_var:-}" ]] && ((lake_values += 1)); done
if ((lake_values != 0 && lake_values != ${#lake_vars[@]})); then
  echo 'partially configured lake credentials cannot prove mutual denial' >&2; exit 1
fi
cell="cell-$(openssl rand -hex 8)"; upload="$(uuidgen | tr '[:upper:]' '[:lower:]')"; key="$cell/$upload/object"; hash="$(openssl rand -hex 32)"; object="sha256/${hash:0:2}/$hash"; preview="$hash/thumb/$hash"
aws_for() { AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" aws --endpoint-url "$FRANK_S3_ENDPOINT" s3api "${@:3}"; }
must_deny_lake() { local access="$1" secret="$2"; for action in "head-object --bucket $FRANK_LAKE_BUCKET --key $lake_key" "list-objects-v2 --bucket $FRANK_LAKE_BUCKET" "put-object --bucket $FRANK_LAKE_BUCKET --key $lake_key --body /dev/null"; do if aws_for "$access" "$secret" $action >/dev/null 2>&1; then echo 'attachment lake overreach' >&2; exit 1; fi; done; }
must_deny_attachments() { local access="$1" secret="$2"; for spec in "frank-attachment-staging:$key" "frank-objects:$object" "frank-object-previews:$preview"; do b="${spec%%:*}"; k="${spec#*:}"; if aws_for "$access" "$secret" head-object --bucket "$b" --key "$k" >/dev/null 2>&1 || aws_for "$access" "$secret" list-objects-v2 --bucket "$b" >/dev/null 2>&1 || aws_for "$access" "$secret" put-object --bucket "$b" --key "$k" --body /dev/null 2>&1; then echo 'lake attachment overreach' >&2; exit 1; fi; done; }
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
if ((lake_values == ${#lake_vars[@]})); then
  lake_key="canary/$hash"
  aws_for "$FRANK_LAKE_WORKER_ACCESS_KEY" "$FRANK_LAKE_WORKER_SECRET_KEY" put-object --bucket "$FRANK_LAKE_BUCKET" --key "$lake_key" --body /dev/null
  aws_for "$FRANK_LAKE_QUERY_ACCESS_KEY" "$FRANK_LAKE_QUERY_SECRET_KEY" head-object --bucket "$FRANK_LAKE_BUCKET" --key "$lake_key" >/dev/null
  must_deny_lake "$FRANK_STAGING_ACCESS_KEY" "$FRANK_STAGING_SECRET_KEY"; must_deny_lake "$FRANK_PROMOTER_ACCESS_KEY" "$FRANK_PROMOTER_SECRET_KEY"; must_deny_lake "$FRANK_DOWNLOADER_ACCESS_KEY" "$FRANK_DOWNLOADER_SECRET_KEY"
  must_deny_attachments "$FRANK_LAKE_WORKER_ACCESS_KEY" "$FRANK_LAKE_WORKER_SECRET_KEY"; must_deny_attachments "$FRANK_LAKE_QUERY_ACCESS_KEY" "$FRANK_LAKE_QUERY_SECRET_KEY"
  aws_for "$FRANK_LAKE_WORKER_ACCESS_KEY" "$FRANK_LAKE_WORKER_SECRET_KEY" delete-object --bucket "$FRANK_LAKE_BUCKET" --key "$lake_key"
  if aws_for "$FRANK_LAKE_QUERY_ACCESS_KEY" "$FRANK_LAKE_QUERY_SECRET_KEY" head-object --bucket "$FRANK_LAKE_BUCKET" --key "$lake_key" >/dev/null 2>&1; then echo 'lake canary cleanup failed' >&2; exit 1; fi
  lake_result='lake-mutual-denial=passed'
else lake_result='lake-mutual-denial=skipped-no-real-lake-credentials'; fi
aws_for "$FRANK_STAGING_ACCESS_KEY" "$FRANK_STAGING_SECRET_KEY" delete-object --bucket frank-attachment-staging --key "$key"
aws_for "$FRANK_PROMOTER_ACCESS_KEY" "$FRANK_PROMOTER_SECRET_KEY" delete-object --bucket frank-objects --key "$object"
aws_for "$FRANK_PROMOTER_ACCESS_KEY" "$FRANK_PROMOTER_SECRET_KEY" delete-object --bucket frank-object-previews --key "$preview"
if aws_for "$FRANK_STAGING_ACCESS_KEY" "$FRANK_STAGING_SECRET_KEY" head-object --bucket frank-attachment-staging --key "$key" >/dev/null 2>&1; then echo 'staging canary cleanup failed' >&2; exit 1; fi
if aws_for "$FRANK_DOWNLOADER_ACCESS_KEY" "$FRANK_DOWNLOADER_SECRET_KEY" head-object --bucket frank-objects --key "$object" >/dev/null 2>&1; then echo 'object canary cleanup failed' >&2; exit 1; fi
if aws_for "$FRANK_DOWNLOADER_ACCESS_KEY" "$FRANK_DOWNLOADER_SECRET_KEY" head-object --bucket frank-object-previews --key "$preview" >/dev/null 2>&1; then echo 'preview canary cleanup failed' >&2; exit 1; fi
echo "s3-policy-canary=passed; scoped identities verified; disposable objects deleted; $lake_result"

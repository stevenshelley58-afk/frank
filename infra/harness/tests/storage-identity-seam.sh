#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
policy="$root/infra/compose/seaweedfs/s3.json.tmpl"
overlay="$root/infra/harness/docker-compose.gateway.yml"
! rg -n 'frank-cell|FRANK_S3_ACCESS_KEY|FRANK_S3_SECRET_KEY|FRANK_OPENFGA|lake-' "$policy" "$overlay"
rg -q 'attachment-staging' "$policy"
rg -q 'attachment-promoter' "$policy"
! rg -n '"Read"|"Write"|"List"|"Tagging"|"Admin"' "$policy"
for bucket in frank-attachment-staging frank-objects frank-object-previews; do rg -q "$bucket" "$root/infra/harness/README.md"; done
! rg -n 'lake-worker|lake-query|FRANK_LAKE_' "$policy" "$overlay"
echo 'attachment identities are isolated from lake identities and buckets'

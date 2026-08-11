#!/usr/bin/env bash
# Render the reviewed template once into root-only runtime state. Compose never mounts it.
set -Eeuo pipefail; set +x; umask 077
: "${FRANK_ATTACHMENT_STAGING_ACCESS_KEY:?}" "${FRANK_ATTACHMENT_STAGING_SECRET_KEY:?}" "${FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY:?}" "${FRANK_ATTACHMENT_PROMOTER_SECRET_KEY:?}" "${FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY:?}" "${FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY:?}"
template="${FRANK_SEAWEEDFS_S3_TEMPLATE:-/srv/frank/repo/infra/compose/seaweedfs/s3.json.tmpl}"
target="${FRANK_SEAWEEDFS_S3_CONFIG:-/srv/frank/secrets/seaweedfs/s3.json}"
test -f "$template" && test ! -L "$template"; install -d -o root -g root -m 0700 -- "${target%/*}"
tmp="$(mktemp "${target}.XXXXXX")"; trap 'rm -f -- "$tmp"' EXIT
node --input-type=module - "$template" "$tmp" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
let s=readFileSync(process.argv[2],'utf8');
for (const n of ['ATTACHMENT_STAGING_ACCESS_KEY','ATTACHMENT_STAGING_SECRET_KEY','ATTACHMENT_PROMOTER_ACCESS_KEY','ATTACHMENT_PROMOTER_SECRET_KEY','ATTACHMENT_DOWNLOADER_ACCESS_KEY','ATTACHMENT_DOWNLOADER_SECRET_KEY']) s=s.replaceAll(`__${n}__`, process.env[`FRANK_${n}`]);
if (/__[A-Z0-9_]+__/.test(s)) throw new Error('unexpanded Seaweed placeholder'); JSON.parse(s); writeFileSync(process.argv[3],s,{mode:0o600});
NODE
chown root:root "$tmp"; chmod 0600 "$tmp"; mv -f "$tmp" "$target"; trap - EXIT

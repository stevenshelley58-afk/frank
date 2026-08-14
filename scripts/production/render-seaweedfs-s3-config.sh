#!/usr/bin/env bash
# Render the reviewed template once into root-only runtime state. Compose never mounts it.
set -Eeuo pipefail; set +x; umask 077
[[ $# -le 1 ]] || { echo "usage: $0 [--with-bootstrap]" >&2; exit 64; }
mode="${1:-scoped}"
case "$mode" in scoped|--with-bootstrap) ;; *) echo "usage: $0 [--with-bootstrap]" >&2; exit 64;; esac
: "${FRANK_ATTACHMENT_STAGING_ACCESS_KEY:?}" "${FRANK_ATTACHMENT_STAGING_SECRET_KEY:?}" "${FRANK_ATTACHMENT_PROMOTER_ACCESS_KEY:?}" "${FRANK_ATTACHMENT_PROMOTER_SECRET_KEY:?}" "${FRANK_ATTACHMENT_DOWNLOADER_ACCESS_KEY:?}" "${FRANK_ATTACHMENT_DOWNLOADER_SECRET_KEY:?}"
if [[ "$mode" == '--with-bootstrap' ]]; then
  : "${FRANK_S3_BOOTSTRAP_ACCESS_KEY:?}" "${FRANK_S3_BOOTSTRAP_SECRET_KEY:?}"
fi
template="${FRANK_SEAWEEDFS_S3_TEMPLATE:-/projects/frank/infra/compose/seaweedfs/s3.json.tmpl}"
target="${FRANK_SEAWEEDFS_S3_CONFIG:-/frank/deployed/secrets/seaweedfs/s3.json}"
test -f "$template" && test ! -L "$template"; install -d -o root -g root -m 0700 -- "${target%/*}"
tmp="$(mktemp "${target}.XXXXXX")"; trap 'rm -f -- "$tmp"' EXIT
node --input-type=module - "$template" "$tmp" "$mode" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
let s=readFileSync(process.argv[2],'utf8');
for (const n of ['ATTACHMENT_STAGING_ACCESS_KEY','ATTACHMENT_STAGING_SECRET_KEY','ATTACHMENT_PROMOTER_ACCESS_KEY','ATTACHMENT_PROMOTER_SECRET_KEY','ATTACHMENT_DOWNLOADER_ACCESS_KEY','ATTACHMENT_DOWNLOADER_SECRET_KEY']) s=s.replaceAll(`__${n}__`, process.env[`FRANK_${n}`]);
if (/__[A-Z0-9_]+__/.test(s)) throw new Error('unexpanded Seaweed placeholder');
const config=JSON.parse(s);
if (process.argv[4] === '--with-bootstrap') {
  const accessKey=process.env.FRANK_S3_BOOTSTRAP_ACCESS_KEY;
  const secretKey=process.env.FRANK_S3_BOOTSTRAP_SECRET_KEY;
  if (!accessKey || !secretKey) throw new Error('temporary bootstrap credential unavailable');
  config.identities.push({name:'attachment-bootstrap-temporary',credentials:[{accessKey,secretKey}],actions:['Admin']});
}
writeFileSync(process.argv[3],`${JSON.stringify(config,null,2)}\n`,{mode:0o600});
NODE
chown root:root "$tmp"; chmod 0600 "$tmp"; mv -f "$tmp" "$target"; trap - EXIT

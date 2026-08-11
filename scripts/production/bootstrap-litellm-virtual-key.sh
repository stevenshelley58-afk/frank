#!/usr/bin/env bash
# Fail closed until the selected LiteLLM release's primary-source evidence records the exact
# /key/generate request/response schema. This script never writes an admin key or virtual key
# to stdout, argv, or the repository.
set -Eeuo pipefail; set +x; umask 077
: "${LITELLM_ADMIN_KEY:?}" "${LITELLM_PRIVATE_URL:?}" "${LITELLM_DATABASE_URL:?}" "${FRANK_LITELLM_KEY_EVIDENCE:?}" "${FRANK_LITELLM_RUNTIME_SECRET:?}"
test -f "$FRANK_LITELLM_KEY_EVIDENCE" && test ! -L "$FRANK_LITELLM_KEY_EVIDENCE"
grep -Fqx 'litellm-key-generate-schema=verified-primary-source' "$FRANK_LITELLM_KEY_EVIDENCE" || { echo 'missing version-specific LiteLLM key API evidence' >&2; exit 78; }
case "$FRANK_LITELLM_RUNTIME_SECRET" in /srv/frank/secrets/*) ;; *) echo 'runtime secret must be under /srv/frank/secrets' >&2; exit 78;; esac
mkdir -p -- "${FRANK_LITELLM_RUNTIME_SECRET%/*}"; test ! -L "${FRANK_LITELLM_RUNTIME_SECRET%/*}"
# The verified evidence file supplies the exact curl payload/response parser command. Keeping
# it external prevents this repository from guessing fields for an unpinned upstream version.
echo 'verified LiteLLM key evidence accepted; execute the recorded private bootstrap procedure' >&2
exit 78

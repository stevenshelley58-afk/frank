#!/usr/bin/env bash
set -Eeuo pipefail; set +x; umask 077
[[ $# -eq 2 ]] || { echo "usage: $0 current.env rollback.env" >&2; exit 64; }; current="$1"; rollback="$2"
[[ -s "$rollback" ]] || { echo 'rollback slot is empty; fail closed' >&2; exit 65; }
grep -Eq '^FRANK_(LITELLM|SEAWEEDFS|TUSD|CLAMAV)_CURRENT_IMAGE=.*@sha256:[a-f0-9]{64}$' "$rollback" || exit 66
tmp="$(mktemp "${current}.XXXXXX")"; trap 'rm -f -- "$tmp"' EXIT; install -m 0600 "$rollback" "$tmp"; sync "$tmp"; mv -f "$tmp" "$current"; trap - EXIT
echo 'rollback manifest restored atomically; recreate/probe selected core services; attachment volumes untouched'

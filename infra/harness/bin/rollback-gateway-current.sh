#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 2 ]] || { echo "usage: $0 current.env rollback.env" >&2; exit 64; }
current="$1" rollback="$2"
[[ -s "$rollback" ]] || { echo 'rollback slot is empty; fail closed' >&2; exit 65; }
cp -- "$rollback" "$current"
echo 'rollback manifest restored; recreate only frank-litellm frank-tusd frank-clamav frank-letta frank-hermes as applicable. Keep attachment volumes intact.'

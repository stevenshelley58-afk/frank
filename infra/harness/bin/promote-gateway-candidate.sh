#!/usr/bin/env bash
set -euo pipefail
# Usage is deliberately explicit: candidate-env current-env rollback-env evidence-url.
# This script mutates files only after a human has reviewed the hosted canary evidence.
[[ $# -eq 4 ]] || { echo "usage: $0 candidate.env current.env rollback.env https://hosted-evidence" >&2; exit 64; }
candidate="$1" current="$2" rollback="$3" evidence="$4"
[[ "$evidence" =~ ^https:// ]] || { echo 'hosted evidence URL required' >&2; exit 65; }
[[ -f "$candidate" && -f "$current" ]] || { echo 'candidate/current manifest missing' >&2; exit 66; }
grep -Eq '^FRANK_(LITELLM|SEAWEEDFS|TUSD|CLAMAV|GOOSE|HERMES|LETTA)_CANDIDATE_IMAGE=.*@sha256:[a-f0-9]{64}$' "$candidate" || { echo 'candidate lacks reviewed digest pins' >&2; exit 67; }
cp -- "$current" "$rollback"
sed 's/_CANDIDATE_IMAGE=/_CURRENT_IMAGE=/' "$candidate" > "$current"
printf '# promoted_from=%s\n# hosted_evidence=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$evidence" >> "$current"
echo 'candidate promoted manually; run the production allocation step separately'

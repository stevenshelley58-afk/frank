#!/usr/bin/env bash
# Build a single immutable Frappe Framework 15 + CRM + Telephony + Helpdesk image.
# This follows frappe_docker's supported custom Containerfile; no app is copied
# into a running container and no customer Blockwise app is included.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
# shellcheck source=/dev/null
source "$root_dir/pins.env"
test -z "$(git -C "$root_dir" status --porcelain)" || { echo "refusing build from a dirty source checkout" >&2; exit 1; }
git -C "$root_dir" rev-parse --verify HEAD^{commit} >/dev/null
tag=${1:?"usage: build-image.sh <immutable-tag>|--check"}
verify_only=0
if test "$tag" = --check; then
  tag=owner-crm-pin-check
  verify_only=1
fi

free_gib=$(df -BG / | awk 'NR == 2 {gsub(/G/, "", $4); print $4}')
if (( free_gib < 15 )); then
  echo "refusing build: ${free_gib}GiB free, minimum is 15GiB" >&2
  exit 1
fi

assert_ref() {
  local repo=$1 ref=$2 expected=$3 actual
  actual=$(git ls-remote "$repo" "refs/tags/$ref" "refs/heads/$ref" | awk 'NR == 1 {print $1}')
  test "$actual" = "$expected" || {
    echo "refusing build: $repo $ref resolved to ${actual:-nothing}, expected $expected" >&2
    exit 1
  }
}
assert_ref https://github.com/frappe/frappe.git "$FRAPPE_REF" "$FRAPPE_SHA"
assert_ref https://github.com/frappe/crm.git "$CRM_REF" "$CRM_SHA"
assert_ref https://github.com/frappe/helpdesk.git "$HELPDESK_REF" "$HELPDESK_SHA"
assert_ref https://github.com/frappe/telephony.git "$TELEPHONY_REF" "$TELEPHONY_SHA"

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
git clone --quiet https://github.com/frappe/frappe_docker.git "$work_dir/frappe_docker"
git -C "$work_dir/frappe_docker" checkout --quiet "$FRAPPE_DOCKER_SHA"
apps_hash=$(sha256sum "$root_dir/apps.json" "$root_dir/pins.env" | sha256sum | cut -c1-16)
# frappe_docker removes app Git metadata at the end of its builder stage. Insert
# a check immediately before that removal so labels cannot disguise a moved ref.
containerfile="$work_dir/Containerfile.owner-crm"
printf -v pin_check $'for pair in "frappe:%s" "crm:%s" "telephony:%s" "helpdesk:%s"; do app=${pair%%:*}; expected=${pair#*:}; actual=$(git -C "apps/$app" rev-parse HEAD); test "$actual" = "$expected" || { echo "pin mismatch for $app" >&2; exit 1; }; done && \\' \
  "$FRAPPE_SHA" "$CRM_SHA" "$TELEPHONY_SHA" "$HELPDESK_SHA"
awk -v pin_check="$pin_check" '/find apps -mindepth 1 -path/ { print "  " pin_check } { print }' \
  "$work_dir/frappe_docker/images/custom/Containerfile" > "$containerfile"

grep -Fq 'git -C "apps/$app" rev-parse HEAD' "$containerfile" || { echo "could not install pin check" >&2; exit 1; }
grep -Fq 'for pair in "frappe:' "$containerfile" || { echo "generated pin check is incomplete" >&2; exit 1; }
if (( verify_only )); then
  echo "upstream refs and in-builder pin check verified"
  exit 0
fi

DOCKER_BUILDKIT=1 docker build \
  --build-arg FRAPPE_PATH=https://github.com/frappe/frappe \
  --build-arg FRAPPE_BRANCH="$FRAPPE_REF" \
  --build-arg PYTHON_VERSION=3.12 \
  --build-arg NODE_VERSION=20.19.0 \
  --build-arg CACHE_BUST="$apps_hash" \
  --label org.opencontainers.image.source=https://github.com/frappe/frappe_docker \
  --label org.opencontainers.image.frappe-revision="$FRAPPE_SHA" \
  --label org.opencontainers.image.crm-revision="$CRM_SHA" \
  --label org.opencontainers.image.helpdesk-revision="$HELPDESK_SHA" \
  --label org.opencontainers.image.telephony-revision="$TELEPHONY_SHA" \
  --secret id=apps_json,src="$root_dir/apps.json" \
  --tag "owner-crm-app:$tag" \
  --file "$containerfile" \
  "$work_dir/frappe_docker"

docker run --rm --entrypoint bash "owner-crm-app:$tag" -lc \
  'test -d apps/frappe && test -d apps/crm && test -d apps/telephony && test -d apps/helpdesk'
echo "built with in-builder commit verification and app check: owner-crm-app:$tag"

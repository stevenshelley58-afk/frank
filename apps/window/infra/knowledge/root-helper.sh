#!/usr/bin/env bash
# Versioned, zero-argument root entry point for knowledge activation.
set -euo pipefail
IFS=$' \t\n'
umask 077

readonly REPO_ROOT=/projects/frank
readonly DEPLOY=/projects/frank/apps/window/infra/knowledge/deploy.sh
readonly APPROVED=/var/lib/frank/release/approved-sha

die() { echo "frank knowledge helper: $*" >&2; exit 1; }
[[ $# -eq 0 ]] || die "arguments are not accepted"
[[ "$(id -u)" == 0 ]] || die "root is required"
[[ "$(realpath -e -- "$REPO_ROOT")" == "$REPO_ROOT" ]] || die "canonical repository is unavailable"
[[ -f "$DEPLOY" && ! -L "$DEPLOY" ]] || die "committed deploy script is unavailable"
[[ -f "$APPROVED" && ! -L "$APPROVED" ]] || die "approved Frank release receipt is unavailable"
[[ "$(stat -c '%u:%g:%a' -- "$APPROVED")" == "0:0:644" ]] || die "release receipt ownership or mode is invalid"
sha="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null)" || die "Frank revision is unavailable"
approved="$(tr -d '\n' <"$APPROVED")"
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$approved" == "$sha" ]] || die "Frank revision is not approved"

# Deliberately discard the caller's environment and shell startup files. The
# committed deploy script supplies every path and every service name itself.
exec env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C LC_ALL=C \
  FRANK_RELEASE_SHA="$sha" \
  /bin/bash --noprofile --norc "$DEPLOY"

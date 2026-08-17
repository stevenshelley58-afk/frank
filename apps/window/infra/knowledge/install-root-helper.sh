#!/usr/bin/env bash
# Install only the exact fixed helper and its exact sudo rule.
set -euo pipefail
IFS=$' \t\n'
umask 077

readonly REPO_ROOT=/projects/frank
readonly SOURCE=/projects/frank/apps/window/infra/knowledge/root-helper.sh
readonly TARGET=/usr/local/sbin/frank-knowledge-deploy
readonly SUDOERS=/etc/sudoers.d/frank-knowledge-deploy

die() { echo "frank knowledge helper install: $*" >&2; exit 1; }
[[ $# -eq 0 ]] || die "arguments are not accepted"
[[ "$(id -u)" == 0 ]] || die "root is required"
[[ "$(realpath -e -- "$REPO_ROOT")" == "$REPO_ROOT" ]] || die "canonical repository is unavailable"
[[ -f "$SOURCE" && ! -L "$SOURCE" ]] || die "committed helper is unavailable"
command -v visudo >/dev/null 2>&1 || die "visudo is required"

# Never modify an unrelated broad privilege rule. An operator must remove or
# narrow it separately, with its own rollback evidence, before this helper is
# installed.
if grep -RqsE '^[[:space:]]*[^#].*NOPASSWD:[[:space:]]*ALL([,[:space:]]|$)' /etc/sudoers /etc/sudoers.d 2>/dev/null; then
  die "broad NOPASSWD ALL rule detected; refusing to alter sudoers"
fi

install -o root -g root -m 0755 -- "$SOURCE" "$TARGET"
tmp="$(mktemp /etc/sudoers.d/.frank-knowledge-deploy.XXXXXX)"
trap 'rm -f -- "$tmp"' EXIT
printf 'root ALL=(root) NOPASSWD: %s\n' "$TARGET" >"$tmp"
chown root:root "$tmp"; chmod 0440 "$tmp"
visudo -cf "$tmp" >/dev/null || die "sudoers validation failed"
mv -f -- "$tmp" "$SUDOERS"
trap - EXIT
chown root:root "$SUDOERS"; chmod 0440 "$SUDOERS"
echo "installed fixed Frank knowledge helper"

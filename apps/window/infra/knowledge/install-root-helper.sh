#!/usr/bin/env bash
# Install only the exact fixed helper and its exact Hermes sudo rule.
set -euo pipefail
IFS=$' \t\n'
umask 077

readonly REPO_ROOT=/projects/frank
readonly SOURCE=/projects/frank/apps/window/infra/knowledge/root-helper.sh
readonly TARGET=/usr/local/sbin/frank-knowledge-deploy
readonly SUDOERS=/etc/sudoers.d/frank-knowledge-deploy
readonly HELPER_RECEIPT=/var/lib/frank/release/frank-knowledge-helper.sha256
readonly LEGACY=/etc/sudoers.d/hermes-full-access
readonly LEGACY_CONTENT='hermes ALL=(ALL:ALL) NOPASSWD: ALL'
readonly ROLLBACK_DIR=/var/lib/frank/release/sudoers-rollback

die() { echo "frank knowledge helper install: $*" >&2; exit 1; }
[[ $# -eq 0 ]] || die "arguments are not accepted"
[[ "$(id -u)" == 0 ]] || die "root is required"
[[ "$(realpath -e -- "$REPO_ROOT")" == "$REPO_ROOT" ]] || die "canonical repository is unavailable"
[[ -f "$SOURCE" && ! -L "$SOURCE" ]] || die "committed helper is unavailable"
for command_name in cmp install mktemp mv rm sha256sum stat visudo; do
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name is required"
done
[[ ! -L /etc/sudoers.d && ! -L "$ROLLBACK_DIR" ]] || die "fixed system directory is a symlink"
visudo -c >/dev/null || die "existing sudoers configuration is invalid"

install -d -o root -g root -m 0700 -- "$ROLLBACK_DIR"
[[ "$(stat -c '%u:%g:%a' -- "$ROLLBACK_DIR")" == "0:0:700" ]] || die "rollback directory ownership or mode is invalid"

legacy_present=0
legacy_removed=0
helper_backup=""
sudoers_backup=""
legacy_backup=""
receipt_backup=""
changed=0
committed=0
helper_existing=0
sudoers_existing=0
receipt_existing=0

restore_backup() {
  local backup="$1" target="$2" mode="$3"
  [[ -n "$backup" && -f "$backup" ]] || return 0
  install -o root -g root -m "$mode" -- "$backup" "$target"
}

rollback() {
  local status=$?
  rm -f -- "${helper_stage:-}" "${sudoers_stage:-}" "${receipt_stage:-}"
  [[ "$committed" == 1 || "$changed" == 0 ]] && return "$status"
  set +e
  if [[ "$legacy_removed" == 1 ]]; then
    restore_backup "$legacy_backup" "$LEGACY" 0440
  fi
  if [[ -n "$sudoers_backup" ]]; then
    restore_backup "$sudoers_backup" "$SUDOERS" 0440
  elif [[ "$changed" == 1 && "$sudoers_existing" == 0 ]]; then
    rm -f -- "$SUDOERS"
  fi
  if [[ -n "$helper_backup" ]]; then
    restore_backup "$helper_backup" "$TARGET" 0755
  elif [[ "$changed" == 1 && "$helper_existing" == 0 ]]; then
    rm -f -- "$TARGET"
  fi
  if [[ -n "$receipt_backup" ]]; then
    restore_backup "$receipt_backup" "$HELPER_RECEIPT" 0644
  elif [[ "$changed" == 1 && "$receipt_existing" == 0 ]]; then
    rm -f -- "$HELPER_RECEIPT"
  fi
  visudo -c >/dev/null 2>&1
  return "$status"
}
trap rollback EXIT INT TERM

if [[ -e "$LEGACY" || -L "$LEGACY" ]]; then
  [[ -f "$LEGACY" && ! -L "$LEGACY" ]] || die "legacy Hermes rule is not a regular file"
  [[ "$(stat -c '%u:%g' -- "$LEGACY")" == "0:0" ]] || die "legacy Hermes rule is not root-owned"
  [[ "$(wc -l <"$LEGACY" | tr -d ' ')" == 1 ]] || die "legacy Hermes rule contains unexpected entries"
  [[ "$(tr -d '\n' <"$LEGACY")" == "$LEGACY_CONTENT" ]] || die "legacy Hermes rule is not the approved sole broad rule"
  legacy_present=1
  legacy_backup="$(mktemp "$ROLLBACK_DIR/hermes-full-access.XXXXXX")"
  install -o root -g root -m 0600 -- "$LEGACY" "$legacy_backup"
fi

if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  [[ -f "$SUDOERS" && ! -L "$SUDOERS" ]] || die "fixed sudoers rule is not a regular file"
  [[ "$(tr -d '\n' <"$SUDOERS")" == "hermes ALL=(root) NOPASSWD: $TARGET" ]] || die "fixed sudoers rule has unexpected contents"
  sudoers_existing=1
  sudoers_backup="$(mktemp "$ROLLBACK_DIR/frank-knowledge-sudoers.XXXXXX")"
  install -o root -g root -m 0600 -- "$SUDOERS" "$sudoers_backup"
else
  sudoers_backup=""
fi

if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  [[ -f "$TARGET" && ! -L "$TARGET" ]] || die "fixed helper is not a regular file"
  helper_existing=1
  if ! cmp -s -- "$SOURCE" "$TARGET"; then
    helper_backup="$(mktemp "$ROLLBACK_DIR/root-helper.XXXXXX")"
    install -o root -g root -m 0755 -- "$TARGET" "$helper_backup"
  else
    helper_backup=""
  fi
else
  helper_backup=""
fi

if [[ -e "$HELPER_RECEIPT" || -L "$HELPER_RECEIPT" ]]; then
  [[ -f "$HELPER_RECEIPT" && ! -L "$HELPER_RECEIPT" ]] || die "helper checksum receipt is not a regular file"
  [[ "$(stat -c '%u:%g:%a' -- "$HELPER_RECEIPT")" == "0:0:644" ]] || die "helper checksum receipt ownership or mode is invalid"
  receipt_existing=1
  receipt_backup="$(mktemp "$ROLLBACK_DIR/frank-knowledge-helper-sha256.XXXXXX")"
  install -o root -g root -m 0600 -- "$HELPER_RECEIPT" "$receipt_backup"
fi

helper_stage="$(mktemp /usr/local/sbin/.frank-knowledge-deploy.XXXXXX)"
sudoers_stage="$(mktemp /etc/sudoers.d/.frank-knowledge-deploy.XXXXXX)"
receipt_stage="$(mktemp /var/lib/frank/release/.frank-knowledge-helper.sha256.XXXXXX)"
install -o root -g root -m 0755 -- "$SOURCE" "$helper_stage"
helper_sha="$(sha256sum "$helper_stage" | awk '{print $1}')"
printf '%s\n' "$helper_sha" >"$receipt_stage"
chown root:root "$receipt_stage"; chmod 0644 "$receipt_stage"
printf 'hermes ALL=(root) NOPASSWD: %s\n' "$TARGET" >"$sudoers_stage"
chown root:root "$sudoers_stage"; chmod 0440 "$sudoers_stage"
visudo -cf "$sudoers_stage" >/dev/null || die "sudoers rule validation failed"

changed=1
mv -f -- "$helper_stage" "$TARGET"
mv -f -- "$sudoers_stage" "$SUDOERS"
mv -f -- "$receipt_stage" "$HELPER_RECEIPT"
if [[ "$legacy_present" == 1 ]]; then
  rm -f -- "$LEGACY"
  legacy_removed=1
fi
visudo -c >/dev/null || die "resulting sudoers configuration is invalid"
committed=1
trap - EXIT INT TERM
rm -f -- "$helper_stage" "$sudoers_stage" "$receipt_stage"
echo "installed fixed Frank knowledge helper"

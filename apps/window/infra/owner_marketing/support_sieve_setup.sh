#!/usr/bin/env bash
# Reconcile only the known Mautic-reply Sieve script, appending Support routing.
set -euo pipefail
secret=/srv/frank/secrets/owner-mail.env
container=frank-owner-marketing
script=blockwise-mautic-replies
image='debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171'
backup=/srv/frank/backups/owner-mail-sieve
die(){ echo "support sieve: $*" >&2; exit 1; }
apply=0; activate=0
for arg in "$@"; do case "$arg" in --apply) apply=1;; --activate-sieve) activate=1;; *) die "unknown-argument";; esac; done
(( !activate || apply )) || die --activate-sieve-requires-apply
[[ $(id -u) -eq 0 ]] || die run-as-root
[[ -f $secret && ! -L $secret && $(stat -c '%U:%a' $secret) == root:600 ]] || die unsafe-secret
source "$secret"
[[ ${PURELYMAIL_USERNAME:-} == blockwise@purelymail.com && -n ${PURELYMAIL_PASSWORD:-} ]] || die unavailable-mailbox-credential
docker inspect "$container" >/dev/null 2>&1 || die missing-mautic-container
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cat >"$tmp/base.sieve" <<'SIEVE'
# BEGIN blockwise-mautic-replies
require ["fileinto", "copy"];
if allof(
  address :is "to" "hello@blockwise.sale",
  anyof(exists "in-reply-to", exists "references")
) {
  fileinto :copy "Mautic Replies";
}
# END blockwise-mautic-replies
SIEVE
cat >"$tmp/desired.sieve" <<'SIEVE'
# BEGIN blockwise-mautic-replies
require ["fileinto", "copy"];
if allof(
  address :is "to" "hello@blockwise.sale",
  anyof(exists "in-reply-to", exists "references")
) {
  fileinto :copy "Mautic Replies";
}
# END blockwise-mautic-replies
# BEGIN blockwise-support-folder
if address :is "to" "support@blockwise.sale" {
  fileinto "Support";
  stop;
}
# END blockwise-support-folder
SIEVE
run(){ printf %s "$PURELYMAIL_PASSWORD" | docker run --rm -i --network frank_owner_marketing_egress --env SIEVE_USER="$PURELYMAIL_USERNAME" --mount type=bind,src="$tmp",dst=/work "$image" sh -ec 'apt-get update -qq; apt-get install -y -qq ca-certificates sieve-connect=0.90-1.1 >/dev/null; exec sieve-connect --server mailserver.purelymail.com --port 4190 --user "$SIEVE_USER" --passwordfd 0 "$@"' -- "$@"; }
listed=$(run --list) || die list-failed
[[ $listed == *"$script"* ]] || die expected-owned-script-missing
run --remotesieve "$script" --localsieve /work/current.sieve --download || die download-failed
sed -i 's/\r$//' "$tmp/current.sieve"
# A Sieve fileinto target must exist before its script can be activated. This
# uses the existing private mailbox login only, and never reads or moves mail.
export PURELYMAIL_USERNAME PURELYMAIL_PASSWORD
folder_args=(); ((apply)) && folder_args+=(--create)
python3 "$(dirname "$0")/support_mailbox.py" "${folder_args[@]}" || die native-imap-support-folder-unavailable
# The exact prior owned script is the sole migration source; any other edit is
# held rather than overwritten.
if cmp -s "$tmp/current.sieve" "$tmp/desired.sieve"; then echo '{"status":"unchanged","support_folder":"checked"}'; exit 0; fi
cmp -s "$tmp/current.sieve" "$tmp/base.sieve" || die owned-script-drift-refusing-to-overwrite
run --localsieve /work/desired.sieve --checkscript || die provider-rejected-script
if (( !activate )); then echo '{"status":"sieve_held","support_folder":"checked","mail_moved":false}'; exit 0; fi
install -d -o root -g root -m 0700 "$backup"
stamp=$(date -u +%Y%m%dT%H%M%SZ); install -o root -g root -m 0600 "$tmp/current.sieve" "$backup/$script.$stamp.sieve"
run --localsieve /work/desired.sieve --remotesieve "$script" --upload || die upload-failed
run --remotesieve "$script" --activate || die activate-failed
echo '{"status":"updated","mail_moved":false,"mail_sent":false}'

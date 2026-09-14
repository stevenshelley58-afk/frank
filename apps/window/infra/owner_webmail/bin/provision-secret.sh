#!/usr/bin/env bash
# Create /srv/frank/secrets/owner-webmail.env without ever printing a value.
#
# The mailbox credential is copied from the existing owner mailbox secret into
# a dedicated, component-scoped file so the webmail client never shares a
# secret location with CRM, Mautic or Hermes. Purelymail app passwords are
# created in the Purelymail account portal, which only the owner can open; when
# the owner issues one, replace OWNER_WEBMAIL_IMAP_PASSWORD here alone and
# restart this component. Nothing else changes.
set -euo pipefail

secret_file=/srv/frank/secrets/owner-webmail.env
mail_secret=/srv/frank/secrets/owner-mail.env
sha=${OWNER_WEBMAIL_SOURCE_SHA:-$(git -C "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" rev-parse HEAD)}

die() { echo "owner-webmail secret: $*" >&2; exit 1; }
read_value() { sed -n "s/^$1=//p" "$2" | tail -n1; }

[[ -f "$mail_secret" && ! -L "$mail_secret" ]] || die "missing regular $mail_secret"
[[ "$(stat -c %a "$mail_secret")" == 600 ]] || die "$mail_secret must be mode 0600"

if [[ -f "$secret_file" && ! -L "$secret_file" ]]; then
  echo "owner-webmail.env already exists; leaving it untouched"
  exit 0
fi
[[ -e "$secret_file" ]] && die "$secret_file exists and is not a regular file"

mail_user=$(read_value PURELYMAIL_USERNAME "$mail_secret")
mail_pass=$(read_value PURELYMAIL_PASSWORD "$mail_secret")
mailbox=$(read_value OWNER_MAIL_ADDRESS "$mail_secret")
[[ -n "$mail_user" && -n "$mail_pass" && -n "$mailbox" ]] || die "owner mailbox secret is incomplete"

umask 077
tmp=$(mktemp /srv/frank/secrets/.owner-webmail.env.XXXXXX)
trap 'rm -f "$tmp"' EXIT

{
  printf 'OWNER_WEBMAIL_SOURCE_SHA=%s\n' "$sha"
  printf 'OWNER_WEBMAIL_HOST_PORT=18107\n'
  printf 'OWNER_WEBMAIL_PUBLIC_URL=https://mail.frank.fail\n'
  printf 'OWNER_WEBMAIL_IMAP_HOST=ssl://imap.purelymail.com:993\n'
  printf 'OWNER_WEBMAIL_IMAP_PLAIN_HOST=imap.purelymail.com\n'
  printf 'OWNER_WEBMAIL_SMTP_HOST=ssl://smtp.purelymail.com:465\n'
  printf 'OWNER_WEBMAIL_SMTP_PLAIN_HOST=smtp.purelymail.com\n'
  printf 'OWNER_WEBMAIL_IMAP_USER=%s\n' "$mail_user"
  printf 'OWNER_WEBMAIL_IMAP_PASSWORD=%s\n' "$mail_pass"
  printf 'OWNER_WEBMAIL_MAILBOX=%s\n' "$mailbox"
  printf 'OWNER_WEBMAIL_IDENTITIES=%s\n' "${OWNER_WEBMAIL_IDENTITIES:-hello@blockwise.sale,owner@blockwise.sale,support@blockwise.sale,steven@blockwise.sale,$mail_user}"
  printf 'OWNER_WEBMAIL_DISPLAY_NAME=%s\n' "${OWNER_WEBMAIL_DISPLAY_NAME:-Blockwise}"
  printf 'OWNER_WEBMAIL_DES_KEY=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  printf 'OWNER_WEBMAIL_INGRESS_SECRET=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  printf 'OWNER_WEBMAIL_CONSUME_SECRET=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  printf 'OWNER_WEBMAIL_OWNER_ID=%s\n' "${OWNER_WEBMAIL_OWNER_ID:-*}"
  printf 'OWNER_WEBMAIL_OWNER_HEADER=X-Frank-Owner\n'
  printf 'OWNER_WEBMAIL_TOKEN_TTL_SECONDS=120\n'
  printf 'OWNER_WEBMAIL_COOKIE_SAMESITE=%s\n' "${OWNER_WEBMAIL_COOKIE_SAMESITE:-Lax}"
  printf 'OWNER_WEBMAIL_FRAME_ANCESTORS=%s\n' "${OWNER_WEBMAIL_FRAME_ANCESTORS:-'https://frank.fail'}"
  printf 'OWNER_WEBMAIL_MAX_UPLOAD=30m\n'
  printf 'OWNER_WEBMAIL_TRUSTED_HOSTS=%s\n' "${OWNER_WEBMAIL_TRUSTED_HOSTS:-^mail\\.frank\\.fail$}"
} > "$tmp"

chown root:root "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$secret_file"
trap - EXIT
echo "wrote $secret_file (mode 0600, root-owned); no value was printed"

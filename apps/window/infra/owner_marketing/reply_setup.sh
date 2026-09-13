#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
secret_file=/srv/frank/secrets/owner-mail.env
container=frank-owner-marketing
remote_script=blockwise-mautic-replies
runner_image='debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171'
die() { printf 'owner-marketing reply setup: %s\n' "$*" >&2; exit 1; }
[[ -f "$secret_file" && ! -L "$secret_file" ]] || die missing-owner-mail-secret
[[ "$(stat -c '%U:%a' "$secret_file")" == root:600 ]] || die unsafe-owner-mail-secret-permissions
source "$secret_file"
[[ -n "${PURELYMAIL_USERNAME:-}" && -n "${PURELYMAIL_PASSWORD:-}" && -n "${OWNER_MAIL_ADDRESS:-}" ]] || die incomplete-owner-mail-secret
[[ "$OWNER_MAIL_ADDRESS" == hello@blockwise.sale ]] || die unexpected-monitored-address
docker inspect "$container" >/dev/null 2>&1 || die missing-mautic-container
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cat >"$tmp/$remote_script.sieve" <<'SIEVE'
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
run_sieve() {
  printf '%s' "$PURELYMAIL_PASSWORD" | docker run --rm -i --network frank_owner_marketing_egress --env SIEVE_USER="$PURELYMAIL_USERNAME" --mount "type=bind,src=$tmp,dst=/work" "$runner_image" sh -ec '
    apt-get update -qq
    apt-get install -y -qq ca-certificates sieve-connect=0.90-1.1 >/dev/null
    exec sieve-connect --server mailserver.purelymail.com --port 4190 --user "$SIEVE_USER" --passwordfd 0 "$@"
  ' -- "$@"
}
listed="$(run_sieve --list)" || die managesieve-list-failed
if [[ -n "$listed" && "$listed" != *"$remote_script"* ]]; then die existing-user-sieve-script-present-refusing-to-replace; fi
if [[ "$listed" == *"$remote_script"* ]]; then
  run_sieve --remotesieve "$remote_script" --localsieve "/work/$remote_script.sieve" --download >"$tmp/active.sieve" || die managesieve-download-failed
  cmp -s "$tmp/$remote_script.sieve" "$tmp/active.sieve" || die existing-owned-sieve-script-differs-refusing-to-replace
else
  run_sieve --localsieve "/work/$remote_script.sieve" --checkscript || die provider-does-not-support-required-sieve-extensions
fi
printf '%s' "$(printf '{"address":"%s","user":"%s","password":"%s"}' "$OWNER_MAIL_ADDRESS" "$PURELYMAIL_USERNAME" "$PURELYMAIL_PASSWORD")" | docker exec -i "$container" php -r '
  $input=json_decode(stream_get_contents(STDIN),true,flags:JSON_THROW_ON_ERROR); $path="/var/www/html/config/local.php"; $parameters=[]; include $path; if(!is_array($parameters))exit(2);
  $mailboxes=$parameters["monitored_email"]??[]; $mailboxes["general"]=array_merge($mailboxes["general"]??[],["address"=>$input["address"],"host"=>"mailserver.purelymail.com","port"=>"993","encryption"=>"/ssl","user"=>$input["user"],"password"=>$input["password"],"use_attachments"=>false]);
  $mailboxes["EmailBundle_replies"]=array_merge($mailboxes["EmailBundle_replies"]??[],["override_settings"=>0,"folder"=>"Mautic Replies"]); $parameters["monitored_email"]=$mailboxes;
  $mode=fileperms($path)&0777; $uid=fileowner($path); $gid=filegroup($path); $tmp=$path.".tmp.".bin2hex(random_bytes(8)); $data="<?php\n\$parameters = ".var_export($parameters,true).";\n";
  if(file_put_contents($tmp,$data,LOCK_EX)===false||!chmod($tmp,$mode)||!chown($tmp,$uid)||!chgrp($tmp,$gid)||!rename($tmp,$path)){@unlink($tmp);exit(3);}
' || die native-mautic-reply-config-failed
docker exec -u www-data -w /var/www/html/docroot "$container" php -r '
  $parameters=[];include "/var/www/html/config/local.php";$mail=$parameters["monitored_email"]["general"]??[];$base=sprintf("{%s:%s/imap%s}",$mail["host"],$mail["port"],$mail["encryption"]);$stream=@imap_open($base."INBOX",$mail["user"],$mail["password"],OP_HALFOPEN);if(!$stream)exit(2);$target=imap_utf7_encode($base."Mautic Replies");if(!imap_createmailbox($stream,$target)&&!imap_reopen($stream,$target,OP_HALFOPEN)){imap_close($stream);exit(3);}imap_close($stream);
' || die native-imap-folder-create-or-check-failed
if [[ "$listed" != *"$remote_script"* ]]; then run_sieve --localsieve "/work/$remote_script.sieve" --remotesieve "$remote_script" --upload || die managesieve-upload-failed; run_sieve --remotesieve "$remote_script" --activate || die managesieve-activate-failed; fi
docker exec -u www-data -w /var/www/html/docroot "$container" php /var/www/html/bin/console cache:clear --no-warmup --no-interaction >/dev/null || die native-config-cache-refresh-failed
"$script_dir/reply_check.sh"
printf 'native Mautic reply monitoring configured for the dedicated folder\n'

#!/usr/bin/env bash
set -euo pipefail
container=frank-owner-marketing
docker inspect "$container" >/dev/null 2>&1 || { echo 'owner-marketing reply check: missing-mautic-container' >&2; exit 1; }
docker exec "$container" php -r '
  $parameters=[];include "/var/www/html/config/local.php";$mail=$parameters["monitored_email"]??[];$general=$mail["general"]??[];$replies=$mail["EmailBundle_replies"]??[];
  if(($general["address"]??null)!=="hello@blockwise.sale"||($general["host"]??null)!=="mailserver.purelymail.com"||($general["port"]??null)!=="993"||($general["encryption"]??null)!=="/ssl"||empty($general["user"])||empty($general["password"])||($replies["folder"]??null)!=="Mautic Replies"||($replies["override_settings"]??null)!==0)exit(1);
  foreach(["EmailBundle_bounces","EmailBundle_unsubscribes"]as$key)if(!empty($mail[$key]["folder"]??null))exit(2);
' || { echo 'owner-marketing reply check: native-config-policy-failed' >&2; exit 1; }
echo 'owner-marketing native reply monitor config passed'

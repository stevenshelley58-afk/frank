#!/usr/bin/env bash
set -euo pipefail
s="$(cd -- "$(dirname -- "$0")" && pwd -P)"
secret=/srv/frank/secrets/owner-marketing/owner-marketing.env
[[ -f "$secret" && ! -L "$secret" ]] || { echo "owner-email-flows: missing owner-marketing secret" >&2; exit 2; }
[[ "$(stat -c '%U:%a' "$secret")" == root:600 ]] || { echo "owner-email-flows: unsafe secret permissions" >&2; exit 2; }
docker exec frank-owner-marketing php -r '$p="/var/www/html/config/local.php"; $parameters=[]; include $p; if (($parameters["api_enable_basic_auth"] ?? false)!==true || ($parameters["api_enabled"] ?? false)!==true) { $parameters["api_enable_basic_auth"]=true; $parameters["api_enabled"]=true; file_put_contents($p,"<?php".PHP_EOL."$"."parameters = ".var_export($parameters,true).";".PHP_EOL); }' >/dev/null
set -a; source "$secret"; set +a
python3 "$s/mautic_flows.py" apply

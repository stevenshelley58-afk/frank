#!/usr/bin/env bash
# Reconcile native Frappe OIDC and Mautic SAML. The outpost remains a separate
# owner-session gate and never impersonates an upstream user.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
repo_root=$(cd "$root_dir/../../../.." && pwd)
export OWNER_IDENTITY_SOURCE_SHA=$(git -C "$repo_root" rev-parse HEAD)
secret_file=/srv/frank/secrets/owner-identity.env
die(){ echo "provision-native: $*" >&2; exit 1; }
value(){ sed -n "s/^$1=//p" "$secret_file" | tail -n1; }
[[ -f "$secret_file" && ! -L "$secret_file" ]] || die "missing regular secret file"
[[ $(stat -c %a "$secret_file") == 600 && $(stat -c %u "$secret_file") == 0 ]] || die "secret file is unsafe"
for key in OWNER_IDENTITY_BOOTSTRAP_TOKEN OWNER_IDENTITY_HOST OWNER_CRM_ORIGIN OWNER_IDENTITY_MAUTIC_SP_ENTITY_ID OWNER_CRM_CONTAINER OWNER_CRM_SITE OWNER_MARKETING_CONTAINER; do [[ -n $(value "$key") ]] || die "$key must be set in $secret_file"; done
idp_host=$(value OWNER_IDENTITY_HOST); crm_origin=$(value OWNER_CRM_ORIGIN); crm_container=$(value OWNER_CRM_CONTAINER); crm_site=$(value OWNER_CRM_SITE); marketing_container=$(value OWNER_MARKETING_CONTAINER); token=$(value OWNER_IDENTITY_BOOTSTRAP_TOKEN)
[[ "$idp_host" =~ ^[A-Za-z0-9.-]+$ && "$crm_origin" =~ ^https://[A-Za-z0-9.-]+$ && "$crm_container" =~ ^[A-Za-z0-9_.-]+$ && "$marketing_container" =~ ^[A-Za-z0-9_.-]+$ && "$crm_site" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid native target"
docker inspect "$crm_container" >/dev/null 2>&1 || die "missing Frappe container"; docker inspect "$marketing_container" >/dev/null 2>&1 || die "missing Mautic container"
identity_container=$(docker compose --project-directory "$root_dir" --env-file "$secret_file" -f "$root_dir/compose.yaml" ps -q server)
[[ -n "$identity_container" ]] || die "owner identity server is not running"
[[ $(docker inspect -f '{{.State.Health.Status}}' "$identity_container") == healthy ]] || die "owner identity server is not healthy"
# Read bootstrap-created OAuth data only from Authentik's authenticated local API.
frappe_json=$(docker exec -i -e OWNER_IDENTITY_BOOTSTRAP_TOKEN="$token" "$identity_container" python3 - <<'PY'
import json, os
from urllib.request import Request, urlopen
h={"Authorization":"Bearer "+os.environ["OWNER_IDENTITY_BOOTSTRAP_TOKEN"]}
with urlopen(Request("http://127.0.0.1:9000/api/v3/providers/oauth2/?name=Frappe%20CRM&page_size=2",headers=h),timeout=10) as r: p=json.load(r)["results"]
if len(p)!=1: raise SystemExit("expected exactly one Frappe CRM OAuth provider")
with urlopen(Request("http://127.0.0.1:9000/api/v3/providers/oauth2/%s/"%p[0]["pk"],headers=h),timeout=10) as r: p=json.load(r)
if not p.get("client_id") or not p.get("client_secret"): raise SystemExit("Frappe CRM OAuth credential missing")
print(json.dumps({"client_id":p["client_id"],"client_secret":p["client_secret"]}))
PY
) || die "could not read Frappe OAuth credential"
frappe_client_id=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["client_id"])' <<<"$frappe_json") || die "invalid Frappe OAuth response"
frappe_client_secret=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["client_secret"])' <<<"$frappe_json") || die "invalid Frappe OAuth response"
# Install the committed, fixed-route Frappe app before reconciling its OIDC key.
# It has no provider or return URL arguments beyond crm/support and is still
# protected by the Caddy owner gate despite its guest Frappe method.
docker exec "$crm_container" test -f /home/frappe/frappe-bench/apps/frank_owner_entry/frank_owner_entry/api.py || die "Frappe native entry is not packaged in this image"
docker exec "$crm_container" bash -lc "cd /home/frappe/frappe-bench && ./env/bin/pip show frank_owner_entry >/dev/null && (bench --site '$crm_site' list-apps | grep -qx frank_owner_entry || bench --site '$crm_site' install-app frank_owner_entry)" || die "Frappe native entry installation failed"
docker exec -i -e FRAPPE_HOST_NAME="$crm_origin" -e FRAPPE_CLIENT_ID="$frappe_client_id" -e FRAPPE_CLIENT_SECRET="$frappe_client_secret" -e FRAPPE_BASE_URL="https://$idp_host/application/o/frappe-crm/" -e FRAPPE_AUTHORIZE_URL="https://$idp_host/application/o/authorize/" -e FRAPPE_TOKEN_URL="https://$idp_host/application/o/token/" -e FRAPPE_USERINFO_URL="https://$idp_host/application/o/userinfo/" "$crm_container" bash -lc "cd /home/frappe/frappe-bench && bench --site '$crm_site' console" < "$script_dir/provision-frappe-console.py" || die "Frappe OIDC provisioning failed"
# Mautic native configuration accepts base64 IdP XML. Preserve other parameters.
mautic_entity=$(value OWNER_IDENTITY_MAUTIC_SP_ENTITY_ID)
metadata_url=${OWNER_IDENTITY_MAUTIC_IDP_METADATA_URL:-"https://$idp_host/application/saml/mautic/metadata/"}
[[ "$metadata_url" =~ ^https://[A-Za-z0-9./:_-]+$ ]] || die "invalid Mautic metadata URL"
metadata=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 15 "$metadata_url") || die "could not fetch Mautic IdP metadata"
python3 -c 'import sys,xml.etree.ElementTree as e;e.fromstring(sys.stdin.buffer.read())' <<<"$metadata" || die "Mautic IdP metadata is not XML"
docker exec -i -e MAUTIC_SAML_SP_ENTITY_ID="$mautic_entity" -e MAUTIC_SAML_IDP_METADATA="$metadata" "$marketing_container" php -r '
$path="/var/www/html/config/local.php";$parameters=[];include $path;if(!is_array($parameters)||!isset($parameters["site_url"]))exit(2);$m=getenv("MAUTIC_SAML_IDP_METADATA");$e=getenv("MAUTIC_SAML_SP_ENTITY_ID");if(!$m||!$e||@simplexml_load_string($m)===false)exit(3);$w=["saml_idp_entity_id"=>$e,"saml_idp_metadata"=>base64_encode($m),"saml_idp_email_attribute"=>"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress","saml_idp_username_attribute"=>"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name","saml_idp_firstname_attribute"=>"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname","saml_idp_lastname_attribute"=>"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname","saml_idp_default_role"=>""];if(array_intersect_assoc($w,$parameters)===$w)exit(0);$parameters=array_replace($parameters,$w);$mode=fileperms($path)&0777;$uid=fileowner($path);$gid=filegroup($path);$tmp=$path.".tmp.".bin2hex(random_bytes(8));$data="<?php\n\$parameters = ".var_export($parameters,true).";\n";if(file_put_contents($tmp,$data,LOCK_EX)===false||!chmod($tmp,$mode)||!chown($tmp,$uid)||!chgrp($tmp,$gid)||!rename($tmp,$path)){@unlink($tmp);exit(4);}' || die "Mautic SAML configuration failed"
# Install the committed Mautic plugin. Its sole /s/frank/return route is
# protected by the native /s/ firewall, then redirects to one fixed bridge URL.
docker exec "$marketing_container" test -f /var/www/html/docroot/plugins/FrankOwnerEntryBundle/Config/config.php || die "Mautic native entry is not packaged in this image"
# Native cache/log directories must be writable by the web user. Provisioning
# runs privileged only to atomically update root-owned local.php; do not leave
# root-owned cache or logs for the application process.
docker exec "$marketing_container" sh -c 'install -d -o www-data -g www-data /var/www/html/var/cache /var/www/html/var/logs && chown -R www-data:www-data /var/www/html/var/cache /var/www/html/var/logs' || die "Mautic runtime directory ownership repair failed"
docker exec -u www-data -w /var/www/html/docroot "$marketing_container" php /var/www/html/bin/console cache:clear --no-warmup --no-interaction >/dev/null || die "Mautic cache refresh failed"
echo "native Frappe OIDC and Mautic SAML configuration reconciled"

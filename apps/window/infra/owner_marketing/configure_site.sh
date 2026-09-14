#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
die(){ echo "owner-marketing configure: $*" >&2; exit 1; }
secret_dir=/srv/frank/secrets/owner-marketing
env_file="$secret_dir/owner-marketing.env"
[[ -f "$env_file" && ! -L "$env_file" ]] || die missing-secret
set -a
source "$env_file"
set +a
public_url="${MAUTIC_PUBLIC_URL:-http://127.0.0.1:${MAUTIC_HOST_PORT:-18106}}"
[[ "$public_url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die invalid-public-url
docker inspect frank-owner-marketing >/dev/null 2>&1 || die missing-container
if ! docker exec frank-owner-marketing test -f /var/www/html/config/local.php; then
  echo "native Mautic is not installed; installer will use MAUTIC_PUBLIC_URL"
  exit 0
fi
ingress_ip="${MAUTIC_EXPECTED_INGRESS_IP:-$(docker inspect --format '{{(index .NetworkSettings.Networks "frank_owner_marketing_private").IPAddress}}' frank-owner-marketing-ingress)}"
[[ "$ingress_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die missing-private-ingress-address
docker exec -e EXPECTED_SITE_URL="$public_url" -e EXPECTED_INGRESS_IP="$ingress_ip" frank-owner-marketing php -r '
$path = "/var/www/html/config/local.php";
$expected = getenv("EXPECTED_SITE_URL");
$proxy = getenv("EXPECTED_INGRESS_IP");
$parameters = [];
include $path;
if (!is_array($parameters) || !isset($parameters["site_url"])) {
    exit(2);
}
if ($parameters["site_url"] === $expected && ($parameters["trusted_proxies"] ?? []) === [$proxy] && ($parameters["disable_trackable_urls"] ?? false) === true) {
    exit(0);
}
$parameters["site_url"] = $expected;
$parameters["trusted_proxies"] = [$proxy];
$parameters["disable_trackable_urls"] = true;
$mode = fileperms($path) & 0777;
$uid = fileowner($path);
$gid = filegroup($path);
$tmp = $path . ".tmp." . bin2hex(random_bytes(8));
$data = "<?php\n\$parameters = " . var_export($parameters, true) . ";\n";
if (file_put_contents($tmp, $data, LOCK_EX) === false || !chmod($tmp, $mode) || !chown($tmp, $uid) || !chgrp($tmp, $gid) || !rename($tmp, $path)) {
    @unlink($tmp);
    exit(3);
}
' || die site-url-update-failed
# local.php holds the monitored-mailbox credential, the database password and
# Mautic's secret_key in clear. Every write above preserves whatever mode the
# file already had, so a world-readable file would stay world-readable forever.
# Normalise ownership and mode on every run instead.
# 0660, not 0640: Mautic's own Configuration screen writes this file as the web
# server account, so 0640 would make that native screen fail to save. 0660 still
# removes every other local user, which was the actual defect at 0755.
local_php_mode="${OWNER_MARKETING_LOCAL_PHP_MODE:-0660}"
if docker exec frank-owner-marketing test -f /var/www/html/config/local.php; then
  docker exec frank-owner-marketing chown root:www-data /var/www/html/config/local.php
  docker exec frank-owner-marketing chmod "$local_php_mode" /var/www/html/config/local.php
fi
docker exec -u www-data -w /var/www/html/docroot frank-owner-marketing php /var/www/html/bin/console cache:clear --no-warmup --no-interaction >/dev/null || die native-config-cache-refresh-failed
echo "native Mautic site_url synchronized"

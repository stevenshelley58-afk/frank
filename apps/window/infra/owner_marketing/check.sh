#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"; compose_file="$script_dir/compose.yml"; die(){ echo "owner-marketing check: $*" >&2; exit 1; }
[[ $# -eq 0 || "${1:-}" == --preinstall ]] || die usage
preinstall="${1:-}"
cd "$script_dir/../../../.."; source_sha="$(git rev-parse HEAD)"; export MAUTIC_SOURCE_SHA="$source_sha"; [[ -z "$(git status --porcelain)" ]] || die dirty-or-untracked-source; git ls-files --error-unmatch apps/window/infra/owner_marketing/compose.yml apps/window/infra/owner_marketing/nginx.conf apps/window/infra/owner_marketing/deploy.sh apps/window/infra/owner_marketing/check.sh apps/window/infra/owner_marketing/install.sh apps/window/infra/owner_marketing/configure_site.sh >/dev/null || die untracked-source; cd "$script_dir"
secret_dir=/srv/frank/secrets/owner-marketing; env_file="$secret_dir/owner-marketing.env"; [[ -f "$env_file" && ! -L "$env_file" ]] || die missing-secret; [[ "$(stat -c '%U:%a' "$secret_dir")" == root:700 && "$(stat -c '%U:%a' "$env_file")" == root:600 ]] || die unsafe-secret-permissions
set -a; source "$env_file"; set +a
public_url="${MAUTIC_PUBLIC_URL:-http://127.0.0.1:${MAUTIC_HOST_PORT:-18106}}"
[[ "$public_url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die invalid-public-url
cfg="$(docker compose --project-name frank-owner-marketing --env-file "$env_file" -f "$compose_file" --profile owner-marketing-cron --profile owner-marketing-worker config --format json)" || die invalid-compose; printf '%s' "$cfg" | python3 -c 'import json,sys; c=json.load(sys.stdin)["services"]; assert c["ingress"]["ports"][0]["host_ip"]=="127.0.0.1"; assert "ports" not in c["mautic"]; assert c["mautic"]["environment"]["MAUTIC_DB_PORT"]=="3306"; assert c["mautic"]["environment"]["DOCKER_MAUTIC_ROLE"]=="mautic_web"; assert "MAUTIC_MAILER_DSN" in c["mautic"]["environment"]; assert c["mautic"]["environment"]["MAUTIC_URL"]==c["mautic"]["environment"]["MAUTIC_PUBLIC_URL"]; assert c["mautic"]["environment"]["MAUTIC_MAILER_APPEND_TRACKING_PIXEL"]=="false"; assert set(c["db"]["networks"])=={"owner_marketing_private"}; assert set(c["mautic"]["networks"])=={"owner_marketing_private","owner_marketing_egress"}; assert set(c["cron"]["profiles"])=={"owner-marketing-cron"} and c["cron"]["environment"]["DOCKER_MAUTIC_ROLE"]=="mautic_cron" and set(c["cron"]["networks"])=={"owner_marketing_private","owner_marketing_egress"}; assert set(c["worker"]["profiles"])=={"owner-marketing-worker"} and c["worker"]["environment"]["DOCKER_MAUTIC_ROLE"]=="mautic_worker" and c["worker"]["environment"]["DOCKER_MAUTIC_WORKERS_CONSUME_FAILED"]=="0" and c["worker"]["environment"]["MAUTIC_MAILER_APPEND_TRACKING_PIXEL"]=="false" and set(c["worker"]["networks"])=={"owner_marketing_private","owner_marketing_egress"}; assert set(c["ingress"]["networks"])=={"owner_marketing_private","owner_marketing_ingress"}' || die policy-failed
docker inspect frank-owner-marketing frank-owner-marketing-db frank-owner-marketing-ingress >/dev/null 2>&1 || die missing-containers; [[ "$(docker inspect --format '{{index .Config.Labels "org.frank.source-sha"}}' frank-owner-marketing)" == "$source_sha" ]] || die source-sha-mismatch; [[ "$(docker inspect --format '{{index .Config.Labels "org.frank.source-sha"}}' frank-owner-marketing-ingress)" == "$source_sha" ]] || die ingress-source-sha-mismatch; [[ "$(docker inspect --format '{{index .Config.Labels "org.frank.image-digest"}}' frank-owner-marketing)" == "sha256:39e967af9f154d50d1a7cbc12e6cfd5a847939c8abdcace98ab20e30570bdfda" ]] || die image-digest-mismatch; [[ "$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing)" == healthy ]] || die mautic-unhealthy; [[ "$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing-db)" == healthy ]] || die db-unhealthy; [[ "$(docker inspect --format '{{.State.Health.Status}}' frank-owner-marketing-ingress)" == healthy ]] || die ingress-unhealthy
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${MAUTIC_HOST_PORT:-18106}/" >/dev/null || die host-loopback-unreachable
if docker exec frank-owner-marketing test -f /var/www/html/config/local.php; then
  docker exec -e EXPECTED_SITE_URL="$public_url" frank-owner-marketing php -r '
  $parameters = [];
  include "/var/www/html/config/local.php";
  if (($parameters["site_url"] ?? null) !== getenv("EXPECTED_SITE_URL")) {
      exit(1);
  }
  ' || die native-site-url-mismatch
fi
[[ "$preinstall" == --preinstall ]] && { echo "healthy: private Mautic setup reachable through pinned loopback ingress"; exit 0; }
login_page="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${MAUTIC_HOST_PORT:-18106}/s/login")"; printf '%s' "$login_page" | grep -Eqi 'mautic|login|sign in' || die native-login-unavailable
auth_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "http://127.0.0.1:${MAUTIC_HOST_PORT:-18106}/s/contacts")"; [[ "$auth_status" == 302 || "$auth_status" == 303 ]] || die protected-route-not-denied
admin_cookie="$(mktemp)"; trap 'rm -f "$admin_cookie"' EXIT
login_token="$(printf '%s' "$login_page" | sed -n 's/.*name="_csrf_token" value="\([^"]*\)".*/\1/p')"; [[ -n "$login_token" ]] || die native-login-token-missing
login_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 -c "$admin_cookie" --data-urlencode '_username=owner' --data-urlencode "_password=$MAUTIC_ADMIN_PASSWORD" --data-urlencode "_csrf_token=$login_token" "http://127.0.0.1:${MAUTIC_HOST_PORT:-18106}/s/login_check")"; [[ "$login_status" == 302 || "$login_status" == 303 ]] || die native-admin-login-failed
dashboard_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 -b "$admin_cookie" "http://127.0.0.1:${MAUTIC_HOST_PORT:-18106}/s/dashboard")"; [[ "$dashboard_status" == 200 ]] || die native-admin-dashboard-unavailable
docker exec -w /var/www/html/docroot frank-owner-marketing php bin/console debug:config framework mailer --no-interaction | grep -Fq "%env(urlencoded-dsn:MAUTIC_MAILER_DSN)%" || die native-mailer-dsn-unconfigured
mailer_dsn="${MAUTIC_MAILER_DSN:-smtp://mail-sink.invalid:25}"
if [[ "$mailer_dsn" == "smtp://mail-sink.invalid:25" ]]; then
  docker exec frank-owner-marketing php -r '$u=parse_url(getenv("MAUTIC_MAILER_DSN")); if (($u["host"] ?? "") !== "mail-sink.invalid") exit(1);' || die default-mail-sink-not-preserved
else
  docker exec frank-owner-marketing php -r '$u=parse_url(getenv("MAUTIC_MAILER_DSN")); if (!in_array($u["scheme"] ?? "", ["smtp","smtps"], true) || empty($u["host"])) exit(2); $tls=($u["scheme"] === "smtps"); $port=(int)($u["port"] ?? ($tls ? 465 : 587)); $s=@fsockopen(($tls ? "ssl://" : "").$u["host"], $port, $e, $s, 10); if (!$s) exit(1); fclose($s);' || die smtp-egress-unreachable
fi
counts="$(docker exec frank-owner-marketing-db sh -lc 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -Nse "SELECT (SELECT COUNT(*) FROM leads), (SELECT COUNT(*) FROM campaigns) FROM DUAL" mautic')"; [[ "$counts" =~ ^[0-9]+[[:space:]][0-9]+$ ]] || die invalid-native-record-counts
echo "healthy: native Mautic admin login through loopback ingress, protected routes deny unauthenticated access, preserved contacts/campaigns, native runtime profile policy, mail transport policy, private backend network"

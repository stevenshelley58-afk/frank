#!/usr/bin/env bash
# Runtime health for the owner webmail component. Every check reads live state.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
secret_file=/srv/frank/secrets/owner-webmail.env
port=$(sed -n "s/^OWNER_WEBMAIL_HOST_PORT=//p" "$secret_file" | tail -n1)
sha=$(sed -n "s/^OWNER_WEBMAIL_SOURCE_SHA=//p" "$secret_file" | tail -n1)
port=${port:-18107}

fail() { echo "owner-webmail health: $*" >&2; exit 1; }
value() { docker inspect -f "{{index .Config.Labels \"io.frank.owner-webmail.applied-source-sha\"}}" "$1"; }

test -f "$secret_file" && test ! -L "$secret_file" || fail "missing regular owner webmail secret"
test "$(stat -c %a "$secret_file")" = 600 && test "$(stat -c %u "$secret_file")" = 0 || fail "secret file is not root-owned mode 0600"

for container in owner-webmail owner-webmail-launch owner-webmail-ingress; do
  test "$(docker inspect -f '{{.State.Running}}' "$container")" = true || fail "$container is not running"
  test "$(value "$container")" = "$sha" || fail "$container does not carry the applied source revision"
done

for container in owner-webmail owner-webmail-launch; do
  test "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = healthy || fail "$container is not healthy"
done

healthz=$(curl -fsS "http://127.0.0.1:$port/frank/healthz") || fail "ingress health endpoint is unreachable"
printf '%s' "$healthz" | grep -q '"service":"owner-webmail-launch"' || fail "unexpected launch health body"

# The launch broker must refuse a request that carries no authenticated owner.
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/frank/launch")
test "$code" = 401 || fail "launch route returned $code for an unauthenticated request, expected 401"

# The client itself must be the real Roundcube, not an error page.
body=$(curl -fsS "http://127.0.0.1:$port/") || fail "webmail root is unreachable"
printf '%s' "$body" | grep -qi 'roundcube' || fail "webmail root does not look like Roundcube"

docker exec owner-webmail test -s /var/www/html/config/config.docker.inc.php || fail "generated docker config is missing"
docker exec owner-webmail test -s /var/www/html/plugins/frank_sso/frank_sso.php || fail "frank_sso plugin is not mounted"
docker exec owner-webmail sh -lc 'php -l /var/www/html/plugins/frank_sso/frank_sso.php >/dev/null' || fail "frank_sso plugin does not lint inside the runtime"

docker exec owner-webmail php -r '
$expected = getenv("OWNER_WEBMAIL_IMAP_HOST");
require "/var/www/html/program/include/iniset.php";
$config = rcmail::get_instance()->config;
$actual = $config->get("imap_host");
$smtp = $config->get("smtp_host");
if ($actual !== $expected || !is_string($smtp) || $smtp === "") { fwrite(STDERR, "effective mail config mismatch\n"); exit(1); }
if ($config->get("x_frame_options") !== false) { fwrite(STDERR, "framing policy is not delegated to the ingress\n"); exit(1); }
if (!in_array("frank_sso", (array) $config->get("plugins"), true)) { fwrite(STDERR, "frank_sso is not enabled\n"); exit(1); }
' 2>/dev/null || fail "effective Roundcube configuration is not the committed one"

# The only network path to the mailbox is IMAP/SMTP over TLS.
docker exec owner-webmail php -r '
$host = getenv("OWNER_WEBMAIL_IMAP_HOST");
$parts = parse_url($host);
$socket = @stream_socket_client("ssl://" . $parts["host"] . ":" . $parts["port"], $errno, $errstr, 10, STREAM_CLIENT_CONNECT, stream_context_create(["ssl" => ["verify_peer" => true, "verify_peer_name" => true]]));
if (!$socket) { fwrite(STDERR, "imap unreachable: $errstr\n"); exit(1); }
fclose($socket);
' 2>/dev/null || fail "the mail client cannot reach Purelymail IMAP over verified TLS"

echo "owner webmail is healthy: Roundcube behind the ingress, launch broker enforcing identity, Purelymail IMAP reachable"

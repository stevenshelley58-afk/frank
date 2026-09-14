#!/usr/bin/env bash
# Runtime health for the owner webmail component. Every check reads live state.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)
secret_file=/srv/frank/secrets/owner-webmail.env
port=$(sed -n "s/^OWNER_WEBMAIL_HOST_PORT=//p" "$secret_file" | tail -n1)
root=$(cd "$script_dir/.." && pwd)
sha=$(git -C "$root" rev-parse HEAD 2>/dev/null || sed -n "s/^OWNER_WEBMAIL_SOURCE_SHA=//p" "$secret_file" | tail -n1)
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

# Query the private ingress from its own namespace; no host port is published.
healthz=$(docker exec owner-webmail-ingress wget -qO- http://127.0.0.1/frank/healthz) || fail "ingress health unavailable"
printf '%s' "$healthz" | jq -e '.ok == true and .service == "owner-webmail-launch"' >/dev/null || fail "unexpected launch health"
docker inspect owner-webmail-ingress --format '{{json .HostConfig.PortBindings}}' | grep -Eq '^(null|\{\})$' || fail "ingress must not publish host ports"

# A local process may forge the owner header but cannot mint edge attestation.
docker exec -i owner-webmail-launch python3 - <<'PY'
import urllib.request, urllib.error
req = urllib.request.Request("http://ingress/frank/launch", headers={"X-Frank-Owner": "forged-owner"})
try:
    urllib.request.urlopen(req, timeout=8)
except urllib.error.HTTPError as exc:
    assert exc.code == 403, exc.code
else:
    raise SystemExit("untrusted launch unexpectedly accepted")
PY

body=$(docker exec owner-webmail-ingress wget -qO- http://webmail/) || fail "mail client unavailable"
printf '%s' "$body" | grep -qi 'roundcube' || fail "mail client is not Roundcube"

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

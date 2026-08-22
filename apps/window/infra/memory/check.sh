#!/usr/bin/env bash
set -euo pipefail

hermes_home="${HERMES_HOME:-/home/hermes/.hermes}"
hermes_user="${HERMES_USER:-hermes}"
hermes_python="$hermes_home/hermes-agent/venv/bin/python"
hermes_cli="$hermes_home/hermes-agent/venv/bin/hermes"
config="$hermes_home/hindsight/config.json"

die() { echo "Hindsight check: $*" >&2; exit 1; }
[[ -f "$config" && ! -L "$config" ]] || die "provider config is missing"
[[ "$(stat -c '%a' -- "$config")" == 600 ]] || die "provider config must be 0600"
[[ "$(stat -c '%a' -- "$hermes_home/.env")" == 600 ]] || die "Hermes environment must be 0600"
systemctl is-active --quiet hermes-gateway.service || die "Hermes gateway is not active"
systemctl is-active --quiet hermes-serve.service || die "Hermes serve is not active"
systemctl is-active --quiet hindsight-frank-proxy.socket || die "the private Frank inspector bridge is not active"
curl --fail --silent --show-error --max-time 5 http://172.16.1.1:9178/health >/dev/null \
  || die "the private Frank inspector bridge is unavailable"

sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" \
  "$hermes_python" - "$config" <<'PY'
import importlib.metadata
import json
import sys

config = json.load(open(sys.argv[1], encoding="utf-8"))
assert config["mode"] == "local_embedded"
assert config["bank_id"] == "steven-unassigned"
assert config["bank_id_template"] == "steven-{workspace}"
assert config["auto_recall"] is True and config["auto_retain"] is True
assert importlib.metadata.version("hindsight-all") == "0.6.1"
assert importlib.metadata.version("hindsight-api-slim") == "0.6.1"
assert importlib.metadata.version("hindsight-client") == "0.6.1"
assert importlib.metadata.version("hindsight-embed") == "0.6.1"
PY

status="$(cd "$hermes_home" && sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" "$hermes_cli" memory status)"
grep -q -E 'Provider:[[:space:]]+hindsight' <<<"$status" || die "Hermes has not activated Hindsight"
grep -q 'Status:    available' <<<"$status" || die "the local provider runtime is unavailable"
echo "healthy: native provider active; bank template steven-{workspace}"

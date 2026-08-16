#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
secret_dir="${INFISICAL_SECRET_DIR:-/srv/infisical/secrets}"
runtime_file="${INFISICAL_ENV_FILE:-$secret_dir/infisical.env}"
admin_file="${INFISICAL_ADMIN_FILE:-$secret_dir/admin.env}"
token_file="${INFISICAL_ADMIN_TOKEN_FILE:-$secret_dir/.instance-bootstrap-token}"
state_file="${INFISICAL_BOOTSTRAP_STATE_FILE:-$secret_dir/hermes-bootstrap.env}"
hermes_secret_file="${HERMES_SECRET_FILE:-/srv/hermes/secrets/connections.env}"
hermes_config_file="${HERMES_CONFIG_FILE:-/home/hermes/.hermes/config.yaml}"

die() { echo "infisical instance bootstrap: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ -f "$runtime_file" && ! -L "$runtime_file" ]] || die "run deploy.sh first"
[[ -f "$hermes_config_file" && ! -L "$hermes_config_file" ]] || die "Hermes default-profile config is unavailable"

install -d -m 0700 -- "$secret_dir" "$(dirname -- "$hermes_secret_file")"
umask 077
host_port="$(awk -F= '$1 == "INFISICAL_HOST_PORT" {sub(/^[^=]*=/, ""); print; exit}' "$runtime_file")"
[[ "$host_port" =~ ^[0-9]+$ ]] || die "invalid Infisical host port"
api_url="http://127.0.0.1:$host_port"
curl --fail --silent --show-error --connect-timeout 3 "$api_url/api/status" >/dev/null || die "Infisical is not healthy on loopback"

if [[ -f "$state_file" ]] && grep -q -E '^HERMES_CONNECTIONS_INFISICAL_CLIENT_ID=[^[:space:]]' "$hermes_secret_file" 2>/dev/null; then
  rm -f -- "$token_file"
  echo "Infisical and the Hermes Universal Auth identity are already bootstrapped."
  exit 0
fi

if [[ ! -f "$token_file" ]]; then
  [[ ! -e "$admin_file" ]] || die "admin recovery file exists but Hermes bootstrap state is incomplete"
  password="$(openssl rand -base64 36 | tr -d '\n')"
  email="${INFISICAL_ADMIN_EMAIL:-infisical-admin@frank.fail}"
  organization="${INFISICAL_ADMIN_ORGANIZATION:-Frank}"
  request_file="$(mktemp "$secret_dir/.instance-request.XXXXXX")"
  response_file="$(mktemp "$secret_dir/.instance-response.XXXXXX")"
  trap 'rm -f -- "$request_file" "$response_file"' EXIT
  python3 - "$request_file" "$email" "$password" "$organization" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump({"email": sys.argv[2], "password": sys.argv[3], "organization": sys.argv[4]}, stream)
PY
  status="$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' \
    --request POST --header 'Content-Type: application/json' --data-binary "@$request_file" \
    "$api_url/api/v1/admin/bootstrap")"
  [[ "$status" == 200 || "$status" == 201 ]] || die "automated admin bootstrap failed with HTTP $status"
  python3 - "$response_file" "$token_file" <<'PY'
import json
import os
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
token = payload.get("identity", {}).get("credentials", {}).get("token", "")
if not isinstance(token, str) or len(token) < 16:
    raise SystemExit("automated bootstrap response did not include an instance-admin token")
with open(sys.argv[2], "w", encoding="utf-8") as stream:
    stream.write(token)
os.chmod(sys.argv[2], 0o600)
PY
  tmp_admin="$(mktemp "$secret_dir/.admin.env.XXXXXX")"
  printf 'INFISICAL_ADMIN_EMAIL=%s\nINFISICAL_ADMIN_PASSWORD=%s\n' "$email" "$password" >"$tmp_admin"
  chmod 0600 "$tmp_admin"
  mv "$tmp_admin" "$admin_file"
  rm -f -- "$request_file" "$response_file"
  trap - EXIT
fi

admin_token="$(cat -- "$token_file")"
[[ -n "$admin_token" ]] || die "temporary instance-admin token is empty"
INFISICAL_BOOTSTRAP_TOKEN="$admin_token" \
INFISICAL_API_URL="$api_url" \
INFISICAL_BOOTSTRAP_STATE_FILE="$state_file" \
HERMES_CONFIG_FILE="$hermes_config_file" \
HERMES_SECRET_FILE="$hermes_secret_file" \
HERMES_PYTHON="${HERMES_PYTHON:-/home/hermes/.hermes/hermes-agent/venv/bin/python}" \
  "$script_dir/bootstrap-hermes.sh"
rm -f -- "$token_file"
echo "Infisical admin recovery and the scoped Hermes identity are bootstrapped; the instance-admin token was discarded."

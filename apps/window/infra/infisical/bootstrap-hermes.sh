#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
secret_file="${INFISICAL_ENV_FILE:-/srv/infisical/secrets/infisical.env}"
secret_dir="$(dirname -- "$secret_file")"
state_file="${INFISICAL_BOOTSTRAP_STATE_FILE:-/srv/infisical/secrets/hermes-bootstrap.env}"
api_url="${INFISICAL_API_URL:-}"
admin_token="${INFISICAL_BOOTSTRAP_TOKEN:-}"
project_slug="${INFISICAL_PROJECT_SLUG:-frank-hermes-vault}"
project_name="${INFISICAL_PROJECT_NAME:-Frank Hermes Vault}"
environment_slug="${INFISICAL_ENVIRONMENT_SLUG:-production}"
environment_name="${INFISICAL_ENVIRONMENT_NAME:-Production}"
secret_path="${INFISICAL_SECRET_PATH:-/hermes}"
identity_name="${INFISICAL_IDENTITY_NAME:-hermes-vault-broker}"
role_slug="${INFISICAL_ROLE_SLUG:-hermes-vault-broker}"
hermes_secret_file="${HERMES_SECRET_FILE:-}"
hermes_config_file="${HERMES_CONFIG_FILE:-}"
connections_enabled="${INFISICAL_CONNECTIONS_ENABLED:-true}"
frank_url="${INFISICAL_FRANK_URL:-http://127.0.0.1:18080}"
resend_secret_name="${INFISICAL_RESEND_SECRET_NAME:-RESEND_API_KEY}"
bootstrap_tmp_dir=""
admin_curl_config=""
tmp_state=""
tmp_hermes=""
canary_name=""
canary_curl_config=""
canary_delete_body=""

die() { echo "infisical bootstrap: $*" >&2; exit 1; }

cleanup() {
  if [[ -n "$canary_name" && -n "$canary_curl_config" && -n "$canary_delete_body" ]]; then
    curl --config "$canary_curl_config" --silent --output /dev/null --request DELETE \
      --header 'Content-Type: application/json' --data-binary "@$canary_delete_body" \
      "$api_url/api/v4/secrets/$canary_name" >/dev/null 2>&1 || true
  fi
  [[ -z "$tmp_state" ]] || rm -f -- "$tmp_state"
  [[ -z "$tmp_hermes" ]] || rm -f -- "$tmp_hermes"
  [[ -z "$bootstrap_tmp_dir" ]] || rm -rf -- "$bootstrap_tmp_dir"
}
trap cleanup EXIT

[[ "$#" -eq 0 ]] || die "usage: HERMES_CONFIG_FILE=/home/hermes/.hermes/config.yaml HERMES_SECRET_FILE=/path/to/hermes.env $0"

command -v curl >/dev/null 2>&1 || die "missing required command: curl"
command -v python3 >/dev/null 2>&1 || die "missing required command: python3"
[[ -f "$script_dir/merge-hermes-config.py" ]] || die "missing merge-hermes-config.py"
[[ -f "$script_dir/resolve-hermes-python.sh" ]] || die "missing resolve-hermes-python.sh"
hermes_python="$(bash "$script_dir/resolve-hermes-python.sh")" || die "could not find Hermes Python with ruamel.yaml"
[[ -f "$secret_file" ]] || die "run deploy.sh first; missing $secret_file"
[[ -n "$admin_token" ]] || die "set INFISICAL_BOOTSTRAP_TOKEN for this one-time admin API session"

if [[ -z "$hermes_config_file" ]]; then
  hermes_home="${HERMES_HOME:-${HOME:-}}"
  [[ -n "$hermes_home" ]] || die "set HERMES_CONFIG_FILE to the default profile config.yaml"
  hermes_config_file="$hermes_home/config.yaml"
fi
[[ -f "$hermes_config_file" && ! -L "$hermes_config_file" ]] || die "HERMES_CONFIG_FILE must be an existing regular non-symlink file"
[[ "$connections_enabled" == true || "$connections_enabled" == false ]] || die "INFISICAL_CONNECTIONS_ENABLED must be true or false"
[[ "$frank_url" == http://127.0.0.1:18080 ]] || die "INFISICAL_FRANK_URL must be http://127.0.0.1:18080"
[[ "$resend_secret_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "INFISICAL_RESEND_SECRET_NAME must be a safe Infisical secret name"

if [[ -z "$api_url" ]]; then
  api_port="$(awk -F= '$1 == "INFISICAL_HOST_PORT" {sub(/^[^=]*=/, ""); print; exit}' "$secret_file")"
  [[ "$api_port" =~ ^[0-9]+$ ]] || die "invalid INFISICAL_HOST_PORT"
  api_url="http://127.0.0.1:$api_port"
fi
api_url="${api_url%/}"
[[ "$api_url" == http://127.0.0.1:* ]] || die "INFISICAL_API_URL must remain a loopback http URL"
api_port="${api_url#http://127.0.0.1:}"
[[ "$api_port" =~ ^[0-9]+$ ]] || die "INFISICAL_API_URL must contain a numeric port"
(( api_port >= 1024 && api_port <= 65535 )) || die "INFISICAL_API_URL port is outside the allowed range"

if [[ -n "$hermes_secret_file" ]]; then
  hermes_dir="$(dirname -- "$hermes_secret_file")"
  [[ ! -L "$hermes_secret_file" ]] || die "Hermes secret path must not be a symlink"
  if [[ -e "$hermes_secret_file" ]]; then
    [[ -f "$hermes_secret_file" && ! -L "$hermes_secret_file" ]] || die "Hermes secret path is not a regular non-symlink file"
    [[ "$(stat -c '%a' "$hermes_secret_file")" == "600" ]] || die "Hermes secret file must have mode 0600"
  fi
else
  die "set HERMES_SECRET_FILE to write credentials directly to Hermes"
fi

install -d -m 0700 -- "$secret_dir"
bootstrap_tmp_dir="$(mktemp -d "$secret_dir/.infisical-bootstrap.XXXXXX")"
chmod 0700 -- "$bootstrap_tmp_dir"
admin_curl_config="$bootstrap_tmp_dir/admin-curl.conf"
[[ "$admin_token" != *$'\r'* && "$admin_token" != *$'\n'* && "$admin_token" != *'"'* && "$admin_token" != *'\\'* ]] || die "INFISICAL_BOOTSTRAP_TOKEN contains unsupported control characters"
printf 'header = "Authorization: Bearer %s"\n' "$admin_token" >"$admin_curl_config"
chmod 0600 -- "$admin_curl_config"
unset INFISICAL_BOOTSTRAP_TOKEN admin_token

api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl --config "$admin_curl_config" --fail --silent --show-error --request "$method" \
      --header 'Content-Type: application/json' \
      --data "$body" "$api_url$path"
  else
    curl --config "$admin_curl_config" --fail --silent --show-error --request "$method" "$api_url$path"
  fi
}

write_hermes_config() {
  "$hermes_python" "$script_dir/merge-hermes-config.py" \
    --config "$hermes_config_file" \
    --enabled "$connections_enabled" \
    --frank-url "$frank_url" \
    --infisical-url "$api_url" \
    --project-id "$project_id" \
    --environment "$environment_slug" \
    --secret-path "$secret_path" \
    --resend-secret-name "$resend_secret_name"
}

prove_identity_membership() {
  membership_detail="$(api GET "/api/v1/projects/$project_id/memberships/identities/$identity_id")"
  printf '%s' "$membership_detail" | python3 -c '
import json
import sys

payload = json.load(sys.stdin).get("identityMembership", {})
project_id, identity_id, role_slug = sys.argv[1:]
identity = payload.get("identity", {})
if identity.get("projectId") not in {None, project_id}:
    raise SystemExit("identity membership points at another project")
if identity.get("id") not in {None, identity_id}:
    raise SystemExit("identity membership points at another identity")
roles = payload.get("roles", [])
if len(roles) != 1:
    raise SystemExit("Hermes identity has extra project roles or memberships")
role = roles[0]
actual_slug = role.get("customRoleSlug") or role.get("role")
if actual_slug != role_slug or role.get("isTemporary") is not False:
    raise SystemExit("Hermes identity does not have exactly one permanent custom broker role")
' "$project_id" "$identity_id" "$role_slug" || die "Hermes identity membership proof failed"
}

run_universal_auth_canary() {
  local login_body="$bootstrap_tmp_dir/universal-auth-login.json"
  local universal_auth_result="$bootstrap_tmp_dir/universal-auth-login.response"
  local create_body="$bootstrap_tmp_dir/canary-create.json"
  local update_body="$bootstrap_tmp_dir/canary-update.json"
  local delete_body="$bootstrap_tmp_dir/canary-delete.json"
  local denied_path_body="$bootstrap_tmp_dir/canary-denied-path.json"
  local denied_environment_body="$bootstrap_tmp_dir/canary-denied-environment.json"
  local denied_project_body="$bootstrap_tmp_dir/canary-denied-project.json"
  local canary_session=""

  CANARY_CLIENT_ID="$client_id" CANARY_CLIENT_SECRET="$client_secret" python3 - "$login_body" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump({"clientId": os.environ["CANARY_CLIENT_ID"], "clientSecret": os.environ["CANARY_CLIENT_SECRET"]}, stream)
PY
  chmod 0600 -- "$login_body"
  curl --fail --silent --show-error --request POST --header 'Content-Type: application/json' \
    --data-binary "@$login_body" "$api_url/api/v1/auth/universal-auth/login" >"$universal_auth_result" \
    || die "Universal Auth login canary failed"
  canary_session="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["accessToken"])' "$universal_auth_result")"
  [[ -n "$canary_session" ]] || die "Universal Auth login canary returned no session credential"
  [[ "$canary_session" != *$'\r'* && "$canary_session" != *$'\n'* && "$canary_session" != *'"'* && "$canary_session" != *'\\'* ]] || die "Universal Auth session credential contains unsupported control characters"
  canary_curl_config="$bootstrap_tmp_dir/canary-curl.conf"
  printf 'header = "Authorization: Bearer %s"\n' "$canary_session" >"$canary_curl_config"
  chmod 0600 -- "$canary_curl_config"

  canary_name="frank_hermes_bootstrap_canary_${BASHPID}"
  CANARY_PROJECT_ID="$project_id" CANARY_ENVIRONMENT="$environment_slug" CANARY_SECRET_PATH="$secret_path" python3 - "$create_body" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump({
        "projectId": os.environ["CANARY_PROJECT_ID"],
        "environment": os.environ["CANARY_ENVIRONMENT"],
        "secretValue": "bootstrap-canary",
        "secretPath": os.environ["CANARY_SECRET_PATH"],
        "type": "shared",
    }, stream)
PY
  chmod 0600 -- "$create_body"
  machine_request POST "/api/v4/secrets/$canary_name" "$create_body" >/dev/null || die "Universal Auth CRUD canary create failed"
  canary_delete_body="$delete_body"

  machine_request GET "/api/v4/secrets/$canary_name?projectId=$project_id&environment=$environment_slug&secretPath=$secret_path&viewSecretValue=false" "" >/dev/null || die "Universal Auth CRUD canary read failed"

  CANARY_PROJECT_ID="$project_id" CANARY_ENVIRONMENT="$environment_slug" CANARY_SECRET_PATH="$secret_path" python3 - "$update_body" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump({
        "projectId": os.environ["CANARY_PROJECT_ID"],
        "environment": os.environ["CANARY_ENVIRONMENT"],
        "secretValue": "bootstrap-canary-updated",
        "secretPath": os.environ["CANARY_SECRET_PATH"],
        "type": "shared",
    }, stream)
PY
  chmod 0600 -- "$update_body"
  machine_request PATCH "/api/v4/secrets/$canary_name" "$update_body" >/dev/null || die "Universal Auth CRUD canary edit failed"

  CANARY_PROJECT_ID="$project_id" CANARY_ENVIRONMENT="$environment_slug" CANARY_SECRET_PATH="$secret_path" python3 - "$delete_body" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump({
        "projectId": os.environ["CANARY_PROJECT_ID"],
        "environment": os.environ["CANARY_ENVIRONMENT"],
        "secretPath": os.environ["CANARY_SECRET_PATH"],
        "type": "shared",
    }, stream)
PY
  chmod 0600 -- "$delete_body"
  machine_request DELETE "/api/v4/secrets/$canary_name" "$delete_body" >/dev/null || die "Universal Auth CRUD canary delete failed"
  canary_name=""
  canary_delete_body=""

  for denied_kind in path environment project; do
    case "$denied_kind" in
      path)
        denied_body="$denied_path_body"
        denied_path="/hermes-denied"
        denied_project="$project_id"
        denied_environment="$environment_slug"
        ;;
      environment)
        denied_body="$denied_environment_body"
        denied_path="$secret_path"
        denied_project="$project_id"
        denied_environment="development"
        ;;
      project)
        denied_body="$denied_project_body"
        denied_path="$secret_path"
        denied_project="00000000-0000-0000-0000-000000000000"
        denied_environment="$environment_slug"
        ;;
    esac
    CANARY_PROJECT_ID="$denied_project" CANARY_ENVIRONMENT="$denied_environment" CANARY_SECRET_PATH="$denied_path" python3 - "$denied_body" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "w", encoding="utf-8") as stream:
    json.dump({
        "projectId": os.environ["CANARY_PROJECT_ID"],
        "environment": os.environ["CANARY_ENVIRONMENT"],
        "secretValue": "bootstrap-denied-canary",
        "secretPath": os.environ["CANARY_SECRET_PATH"],
        "type": "shared",
    }, stream)
PY
    chmod 0600 -- "$denied_body"
    expect_machine_denied POST "/api/v4/secrets/frank_hermes_denied_canary" "$denied_body" || die "Universal Auth canary unexpectedly allowed another $denied_kind"
  done
  echo "Universal Auth canary passed: CRUD allowed only at $environment_slug:$secret_path; other path/environment/project denied." >&2
}

machine_request() {
  local method="$1" path="$2" body_file="${3:-}"
  if [[ -n "$body_file" ]]; then
    curl --config "$canary_curl_config" --fail --silent --show-error --request "$method" \
      --header 'Content-Type: application/json' --data-binary "@$body_file" "$api_url$path"
  else
    curl --config "$canary_curl_config" --fail --silent --show-error --request "$method" "$api_url$path"
  fi
}

expect_machine_denied() {
  local method="$1" path="$2" body_file="$3" status
  status="$(curl --config "$canary_curl_config" --silent --output /dev/null --write-out '%{http_code}' \
    --request "$method" --header 'Content-Type: application/json' --data-binary "@$body_file" "$api_url$path")" || return 1
  [[ "$status" =~ ^[45][0-9][0-9]$ ]]
}

write_hermes_credentials() {
  local handoff_client_id="$1"
  local handoff_client_secret="$2"
  if [[ -n "$hermes_secret_file" ]]; then
    install -d -m 0700 -- "$hermes_dir"
    tmp_hermes="$(mktemp "$hermes_dir/.connections.XXXXXX")"
    if [[ -f "$hermes_secret_file" ]]; then
      # Keep unrelated credentials and comments, but remove every behavioral
      # Connections setting so config.yaml remains the sole settings source.
      awk -F= '!($1 ~ /^HERMES_CONNECTIONS_(ENABLED|FRANK_URL|RESEND_SECRET_NAME)$/ || $1 ~ /^HERMES_CONNECTIONS_INFISICAL_(URL|PROJECT_ID|ENVIRONMENT|SECRET_PATH|CLIENT_ID|CLIENT_SECRET)$/) {print}' "$hermes_secret_file" >"$tmp_hermes"
    fi
    printf 'HERMES_CONNECTIONS_INFISICAL_CLIENT_ID=%s\n' "$handoff_client_id" >>"$tmp_hermes"
    printf 'HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET=%s\n' "$handoff_client_secret" >>"$tmp_hermes"
    chmod 0600 -- "$tmp_hermes"
    mv -- "$tmp_hermes" "$hermes_secret_file"
    tmp_hermes=""
    echo "Wrote Hermes Universal Auth client credentials to $hermes_secret_file (0600); access tokens remain in Hermes memory." >&2
  else
    die "HERMES_SECRET_FILE is required; refusing to print client credentials"
  fi
}

write_state() {
  install -d -m 0700 -- "$(dirname -- "$state_file")"
  tmp_state="$(mktemp "$(dirname -- "$state_file")/.hermes-bootstrap.XXXXXX")"
  cat >"$tmp_state" <<EOF
INFISICAL_PROJECT_ID=$project_id
INFISICAL_ENVIRONMENT=$environment_slug
INFISICAL_SECRET_PATH=$secret_path
INFISICAL_IDENTITY_ID=$identity_id
INFISICAL_CLIENT_ID=$client_id
EOF
  chmod 0600 -- "$tmp_state"
  mv -- "$tmp_state" "$state_file"
  tmp_state=""
}

json_find_id() {
  python3 -c '
import json
import sys

payload = json.load(sys.stdin)
kind, field, wanted = sys.argv[1:]
for item in payload.get(kind, []):
    if item.get(field) == wanted:
        print(item.get("id", ""))
        break
' "$@"
}

project_list="$(api GET '/api/v1/projects')"
project_id="$(printf '%s' "$project_list" | json_find_id projects slug "$project_slug")"
if [[ -z "$project_id" ]]; then
  project_payload="$(python3 -c 'import json,sys; print(json.dumps({"projectName":sys.argv[1],"projectDescription":"Private secrets for the Hermes vault broker.","slug":sys.argv[2],"type":"secret-manager","shouldCreateDefaultEnvs":False,"hasDeleteProtection":True}))' "$project_name" "$project_slug")"
  project_response="$(api POST '/api/v1/projects' "$project_payload")"
  project_id="$(printf '%s' "$project_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["id"])')"
fi

project_detail="$(api GET "/api/v1/projects/$project_id")"
environment_id="$(printf '%s' "$project_detail" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
wanted = sys.argv[1]
project = payload.get("project", payload)
for item in project.get("environments", []):
    if item.get("slug") == wanted:
        print(item.get("id", ""))
        break
' "$environment_slug")"
if [[ -z "$environment_id" ]]; then
  environment_payload="$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"slug":sys.argv[2],"position":1}))' "$environment_name" "$environment_slug")"
  environment_response="$(api POST "/api/v1/projects/$project_id/environments" "$environment_payload")"
  environment_id="$(printf '%s' "$environment_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["environment"]["id"])')"
fi
[[ -n "$environment_id" ]] || die "could not resolve the $environment_slug environment"

role_list="$(api GET "/api/v1/projects/$project_id/roles")"
role_id="$(printf '%s' "$role_list" | json_find_id roles slug "$role_slug")"
if [[ -z "$role_id" ]]; then
  role_payload="$(python3 -c '
import json
import sys

slug, environment, secret_path = sys.argv[1:]
conditions = {"environment": environment, "secretPath": secret_path}
print(json.dumps({
    "slug": slug,
    "name": "Hermes Vault Broker",
    "description": "CRUD secret values only under the Hermes production path.",
    "permissions": [
        {"subject": "secrets", "action": "read", "conditions": conditions},
        {"subject": "secrets", "action": "create", "conditions": conditions},
        {"subject": "secrets", "action": "edit", "conditions": conditions},
        {"subject": "secrets", "action": "delete", "conditions": conditions},
        {"subject": "secret-folders", "action": "read", "conditions": conditions},
    ],
}))
' "$role_slug" "$environment_slug" "$secret_path")"
  role_response="$(api POST "/api/v1/projects/$project_id/roles" "$role_payload")"
  role_id="$(printf '%s' "$role_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["role"]["id"])')"
fi
[[ -n "$role_id" ]] || die "could not resolve the $role_slug project role"
role_detail="$(api GET "/api/v1/projects/$project_id/roles/slug/$role_slug")"
printf '%s' "$role_detail" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
environment, secret_path = sys.argv[1:]
expected = {
    ("secrets", "read", environment, secret_path),
    ("secrets", "create", environment, secret_path),
    ("secrets", "edit", environment, secret_path),
    ("secrets", "delete", environment, secret_path),
    ("secret-folders", "read", environment, secret_path),
}
actual = set()
for permission in payload.get("role", payload).get("permissions", []):
    conditions = permission.get("conditions") or {}
    actual.add((permission.get("subject"), permission.get("action"), conditions.get("environment"), conditions.get("secretPath")))
if actual != expected:
    raise SystemExit("existing Hermes role does not exactly match the fixed CRUD policy")
' "$environment_slug" "$secret_path" || die "Hermes role policy validation failed"

identity_list="$(api GET "/api/v1/projects/$project_id/identities")"
identity_id="$(printf '%s' "$identity_list" | json_find_id identities name "$identity_name")"
if [[ -z "$identity_id" ]]; then
  identity_payload="$(python3 -c 'import json,sys; print(json.dumps({"name":sys.argv[1],"hasDeleteProtection":True}))' "$identity_name")"
  identity_response="$(api POST "/api/v1/projects/$project_id/identities" "$identity_payload")"
  identity_id="$(printf '%s' "$identity_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["identity"]["id"])')"
  membership_payload="$(python3 -c 'import json,sys; print(json.dumps({"roles":[{"role":sys.argv[1],"isTemporary":False}]}))' "$role_slug")"
  api POST "/api/v1/projects/$project_id/memberships/identities/$identity_id" "$membership_payload" >/dev/null
else
  if [[ ! -f "$state_file" ]]; then
    [[ -n "$hermes_secret_file" && -f "$hermes_secret_file" ]] || die "identity already exists but bootstrap state is absent; refusing to create another credential"
    client_id="$(awk -F= '$1 == "HERMES_CONNECTIONS_INFISICAL_CLIENT_ID" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
    client_secret="$(awk -F= '$1 == "HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
    [[ -n "$client_id" && -n "$client_secret" ]] || die "existing Hermes secret file lacks Universal Auth credentials; refusing to create another credential"
    write_state
  fi
fi

prove_identity_membership
write_hermes_config

if [[ -f "$state_file" ]]; then
  # The client secret is intentionally never persisted here; it belongs only in Hermes.
  client_id="$(awk -F= '$1 == "INFISICAL_CLIENT_ID" {sub(/^[^=]*=/, ""); print; exit}' "$state_file")"
  [[ -n "$client_id" ]] || die "bootstrap state has no client ID"
  [[ -n "$hermes_secret_file" && -f "$hermes_secret_file" ]] || die "bootstrap state exists; refusing to print or recreate the client secret"
  client_secret="$(awk -F= '$1 == "HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
  [[ -n "$client_secret" ]] || die "Hermes secret file has no client secret; refusing to recreate it"
  write_hermes_credentials "$client_id" "$client_secret"
  echo "Hermes identity already bootstrapped; no new client secret was created."
else
  auth_response="$(api POST "/api/v1/auth/universal-auth/identities/$identity_id" '{"accessTokenTTL":3600,"accessTokenMaxTTL":3600,"accessTokenNumUsesLimit":0,"accessTokenPeriod":0,"lockoutEnabled":true,"lockoutThreshold":3,"lockoutDurationSeconds":300,"lockoutCounterResetSeconds":30}')"
  client_id="$(printf '%s' "$auth_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["identityUniversalAuth"]["clientId"])')"
  client_response="$(api POST "/api/v1/auth/universal-auth/identities/$identity_id/client-secrets" '{"description":"Hermes host vault broker","numUsesLimit":0,"ttl":0}')"
  client_secret="$(printf '%s' "$client_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["clientSecret"])')"
  write_hermes_credentials "$client_id" "$client_secret"
  write_state
  echo "The admin token and client secret were not written to Frank or this bundle; Hermes obtains access tokens in memory." >&2
fi

run_universal_auth_canary
unset client_secret

echo "bootstrap identity=$identity_id project=$project_id environment=$environment_slug path=$secret_path role=$role_slug" >&2

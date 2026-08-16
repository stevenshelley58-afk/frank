#!/usr/bin/env bash
set -euo pipefail

secret_file="${INFISICAL_ENV_FILE:-/srv/infisical/secrets/infisical.env}"
state_file="${INFISICAL_BOOTSTRAP_STATE_FILE:-/srv/infisical/secrets/hermes-bootstrap.env}"
api_url="${INFISICAL_API_URL:-}"
admin_token="${INFISICAL_BOOTSTRAP_TOKEN:-}"
project_slug="${INFISICAL_PROJECT_SLUG:-frank-hermes-vault}"
project_name="${INFISICAL_PROJECT_NAME:-Frank Hermes Vault}"
environment_slug="${INFISICAL_ENVIRONMENT_SLUG:-production}"
environment_name="${INFISICAL_ENVIRONMENT_NAME:-Production}"
secret_path="${INFISICAL_SECRET_PATH:-/hermes}"
identity_name="${INFISICAL_IDENTITY_NAME:-hermes-vault-broker}"
role_slug="${INFISICAL_ROLE_SLUG:-hermes-vault-reader}"
hermes_secret_file="${HERMES_SECRET_FILE:-}"

die() { echo "infisical bootstrap: $*" >&2; exit 1; }

emit_once=false
if [[ "${1:-}" == "--emit-once" ]]; then
  emit_once=true
  shift
fi
[[ "$#" -eq 0 ]] || die "usage: HERMES_SECRET_FILE=/path/to/hermes.env $0 [--emit-once]"

command -v curl >/dev/null 2>&1 || die "missing required command: curl"
command -v python3 >/dev/null 2>&1 || die "missing required command: python3"
[[ -f "$secret_file" ]] || die "run deploy.sh first; missing $secret_file"
[[ -n "$admin_token" ]] || die "set INFISICAL_BOOTSTRAP_TOKEN for this one-time admin API session"

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
  if [[ -e "$hermes_secret_file" ]]; then
    [[ -f "$hermes_secret_file" ]] || die "Hermes secret path is not a regular file"
    [[ "$(stat -c '%a' "$hermes_secret_file")" == "600" ]] || die "Hermes secret file must have mode 0600"
  fi
elif [[ "$emit_once" != true ]]; then
  die "set HERMES_SECRET_FILE to write directly to Hermes, or pass --emit-once for an explicit one-time handoff"
fi

api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl --fail --silent --show-error --request "$method" \
      --header "Authorization: Bearer $admin_token" \
      --header 'Content-Type: application/json' \
      --data "$body" "$api_url$path"
  else
    curl --fail --silent --show-error --request "$method" \
      --header "Authorization: Bearer $admin_token" "$api_url$path"
  fi
}

write_state() {
  install -d -m 0700 -- "$(dirname -- "$state_file")"
  tmp_state="$(mktemp "$(dirname -- "$state_file")/.hermes-bootstrap.XXXXXX")"
  trap 'rm -f -- "$tmp_state"' EXIT
  cat >"$tmp_state" <<EOF
INFISICAL_PROJECT_ID=$project_id
INFISICAL_ENVIRONMENT=$environment_slug
INFISICAL_SECRET_PATH=$secret_path
INFISICAL_IDENTITY_ID=$identity_id
INFISICAL_CLIENT_ID=$client_id
EOF
  chmod 0600 -- "$tmp_state"
  mv -- "$tmp_state" "$state_file"
  trap - EXIT
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
    "name": "Hermes Vault Reader",
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
    [[ -n "$client_id" ]] || die "existing Hermes secret file has no client ID; refusing to create another credential"
    write_state
  fi
fi

if [[ -f "$state_file" ]]; then
  # The client secret is intentionally never persisted here; it belongs only in Hermes.
  client_id="$(awk -F= '$1 == "INFISICAL_CLIENT_ID" {sub(/^[^=]*=/, ""); print; exit}' "$state_file")"
  [[ -n "$client_id" ]] || die "bootstrap state has no client ID"
  [[ -n "$hermes_secret_file" && -f "$hermes_secret_file" ]] || die "bootstrap state exists; refusing to print or recreate the client secret"
  echo "Hermes identity already bootstrapped; no new client secret was created."
else
  auth_response="$(api POST "/api/v1/auth/universal-auth/identities/$identity_id" '{"accessTokenTTL":3600,"accessTokenMaxTTL":3600,"accessTokenNumUsesLimit":0,"accessTokenPeriod":0,"lockoutEnabled":true,"lockoutThreshold":3,"lockoutDurationSeconds":300,"lockoutCounterResetSeconds":30}')"
  client_id="$(printf '%s' "$auth_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["identityUniversalAuth"]["clientId"])')"
  client_response="$(api POST "/api/v1/auth/universal-auth/identities/$identity_id/client-secrets" '{"description":"Hermes host vault broker","numUsesLimit":0,"ttl":0}')"
  client_secret="$(printf '%s' "$client_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["clientSecret"])')"
  if [[ -n "$hermes_secret_file" ]]; then
    install -d -m 0700 -- "$hermes_dir"
    tmp_hermes="$(mktemp "$hermes_dir/.connections.XXXXXX")"
    trap 'rm -f -- "$tmp_hermes"' EXIT
    if [[ -f "$hermes_secret_file" ]]; then
      awk -F= '!($1 ~ /^HERMES_CONNECTIONS_INFISICAL_(URL|PROJECT_ID|ENVIRONMENT|SECRET_PATH|CLIENT_ID|CLIENT_SECRET)$/) {print}' "$hermes_secret_file" >"$tmp_hermes"
    fi
    cat >>"$tmp_hermes" <<EOF
HERMES_CONNECTIONS_INFISICAL_URL=$api_url
HERMES_CONNECTIONS_INFISICAL_PROJECT_ID=$project_id
HERMES_CONNECTIONS_INFISICAL_ENVIRONMENT=$environment_slug
HERMES_CONNECTIONS_INFISICAL_SECRET_PATH=$secret_path
HERMES_CONNECTIONS_INFISICAL_CLIENT_ID=$client_id
HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET=$client_secret
EOF
    chmod 0600 -- "$tmp_hermes"
    mv -- "$tmp_hermes" "$hermes_secret_file"
    trap - EXIT
    echo "Wrote the Hermes Universal Auth client credentials to $hermes_secret_file (0600); access tokens remain in Hermes memory." >&2
  elif [[ "$emit_once" == true ]]; then
    echo "Explicit one-time handoff; store these values in Hermes' 0600 secret file and do not log them:" >&2
    printf 'HERMES_CONNECTIONS_INFISICAL_URL=%s\n' "$api_url"
    printf 'HERMES_CONNECTIONS_INFISICAL_PROJECT_ID=%s\n' "$project_id"
    printf 'HERMES_CONNECTIONS_INFISICAL_ENVIRONMENT=%s\n' "$environment_slug"
    printf 'HERMES_CONNECTIONS_INFISICAL_SECRET_PATH=%s\n' "$secret_path"
    printf 'HERMES_CONNECTIONS_INFISICAL_CLIENT_ID=%s\n' "$client_id"
    printf 'HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET=%s\n' "$client_secret"
  else
    die "unreachable credential handoff state"
  fi
  write_state
  echo "The admin token and client secret were not written to Frank or this bundle; Hermes obtains access tokens in memory." >&2
fi

echo "bootstrap identity=$identity_id project=$project_id environment=$environment_slug path=$secret_path role=$role_slug" >&2

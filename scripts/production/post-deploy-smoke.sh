#!/usr/bin/env bash

# Read-only HTTPS smoke checks for the public health surface and authenticated app.

set +x
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="$(basename -- "${BASH_SOURCE[0]}")"

log() {
  local -r level="$1"
  shift
  printf '%s %s %s: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$PROGRAM_NAME" "$*" >&2
}

die() {
  log ERROR "$*"
  exit 1
}

on_error() {
  local -r status="$1"
  local -r line="$2"
  log ERROR "failed at line ${line} with exit status ${status}"
  return "$status"
}

trap 'on_error "$?" "$LINENO"' ERR

require_command() {
  local -r command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "required command is unavailable: $command_name"
}

for command_name in basename chmod curl date grep jq mktemp rm stat; do
  require_command "$command_name"
done

readonly configured_public_url="${FRANK_PUBLIC_URL:-https://frank.fail}"
readonly expected_service="${FRANK_EXPECTED_SERVICE:-frank-api}"
readonly expected_web_pattern="${FRANK_WEB_EXPECTED_PATTERN:-}"
readonly basic_auth_user="${FRANK_BASIC_AUTH_USER:-}"
readonly basic_auth_password="${FRANK_BASIC_AUTH_PASSWORD:-}"

(( EUID == 0 )) || die "post-deploy smoke must run as root so its temporary credential file is root-only"
[[ "$configured_public_url" == https://* ]] || die "FRANK_PUBLIC_URL must use HTTPS"
[[ "$configured_public_url" != *"@"* ]] || die "FRANK_PUBLIC_URL must not contain credentials"
[[ "$configured_public_url" != *"?"* && "$configured_public_url" != *"#"* ]] || die "FRANK_PUBLIC_URL must not contain a query or fragment"
[[ -n "$basic_auth_user" ]] || die "FRANK_BASIC_AUTH_USER is required"
[[ -n "$basic_auth_password" ]] || die "FRANK_BASIC_AUTH_PASSWORD is required"
[[ "$basic_auth_user" != *:* ]] || die "FRANK_BASIC_AUTH_USER must not contain a colon"
[[ "$basic_auth_user" != *$'\r'* && "$basic_auth_user" != *$'\n'* ]] || die "FRANK_BASIC_AUTH_USER must not contain a newline"
[[ "$basic_auth_password" != *$'\r'* && "$basic_auth_password" != *$'\n'* ]] || die "FRANK_BASIC_AUTH_PASSWORD must not contain a newline"

public_url="${configured_public_url%/}"
authority="${public_url#https://}"
[[ -n "$authority" && "$authority" != */* ]] || die "FRANK_PUBLIC_URL must be an origin without a path"
readonly public_url authority

tmp_dir="$(mktemp -d)"
cleanup() {
  local -r status="$?"
  trap - EXIT
  if [[ -n "${tmp_dir:-}" && -d "$tmp_dir" ]]; then
    case "$tmp_dir" in
      /tmp/*|/var/tmp/*)
        rm -r --one-file-system -- "$tmp_dir"
        ;;
      *)
        log ERROR "refusing to remove unexpected temporary path"
        ;;
    esac
  fi
  exit "$status"
}
trap cleanup EXIT

curl_config_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

# Keep the plaintext Basic Auth credential out of argv, stdout, and stderr. The
# containing directory and file are mode 0700/0600 because umask is restrictive.
readonly auth_config="$tmp_dir/auth.curlrc"
printf 'basic\nuser = "%s:%s"\n' \
  "$(curl_config_escape "$basic_auth_user")" \
  "$(curl_config_escape "$basic_auth_password")" \
  > "$auth_config"
chmod 0600 -- "$auth_config"

readonly -a curl_args=(
  --disable
  --silent
  --show-error
  --location
  --proto '=https'
  --proto-redir '=https'
  --tlsv1.2
  --connect-timeout 5
  --max-time 20
  --retry 4
  --retry-delay 2
  --retry-max-time 90
  --retry-all-errors
)

HTTP_CODE=""
HTTP_TIME=""
HTTP_CONTENT_TYPE=""

public_get() {
  local -r label="$1"
  local -r url="$2"
  local -r body_file="$3"
  local -r expected_code="$4"
  local -r auth_mode="$5"
  local result=""
  local -a request_args=()

  if [[ "$auth_mode" == "authenticated" ]]; then
    request_args+=(--config "$auth_config")
  elif [[ "$auth_mode" != "anonymous" ]]; then
    die "internal error: invalid authentication mode"
  fi

  if ! result="$(curl "${curl_args[@]}" "${request_args[@]}" \
    --output "$body_file" \
    --write-out '%{http_code}|%{time_total}|%{content_type}' \
    "$url")"; then
    die "$label request failed"
  fi

  IFS='|' read -r HTTP_CODE HTTP_TIME HTTP_CONTENT_TYPE <<< "$result"
  [[ "$HTTP_CODE" == "$expected_code" ]] || die "$label returned HTTP $HTTP_CODE, expected $expected_code"
  log INFO "$label returned expected HTTP $expected_code in ${HTTP_TIME}s"
}

readonly live_body="$tmp_dir/live.json"
readonly ready_body="$tmp_dir/ready.json"
readonly anonymous_root_body="$tmp_dir/root-anonymous.txt"
readonly web_body="$tmp_dir/web.html"

public_get "API liveness" "$public_url/v1/system/live" "$live_body" "200" "anonymous"
[[ -s "$live_body" ]] || die "API liveness returned an empty body"
[[ "$HTTP_CONTENT_TYPE" == application/json* ]] || die "API liveness did not return JSON"
jq -e --arg service "$expected_service" \
  '.live == true and .service == $service and (.checked_at | type == "string")' \
  "$live_body" >/dev/null || die "API liveness payload failed validation"
readonly live_time="$HTTP_TIME"

public_get "API readiness" "$public_url/v1/system/ready" "$ready_body" "200" "anonymous"
[[ -s "$ready_body" ]] || die "API readiness returned an empty body"
[[ "$HTTP_CONTENT_TYPE" == application/json* ]] || die "API readiness did not return JSON"
jq -e \
  '.ready == true and .state == "healthy" and (.blocking | type == "array") and (.blocking | length == 0)' \
  "$ready_body" >/dev/null || die "API readiness payload failed validation"
readonly ready_time="$HTTP_TIME"

public_get "unauthenticated web root" "$public_url/" "$anonymous_root_body" "401" "anonymous"
readonly root_unauth_time="$HTTP_TIME"

public_get "authenticated web root" "$public_url/" "$web_body" "200" "authenticated"
[[ -s "$web_body" ]] || die "authenticated web root returned an empty body"
[[ "$HTTP_CONTENT_TYPE" == text/html* ]] || die "web root did not return HTML"
if [[ -n "$expected_web_pattern" ]]; then
  grep -Fq -- "$expected_web_pattern" "$web_body" || die "web root did not contain FRANK_WEB_EXPECTED_PATTERN"
fi
readonly web_time="$HTTP_TIME"
readonly web_bytes="$(stat -c '%s' "$web_body")"
readonly checked_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

log INFO "post-deploy edge and authenticated application smoke checks passed"
printf 'smoke=passed\n'
printf 'checked_at_utc=%s\n' "$checked_at"
printf 'public_url=%s\n' "$public_url"
printf 'live_http=200\n'
printf 'live_seconds=%s\n' "$live_time"
printf 'ready_http=200\n'
printf 'ready_seconds=%s\n' "$ready_time"
printf 'root_unauth_http=401\n'
printf 'root_unauth_seconds=%s\n' "$root_unauth_time"
printf 'root_auth_http=200\n'
printf 'root_auth_seconds=%s\n' "$web_time"
printf 'web_bytes=%s\n' "$web_bytes"

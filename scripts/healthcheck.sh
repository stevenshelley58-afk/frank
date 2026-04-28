#!/usr/bin/env bash
set -euo pipefail

read_env() {
  key="$1"
  default="$2"
  if [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//')"
  else
    value=""
  fi
  printf '%s' "${value:-$default}"
}

WEB_PORT="$(read_env WEB_PORT 3000)"
API_PORT="$(read_env API_PORT 8080)"
POSTGRES_DB="$(read_env POSTGRES_DB frank)"
POSTGRES_USER="$(read_env POSTGRES_USER frank)"
POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD "")"
CLOUDFLARE_ACCESS_ENABLED="$(read_env CLOUDFLARE_ACCESS_ENABLED false)"

API_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"

echo "Checking API health..."
curl -fsS "${API_URL}/healthz" >/dev/null

echo "Checking web dashboard..."
curl -fsS "${WEB_URL}/" | grep -q '<div id="root">'

if [ "${CLOUDFLARE_ACCESS_ENABLED}" = "true" ]; then
  status_code="$(curl -sS -o /dev/null -w '%{http_code}' "${API_URL}/v1/system/status")"
  case "$status_code" in
    401|503)
      echo "Protected route fails closed without Cloudflare Access JWT (HTTP ${status_code})."
      ;;
    *)
      echo "Expected /v1/system/status to reject missing Access JWT, got HTTP ${status_code}." >&2
      exit 1
      ;;
  esac
fi

echo "Checking database seeds..."
role_count="$(docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc "select count(*) from model_roles;")"
provider_count="$(docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc "select count(*) from provider_registry;")"
audit_count="$(docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc "select count(*) from audit_log where action in ('api.startup','worker.startup');")"

if [ "$role_count" != "17" ]; then
  echo "Expected 17 model roles, found ${role_count}." >&2
  exit 1
fi

if [ "$provider_count" != "15" ]; then
  echo "Expected 15 providers, found ${provider_count}." >&2
  exit 1
fi

if [ "$audit_count" -lt "2" ]; then
  echo "Expected API and worker startup audit events, found ${audit_count}." >&2
  exit 1
fi

echo "Frank Hub healthcheck passed."

#!/usr/bin/env bash
set -euo pipefail

read_env() {
  key="$1"
  default="$2"
  value=""
  if [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//')"
  fi
  printf '%s' "${value:-$default}"
}

json_field_count() {
  if command -v node >/dev/null 2>&1; then
    node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);const a=j.data||j.models||[];console.log(Array.isArray(a)?a.length:0)}catch{console.log(0)}});"
  else
    cat >/dev/null
    printf '0\n'
  fi
}

HERMES_ENABLED="$(read_env HERMES_ENABLED false)"
HERMES_API_BASE_URL="$(read_env HERMES_API_BASE_URL http://127.0.0.1:8642)"
HERMES_API_SERVER_KEY="$(read_env HERMES_API_SERVER_KEY "")"

echo "Hermes enabled: ${HERMES_ENABLED}"

if [ "${HERMES_ENABLED}" != "true" ]; then
  echo "Hermes is disabled. Set HERMES_ENABLED=true after configuring the private gateway."
  exit 0
fi

if [ -z "${HERMES_API_SERVER_KEY}" ]; then
  echo "Hermes is enabled but HERMES_API_SERVER_KEY is missing." >&2
  exit 1
fi

echo "Hermes API base URL: ${HERMES_API_BASE_URL}"
echo "Hermes API key: configured (redacted)"

if [ -f docker-compose.hermes.yml ]; then
  echo "Checking Hermes compose configuration..."
  docker compose -f docker-compose.yml -f docker-compose.hermes.yml --env-file .env config >/dev/null
else
  echo "docker-compose.hermes.yml is missing." >&2
  exit 1
fi

echo "Checking Hermes health endpoint..."
curl -fsS \
  -H "Authorization: Bearer ${HERMES_API_SERVER_KEY}" \
  "${HERMES_API_BASE_URL%/}/health" >/dev/null

echo "Checking Hermes models endpoint..."
models_json="$(curl -fsS \
  -H "Authorization: Bearer ${HERMES_API_SERVER_KEY}" \
  "${HERMES_API_BASE_URL%/}/v1/models")"
model_count="$(printf '%s' "${models_json}" | json_field_count)"

echo "Hermes reachable: true"
echo "Hermes models discovered: ${model_count}"

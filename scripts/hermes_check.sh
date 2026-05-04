#!/usr/bin/env bash
set -euo pipefail

read_env() {
  key="$1"
  default="$2"
  value=""
  if [ -f .env ]; then
    value="$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' || true)"
  fi
  access_file="$(grep -E "^FRANK_ACCESS_ENV_FILE=" .env 2>/dev/null | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' || true)"
  if [ -n "${access_file}" ] && [ -f "${access_file}" ]; then
    access_value="$(grep -E "^${key}=" "${access_file}" | tail -n 1 | cut -d '=' -f 2- | sed -e 's/^"//' -e 's/"$//' || true)"
    value="${access_value:-$value}"
  fi
  printf '%s' "${value:-$default}"
}

HERMES_ENABLED="$(read_env HERMES_ENABLED false)"
HERMES_API_BASE_URL="$(read_env HERMES_API_BASE_URL http://hermes:8642)"
HERMES_API_SERVER_KEY="$(read_env HERMES_API_SERVER_KEY "")"
WEBHOOK_ENABLED="$(read_env WEBHOOK_ENABLED false)"
HERMES_WEBHOOK_BASE_URL="$(read_env HERMES_WEBHOOK_BASE_URL http://hermes:8644)"

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

compose=(docker compose -f docker-compose.yml -f docker-compose.hermes.yml --env-file .env)

if [ -f docker-compose.hermes.yml ]; then
  echo "Checking Hermes compose configuration..."
  "${compose[@]}" config >/dev/null
else
  echo "docker-compose.hermes.yml is missing." >&2
  exit 1
fi

echo "Checking Hermes health and models from the API container network..."
model_count="$(
  "${compose[@]}" exec -T \
    -e HERMES_API_BASE_URL="${HERMES_API_BASE_URL}" \
    -e HERMES_API_SERVER_KEY="${HERMES_API_SERVER_KEY}" \
    api \
    node -e '
      const base = process.env.HERMES_API_BASE_URL.replace(/\/$/, "");
      const key = process.env.HERMES_API_SERVER_KEY;
      const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
      const fail = (message) => { console.error(message); process.exit(1); };
      const readJson = async (path) => {
        const response = await fetch(`${base}${path}`, { headers });
        if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
        return response.json();
      };
      const main = async () => {
        await readJson("/health");
        const models = await readJson("/v1/models");
        const list = Array.isArray(models.data) ? models.data : Array.isArray(models.models) ? models.models : [];
        console.log(list.length);
      };
      main().catch((error) => fail(error instanceof Error ? error.message : "Hermes check failed."));
    '
)"

echo "Hermes reachable: true"
echo "Hermes models discovered: ${model_count}"

if [ "${WEBHOOK_ENABLED}" = "true" ]; then
  echo "Checking Hermes webhook health from the API container network..."
  "${compose[@]}" exec -T \
    -e HERMES_WEBHOOK_BASE_URL="${HERMES_WEBHOOK_BASE_URL}" \
    api \
    node -e '
      const base = process.env.HERMES_WEBHOOK_BASE_URL.replace(/\/$/, "");
      fetch(`${base}/health`)
        .then((response) => {
          if (!response.ok) {
            console.error(`/health returned HTTP ${response.status}`);
            process.exit(1);
          }
          console.log("Hermes webhook reachable: true");
        })
        .catch((error) => {
          console.error(error instanceof Error ? error.message : "Hermes webhook check failed.");
          process.exit(1);
        });
    '
fi

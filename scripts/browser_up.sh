#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and edit VPS values first." >&2
  exit 1
fi

mkdir -p runtime/browser

read_env_value() {
  local key="$1"
  awk -F= -v key="$key" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      value = $0
      sub("^[^=]*=", "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^"|"$/, "", value)
      gsub(/^'\''|'\''$/, "", value)
      print value
      exit
    }
  ' .env
}

configured_app_url="${FRANK_BROWSER_APP_URL:-$(read_env_value FRANK_BROWSER_APP_URL)}"
legacy_app_args="${FRANK_BROWSER_APP_ARGS:-$(read_env_value FRANK_BROWSER_APP_ARGS)}"
target_url="${1:-${configured_app_url:-${legacy_app_args:-https://chatgpt.com}}}"

configured_browser_image="${FRANK_BROWSER_IMAGE:-$(read_env_value FRANK_BROWSER_IMAGE)}"
browser_image="${configured_browser_image:-jlesage/chromium:latest}"
case "${browser_image}" in
  jlesage/chrome|jlesage/chrome:*)
    browser_image="jlesage/chromium:latest"
    echo "FRANK_BROWSER_IMAGE uses the retired jlesage/chrome image; using ${browser_image}." >&2
    ;;
esac

FRANK_BROWSER_IMAGE="${browser_image}" FRANK_BROWSER_APP_URL="${target_url}" docker compose \
  -f docker-compose.yml \
  -f docker-compose.browser.yml \
  --env-file .env \
  up -d --no-recreate browser

echo "Frank VPS browser requested at /vps-browser/ for ${target_url}."

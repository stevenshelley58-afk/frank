#!/usr/bin/env bash
set -euo pipefail

hermes_secret_file="${HERMES_SECRET_FILE:-/srv/hermes/secrets/connections.env}"
frank_secret_file="${FRANK_SECRET_FILE:-/srv/frank/secrets/window.env}"

die() { echo "hermes connections check: $*" >&2; exit 1; }
[[ -f "$hermes_secret_file" && "$(stat -c '%a' "$hermes_secret_file")" == 600 ]] || die "Hermes secret file is missing or not 0600"
for key in HERMES_CONNECTIONS_AGENT_KEY HERMES_VAULT_BROKER_KEY HERMES_CONNECTIONS_INFISICAL_CLIENT_ID HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET; do
  grep -q -E "^${key}=[^[:space:]]" "$hermes_secret_file" || die "missing $key"
done
for key in HERMES_CONNECTIONS_AGENT_KEY HERMES_VAULT_BROKER_KEY HERMES_VAULT_BROKER_URL; do
  grep -q -E "^${key}=[^[:space:]]" "$frank_secret_file" || die "Frank is missing $key"
done
[[ "$(awk -F= '$1 == "HERMES_VAULT_BROKER_URL" {print $2; exit}' "$frank_secret_file")" == http://172.16.1.1:18083 ]] || die "Frank broker URL is not on the private Docker gateway"
systemctl is-active --quiet hermes-frank-vault-broker.service || die "vault broker service is not active"
systemctl is-active --quiet hermes-gateway.service || die "Hermes gateway is not active"
systemctl is-active --quiet hermes-serve.service || die "Hermes serve is not active"
ss -ltn | awk '$4 == "172.16.1.1:18083" {found=1} END {exit !found}' || die "vault broker is not bound to the private Docker gateway"
curl --fail --silent --show-error --connect-timeout 3 http://172.16.1.1:18083/secrets/health >/dev/null 2>&1 && die "unauthenticated broker health unexpectedly succeeded"
broker_key="$(awk -F= '$1 == "HERMES_VAULT_BROKER_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
curl --fail --silent --show-error --connect-timeout 3 \
  --header "Authorization: Bearer $broker_key" --header 'X-Hermes-Profile: default' \
  http://172.16.1.1:18083/secrets/health | python3 -c 'import json,sys; payload=json.load(sys.stdin); assert payload.get("status") == "verified"' \
  || die "authenticated broker health failed"
echo "healthy: Hermes plugin configured, broker active, credentials present"

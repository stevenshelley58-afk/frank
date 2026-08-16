#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd -P)"
hermes_home="${HERMES_HOME:-/home/hermes/.hermes}"
hermes_user="${HERMES_USER:-hermes}"
hermes_group="${HERMES_GROUP:-hermes}"
hermes_secret_file="${HERMES_SECRET_FILE:-/srv/hermes/secrets/connections.env}"
frank_secret_file="${FRANK_SECRET_FILE:-/srv/frank/secrets/window.env}"
runtime_dir="${HERMES_FRANK_RUNTIME_DIR:-/srv/frank/hermes-connections}"

die() { echo "hermes connections deploy: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ -f "$repo_root/.git/HEAD" || -d "$repo_root/.git" ]] || die "run from the committed Frank checkout"
[[ -f "$script_dir/broker.py" && -f "$script_dir/plugin/plugin.yaml" ]] || die "deployment bundle is incomplete"
id "$hermes_user" >/dev/null 2>&1 || die "Hermes user does not exist"
command -v openssl >/dev/null 2>&1 || die "openssl is required"
command -v systemctl >/dev/null 2>&1 || die "systemd is required"
command -v sudo >/dev/null 2>&1 || die "sudo is required"
[[ -f "$hermes_home/config.yaml" && ! -L "$hermes_home/config.yaml" ]] || die "Hermes config is unavailable"
[[ -f "$frank_secret_file" && ! -L "$frank_secret_file" ]] || die "Frank secret file is unavailable"

install -d -o "$hermes_user" -g "$hermes_group" -m 0700 -- "$(dirname -- "$hermes_secret_file")"
touch "$hermes_secret_file"
chown "$hermes_user:$hermes_group" "$hermes_secret_file"
chmod 0600 "$hermes_secret_file"

ensure_secret() {
  local key="$1" value tmp
  value="$(awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
  if [[ -z "$value" ]]; then
    value="$(openssl rand -hex 32)"
    tmp="$(mktemp "$(dirname -- "$hermes_secret_file")/.connections.XXXXXX")"
    awk -F= -v wanted="$key" '$1 != wanted {print}' "$hermes_secret_file" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
    chown "$hermes_user:$hermes_group" "$tmp"
    chmod 0600 "$tmp"
    mv "$tmp" "$hermes_secret_file"
  fi
}

ensure_secret HERMES_CONNECTIONS_AGENT_KEY
ensure_secret HERMES_VAULT_BROKER_KEY

install -d -o root -g root -m 0755 -- "$runtime_dir"
install -o root -g root -m 0644 -- "$script_dir/broker.py" "$runtime_dir/broker.py"
install -d -o "$hermes_user" -g "$hermes_group" -m 0755 -- "$hermes_home/plugins/connections-agent"
install -o "$hermes_user" -g "$hermes_group" -m 0644 -- "$script_dir/plugin/plugin.yaml" "$hermes_home/plugins/connections-agent/plugin.yaml"
install -o "$hermes_user" -g "$hermes_group" -m 0644 -- "$script_dir/plugin/__init__.py" "$hermes_home/plugins/connections-agent/__init__.py"
install -o root -g root -m 0644 -- "$script_dir/hermes-frank-vault-broker.service" /etc/systemd/system/hermes-frank-vault-broker.service

install -d -o root -g root -m 0755 -- /etc/systemd/system/hermes-gateway.service.d /etc/systemd/system/hermes-serve.service.d
for unit in hermes-gateway.service hermes-serve.service; do
  printf '[Service]\nEnvironmentFile=%s\n' "$hermes_secret_file" >"/etc/systemd/system/$unit.d/frank-connections.conf"
  chmod 0644 "/etc/systemd/system/$unit.d/frank-connections.conf"
done

agent_key="$(awk -F= '$1 == "HERMES_CONNECTIONS_AGENT_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
broker_key="$(awk -F= '$1 == "HERMES_VAULT_BROKER_KEY" {sub(/^[^=]*=/, ""); print; exit}' "$hermes_secret_file")"
sudo -u "$hermes_user" -H env HERMES_CONNECTIONS_AGENT_KEY="$agent_key" \
  HERMES_HOME="$hermes_home" \
  "$hermes_home/hermes-agent/venv/bin/python" -m hermes_cli.main plugins enable connections-agent >/dev/null
tmp_frank="$(mktemp "$(dirname -- "$frank_secret_file")/.window.XXXXXX")"
awk -F= '!($1 == "HERMES_CONNECTIONS_AGENT_KEY" || $1 == "HERMES_VAULT_BROKER_KEY" || $1 == "HERMES_VAULT_BROKER_URL") {print}' "$frank_secret_file" >"$tmp_frank"
printf 'HERMES_CONNECTIONS_AGENT_KEY=%s\nHERMES_VAULT_BROKER_KEY=%s\nHERMES_VAULT_BROKER_URL=http://172.16.1.1:18083\n' "$agent_key" "$broker_key" >>"$tmp_frank"
chmod 0600 "$tmp_frank"
mv "$tmp_frank" "$frank_secret_file"

systemctl daemon-reload
systemctl enable --now hermes-frank-vault-broker.service
systemctl restart hermes-gateway.service hermes-serve.service
echo "Hermes Connections Agent and loopback vault broker are enabled."

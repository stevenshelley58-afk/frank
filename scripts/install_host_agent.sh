#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_name="frank-host-agent"
service_user="${FRANK_HOST_AGENT_SERVICE_USER:-${SUDO_USER:-$(id -un)}}"
pnpm_bin="$(command -v pnpm || true)"
node_bin="$(command -v node || true)"
bridge_ip="$(ip -4 addr show docker0 2>/dev/null | awk '/inet / { print $2 }' | cut -d/ -f1 | head -n 1 || true)"
host="${FRANK_HOST_AGENT_HOST:-${bridge_ip:-127.0.0.1}}"
port="${FRANK_HOST_AGENT_PORT:-8787}"

if [ "$(id -u)" -eq 0 ]; then
  sudo_cmd=()
else
  sudo_cmd=(sudo)
fi

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file
  tmp_file="$(mktemp)"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (updated == 0) {
        print key "=" value
      }
    }
  ' "${file}" > "${tmp_file}"
  mv "${tmp_file}" "${file}"
}

if [ -z "${pnpm_bin}" ] || [ -z "${node_bin}" ]; then
  echo "node and pnpm are required. Run scripts/install_ai_tools.sh first." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate FRANK_HOST_AGENT_TOKEN." >&2
  exit 1
fi

if [ ! -f "${repo_dir}/runtime/access/frank-access.env" ]; then
  mkdir -p "${repo_dir}/runtime/access"
  touch "${repo_dir}/runtime/access/frank-access.env"
  chmod 0600 "${repo_dir}/runtime/access/frank-access.env"
fi

if ! grep -q '^FRANK_HOST_AGENT_TOKEN=' "${repo_dir}/runtime/access/frank-access.env"; then
  token="$(openssl rand -hex 32)"
  {
    echo ""
    echo "FRANK_HOST_AGENT_TOKEN=${token}"
  } >> "${repo_dir}/runtime/access/frank-access.env"
  chmod 0600 "${repo_dir}/runtime/access/frank-access.env"
  echo "Generated FRANK_HOST_AGENT_TOKEN in runtime/access/frank-access.env."
fi

upsert_env_var "${repo_dir}/runtime/access/frank-access.env" "FRANK_HOST_AGENT_ENABLED" "true"
upsert_env_var "${repo_dir}/runtime/access/frank-access.env" "FRANK_HOST_AGENT_BASE_URL" "http://${host}:${port}"

"${sudo_cmd[@]}" chown "${service_user}" "${repo_dir}/runtime/access" "${repo_dir}/runtime/access/frank-access.env"
chmod 0700 "${repo_dir}/runtime/access"
chmod 0600 "${repo_dir}/runtime/access/frank-access.env"

cd "${repo_dir}"
pnpm --filter @frank/host-agent build

"${sudo_cmd[@]}" tee "/etc/systemd/system/${service_name}.service" >/dev/null <<SERVICE
[Unit]
Description=Frank Host Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${service_user}
WorkingDirectory=${repo_dir}
EnvironmentFile=-${repo_dir}/.env
EnvironmentFile=-${repo_dir}/runtime/access/frank-access.env
Environment=FRANK_HOST_AGENT_HOST=${host}
Environment=FRANK_HOST_AGENT_PORT=${port}
Environment=FRANK_HOST_AGENT_REPO=${repo_dir}
ExecStart=${pnpm_bin} --dir ${repo_dir} --filter @frank/host-agent start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

"${sudo_cmd[@]}" systemctl daemon-reload
"${sudo_cmd[@]}" systemctl enable --now "${service_name}"

echo "Frank Host Agent installed as ${service_name} on ${host}:${port}."
echo "FRANK_HOST_AGENT_ENABLED, FRANK_HOST_AGENT_BASE_URL, and FRANK_HOST_AGENT_TOKEN are set in runtime/access/frank-access.env."
echo "Redeploy or restart the API so the container reads the updated runtime access env."

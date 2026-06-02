#!/usr/bin/env bash
set -euo pipefail

data_dir="${AIONUI_DATA_DIR:-/data}"
log_dir="${AIONUI_LOG_DIR:-${data_dir}/logs}"
access_dir="${FRANK_AIONUI_ACCESS_DIR:-/access}"
credentials_path="${FRANK_AIONUI_CREDENTIALS_PATH:-${access_dir}/aionui-admin.json}"

mkdir -p "${data_dir}" "${log_dir}" "${access_dir}"
touch "${log_dir}/aionui-web.stdout.log"
chmod 0600 "${log_dir}/aionui-web.stdout.log" 2>/dev/null || true

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_credentials() {
  local username="$1"
  local password="$2"
  local tmp_path="${credentials_path}.tmp"
  if [ -z "${password}" ]; then
    return
  fi
  umask 077
  mkdir -p "$(dirname "${credentials_path}")"
  printf '{"username":"%s","password":"%s","generatedAt":"%s"}\n' \
    "$(json_escape "${username}")" \
    "$(json_escape "${password}")" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${tmp_path}"
  mv "${tmp_path}" "${credentials_path}"
  chmod 0600 "${credentials_path}" 2>/dev/null || true
}

username="${AIONUI_ADMIN_USERNAME:-admin}"
password=""

/opt/aionui-web/aionui-web start 2>&1 | while IFS= read -r line; do
  redacted_line="${line}"
  case "${line}" in
    *"Initial admin username:"*)
      username="${line##*Initial admin username: }"
      ;;
    *"Log in with username \""*)
      username="${line#*Log in with username \"}"
      username="${username%%\"*}"
      ;;
  esac
  case "${line}" in
    *"Generated initial admin password:"*)
      password="${line##*Generated initial admin password: }"
      redacted_line="[aionui-web] Generated initial admin password: [redacted]"
      write_credentials "${username}" "${password}"
      ;;
    *"Initial admin password:"*)
      password="${line##*Initial admin password: }"
      redacted_line="Initial admin password: [redacted]"
      write_credentials "${username}" "${password}"
      ;;
  esac
  printf '%s\n' "${redacted_line}"
  printf '%s\n' "${redacted_line}" >> "${log_dir}/aionui-web.stdout.log"
done

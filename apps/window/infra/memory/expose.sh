#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd -P)"
socket_unit="/etc/systemd/system/hindsight-frank-proxy.socket"
service_unit="/etc/systemd/system/hindsight-frank-proxy.service"

die() { echo "Hindsight inspector bridge: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ "$(realpath -e -- "$repo_root")" == "/projects/frank" ]] || die "run from the canonical Frank checkout"
git -C "$repo_root" diff --quiet HEAD -- || die "refusing an uncommitted Frank revision"
[[ -x /lib/systemd/systemd-socket-proxyd ]] || die "systemd socket proxy is unavailable"
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:9177/health >/dev/null \
  || die "the loopback Hindsight API is unavailable"

install -o root -g root -m 0644 -- "$script_dir/hindsight-frank-proxy.socket" "$socket_unit"
install -o root -g root -m 0644 -- "$script_dir/hindsight-frank-proxy.service" "$service_unit"
systemctl daemon-reload
systemctl enable hindsight-frank-proxy.socket >/dev/null
systemctl stop hindsight-frank-proxy.service
systemctl restart hindsight-frank-proxy.socket
curl --fail --silent --show-error --max-time 5 http://172.16.1.1:9178/health >/dev/null \
  || die "the private Frank Hindsight bridge is unavailable"
echo "Hindsight inspector bridge is available only on the Frank Docker network."

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd -P)"
hermes_home="${HERMES_HOME:-/home/hermes/.hermes}"
hermes_user="${HERMES_USER:-hermes}"
hermes_python="$hermes_home/hermes-agent/venv/bin/python"
hermes_cli="$hermes_home/hermes-agent/venv/bin/hermes"
hindsight_embed="$hermes_home/hermes-agent/venv/bin/hindsight-embed"
uv_bin="$hermes_home/bin/uv"

die() { echo "Hindsight deploy: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ "$(realpath -e -- "$repo_root")" == "/projects/frank" ]] || die "run from the canonical Frank checkout"
git -C "$repo_root" diff --quiet HEAD -- || die "refusing an uncommitted Frank revision"
id "$hermes_user" >/dev/null 2>&1 || die "Hermes user does not exist"
[[ -x "$hermes_python" && -x "$hermes_cli" && -x "$hindsight_embed" && -x "$uv_bin" ]] || die "Hermes runtime is incomplete"
[[ -f "$hermes_home/config.yaml" && ! -L "$hermes_home/config.yaml" ]] || die "Hermes config is unavailable"
[[ -f "$hermes_home/.env" && ! -L "$hermes_home/.env" ]] || die "Hermes secret environment is unavailable"

# Hermes 0.20.1 pins this client version at runtime. Pin the whole vendor suite
# to the same release so Hermes cannot create a mixed, incompatible install.
sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" \
  "$uv_bin" pip install --python "$hermes_python" \
  "hindsight-all==0.6.1" "hindsight-api-slim==0.6.1" \
  "hindsight-client==0.6.1" "hindsight-embed==0.6.1"

sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" \
  "$hermes_python" "$script_dir/configure.py" \
  --template "$script_dir/hindsight-config.json" --hermes-home "$hermes_home"
sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" \
  "$hermes_cli" config set memory.provider hindsight >/dev/null

systemctl restart hermes-gateway.service hermes-serve.service
# Start the vendor-owned embedded daemon explicitly after Hermes has stopped its
# previous instance. Under a queued consolidation load the vendor start command
# can time out after the daemon is already healthy, so confirm that false-negative
# with the vendor status command. expose.sh still enforces the real health probe.
if ! sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" \
  "$hindsight_embed" --profile hermes daemon start; then
  sudo -u "$hermes_user" -H env HERMES_HOME="$hermes_home" \
    "$hindsight_embed" --profile hermes daemon status \
    || die "the embedded Hindsight daemon failed to start"
fi
bash "$script_dir/expose.sh"
"$script_dir/check.sh"
echo "Hindsight is active for workspace-derived project banks."

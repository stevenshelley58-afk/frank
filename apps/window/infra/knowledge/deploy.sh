#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../../../.." && pwd -P)"
install_root="/opt/frank-knowledge/codewiki"
venv="$install_root/venv"
codewiki_revision="00138da6ab25f0b0aad58d42c74a97d78b6547a7"

die() { echo "Frank project knowledge: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ "$(realpath -e -- "$repo_root")" == "/projects/frank" ]] || die "run from the canonical Frank checkout"
git -C "$repo_root" diff --quiet HEAD -- || die "refusing an uncommitted Frank revision"
command -v git >/dev/null || die "git is unavailable"
command -v node >/dev/null || die "Node.js is unavailable"
command -v codex >/dev/null || die "Codex CLI is unavailable"

uv_bin="$(command -v uv || true)"
[[ -n "$uv_bin" ]] || uv_bin="/home/hermes/.local/bin/uv"
python_bin="$(command -v python3.12 || true)"
[[ -n "$python_bin" ]] || die "Python 3.12 is unavailable"

install -d -o root -g root -m 0755 -- "$install_root"
if [[ ! -x "$venv/bin/python" ]]; then
  if [[ -x "$uv_bin" ]]; then
    "$uv_bin" venv --python 3.12 "$venv"
  else
    "$python_bin" -m venv "$venv"
  fi
fi
if [[ -x "$uv_bin" ]]; then
  "$uv_bin" pip install --python "$venv/bin/python" \
    "git+https://github.com/FSoft-AI4Code/CodeWiki.git@$codewiki_revision"
else
  "$venv/bin/python" -m pip install --disable-pip-version-check \
    "git+https://github.com/FSoft-AI4Code/CodeWiki.git@$codewiki_revision"
fi

install -o root -g root -m 0755 -- "$script_dir/generate.sh" /usr/local/sbin/frank-project-wiki
CODEWIKI_NO_KEYRING=1 "$venv/bin/codewiki" config set \
  --provider codex \
  --main-model "${FRANK_CODEWIKI_MAIN_MODEL:-gpt-5.4}" \
  --cluster-model "${FRANK_CODEWIKI_CLUSTER_MODEL:-gpt-5.4}" >/dev/null
"$venv/bin/codewiki" --version
echo "installed: FSoft CodeWiki $codewiki_revision"

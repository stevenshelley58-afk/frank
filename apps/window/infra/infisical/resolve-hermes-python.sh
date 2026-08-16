#!/usr/bin/env bash
set -euo pipefail

die() { echo "resolve Hermes Python: $*" >&2; exit 1; }

check_candidate() {
  local candidate="$1"
  [[ -x "$candidate" ]] || return 1
  "$candidate" -c 'import ruamel.yaml' >/dev/null 2>&1 || return 1
  printf '%s\n' "$candidate"
  return 0
}

resolve_command() {
  local requested="$1"
  if [[ "$requested" == */* ]]; then
    printf '%s\n' "$requested"
  else
    command -v "$requested" || true
  fi
}

if [[ -n "${HERMES_PYTHON:-}" ]]; then
  explicit="$(resolve_command "$HERMES_PYTHON")"
  [[ -n "$explicit" ]] || die "HERMES_PYTHON is not executable: $HERMES_PYTHON"
  check_candidate "$explicit" || die "HERMES_PYTHON lacks ruamel.yaml: $explicit"
  exit 0
fi

declare -a candidates=()
if [[ -n "${HERMES_INSTALL_DIR:-}" ]]; then
  candidates+=("$HERMES_INSTALL_DIR/venv/bin/python")
fi
if [[ -n "${HERMES_HOME:-}" ]]; then
  candidates+=("$HERMES_HOME/venv/bin/python" "$HERMES_HOME/venvs/hermes-dev/bin/python")
fi
if [[ -n "${HOME:-}" ]]; then
  # The Hermes installer documents ~/.hermes/venvs/hermes-dev as its managed
  # development/runtime venv location when the checkout is external.
  candidates+=("$HOME/.hermes/venvs/hermes-dev/bin/python")
fi
system_python="$(command -v python3 || true)"
[[ -n "$system_python" ]] && candidates+=("$system_python")

for candidate in "${candidates[@]}"; do
  if check_candidate "$candidate"; then
    exit 0
  fi
done

die "no candidate Python imports ruamel.yaml; set HERMES_PYTHON to the production Hermes venv interpreter (no packages are installed)"

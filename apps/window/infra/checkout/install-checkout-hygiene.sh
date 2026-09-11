#!/usr/bin/env bash
# Install the Frank checkout-hygiene contract on the host.
#
# Two things have to be true or the commit guard silently never runs, and git
# reports neither: every parent directory of the hook must be readable and
# executable by the account the agent runs as, and the hook itself must be
# executable. Git skips a hook it cannot execute without a word.
#
# So this script creates the session-worktree parent with a mode that actually
# lets agent accounts write in it, points the canonical repository at the
# versioned hooks, and then verifies all of it as a real agent account instead of
# assuming the configuration took effect.
set -Eeuo pipefail

readonly CANONICAL="${FRANK_CHECKOUT_CANONICAL:-/projects/frank}"
readonly SESSION_PARENT="${FRANK_CHECKOUT_SESSION_PARENT:-/projects/frank-worktrees}"
readonly LOG_FILE="${FRANK_CHECKOUT_LOG:-/srv/frank/checkout-hygiene.log}"
readonly GROUP="${FRANK_CHECKOUT_GROUP:-hermes}"
readonly HOOKS_DIR="$CANONICAL/apps/window/infra/checkout/githooks"
readonly UNIT_DIR="${FRANK_CHECKOUT_UNIT_DIR:-/etc/systemd/system}"
readonly UNITS=(
  frank-checkout-sweep.service
  frank-checkout-sweep.timer
  frank-checkout-prune.service
  frank-checkout-prune.timer
)

[[ "$(id -u)" == "0" ]] || {
  printf 'checkout-hygiene installation requires root\n' >&2
  exit 1
}

[[ -d "$HOOKS_DIR" ]] || {
  printf 'missing versioned hooks directory: %s\n' "$HOOKS_DIR" >&2
  exit 1
}

# The session-worktree parent. setgid so worktrees inherit the agent group, and
# group-writable so every agent account that works on Frank can claim one without
# going through root. root keeps ownership so a release can always repair it.
install -d -o root -g "$GROUP" -m 2775 -- "$SESSION_PARENT"

# The sweep, the prune and the deploy trigger all append here.
install -d -o root -g root -m 0755 -- "$(dirname -- "$LOG_FILE")"
[[ -e "$LOG_FILE" ]] || install -o root -g root -m 0644 -- /dev/null "$LOG_FILE"

# One guard version for the canonical checkout and every worktree of it: an
# absolute hooks path cannot be lost by a worktree branched from an older
# revision, which is exactly when a missing guard would go unnoticed.
git -c safe.directory='*' -C "$CANONICAL" config core.hooksPath "$HOOKS_DIR"

chmod 0755 -- "$HOOKS_DIR"
chmod 0755 -- "$HOOKS_DIR"/*.sh "$HOOKS_DIR"/pre-commit "$HOOKS_DIR"/post-checkout

# The sweep units belong to this contract, not to the staged control-plane timer
# set: they are installed, verified and enabled here so that one entry point
# leaves nothing for a human to remember.
unit_source="$CANONICAL/apps/window/infra/checkout"
for unit in "${UNITS[@]}"; do
  [[ -f "$unit_source/$unit" && ! -L "$unit_source/$unit" ]] || {
    printf 'missing regular unit: %s\n' "$unit" >&2
    exit 1
  }
  install -o root -g root -m 0644 -- "$unit_source/$unit" "$UNIT_DIR/$unit"
done
systemctl daemon-reload
systemd-analyze verify "${UNITS[@]/#/$UNIT_DIR/}"

failures=()
configured="$(git -c safe.directory='*' -C "$CANONICAL" config --get core.hooksPath || true)"
[[ "$configured" == "$HOOKS_DIR" ]] || failures+=("core.hooksPath is '$configured', expected '$HOOKS_DIR'")

for hook in pre-commit post-checkout; do
  [[ -f "$HOOKS_DIR/$hook" && ! -L "$HOOKS_DIR/$hook" ]] || {
    failures+=("$hook is not a regular file")
    continue
  }
  [[ -x "$HOOKS_DIR/$hook" ]] || failures+=("$hook is not executable")
done

# Verify traversal as the agent's own account. A hook that is executable but
# unreachable is the same as no hook at all.
agent_user=""
if id "$GROUP" >/dev/null 2>&1; then
  agent_user="$(id -un "$GROUP")"
fi
if [[ -n "$agent_user" ]] && command -v runuser >/dev/null 2>&1; then
  probe="$HOOKS_DIR/pre-commit"
  dir="$HOOKS_DIR"
  while :; do
    runuser -u "$agent_user" -- test -x "$dir" || {
      failures+=("$dir is not traversable by $agent_user")
      break
    }
    [[ "$dir" == "/" ]] && break
    dir="$(dirname -- "$dir")"
  done
  runuser -u "$agent_user" -- test -r "$probe" || failures+=("$probe is not readable by $agent_user")
  runuser -u "$agent_user" -- test -x "$probe" || failures+=("$probe is not executable by $agent_user")
  runuser -u "$agent_user" -- test -w "$SESSION_PARENT" || {
    failures+=("$SESSION_PARENT is not writable by $agent_user")
  }
fi

if ((${#failures[@]} > 0)); then
  printf 'checkout-hygiene contract is not satisfied:\n' >&2
  for failure in "${failures[@]}"; do
    printf '  %s\n' "$failure" >&2
  done
  printf 'the commit guard would silently never run; refusing to continue\n' >&2
  exit 1
fi

# The sweep timers are enabled here rather than by the control-plane installer,
# whose direct runs deliberately keep their timers disabled until a validated
# release enables them. Checkout hygiene is not a staged product feature: it
# touches no product data, and it holds whenever it is installed.
systemctl enable --now frank-checkout-sweep.timer frank-checkout-prune.timer >/dev/null

printf 'checkout hygiene installed: hooks %s, session worktrees %s (%s:%s %s), log %s\n' \
  "$HOOKS_DIR" "$SESSION_PARENT" "$(stat -c %U "$SESSION_PARENT")" "$(stat -c %G "$SESSION_PARENT")" \
  "$(stat -c %a "$SESSION_PARENT")" "$LOG_FILE"

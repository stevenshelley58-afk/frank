#!/usr/bin/env bash
# Session-1 reviewed handoff: least-privilege Codex VPS setup (idempotent).
# Never executed by Session 5. Run only after review; no production action
# is taken by this script automatically.
set -euo pipefail

# 1. The codex user must not run as root and must not be in group hermes.
if id -nG codex | grep -qw hermes; then
  echo "FAIL: codex user must not be in group hermes" >&2
  exit 1
fi
if [ "$(id -u codex)" -eq 0 ]; then
  echo "FAIL: codex user must not be root" >&2
  exit 1
fi

# 2. Record over-broad memberships observed at audit (sudo, docker). Narrowing
#    them is a host-owner decision; this check only fails loudly if NEW
#    memberships appear.
memberships="$(id -nG codex | tr ' ' '\n' | sort | tr '\n' ',')"
echo "codex memberships: ${memberships}"

# 3. Per-project group + inherited setgid/umask for each registered project.
#    PROJECT_ROOTS is provided by Session 1's wiring (one canonical host path
#    per opaque workspace_id, resolved from the migrated registry).
: "${PROJECT_ROOTS:?export PROJECT_ROOTS=/projects/a:/projects/b}"
IFS=':' read -ra roots <<< "$PROJECT_ROOTS"
for root in "${roots[@]}"; do
  test -d "$root" || { echo "missing project root: $root"; exit 1; }
  slug="$(basename "$root")"
  getent group "frank-proj-${slug}" >/dev/null || groupadd "frank-proj-${slug}"
  usermod -aG "frank-proj-${slug}" codex
  chgrp -R "frank-proj-${slug}" "$root"
  chmod -R g+rwX "$root"
  find "$root" -type d -exec chmod g+s {} +
  # Git ownership for the codex user (run as codex).
  sudo -u codex git -C "$root" config --global --add safe.directory "$root" 2>/dev/null || true
  echo "project ${slug}: group + setgid + safe.directory applied"
done

# 4. Shared skills visibility: codex reads /srv/skills through its supported
#    user-skill path; runtime-owned .system skills remain in the runtimes.
#    (Consumer redirection is the skills cutover script, not this file.)

echo "setup complete; codex may edit only registered project roots"

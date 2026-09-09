#!/usr/bin/env bash
# Session-1 reviewed handoff: least-privilege Codex VPS setup (idempotent).
# Run only after review; no production action is taken by this script
# automatically.
#
# Phase-3 revision: PROJECT_ROOTS is now GENERATED from the validated active
# workspace registry (/srv/frank/data/window/workspace-registry.json): every
# active live-reference entry contributes slug + host_path. The script fails
# closed if the registry is unreadable, malformed, lists a missing host path,
# or yields no active roots. A legacy explicit PROJECT_ROOTS env override is
# still honored (paths; slug = basename) so the documented manual interface
# keeps working. For every root this script:
#   - ensures group frank-proj-<slug> exists and codex is a member;
#   - keeps Hermes rwX everywhere (named-user ACL, owner/group untouched);
#   - grants frank-proj-<slug> rwX via POSIX ACLs (no recursive chgrp, so the
#     running Hermes processes never lose group access to root:hermes roots);
#   - installs default ACLs on directories so new files inherit both grants;
#   - sets setgid on every directory;
#   - strips every world-write bit in the tree (world-write is forbidden);
#   - makes the root itself root-owned or Hermes-owned, group hermes, 2775
#     (mirrors deploy.sh's root:hermes 2775 pattern for provisioning roots);
#   - prunes codex memberships in frank-proj-* groups not backed by the
#     active registry (e.g. retired canary estates).
set -euo pipefail

REGISTRY_FILE="${FRANK_WORKSPACE_REGISTRY:-/srv/frank/data/window/workspace-registry.json}"

# 1. The codex user must not run as root and must not be in group hermes.
if id -nG codex | grep -qw hermes; then
  echo "FAIL: codex user must not be in group hermes" >&2
  exit 1
fi
if [ "$(id -u codex)" -eq 0 ]; then
  echo "FAIL: codex user must not be root" >&2
  exit 1
fi

# 2. Derive the registered project roots (slug=path pairs).
derive_project_roots() {
  python3 - "$REGISTRY_FILE" <<'PYEOF'
import json, os, sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as fh:
        registry = json.load(fh)
except (OSError, ValueError) as exc:
    raise SystemExit(f"FATAL: workspace registry unreadable ({path}): {exc}")

entries = registry.get("workspaces")
if not isinstance(entries, list):
    raise SystemExit("FATAL: registry 'workspaces' is not a list; refusing to guess project roots")

pairs = []
for entry in entries:
    if not isinstance(entry, dict):
        continue
    if entry.get("status") != "active" or entry.get("root_kind") != "live-reference":
        continue
    slug = str(entry.get("slug") or "").strip()
    host_path = str(entry.get("host_path") or "").strip()
    if not slug or not host_path:
        raise SystemExit(
            f"FATAL: active live-reference entry {entry.get('project_id')!r} "
            "is missing slug or host_path"
        )
    if not os.path.isdir(host_path):
        raise SystemExit(f"FATAL: registered host path missing for slug {slug!r}: {host_path}")
    pairs.append(f"{slug}={host_path}")

if not pairs:
    raise SystemExit("FATAL: registry yields no active live-reference workspaces")
print("\n".join(pairs))
PYEOF
}

if [ -n "${PROJECT_ROOTS:-}" ]; then
  # Legacy explicit interface (colon-separated paths; slug = basename).
  IFS=':' read -ra legacy_roots <<< "$PROJECT_ROOTS"
  roots=()
  for legacy in "${legacy_roots[@]}"; do
    [ -n "$legacy" ] || continue
    roots+=("$(basename "$legacy")=$legacy")
  done
else
  mapfile -t roots < <(derive_project_roots)
fi
echo "registered project roots:"; printf '  %s\n' "${roots[@]}"

# 3. Per-project group + ACLs for each registered project.
command -v setfacl >/dev/null || { echo "setfacl missing (install acl)"; exit 1; }
for entry in "${roots[@]}"; do
  slug="${entry%%=*}"
  root="${entry#*=}"
  test -d "$root" || { echo "missing project root: $root"; exit 1; }
  [[ "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "invalid slug: $slug"; exit 1; }
  getent group "frank-proj-${slug}" >/dev/null || groupadd "frank-proj-${slug}"
  id -nG codex | grep -qw "frank-proj-${slug}" || usermod -aG "frank-proj-${slug}" codex
  # Grant the project group rwX via POSIX ACLs instead of chgrp: recursive
  # chgrp would strip the running Hermes processes' group access to roots
  # owned root:hermes until a restart. ACLs leave owner/group untouched.
  # The named-user hermes ACL preserves Hermes rwX everywhere it has it.
  # Skip .frank-attachments: read-only bind mount (setfacl cannot traverse
  # it; the bound content is owned and written by the container runtime).
  # Skip <root>/customer-projects: deploy.sh exclusively owns that legacy
  # Mini root (install -d -o hermes -g hermes -m 0750); codex access there is
  # not required and must not be granted by this script.
  # World-write is forbidden anywhere in a registered tree. Sweep BEFORE the
  # ACL pass so inherited default ACLs never bake in other::rwx (new-file
  # permissions under a default ACL come from the default other:: entry, not
  # the creator's umask).
  find "$root" \( -name .frank-attachments -o -path "$root/customer-projects" \) -prune -o -type f -perm -0002 -exec chmod o-w {} +
  find "$root" \( -name .frank-attachments -o -path "$root/customer-projects" \) -prune -o -type d -perm -0002 -exec chmod o-w {} +
  find "$root" \( -name .frank-attachments -o -path "$root/customer-projects" \) -prune -o -type d -print0 \
    | xargs -0 -r -n 200 setfacl -m "u:hermes:rwX,g:frank-proj-${slug}:rwX" \
        -d -m "u:hermes:rwX,g:frank-proj-${slug}:rwX,o::r-X,m:rwX"
  find "$root" \( -name .frank-attachments -o -path "$root/customer-projects" \) -prune -o -type f -print0 \
    | xargs -0 -r -n 500 setfacl -m "u:hermes:rwX,g:frank-proj-${slug}:rwX,m:rwX"
  find "$root" \( -name .frank-attachments -o -path "$root/customer-projects" \) -prune -o -type d -exec chmod g+s {} +
  # Self-heal any prior over-grant inside the deploy.sh-owned legacy root:
  # if a frank-proj-* ACL exists there (an earlier revision of this script
  # applied it), strip all extended ACLs and restore deploy.sh's exact
  # declared state (install -d -o hermes -g hermes -m 0750). No-op otherwise,
  # so deploy.sh remains the sole owner of that root's permissions.
  legacy_dir="$root/customer-projects"
  if [ -d "$legacy_dir" ] && getfacl -p -- "$legacy_dir" 2>/dev/null | grep -q '^group:frank-proj-'; then
    setfacl -R -b -- "$legacy_dir"
    chown -R hermes:hermes -- "$legacy_dir"
    chmod 0750 -- "$legacy_dir"
    echo "restored deploy.sh state for $legacy_dir (0750 hermes:hermes, no extended ACLs)"
  fi
  # Root directory mirrors deploy.sh's provisioning pattern: group hermes,
  # setgid, group-writable, no world-write (2775). Owner is left as-is.
  chgrp hermes "$root"
  chmod 2775 "$root"
  # Git ownership for the codex user (run as codex).
  sudo -u codex git -C "$root" config --global --add safe.directory "$root" 2>/dev/null || true
  echo "project ${slug}: group ACL + hermes ACL + setgid + o-w sweep + safe.directory applied"
done

# 4. Prune codex memberships in frank-proj-* groups that the active registry
#    no longer backs (e.g. the retired v021 canary estate).
for grp in $(id -nG codex | tr ' ' '\n' | grep '^frank-proj-' || true); do
  keep=0
  for entry in "${roots[@]}"; do
    [ "frank-proj-${entry%%=*}" = "$grp" ] && keep=1
  done
  if [ "$keep" -eq 0 ]; then
    gpasswd -d codex "$grp"
    echo "pruned stale codex membership: $grp"
  fi
done

# 5. Shared skills visibility: codex reads /srv/skills through its supported
#    user-skill path; runtime-owned .system skills remain in the runtimes.
#    (Consumer redirection is the skills cutover script, not this file.)

# 6. Host-level least privilege for codex. Evidence (Phase-3 audit):
#    - launch_codex_task.sh resolves the workspace over the private HTTP API,
#      acquires the lease, then runs `codex` directly; it uses neither sudo
#      nor docker.
#    - The agenttrail-*-only-process services run as User=codex with
#      NoNewPrivileges=yes and reference neither sudo nor docker.
#    - The codex user-level openship.service runs plain node; no sudo/docker.
#    - No crontab exists for codex.
#    Therefore codex must not be in the sudo or docker groups; 'users' is
#    kept. Idempotent: no-op once the memberships are gone.
for grp in sudo docker; do
  if id -nG codex | grep -qw "$grp"; then
    gpasswd -d codex "$grp"
    echo "removed codex membership: $grp"
  fi
done

#    A standing passwordless sudo grant for codex bypasses group membership,
#    so it must go too. Only remove a file that actually grants codex
#    passwordless root (validated content, not name); a copy of the removed
#    rule should exist in the change backup before this runs.
for rule in /etc/sudoers.d/*; do
  [ -f "$rule" ] || continue
  if grep -Eq "^codex[[:space:]]+ALL=\(ALL\)[[:space:]]+NOPASSWD:ALL" "$rule"; then
    rm -f -- "$rule"
    visudo -c >/dev/null
    echo "removed passwordless sudo grant for codex: $rule"
  fi
done

echo "setup complete; codex may edit only registered project roots"

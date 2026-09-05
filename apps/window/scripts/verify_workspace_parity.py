#!/usr/bin/env python3
"""Verify the RUNNING Frank Window container's workspace mounts against the registry.

Compares docker inspect bind mounts on frank-window against the ACTIVE
live-reference entries of the workspace registry (frank.workspace-resolver/v1):

- ok         mount source, destination, and read-only flag all match;
- mismatch   a mount exists for the workspace but disagrees with the registry
             (wrong source, wrong destination mode, or writable);
- missing    no mount for a registered active workspace;
- unexpected a /vps/projects/* bind mount that no active workspace claims
             (Frank's own repo mount is exempt).

Prints a per-project table and exits non-zero on any mismatch, missing, or
unexpected mount. Reused in the Phase 6 release checklist.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_APP_DIR = Path(__file__).resolve().parent.parent
if str(REPO_APP_DIR) not in sys.path:
    sys.path.insert(0, str(REPO_APP_DIR))

from infra.workspace.resolver import WorkspaceRegistry  # noqa: E402

DEFAULT_REGISTRY_PATH = "/srv/frank/data/window/workspace-registry.json"
DEFAULT_CONTAINER = "frank-window"
# Frank's own repository mount is fixed in the base compose file and is not a
# workspace-registry entry.
EXEMPT_DESTINATIONS = {"/vps/projects/frank"}


class ParityError(RuntimeError):
    """The running mounts cannot be compared to the registry."""


def running_binds(container: str) -> list[dict]:
    try:
        raw = subprocess.run(
            ["docker", "inspect", container, "--format", "{{json .Mounts}}"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        ).stdout
    except (subprocess.SubprocessError, OSError) as error:
        raise ParityError(f"cannot inspect container {container}: {error}") from error
    try:
        mounts = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ParityError(f"docker inspect returned invalid JSON: {error}") from error
    return [
        m
        for m in mounts
        if isinstance(m, dict) and m.get("Type") == "bind" and isinstance(m.get("Destination"), str)
    ]


def check(container: str, registry_path: str) -> tuple[list[tuple], bool]:
    registry = WorkspaceRegistry(Path(registry_path))
    records = [
        r
        for r in registry.all_records()
        if r.root_kind == "live-reference" and r.status == "active"
    ]
    mounts = running_binds(container)
    by_dest: dict[str, dict] = {}
    for mount in mounts:
        by_dest.setdefault(mount["Destination"], mount)

    rows: list[tuple[str, str, str]] = []
    all_ok = True
    for record in records:
        slug = record.slug or record.project_id
        mount = by_dest.get(record.container_path)
        if mount is None:
            rows.append((slug, "missing", f"no mount at {record.container_path}"))
            all_ok = False
            continue
        problems = []
        if mount.get("Source") != record.host_path:
            problems.append(
                f"source {mount.get('Source')!r} != registry {record.host_path!r}"
            )
        if mount.get("RW", not mount.get("ReadOnly", False)) is not False:
            problems.append("mount is writable; registry requires :ro")
        if problems:
            rows.append((slug, "mismatch", "; ".join(problems)))
            all_ok = False
        else:
            rows.append((slug, "ok", f"{record.host_path} -> {record.container_path} (ro)"))

    claimed = {r.container_path for r in records}
    for dest in sorted(by_dest):
        if dest in claimed or dest in EXEMPT_DESTINATIONS:
            continue
        if dest.startswith("/vps/projects/"):
            rows.append(
                (by_dest[dest].get("Source") or "?", "unexpected",
                 f"unregistered workspace mount at {dest}")
            )
            all_ok = False
    return rows, all_ok


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify running workspace mounts against the registry."
    )
    parser.add_argument(
        "--registry",
        default=os.environ.get("FRANK_WORKSPACE_REGISTRY", DEFAULT_REGISTRY_PATH),
        help="workspace registry path (default: %(default)s)",
    )
    parser.add_argument(
        "--container",
        default=os.environ.get("FRANK_WINDOW_CONTAINER", DEFAULT_CONTAINER),
        help="Window container name (default: %(default)s)",
    )
    args = parser.parse_args()

    try:
        rows, all_ok = check(args.container, args.registry)
    except ParityError as error:
        print(f"workspace parity check failed: {error}", file=sys.stderr)
        return 1

    print(f"workspace parity: {args.container} vs {args.registry}")
    print(f"{'project':<20} {'status':<11} detail")
    for slug, status, detail in rows:
        print(f"{slug:<20} {status:<11} {detail}")
    if not rows:
        print("(no active live-reference workspaces registered)")
    if not all_ok:
        print("PARITY FAILED", file=sys.stderr)
        return 1
    print("parity ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())

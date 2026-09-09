#!/usr/bin/env python3
"""Generate the read-only Compose workspace-mount override from the registry.

The workspace registry (frank.workspace-resolver/v1) is the single source of
truth for which live-reference project workspaces are mounted into the Frank
Window container. This generator selects the ACTIVE live-reference workspaces,
validates every path fail-closed, and only then writes an exact, deterministic
Compose override file (default /srv/frank/compose/workspaces-override.yml).

Fail-closed contract:
- Every host_path must be a real directory and NOT a symlink (no symlinked
  ancestor components either).
- Every host_path must be the registry's own canonical host_path under
  /projects/ (paths are never invented or normalized into something else).
- Every container destination must exactly equal the registry container_path.
- No duplicate host paths or container destinations (including collisions
  with the fixed base-compose mounts).
- Every emitted bind mount is read-only.

Any validation error exits non-zero with NO file written, so a deploy that
sources this override aborts with the previous containers untouched.
"""
from __future__ import annotations

import argparse
import os
import stat
import sys
import tempfile
from pathlib import Path

REPO_APP_DIR = Path(__file__).resolve().parent.parent
if str(REPO_APP_DIR) not in sys.path:
    sys.path.insert(0, str(REPO_APP_DIR))

from infra.workspace.resolver import ResolverError, WorkspaceRegistry  # noqa: E402

DEFAULT_REGISTRY_PATH = "/srv/frank/data/window/workspace-registry.json"
DEFAULT_OUTPUT_PATH = "/srv/frank/compose/workspaces-override.yml"
HOST_ROOT_PREFIX = "/projects/"
CONTAINER_ROOT_PREFIX = "/vps/projects/"

# Container destinations reserved by the base compose file; the override must
# never collide with them.
RESERVED_CONTAINER_PATHS = (
    "/data",
    "/ops-projections",
    "/previews/mini",
    "/legacy-mini-projects",
    "/vps/projects/frank",
    "/srv/frank/secrets/hermes-api-key",
    "/srv/frank/secrets/customer-ops-control-secret",
    "/srv/frank/secrets/frank-operator-id",
    "/workspace",
)


class GenerationError(RuntimeError):
    """A validation failed; no override file may be written."""


def _real_dir_no_symlink(raw_path: str, label: str) -> None:
    """Fail closed unless raw_path is a real directory with no symlink."""
    path = Path(raw_path)
    try:
        st = path.lstat()
    except OSError as error:
        raise GenerationError(f"{label}: cannot stat {raw_path}: {error}") from error
    if stat.S_ISLNK(st.st_mode):
        raise GenerationError(f"{label}: symlink is rejected: {raw_path}")
    if not stat.S_ISDIR(st.st_mode):
        raise GenerationError(f"{label}: not a real directory: {raw_path}")
    if os.path.realpath(raw_path) != raw_path:
        raise GenerationError(
            f"{label}: path resolves through a symlink: {raw_path} -> {os.path.realpath(raw_path)}"
        )


def select_active_live_reference(registry: WorkspaceRegistry) -> list[dict]:
    """Active live-reference records only, in registry (stable) order."""
    selected = []
    for record in registry.all_records():
        if record.root_kind != "live-reference" or record.status != "active":
            continue
        selected.append(record)
    return selected


def validate_mounts(records: list) -> list[tuple[str, str]]:
    """Validate and return (host_path, container_path) pairs, fail-closed."""
    mounts: list[tuple[str, str]] = []
    seen_hosts: dict[str, str] = {}
    seen_dests: dict[str, str] = {}
    for record in records:
        slug = record.slug or record.project_id
        host = record.host_path
        dest = record.container_path

        if not host or not host.startswith(HOST_ROOT_PREFIX):
            raise GenerationError(
                f"{slug}: host_path is not under {HOST_ROOT_PREFIX}: {host!r}"
            )
        if host != os.path.normpath(host) or host.endswith("/"):
            raise GenerationError(f"{slug}: host_path is not normalized: {host!r}")
        _real_dir_no_symlink(host, slug)

        if not dest or not dest.startswith(CONTAINER_ROOT_PREFIX):
            raise GenerationError(
                f"{slug}: container_path is not under {CONTAINER_ROOT_PREFIX}: {dest!r}"
            )
        if dest != os.path.normpath(dest) or dest.endswith("/"):
            raise GenerationError(f"{slug}: container_path is not normalized: {dest!r}")
        if dest in RESERVED_CONTAINER_PATHS:
            raise GenerationError(
                f"{slug}: container_path collides with a reserved base mount: {dest}"
            )

        if host in seen_hosts:
            raise GenerationError(
                f"{slug}: duplicate host_path {host} already mounted for {seen_hosts[host]}"
            )
        if dest in seen_dests:
            raise GenerationError(
                f"{slug}: duplicate container destination {dest} already used by {seen_dests[dest]}"
            )
        seen_hosts[host] = slug
        seen_dests[dest] = slug
        mounts.append((host, dest))
    return mounts


def render_override(mounts: list[tuple[str, str]], registry_version: int) -> str:
    """Exact deterministic override file; every mount is read-only."""
    lines = [
        "# GENERATED FILE - do not edit by hand.",
        "# Source: apps/window/scripts/generate_workspace_override.py",
        "# Truth: the Frank workspace registry"
        f" (frank.workspace-resolver/v1, version {registry_version}).",
        "# Only active live-reference workspaces are mounted, always read-only.",
        "services:",
        "  frank-window:",
        "    volumes:",
    ]
    for host, dest in mounts:
        lines.append(f'      - "{host}:{dest}:ro"')
    return "\n".join(lines) + "\n"


def write_override(output: Path, body: str) -> None:
    """Atomic write; output must be root-owned mode 0644 in a 0755 directory."""
    directory = output.parent
    try:
        directory.mkdir(parents=True, exist_ok=True)
        os.chmod(directory, 0o755)
        fd, tmp_name = tempfile.mkstemp(dir=str(directory), prefix=".workspaces-override.")
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(body)
            os.chmod(tmp_name, 0o644)
            os.chown(tmp_name, 0, 0)
            os.replace(tmp_name, output)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
    except OSError as error:
        raise GenerationError(f"cannot write {output}: {error}") from error


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate the read-only workspace Compose override."
    )
    parser.add_argument(
        "--registry",
        default=os.environ.get("FRANK_WORKSPACE_REGISTRY", DEFAULT_REGISTRY_PATH),
        help="workspace registry path (default: %(default)s)",
    )
    parser.add_argument(
        "--output",
        default=os.environ.get("FRANK_WORKSPACES_OVERRIDE", DEFAULT_OUTPUT_PATH),
        help="override output path (default: %(default)s)",
    )
    args = parser.parse_args()

    registry = WorkspaceRegistry(Path(args.registry))
    try:
        data = registry._read()  # schema validation happens here
    except ResolverError as error:
        print(f"workspace override generation failed: {error}", file=sys.stderr)
        return 1

    try:
        records = select_active_live_reference(registry)
        mounts = validate_mounts(records)
        if not mounts:
            raise GenerationError("no active live-reference workspaces to mount")
        body = render_override(mounts, int(data.get("version", 1)))
        write_override(Path(args.output), body)
    except GenerationError as error:
        print(f"workspace override generation failed: {error}", file=sys.stderr)
        return 1

    for host, dest in mounts:
        print(f"{host} -> {dest}:ro")
    print(f"wrote {args.output} ({len(mounts)} read-only workspace mounts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

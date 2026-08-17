"""Operator runner for safe per-project knowledge projections.

It writes only under the configured knowledge root.  Source projects are read
by Graphify and the vault projector; neither tool is allowed to write back.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile

from graphify_supervisor import run_graphify
from knowledge_projection import build_combined_projection, validate_project
from vault_projection import project as project_vault


DEFAULT_ROOT = Path("/srv/frank/knowledge")
PROJECTION_UID = 65532
PROJECTION_GID = 65532


def _projection_identity() -> tuple[int, int]:
    try:
        uid = int(os.environ.get("KNOWLEDGE_PROJECTION_UID", str(PROJECTION_UID)))
        gid = int(os.environ.get("KNOWLEDGE_PROJECTION_GID", str(PROJECTION_GID)))
    except ValueError as exc:
        raise ValueError("projection uid/gid must be numeric") from exc
    if uid < 0 or gid < 0:
        raise ValueError("projection uid/gid must be non-negative")
    return uid, gid


def _normalize_projection_path(path: Path, *, directory: bool) -> None:
    """Make only generated output readable by the projection container.

    Root operators may refresh a project while the listener runs as UID
    65532. Normalize the generated directory/files, never the source project
    or vault. On non-POSIX development systems ownership is unavailable and
    mode checks remain best-effort.
    """

    uid, gid = _projection_identity()
    if hasattr(os, "geteuid") and os.geteuid() == 0 and hasattr(os, "chown"):
        os.chown(path, uid, gid)
    os.chmod(path, 0o750 if directory else 0o640)


def _safe_dir(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.exists() or not path.is_dir():
        raise ValueError(f"{label} must be a real directory")
    return path.resolve()


def _atomic_json(destination: Path, payload: object) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise ValueError("projection destination cannot be a symlink")
    fd, temporary = tempfile.mkstemp(prefix=".knowledge-", dir=str(destination.parent), text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        # The read-only projection container runs as UID 65532.  The deploy
        # step owns the knowledge root to that UID; group-readable artifacts
        # keep the source and vault private while allowing projection reads.
        os.chmod(temporary, 0o640)
        os.replace(temporary, destination)
        _normalize_projection_path(destination, directory=False)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def run_project(project: str, source: Path, vault: Path | None = None, output_root: Path = DEFAULT_ROOT) -> dict:
    project = validate_project(project)
    source = _safe_dir(source, "source project")
    output_root = output_root.absolute()
    if output_root == source or source in output_root.parents:
        raise ValueError("knowledge root must be outside the source project")
    if output_root.exists() and output_root.is_symlink():
        raise ValueError("knowledge root cannot be a symlink")
    output_root.mkdir(parents=True, exist_ok=True)
    _normalize_projection_path(output_root, directory=True)
    destination = output_root / project
    if destination.is_symlink():
        raise ValueError("project output cannot be a symlink")
    destination.mkdir(parents=True, exist_ok=True)
    _normalize_projection_path(destination, directory=True)
    graphify_output = destination / "graphify"
    status = run_graphify(source, graphify_output)
    if status != 0:
        raise RuntimeError(f"Graphify failed with status {status}")
    graphify_json = graphify_output / "graphify-out" / "graph.json"
    vault_json = None
    if vault is not None:
        vault = _safe_dir(vault, "vault")
        if vault == source or source in vault.parents or vault == output_root or output_root in vault.parents:
            raise ValueError("vault and source/output roots must remain separate")
        vault_json = destination / "vault-projection.json"
        project_vault(vault, vault_json)
        _normalize_projection_path(vault_json, directory=False)
    combined = build_combined_projection(project, vault=vault_json, graphify=graphify_json,
                                         generated_at=None)
    _atomic_json(destination / "projection.json", combined)
    return combined


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project")
    parser.add_argument("source", type=Path)
    parser.add_argument("--vault", type=Path)
    parser.add_argument("--output-root", type=Path, default=Path(os.environ.get("FRANK_KNOWLEDGE_ROOT", DEFAULT_ROOT)))
    args = parser.parse_args()
    run_project(args.project, args.source, args.vault, args.output_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Fail-closed import-path policy for the scratch codegraph runtime."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from typing import Mapping, Sequence


TRUSTED_PYTHONPATH = "/app:/opt/frank-codegraph/site-packages"
TRUSTED_ROOTS = (Path("/app"), Path("/opt/frank-codegraph/site-packages"))
PROJECTS_ROOT = Path("/repositories")


def _contained(path: Path, root: Path) -> bool:
    return path == root or path.is_relative_to(root)


def _module_origin(module_name: str, trusted_root: Path) -> Path:
    spec = importlib.util.find_spec(module_name)
    if spec is None or spec.origin is None:
        raise RuntimeError(f"trusted module is not importable: {module_name}")
    origin = Path(spec.origin).resolve(strict=True)
    canonical_root = trusted_root.resolve(strict=True)
    if not _contained(origin, canonical_root):
        raise RuntimeError(f"module resolves outside trusted root: {module_name} -> {origin}")
    return origin


def validate_import_environment(
    *,
    environment: Mapping[str, str] | None = None,
    path_entries: Sequence[str] | None = None,
    safe_path: bool | None = None,
    no_user_site: bool | None = None,
    cwd: Path | None = None,
    validate_modules: bool = True,
    trusted_roots: tuple[Path, ...] = TRUSTED_ROOTS,
    projects_root: Path = PROJECTS_ROOT,
) -> None:
    active_environment = os.environ if environment is None else environment
    active_entries = tuple(sys.path if path_entries is None else path_entries)
    active_safe_path = bool(sys.flags.safe_path) if safe_path is None else safe_path
    active_no_user_site = bool(sys.flags.no_user_site) if no_user_site is None else no_user_site
    active_cwd = Path.cwd() if cwd is None else cwd

    if active_environment.get("PYTHONPATH") != TRUSTED_PYTHONPATH:
        raise RuntimeError("PYTHONPATH does not match the fixed trusted path")
    if active_environment.get("PYTHONSAFEPATH") != "1" or not active_safe_path:
        raise RuntimeError("Python safe-path mode is required")
    if active_environment.get("PYTHONNOUSERSITE") != "1" or not active_no_user_site:
        raise RuntimeError("Python user-site loading must be disabled")
    if any(not entry for entry in active_entries):
        raise RuntimeError("empty/current-directory sys.path entry is forbidden")

    canonical_entries: list[Path] = []
    for entry in active_entries:
        candidate = Path(entry)
        if not candidate.is_absolute():
            raise RuntimeError(f"relative sys.path entry is forbidden: {entry}")
        canonical_entries.append(candidate.resolve(strict=False))

    trusted = tuple(root.resolve(strict=True) for root in trusted_roots)
    positions: list[int] = []
    for root in trusted:
        matches = [index for index, entry in enumerate(canonical_entries) if entry == root]
        if len(matches) != 1:
            raise RuntimeError(f"trusted sys.path root must appear exactly once: {root}")
        positions.append(matches[0])
    if positions != sorted(positions):
        raise RuntimeError("trusted sys.path roots are out of order")

    canonical_cwd = active_cwd.resolve(strict=True)
    if canonical_cwd not in trusted and canonical_cwd in canonical_entries:
        raise RuntimeError(f"working directory leaked into sys.path: {canonical_cwd}")
    canonical_projects_root = projects_root.resolve(strict=False)
    if any(_contained(entry, canonical_projects_root) for entry in canonical_entries):
        raise RuntimeError("repository path leaked into sys.path")

    if validate_modules:
        if len(trusted_roots) != 2:
            raise RuntimeError("runtime import policy requires exactly two trusted roots")
        _module_origin("frank_codegraph", trusted_roots[0])
        _module_origin("graphify", trusted_roots[1])


def _enforce_or_exit() -> None:
    try:
        validate_import_environment()
    except BaseException as error:
        detail = f"fatal codegraph import-path policy failure: {type(error).__name__}: {error}\n"
        os.write(2, detail.encode("utf-8", errors="replace")[:2048])
        os._exit(78)


if __name__ == "sitecustomize":
    _enforce_or_exit()

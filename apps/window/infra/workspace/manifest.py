"""Bounded VPS file/folder manifests without copying any folder.

Entries are sorted deterministically and carry safe relative path, bytes,
media type, modification time, and a content hash where size/cost permits
(explicit ``hash_deferred`` otherwise). Totals and ``truncation: false`` are
mandatory: an over-limit walk fails closed instead of silently truncating.
Private canonical paths stay in the server resolver; callers receive display
paths only.
"""
from __future__ import annotations

import hashlib
import mimetypes
import os
import stat
from datetime import datetime, timezone
from pathlib import Path

from .resolver import PathRejected, normalize_relative_path

HASH_BUDGET_BYTES = 64 * 1024 * 1024
MANIFEST_SCHEMA = "schema://frank.attachment-manifest/v1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_manifest(
    root: Path,
    rel: str,
    *,
    max_files: int,
    max_total_bytes: int,
    max_file_bytes: int,
    allowed_extensions: tuple[str, ...] | None = None,
    hash_budget_bytes: int = HASH_BUDGET_BYTES,
) -> dict:
    """Build one bounded manifest for a file or recursive folder."""
    normalize_relative_path(rel)
    root_path = Path(root)
    if not root_path.is_dir():
        raise PathRejected("manifest root is unavailable")
    base = root_path / rel
    try:
        base_st = os.stat(base, follow_symlinks=False)
    except OSError as error:
        raise PathRejected("manifest target is unavailable") from error
    if stat.S_ISREG(base_st.st_mode):
        return _single_file_manifest(root_path, rel, base_st, max_file_bytes, allowed_extensions)
    if not stat.S_ISDIR(base_st.st_mode):
        raise PathRejected("only regular files and directories can be manifested")

    entries: list[dict] = []
    total_files = 0
    total_bytes = 0
    hash_remaining = hash_budget_bytes
    stack = [rel]
    while stack:
        current = stack.pop()
        try:
            children = sorted(
                os.scandir(root_path / current),
                key=lambda item: item.name,
            )
        except OSError as error:
            raise PathRejected("folder is unreadable") from error
        for child in children:
            if child.is_symlink():
                continue  # never follow or list symlinks during the walk
            try:
                child_st = child.stat(follow_symlinks=False)
            except OSError:
                continue
            child_rel = f"{current}/{child.name}"
            if stat.S_ISDIR(child_st.st_mode):
                stack.append(child_rel)
                continue
            if not stat.S_ISREG(child_st.st_mode):
                continue
            total_files += 1
            total_bytes += child_st.st_size
            if total_files > max_files or total_bytes > max_total_bytes:
                raise PathRejected("folder exceeds manifest limits")
            if child_st.st_size > max_file_bytes:
                raise PathRejected(f"file exceeds the per-file limit: {child.name}")
            entry = {
                "path": child_rel,
                "bytes": child_st.st_size,
                "media_type": _media_type(child.name),
                "mtime": int(child_st.st_mtime),
            }
            if child_st.st_size <= hash_remaining:
                entry["sha256"] = _hash_file(root_path / child_rel)
                hash_remaining -= child_st.st_size
            else:
                entry["hash_deferred"] = True
            if allowed_extensions is not None:
                suffix = Path(child.name).suffix.lower().lstrip(".")
                if suffix not in allowed_extensions:
                    raise PathRejected(f"file type is not permitted on this root: {child.name}")
            entries.append(entry)
    entries.sort(key=lambda item: item["path"])
    return {
        "schema": MANIFEST_SCHEMA,
        "root": "workspace",
        "path": rel,
        "kind": "folder",
        "generated_at": _now(),
        "entries": entries,
        "totals": {"files": total_files, "bytes": total_bytes},
        "truncation": False,
    }


def _single_file_manifest(
    root_path: Path, rel: str, file_st: os.stat_result, max_file_bytes: int, allowed_extensions
) -> dict:
    if file_st.st_size > max_file_bytes:
        raise PathRejected("file exceeds the per-file limit")
    if allowed_extensions is not None:
        suffix = Path(rel).suffix.lower().lstrip(".")
        if suffix not in allowed_extensions:
            raise PathRejected("file type is not permitted on this root")
    return {
        "schema": MANIFEST_SCHEMA,
        "root": "workspace",
        "path": rel,
        "kind": "file",
        "generated_at": _now(),
        "entries": [
            {
                "path": rel,
                "bytes": file_st.st_size,
                "media_type": _media_type(rel),
                "mtime": int(file_st.st_mtime),
                "sha256": _hash_file(root_path / rel),
            }
        ],
        "totals": {"files": 1, "bytes": file_st.st_size},
        "truncation": False,
    }


def _media_type(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1_000_000), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_manifest_against_root(root: Path, manifest: dict) -> dict:
    """Re-validate a stored manifest at use time; changed/deleted fails honestly."""
    for entry in manifest.get("entries", []):
        rel = entry["path"]
        normalize_relative_path(rel)
        try:
            st = os.stat(root / rel, follow_symlinks=False)
        except OSError as error:
            raise PathRejected(f"attachment file changed or disappeared: {rel}") from error
        if st.st_size != entry.get("bytes"):
            raise PathRejected(f"attachment file changed since manifest: {rel}")
        if entry.get("sha256") and st.st_size <= HASH_BUDGET_BYTES:
            if _hash_file(root / rel) != entry["sha256"]:
                raise PathRejected(f"attachment hash mismatch: {rel}")
    return {"validated_at": _now(), "files": len(manifest.get("entries", []))}

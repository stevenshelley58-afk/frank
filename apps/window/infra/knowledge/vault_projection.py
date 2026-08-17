"""Project a Markdown vault into content-free, deterministic metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


WIKILINK = re.compile(r"\[\[([^]|#]+)(?:#[^]|]+)?(?:\|[^]]+)?\]\]")
TAG = re.compile(r"(?<![\w-])#([A-Za-z][\w/-]*)")
MAX_NOTE_BYTES = 2 * 1024 * 1024


def _has_symlink_component(path: Path, include_leaf: bool = True) -> bool:
    current = Path(path.anchor)
    parts = path.parts[1:] if include_leaf else path.parts[1:-1]
    for part in parts:
        current /= part
        if current.is_symlink():
            return True
    return False


def _read_note(path: Path) -> tuple[bytes, str] | None:
    try:
        stat = path.stat()
        if stat.st_size > MAX_NOTE_BYTES:
            return None
        with path.open("rb") as handle:
            raw = handle.read(MAX_NOTE_BYTES + 1)
        if len(raw) > MAX_NOTE_BYTES:
            return None
        return raw, raw.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _note_record(path: Path, vault: Path) -> dict[str, object] | None:
    relative = path.relative_to(vault)
    if any(part.startswith(".") for part in relative.parts):
        return None
    if path.is_symlink() or _has_symlink_component(path):
        return None
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        return None
    if vault not in resolved.parents:
        return None
    note = _read_note(path)
    if note is None:
        return None
    raw, text = note
    links = sorted(set(WIKILINK.findall(text)), key=lambda value: (value.casefold(), value))
    tags = sorted({tag.lower() for tag in TAG.findall(text)}, key=lambda value: (value.casefold(), value))
    return {
        "path": relative.as_posix(),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "wikilinks": links,
        "tags": tags,
    }


def _validate_destination(vault: Path, destination: Path) -> tuple[Path, Path]:
    if vault.is_symlink():
        raise ValueError("vault cannot be a symlink")
    vault = vault.resolve(strict=True)
    if not vault.is_dir():
        raise ValueError("vault must be a directory")
    destination = destination.absolute()
    if destination.exists() and destination.is_symlink():
        raise ValueError("projection destination cannot be a symlink")
    if _has_symlink_component(destination):
        raise ValueError("projection destination cannot contain symlinks")
    parent = destination.parent
    if vault == destination or vault in destination.parents:
        raise ValueError("projection destination must be outside vault")
    if parent.exists() and not parent.is_dir():
        raise ValueError("projection parent must be a directory")
    if vault == parent or vault in parent.parents:
        raise ValueError("projection parent must be outside vault")
    return vault, destination


def project(vault: Path, destination: Path) -> dict[str, object]:
    vault, destination = _validate_destination(vault, destination)
    records = []
    for path in sorted(vault.rglob("*.md"), key=lambda value: value.relative_to(vault).as_posix()):
        record = _note_record(path, vault)
        if record is not None:
            records.append(record)
    payload: dict[str, object] = {
        "schema": "frank.vault-projection.v1",
        "content": False,
        "notes": records,
    }

    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    if _has_symlink_component(destination) or _has_symlink_component(parent):
        raise ValueError("projection destination cannot contain symlinks")
    fd, temporary = tempfile.mkstemp(prefix=".projection-", dir=str(parent), text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        if destination.exists() and destination.is_symlink():
            raise ValueError("projection destination cannot be a symlink")
        os.replace(temporary, destination)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vault", type=Path)
    parser.add_argument("projection", type=Path)
    args = parser.parse_args()
    project(args.vault, args.projection)


if __name__ == "__main__":
    main()

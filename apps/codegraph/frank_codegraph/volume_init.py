from __future__ import annotations

import os
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path


VOLUME_ROOT = Path("/data/codegraph")
SERVICE_UID = 10001
SERVICE_GID = 10001
DIRECTORY_MODE = 0o750
FILE_MODE = 0o640
MAX_ENTRIES = 50_000
MAX_DEPTH = 64
MIGRATION_MARKER = ".frank-codegraph-ownership-v2"
MIGRATION_MARKER_CONTENT = b"frank-codegraph-volume-ownership-v2\n"
RELEASE_NAME = re.compile(r"^\d{8}T\d{6}Z-[a-f0-9]{12}$")
PROJECT_NAME = re.compile(r"^[a-z][a-z0-9-]{0,62}$")


@dataclass(frozen=True)
class Entry:
    parts: tuple[str, ...]
    device: int
    inode: int
    kind: str
    link_target: str | None = None


def _open_directory(name: str | Path, *, dir_fd: int | None = None) -> int:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    return os.open(name, flags, dir_fd=dir_fd)


def _same_entry(metadata: os.stat_result, expected: Entry, kind: str) -> None:
    if (metadata.st_dev, metadata.st_ino, kind) != (expected.device, expected.inode, expected.kind):
        raise RuntimeError("codegraph volume entry changed during migration")


def _inventory(
    root_fd: int,
    *,
    canonical_root: Path,
    root_device: int,
    max_entries: int,
    max_depth: int,
) -> list[Entry]:
    entries: list[Entry] = []
    pending_links: list[Entry] = []

    def visit(directory_fd: int, parts: tuple[str, ...]) -> None:
        if len(parts) >= max_depth:
            if os.listdir(directory_fd):
                raise RuntimeError("codegraph volume exceeds migration depth limit")
            return
        for name in sorted(os.listdir(directory_fd)):
            if len(entries) + len(pending_links) >= max_entries:
                raise RuntimeError("codegraph volume exceeds migration entry limit")
            metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if metadata.st_dev != root_device:
                raise RuntimeError("codegraph volume entry crosses a filesystem boundary")
            child_parts = (*parts, name)
            if stat.S_ISLNK(metadata.st_mode):
                if metadata.st_nlink != 1:
                    raise RuntimeError("codegraph volume contains a hard-linked symlink")
                pending_links.append(
                    Entry(
                        child_parts,
                        metadata.st_dev,
                        metadata.st_ino,
                        "symlink",
                        os.readlink(name, dir_fd=directory_fd),
                    )
                )
                continue
            if stat.S_ISDIR(metadata.st_mode):
                entry = Entry(child_parts, metadata.st_dev, metadata.st_ino, "directory")
                entries.append(entry)
                child_fd = _open_directory(name, dir_fd=directory_fd)
                try:
                    _same_entry(os.fstat(child_fd), entry, "directory")
                    visit(child_fd, child_parts)
                finally:
                    os.close(child_fd)
                continue
            if stat.S_ISREG(metadata.st_mode):
                if metadata.st_nlink != 1:
                    raise RuntimeError("codegraph volume contains a forbidden hard-linked file")
                entries.append(Entry(child_parts, metadata.st_dev, metadata.st_ino, "file"))
                continue
            raise RuntimeError("codegraph volume contains a forbidden special entry")

    visit(root_fd, ())
    directories = {entry.parts: entry for entry in entries if entry.kind == "directory"}
    for link in pending_links:
        if len(link.parts) != 2 or link.parts[1] != "current":
            raise RuntimeError("codegraph volume contains a symlink outside the project current position")
        project = link.parts[0]
        if not PROJECT_NAME.fullmatch(project):
            raise RuntimeError("codegraph current link is under an invalid project directory")
        target = link.link_target
        if target is None or target.startswith("/"):
            raise RuntimeError("codegraph current link target must be relative")
        target_parts = tuple(target.split("/"))
        if (
            len(target_parts) != 2
            or target_parts[0] != "releases"
            or not RELEASE_NAME.fullmatch(target_parts[1])
        ):
            raise RuntimeError("codegraph current link target has an unsafe release shape")
        release_parts = (project, *target_parts)
        if (project,) not in directories or (project, "releases") not in directories or release_parts not in directories:
            raise RuntimeError("codegraph current link target was not inventoried as a real directory")
        releases_root = (canonical_root / project / "releases").resolve(strict=True)
        expected = (releases_root / target_parts[1]).resolve(strict=True)
        resolved = (canonical_root / project / "current").resolve(strict=True)
        if resolved != expected or resolved.parent != releases_root or not resolved.is_relative_to(releases_root):
            raise RuntimeError("codegraph current link resolves outside its project releases directory")
        entries.append(link)
    return entries


def _mutate_entry(directory_fd: int, entry: Entry, *, uid: int, gid: int) -> None:
    current_fd = os.dup(directory_fd)
    try:
        for part in entry.parts[:-1]:
            next_fd = _open_directory(part, dir_fd=current_fd)
            os.close(current_fd)
            current_fd = next_fd
        name = entry.parts[-1]
        if entry.kind == "symlink":
            metadata = os.stat(name, dir_fd=current_fd, follow_symlinks=False)
            _same_entry(metadata, entry, "symlink")
            if metadata.st_nlink != 1 or os.readlink(name, dir_fd=current_fd) != entry.link_target:
                raise RuntimeError("codegraph current link changed during migration")
            os.chown(name, uid, gid, dir_fd=current_fd, follow_symlinks=False)
            final = os.stat(name, dir_fd=current_fd, follow_symlinks=False)
            _same_entry(final, entry, "symlink")
            return
        if entry.kind == "directory":
            target_fd = _open_directory(name, dir_fd=current_fd)
        else:
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
            target_fd = os.open(name, flags, dir_fd=current_fd)
        try:
            metadata = os.fstat(target_fd)
            kind = "directory" if stat.S_ISDIR(metadata.st_mode) else "file" if stat.S_ISREG(metadata.st_mode) else "special"
            _same_entry(metadata, entry, kind)
            if kind == "file" and metadata.st_nlink != 1:
                raise RuntimeError("codegraph volume file acquired an unsafe hard link")
            os.fchown(target_fd, uid, gid)
            os.fchmod(target_fd, DIRECTORY_MODE if kind == "directory" else FILE_MODE)
        finally:
            os.close(target_fd)
    finally:
        os.close(current_fd)


def _migration_complete(root_fd: int, root_metadata: os.stat_result, *, uid: int, gid: int) -> bool:
    try:
        marker_metadata = os.stat(MIGRATION_MARKER, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    if (
        not stat.S_ISREG(marker_metadata.st_mode)
        or marker_metadata.st_nlink != 1
        or marker_metadata.st_dev != root_metadata.st_dev
    ):
        raise RuntimeError("codegraph volume migration marker is unsafe")
    marker_fd = os.open(
        MIGRATION_MARKER,
        os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
        dir_fd=root_fd,
    )
    try:
        opened = os.fstat(marker_fd)
        if (opened.st_dev, opened.st_ino) != (marker_metadata.st_dev, marker_metadata.st_ino):
            raise RuntimeError("codegraph volume migration marker changed during validation")
        content = os.read(marker_fd, len(MIGRATION_MARKER_CONTENT) + 1)
    finally:
        os.close(marker_fd)
    valid = (
        root_metadata.st_uid == uid
        and root_metadata.st_gid == gid
        and stat.S_IMODE(root_metadata.st_mode) == DIRECTORY_MODE
        and opened.st_uid == uid
        and opened.st_gid == gid
        and stat.S_IMODE(opened.st_mode) == FILE_MODE
        and content == MIGRATION_MARKER_CONTENT
    )
    if not valid:
        raise RuntimeError("codegraph volume migration marker is invalid")
    return True


def _write_migration_marker(root_fd: int, *, uid: int, gid: int) -> None:
    marker_fd = os.open(
        MIGRATION_MARKER,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
        dir_fd=root_fd,
    )
    try:
        written = os.write(marker_fd, MIGRATION_MARKER_CONTENT)
        if written != len(MIGRATION_MARKER_CONTENT):
            raise RuntimeError("could not write complete codegraph volume migration marker")
        os.fchown(marker_fd, uid, gid)
        os.fchmod(marker_fd, FILE_MODE)
        os.fsync(marker_fd)
    finally:
        os.close(marker_fd)


def initialize_volume(
    root: Path,
    *,
    expected_root: Path,
    uid: int,
    gid: int,
    max_entries: int = MAX_ENTRIES,
    max_depth: int = MAX_DEPTH,
) -> None:
    root = Path(os.path.abspath(root))
    expected_root = Path(os.path.abspath(expected_root))
    if root != expected_root:
        raise RuntimeError("volume initializer target is not the intended root")
    if max_entries < 1 or max_depth < 1:
        raise RuntimeError("volume migration limits must be positive")

    before = root.lstat()
    if not stat.S_ISDIR(before.st_mode) or stat.S_ISLNK(before.st_mode):
        raise RuntimeError("volume initializer target must be a real directory")
    if root.resolve(strict=True) != expected_root:
        raise RuntimeError("volume initializer target resolves outside the intended root")

    root_fd = _open_directory(root)
    try:
        opened = os.fstat(root_fd)
        if not stat.S_ISDIR(opened.st_mode) or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise RuntimeError("volume initializer target changed during validation")

        # A validated marker proves the bounded legacy migration completed.
        # Avoid traversing normal service-created `current` symlinks thereafter.
        if _migration_complete(root_fd, opened, uid=uid, gid=gid):
            return

        entries = _inventory(
            root_fd,
            canonical_root=root.resolve(strict=True),
            root_device=opened.st_dev,
            max_entries=max_entries,
            max_depth=max_depth,
        )
        for entry in entries:
            _mutate_entry(root_fd, entry, uid=uid, gid=gid)
        os.fchown(root_fd, uid, gid)
        os.fchmod(root_fd, DIRECTORY_MODE)
        final = os.fstat(root_fd)
        if final.st_uid != uid or final.st_gid != gid or stat.S_IMODE(final.st_mode) != DIRECTORY_MODE:
            raise RuntimeError("volume initializer could not establish ownership and mode")
        _write_migration_marker(root_fd, uid=uid, gid=gid)
    finally:
        os.close(root_fd)


def main() -> None:
    if len(sys.argv) != 1:
        raise SystemExit("volume initializer accepts no arguments")
    if os.geteuid() != 0:
        raise SystemExit("volume initializer must run as root")
    initialize_volume(VOLUME_ROOT, expected_root=VOLUME_ROOT, uid=SERVICE_UID, gid=SERVICE_GID)


if __name__ == "__main__":
    main()

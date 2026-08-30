#!/usr/bin/env python3
"""Create and verify a bounded, isolated control-graph restore drill."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import stat
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Sequence


SHA = re.compile(r"^[0-9a-f]{40,64}$")
RUN_KEY = re.compile(r"^restore-drill-[a-z0-9]+(?:-[a-z0-9]+)*$")
SECRET = re.compile(
    rb"(?i)(?:-----BEGIN .*PRIVATE KEY-----|password\s*[:=]|secret\s*[:=]|"
    rb"token\s*[:=]|api[_-]?key\s*[:=]|authorization\s*[:=])"
)
MAX_FILES = 10_000
MAX_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = MAX_BYTES + (2 * 1024 * 1024)


@dataclass(frozen=True)
class FileSnapshot:
    relative: Path
    data: bytes

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def _sync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError:
        if os.name != "nt":
            raise


def _safe_root(path: Path, *, create: bool = False) -> Path:
    absolute = path.absolute()
    if any(candidate.is_symlink() for candidate in (absolute, *absolute.parents)):
        raise ValueError("path ancestry contains a symlink")
    if create:
        absolute.mkdir(parents=True, exist_ok=True, mode=0o750)
        os.chmod(absolute, 0o750)
    if not absolute.is_dir() or absolute.resolve() != absolute:
        raise ValueError("path is not a regular directory")
    return absolute


def _read_regular(path: Path, *, limit: int) -> bytes:
    absolute = path.absolute()
    if any(candidate.is_symlink() for candidate in (absolute, *absolute.parents)):
        raise ValueError("regular-file path contains a symlink")
    flags = (
        os.O_RDONLY
        | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    descriptor = os.open(absolute, flags)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError("regular file exceeds its bound or has the wrong type")
        data = bytearray()
        while len(data) <= limit:
            chunk = os.read(descriptor, min(1024 * 1024, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
        if (
            len(data) > limit
            or len(data) != after.st_size
            or before.st_size != after.st_size
            or before.st_ino != after.st_ino
            or before.st_dev != after.st_dev
        ):
            raise ValueError("regular file changed while it was being read")
        return bytes(data)
    finally:
        os.close(descriptor)


def _read_revision(path: Path) -> str:
    try:
        revision = _read_regular(path, limit=65).decode("utf-8").strip()
    except UnicodeError as error:
        raise ValueError("approved revision is not UTF-8") from error
    if not SHA.fullmatch(revision):
        raise ValueError("approved revision is invalid")
    return revision


def _collect_files(root: Path) -> list[FileSnapshot]:
    snapshots: list[FileSnapshot] = []
    total = 0
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("source contains a symlink")
        if stat.S_ISDIR(info.st_mode):
            continue
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("source contains a non-regular file")
        relative = path.relative_to(root)
        if any(part in {"", ".", ".."} for part in relative.parts):
            raise ValueError("source path is unsafe")
        data = _read_regular(path, limit=MAX_FILE_BYTES)
        total += len(data)
        if total > MAX_BYTES or len(snapshots) >= MAX_FILES:
            raise ValueError("source exceeds the restore-drill bound")
        if SECRET.search(data):
            raise ValueError("source contains secret-like material")
        snapshots.append(FileSnapshot(relative=relative, data=data))
    if not snapshots:
        raise ValueError("control graph source is empty")
    return snapshots


def _atomic_write(path: Path, data: bytes, *, mode: int = 0o600) -> None:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("output target is unsafe")
    descriptor, temporary = tempfile.mkstemp(prefix=".restore-drill-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _manifest(files: Sequence[FileSnapshot]) -> list[dict[str, object]]:
    return [
        {"path": item.relative.as_posix(), "sha256": item.digest, "size": len(item.data)}
        for item in files
    ]


def _json_bytes(value: object) -> bytes:
    rendered = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (rendered + "\n").encode("utf-8")


def _write_archive(path: Path, files: Sequence[FileSnapshot]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".restore-archive-", dir=path.parent)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                    for item in files:
                        member = tarfile.TarInfo("control-graph/" + item.relative.as_posix())
                        member.size = len(item.data)
                        member.mtime = 0
                        member.mode = 0o600
                        member.uid = member.gid = 0
                        member.uname = member.gname = ""
                        archive.addfile(member, io.BytesIO(item.data))
            raw.flush()
            os.fsync(raw.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _verify_archive(path: Path, expected: Sequence[FileSnapshot]) -> list[FileSnapshot]:
    expected_by_name = {
        "control-graph/" + item.relative.as_posix(): item
        for item in expected
    }
    restored: list[FileSnapshot] = []
    seen: set[str] = set()
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        if len(members) != len(expected_by_name) or len(members) > MAX_FILES:
            raise ValueError("archive member set is incomplete")
        for member in members:
            if (
                not member.isfile()
                or member.issym()
                or member.islnk()
                or member.name not in expected_by_name
                or member.name in seen
                or member.size > MAX_FILE_BYTES
            ):
                raise ValueError("archive member is unsafe")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError("archive member is unreadable")
            data = stream.read(MAX_FILE_BYTES + 1)
            expected_item = expected_by_name[member.name]
            if data != expected_item.data:
                raise ValueError("archive content differs from verified source")
            seen.add(member.name)
            restored.append(FileSnapshot(relative=expected_item.relative, data=data))
    if seen != set(expected_by_name):
        raise ValueError("archive member set is incomplete")
    return sorted(restored, key=lambda item: item.relative.as_posix())


def _materialize_isolated_restore(root: Path, files: Sequence[FileSnapshot]) -> Path:
    restored_root = root / "control-graph"
    restored_root.mkdir(parents=True, mode=0o750)
    os.chmod(restored_root, 0o750)
    for item in files:
        target = restored_root / item.relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
        os.chmod(target.parent, 0o750)
        _atomic_write(target, item.data)
    return restored_root


def _build_receipt(
    *,
    run_key: str,
    run_dir: Path,
    revision: str,
    archive_hash: str,
    file_count: int,
    captured: datetime,
) -> dict[str, object]:
    receipt_id = "receipt:retention/" + run_key
    archive = run_dir / "control-graph.tar.gz"
    source_manifest = run_dir / "source-manifest.json"
    restored_manifest = run_dir / "restored-manifest.json"
    return {
        "schema": "frank.restore-drill-evidence/v1",
        "id": receipt_id,
        "receipt_id": receipt_id,
        "kind": "restore_drill",
        "subject_ids": ["vps:dedicated", "project:frank"],
        "producer": "frank-retention-restore-drill",
        "source_revision_set": {"project:frank": revision},
        "deployed_revision_set": {"project:frank": revision},
        "captured_at": captured.isoformat().replace("+00:00", "Z"),
        "fresh_until": (captured + timedelta(days=90)).isoformat().replace("+00:00", "Z"),
        "outcome": "pass",
        "status": "passed",
        "backup_archive": str(archive),
        "backup_sha256": archive_hash,
        "source_manifest": str(source_manifest),
        "restored_manifest": str(restored_manifest),
        "file_count": file_count,
        "content_match": True,
        "redaction": "secret_filtered",
        "evidence_uris": [
            "host:" + str(archive),
            "host:" + str(source_manifest),
            "host:" + str(restored_manifest),
        ],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("/srv/frank/data/window/control-graph"))
    parser.add_argument("--backup-root", type=Path, default=Path("/srv/frank/backups/control-plane"))
    parser.add_argument("--revision-file", type=Path, default=Path("/var/lib/frank/release/approved-sha"))
    parser.add_argument("--run-key")
    args = parser.parse_args(argv)

    run_key = args.run_key or "restore-drill-" + datetime.now(timezone.utc).strftime("%Y%m%dt%H%M%sz")
    run_dir: Path | None = None
    try:
        if not RUN_KEY.fullmatch(run_key):
            raise ValueError("run key is not canonical")
        source = _safe_root(args.source_root)
        backup = _safe_root(args.backup_root, create=True)
        if source == backup or source in backup.parents or backup in source.parents:
            raise ValueError("backup and source roots overlap")
        revision = _read_revision(args.revision_file)
        run_dir = backup / run_key
        if run_dir.exists() or run_dir.is_symlink():
            raise ValueError("restore-drill run already exists")
        run_dir.mkdir(mode=0o750)
        os.chmod(run_dir, 0o750)
        _sync_directory(backup)

        source_files = _collect_files(source)
        source_manifest = _manifest(source_files)
        _atomic_write(run_dir / "source-manifest.json", _json_bytes(source_manifest))

        archive = run_dir / "control-graph.tar.gz"
        _write_archive(archive, source_files)
        archive_files = _verify_archive(archive, source_files)

        restore_dir = run_dir / "restored"
        restore_dir.mkdir(mode=0o750)
        os.chmod(restore_dir, 0o750)
        restored_root = _materialize_isolated_restore(restore_dir, archive_files)
        restored_files = _collect_files(restored_root)
        restored_manifest = _manifest(restored_files)
        if restored_manifest != source_manifest:
            raise ValueError("restored content hash manifest differs")
        _atomic_write(run_dir / "restored-manifest.json", _json_bytes(restored_manifest))

        archive_data = _read_regular(archive, limit=MAX_ARCHIVE_BYTES)
        captured = datetime.now(timezone.utc).replace(microsecond=0)
        receipt = _build_receipt(
            run_key=run_key,
            run_dir=run_dir,
            revision=revision,
            archive_hash="sha256:" + hashlib.sha256(archive_data).hexdigest(),
            file_count=len(source_files),
            captured=captured,
        )
        receipt_bytes = _json_bytes(receipt)
        _atomic_write(run_dir / "receipt.json", receipt_bytes)
        _atomic_write(backup / "latest-restore-drill.json", receipt_bytes)
        shutil.rmtree(restore_dir)
        print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, UnicodeError, ValueError, tarfile.TarError) as error:
        if run_dir is not None and run_dir.exists():
            failure = {
                "schema": "frank.restore-drill-evidence/v1",
                "status": "failed",
                "outcome": "fail",
                "reason": str(error)[:200],
                "redaction": "secret_filtered",
            }
            try:
                _atomic_write(run_dir / "failure.json", _json_bytes(failure))
            except (OSError, ValueError):
                pass
        print(json.dumps({"status": "failed", "error_code": "restore_drill_rejected"}, sort_keys=True))
        return 1
    finally:
        if run_dir is not None:
            restore_dir = run_dir / "restored"
            if restore_dir.exists():
                shutil.rmtree(restore_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())

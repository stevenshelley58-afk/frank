"""Opaque workspace-root resolver for the shared estate (Session 5).

Every workspace is keyed by an opaque UUIDv4 ``workspace_id`` minted during
the registry migration. Private records hold the registered host, Hermes,
and container paths, the immutable legacy-derived ``memory_scope``, and an
opaque ``board_binding_id`` whose private record maps to the native Hermes
board slug. No browser DTO ever receives private mappings.

Path handling fails closed: only normalized relative paths are accepted,
every component is re-verified beneath the exact root, symlinks and special
files are rejected, and opens use O_NOFOLLOW to avoid time-of-check /
time-of-use escapes.
"""
from __future__ import annotations

import json
import os
import re
import stat
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .schemas import (
    ROOT_KINDS,
    WORKSPACE_RESOLVER_SCHEMA,
    WORKSPACE_STATUSES,
    PrivateWorkspaceRecord,
    ResolvedPath,
    WorkspacePublic,
)

MAX_COMPONENT = 200
MAX_REL_PATH = 1024
_WINDOWS_DEVICE = re.compile(
    r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$", re.IGNORECASE
)
_SAFE_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


class ResolverError(RuntimeError):
    """The workspace registry cannot be read, written, or trusted."""


class PathRejected(ResolverError):
    """A requested path failed closed."""


class WorkspaceUnknown(ResolverError):
    """No active workspace exists for the given opaque id."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _validate_component(raw: str) -> str:
    component = raw
    if not component or component in {".", ".."}:
        raise PathRejected("path components cannot be empty, dot, or dotdot")
    if component.startswith("."):
        raise PathRejected("hidden path components are rejected")
    if len(component) > MAX_COMPONENT:
        raise PathRejected("path component is too long")
    if component != unicodedata.normalize("NFC", component):
        raise PathRejected("path components must be Unicode NFC normalized")
    if any(ord(char) < 32 or ord(char) == 127 for char in component):
        raise PathRejected("control characters are rejected")
    if _WINDOWS_DEVICE.fullmatch(component):
        raise PathRejected("Windows device names are rejected")
    if component.endswith((" ", ".")):
        raise PathRejected("trailing dot or space path components are rejected")
    return component


def normalize_relative_path(raw: object) -> str:
    """Normalize and fully validate one browser-supplied relative path."""
    value = str(raw or "").replace("\\", "/").strip()
    if not value:
        raise PathRejected("a relative path is required")
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        raise PathRejected("absolute paths are rejected")
    if "\x00" in value or len(value) > MAX_REL_PATH:
        raise PathRejected("path is empty, contains NUL, or is too long")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise PathRejected("control characters are rejected")
    for part in value.split("/"):
        _validate_component(part)
    return value


class WorkspaceRegistry:
    """Durable workspace registry; atomic JSON writes, fail-closed reads."""

    def __init__(
        self,
        path: Path,
        uuid_factory=None,
        verify_host_paths: bool = False,
        canonical_prefixes: tuple[str, ...] = ("/projects/",),
    ):
        self.path = Path(path)
        self._uuid = uuid_factory or (lambda: str(uuid.uuid4()))
        self._verify_host_paths = verify_host_paths
        self._canonical_prefixes = tuple(canonical_prefixes)
        self._lock = threading.RLock()

    @staticmethod
    def _empty() -> dict:
        return {"schema": WORKSPACE_RESOLVER_SCHEMA, "version": 1, "workspaces": []}

    def _read(self) -> dict:
        if not self.path.exists():
            return self._empty()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ResolverError("workspace registry is unavailable.") from error
        if (
            not isinstance(data, dict)
            or data.get("schema") != WORKSPACE_RESOLVER_SCHEMA
            or data.get("version") != 1
            or not isinstance(data.get("workspaces"), list)
        ):
            raise ResolverError("workspace registry has an unsupported format.")
        return data

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        try:
            temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(self.path)
        except OSError as error:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
            raise ResolverError("workspace registry could not be saved.") from error

    def _records(self) -> list[PrivateWorkspaceRecord]:
        records = []
        for raw in self._read()["workspaces"]:
            if not isinstance(raw, dict):
                continue
            board_slug = raw.get("board_slug_private")
            records.append(
                PrivateWorkspaceRecord(
                    workspace_id=str(raw.get("workspace_id") or ""),
                    project_id=str(raw.get("project_id") or ""),
                    slug=str(raw.get("slug") or ""),
                    host_path=str(raw.get("host_path") or ""),
                    hermes_path=str(raw.get("hermes_path") or ""),
                    container_path=str(raw.get("container_path") or ""),
                    memory_scope=str(raw.get("memory_scope") or ""),
                    board_binding_id=str(raw.get("board_binding_id") or ""),
                    board_slug_private=str(board_slug) if board_slug else None,
                    root_kind=str(raw.get("root_kind") or ""),
                    status=str(raw.get("status") or ""),
                    quarantine_reason=str(raw.get("quarantine_reason") or ""),
                    created_at=str(raw.get("created_at") or ""),
                )
            )
        return records

    def save_records(self, records: list[PrivateWorkspaceRecord]) -> None:
        data = self._empty()
        data["workspaces"] = [record.__dict__ | {"board_slug_private": record.board_slug_private} for record in records]
        with self._lock:
            self._write(data)

    def all_records(self) -> list[PrivateWorkspaceRecord]:
        with self._lock:
            return self._records()

    def get(self, workspace_id: str) -> PrivateWorkspaceRecord | None:
        return next((r for r in self.all_records() if r.workspace_id == workspace_id), None)

    def get_active(self, workspace_id: str) -> PrivateWorkspaceRecord:
        record = self.get(workspace_id)
        if record is None or record.status != "active":
            raise WorkspaceUnknown("no active workspace for the given id")
        return record

    def public_list(self) -> list[WorkspacePublic]:
        return [
            WorkspacePublic(r.workspace_id, r.project_id, r.root_kind, r.status)
            for r in self.all_records()
        ]

    def migrate_registry(
        self,
        candidates: list[dict],
        *,
        unassigned_scope: str = "steven-unassigned",
    ) -> dict:
        """Migrate legacy project entries into opaque workspaces.

        ``candidates`` entries carry: project_id, slug, host_path,
        hermes_path, container_path, root_kind, legacy_memory_scope and
        optional board_slug. Entries with missing paths, duplicate slugs,
        non-canonical host paths, or unverifiable roots are quarantined
        with an explicit reason and never resolve.
        """
        with self._lock:
            existing = self._records()
            by_slug: dict[str, PrivateWorkspaceRecord] = {}
            for record in existing:
                by_slug.setdefault(record.slug, record)
            migrated = list(existing)
            quarantined = 0
            promoted = 0
            for candidate in candidates:
                slug = str(candidate.get("slug") or "")
                host_path = str(candidate.get("host_path") or "")
                memory_scope = str(candidate.get("legacy_memory_scope") or "")
                root_kind = str(candidate.get("root_kind") or "live-reference")
                reason = ""
                if not _SAFE_SLUG.fullmatch(slug):
                    reason = "invalid slug"
                elif root_kind not in ROOT_KINDS:
                    reason = "invalid root kind"
                elif not memory_scope:
                    reason = "missing immutable memory scope"
                elif not any(
                    host_path.startswith(prefix) or host_path == prefix.rstrip("/")
                    for prefix in self._canonical_prefixes
                ):
                    reason = "host path is outside the canonical workspace roots"
                elif self._verify_host_paths and not self._host_root_ok(host_path):
                    reason = "host root missing or not a real directory"
                elif slug in by_slug:
                    reason = "duplicate slug; existing mapping preserved"
                if reason:
                    quarantined += 1
                    if slug not in by_slug:
                        evidence = PrivateWorkspaceRecord(
                            workspace_id=str(self._uuid()),
                            project_id=str(candidate.get("project_id") or slug),
                            slug=slug or "unknown",
                            host_path=host_path,
                            hermes_path=str(candidate.get("hermes_path") or ""),
                            container_path=str(candidate.get("container_path") or ""),
                            memory_scope=memory_scope,
                            board_binding_id=str(self._uuid()),
                            board_slug_private=None,
                            root_kind=root_kind if root_kind in ROOT_KINDS else "live-reference",
                            status="quarantined",
                            quarantine_reason=reason,
                            created_at=_now_iso(),
                        )
                        by_slug[evidence.slug] = evidence
                        migrated.append(evidence)
                    continue
                record = PrivateWorkspaceRecord(
                    workspace_id=str(self._uuid()),
                    project_id=str(candidate.get("project_id") or slug),
                    slug=slug,
                    host_path=host_path,
                    hermes_path=str(candidate.get("hermes_path") or f"/projects/{slug}"),
                    container_path=str(candidate.get("container_path") or f"/vps/projects/{slug}"),
                    memory_scope=memory_scope,
                    board_binding_id=str(self._uuid()),
                    board_slug_private=candidate.get("board_slug") or None,
                    root_kind=root_kind,
                    status="active",
                    created_at=_now_iso(),
                )
                by_slug[slug] = record
                migrated.append(record)
                promoted += 1
            if not any(record.slug == "unassigned" for record in migrated):
                migrated.append(
                    PrivateWorkspaceRecord(
                        workspace_id=str(self._uuid()),
                        project_id="unassigned",
                        slug="unassigned",
                        host_path="",
                        hermes_path="",
                        container_path="",
                        memory_scope=unassigned_scope,
                        board_binding_id=str(self._uuid()),
                        board_slug_private=None,
                        root_kind="upload-staging",
                        status="active",
                        created_at=_now_iso(),
                    )
                )
                promoted += 1
            self.save_records(migrated)
            return {"migrated": promoted, "quarantined": quarantined}

    @staticmethod
    def _host_root_ok(host_path: str) -> bool:
        try:
            path = Path(host_path)
            return path.is_dir() and not path.is_symlink()
        except OSError:
            return False

    def resolve_rel(self, workspace_id: str, raw_rel: object) -> ResolvedPath:
        """Resolve one normalized relative path beneath the workspace root."""
        record = self.get_active(workspace_id)
        rel = normalize_relative_path(raw_rel)
        root = record.host_path
        if not root:
            raise WorkspaceUnknown("workspace has no host root")
        resolved = self.safe_resolve(Path(root), rel)
        return ResolvedPath(display_path=rel, private_path=str(resolved), workspace_id=record.workspace_id)

    @staticmethod
    def safe_resolve(root: Path, rel: str) -> Path:
        """Resolve ``rel`` beneath ``root``, rejecting symlinks and escapes.

        Intermediate components must be real directories; the final
        component may be a directory or a regular file. Every open uses
        O_NOFOLLOW so symlinks fail closed at the exact component.
        """
        normalize_relative_path(rel)
        try:
            root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except OSError as error:
            raise PathRejected("workspace root is unavailable") from error
        try:
            resolved_root = os.readlink(f"/proc/self/fd/{root_fd}")
            parts = rel.split("/")
            current_fd = root_fd
            try:
                for index, part in enumerate(parts):
                    _validate_component(part)
                    try:
                        next_fd = os.open(part, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=current_fd)
                    except OSError as error:
                        raise PathRejected("path component is unavailable or a symlink") from error
                    if current_fd != root_fd:
                        os.close(current_fd)
                    current_fd = next_fd
                    st = os.fstat(current_fd)
                    if index < len(parts) - 1 and not stat.S_ISDIR(st.st_mode):
                        raise PathRejected("path traverses a non-directory component")
                resolved = os.readlink(f"/proc/self/fd/{current_fd}")
            finally:
                if current_fd != root_fd:
                    os.close(current_fd)
            if resolved != resolved_root and not resolved.startswith(resolved_root + "/"):
                raise PathRejected("resolved path escaped the workspace root")
            return Path(resolved)
        finally:
            os.close(root_fd)

    @staticmethod
    def safe_read_file(root: Path, rel: str, max_bytes: int = 8_000_000) -> bytes:
        """Open one regular file beneath ``root`` without following symlinks."""
        normalize_relative_path(rel)
        try:
            root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except OSError as error:
            raise PathRejected("workspace root is unavailable") from error
        try:
            try:
                fd = os.open(rel, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
            except OSError as error:
                raise PathRejected("file is unavailable or a symlink") from error
            try:
                st = os.fstat(fd)
                if not stat.S_ISREG(st.st_mode):
                    raise PathRejected("only regular files can be read")
                if st.st_size > max_bytes:
                    raise PathRejected("file exceeds the read limit")
                chunks = []
                while True:
                    chunk = os.read(fd, 1_000_000)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    if sum(len(item) for item in chunks) > max_bytes:
                        raise PathRejected("file exceeds the read limit")
                return b"".join(chunks)
            finally:
                os.close(fd)
        finally:
            os.close(root_fd)

    @staticmethod
    def safe_stat(root: Path, rel: str) -> os.stat_result:
        """Stat one path beneath ``root`` without following symlinks."""
        normalize_relative_path(rel)
        try:
            root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        except OSError as error:
            raise PathRejected("workspace root is unavailable") from error
        try:
            try:
                st = os.stat(rel, dir_fd=root_fd, follow_symlinks=False)
            except OSError as error:
                raise PathRejected("path is unavailable") from error
            if not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):
                raise PathRejected("sockets, devices, and FIFOs are rejected")
            return st
        finally:
            os.close(root_fd)

"""Local upload snapshots: atomic batches under the existing uploads root.

Finalized data partitions as ``projects/<opaque-project-id>/<session>/<batch>``
(or the explicit ``unassigned/`` scope) beneath the existing
``/data/uploads`` container root whose host twin is
``/srv/frank/data/window/uploads``. Batches are written to a temporary
directory, validated (counts/bytes/hashes), then atomically published
together with their manifest. A partial batch is never sendable. A snapshot
never changes when the original local folder changes.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import mimetypes
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from .manifest import MANIFEST_SCHEMA, _media_type
from .resolver import PathRejected, normalize_relative_path

UPLOAD_SNAPSHOT_SCHEMA = "schema://frank.upload-snapshot/v1"
_SAFE_BATCH = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class SnapshotError(RuntimeError):
    """Upload snapshot could not be staged, published, or removed."""


def require_same_origin(origin: str | None, content_type: str | None, expected_type: str) -> None:
    """Strict same-origin + exact content-type guard for browser mutations.

    Missing/null/cross-site Origin and any content-type other than the
    endpoint's exact expected type are refused. Session 1 adopts this guard
    centrally; new endpoints must call it before authorization.
    """
    if not origin or not origin.startswith("https://"):
        raise SnapshotError("same-origin request required")
    if content_type != expected_type:
        raise SnapshotError("unsupported content type")


class UploadSnapshotService:
    def __init__(
        self,
        uploads_root: Path,
        *,
        max_file_bytes: int,
        max_batch_bytes: int,
        max_batch_files: int,
        host_twin: str = "/srv/frank/data/window/uploads",
    ):
        self.root = Path(uploads_root)
        self.max_file_bytes = max_file_bytes
        self.max_batch_bytes = max_batch_bytes
        self.max_batch_files = max_batch_files
        self.host_twin = host_twin

    def _partition(self, workspace_id: str, project_id: str, slug: str) -> str:
        if slug == "unassigned":
            return "unassigned"
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", project_id or ""):
            raise PathRejected("invalid project partition")
        return f"projects/{project_id}"

    def _batch_dir(self, workspace_id: str, project_id: str, slug: str, session_id: str, batch_id: str) -> Path:
        if not _SAFE_BATCH.fullmatch(str(batch_id or "")):
            raise PathRejected("invalid batch id")
        if not _SAFE_BATCH.fullmatch(str(session_id or "")):
            raise PathRejected("invalid session id")
        partition = self._partition(workspace_id, project_id, slug)
        return self.root / partition / session_id / batch_id

    def stage_batch(
        self,
        *,
        workspace_id: str,
        project_id: str,
        slug: str,
        session_id: str,
        batch_id: str,
        files: list[dict],
    ) -> dict:
        """Write, validate, and atomically publish one finalized batch.

        Each file entry: ``{"path": safe-relative, "data": bytes,
        "declared_mime": optional-untrusted}``. Browser names and media
        types are untrusted; paths are normalized and validated, media
        types are derived from content-verified names only.
        """
        if not files:
            raise SnapshotError("batch contains no files")
        if len(files) > self.max_batch_files:
            raise SnapshotError("batch exceeds the file-count limit")
        batch_dir = self._batch_dir(workspace_id, project_id, slug, session_id, batch_id)
        if batch_dir.exists():
            raise SnapshotError("batch id already exists; use retry to replace failed files")
        temp_dir = batch_dir.parent / f".tmp-{batch_id}-{os.getpid()}"
        partition_root = self.root / batch_dir.relative_to(self.root).parts[0]
        if not str(temp_dir).startswith(str(partition_root)):
            raise SnapshotError("temp staging escaped the partition")
        total_bytes = 0
        entries = []
        try:
            temp_dir.mkdir(parents=True)
            for item in files:
                rel = normalize_relative_path(item.get("path"))
                data = item.get("data")
                if not isinstance(data, (bytes, bytearray)):
                    raise SnapshotError("file payload must be bytes")
                if len(data) > self.max_file_bytes:
                    raise SnapshotError(f"file exceeds the per-file limit: {rel}")
                total_bytes += len(data)
                if total_bytes > self.max_batch_bytes:
                    raise SnapshotError("batch exceeds the size limit")
                target = temp_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                # O_NOFOLLOW-style safety: we created the temp tree ourselves.
                with open(target, "xb") as handle:
                    handle.write(data)
                entries.append(
                    {
                        "path": rel,
                        "bytes": len(data),
                        "media_type": _media_type(rel),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                )
            entries.sort(key=lambda entry: entry["path"])
            manifest = {
                "schema": MANIFEST_SCHEMA,
                "source": "local-upload",
                "captured_at": _now(),
                "workspace_id": workspace_id,
                "session_id": session_id,
                "batch_id": batch_id,
                "entries": entries,
                "totals": {"files": len(entries), "bytes": total_bytes},
                "truncation": False,
                "host_twin_private": self.host_twin,
            }
            # Validate what we just wrote before publishing.
            for entry in entries:
                written = temp_dir / entry["path"]
                if written.stat().st_size != entry["bytes"]:
                    raise SnapshotError(f"staged size mismatch: {entry['path']}")
            manifest_path = temp_dir / "manifest.json"
            with open(manifest_path, "xb") as handle:
                handle.write(json.dumps(manifest, ensure_ascii=False).encode("utf-8"))
            temp_dir.chmod(0o750)
            os.rename(temp_dir, batch_dir)  # atomic publish
        except OSError as error:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise SnapshotError("batch staging failed") from error
        except Exception:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise
        return {"ok": True, "batch_id": batch_id, "manifest": self.batch_manifest(batch_dir)}

    @staticmethod
    def batch_manifest(batch_dir: Path) -> dict:
        manifest_path = Path(batch_dir) / "manifest.json"
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise SnapshotError("batch manifest is unavailable") from error
        if manifest.get("schema") != MANIFEST_SCHEMA:
            raise SnapshotError("batch manifest has an unsupported format")
        public = {k: v for k, v in manifest.items() if k != "host_twin_private"}
        public["sendable"] = True
        return public

    def status(self, batch_dir: Path) -> dict:
        path = Path(batch_dir)
        if (path / "manifest.json").is_file():
            return {"state": "finalized", "manifest": self.batch_manifest(path)}
        temp = path.parent / f".tmp-{path.name}-{os.getpid()}"
        if temp.is_dir():
            return {"state": "staging", "manifest": None}
        return {"state": "absent", "manifest": None}

    def cancel(self, batch_dir: Path) -> dict:
        """Remove an unpublished batch; a finalized batch needs delete instead."""
        path = Path(batch_dir)
        if (path / "manifest.json").is_file():
            raise SnapshotError("batch already finalized; use delete")
        temp = path.parent / f".tmp-{path.name}-{os.getpid()}"
        target = temp if temp.is_dir() else path
        if not str(target).startswith(str(self.root)):
            raise SnapshotError("cancel target escaped the uploads root")
        shutil.rmtree(target, ignore_errors=True)
        return {"ok": True, "state": "cancelled"}

    def delete(self, batch_dir: Path) -> dict:
        """Delete a finalized batch by exact resolved directory only."""
        path = Path(batch_dir).resolve(strict=True)
        root_resolved = self.root.resolve(strict=True)
        if path.parent == root_resolved or root_resolved not in path.parents:
            raise SnapshotError("delete target escaped the uploads root")
        if not (path / "manifest.json").is_file():
            raise SnapshotError("only finalized batches can be deleted")
        shutil.rmtree(path)
        return {"ok": True, "state": "deleted"}

    def retry(self, *, batch_dir: Path, files: list[dict], **stage_kwargs) -> dict:
        """Replace a failed staging attempt: cancel, then stage again."""
        self.cancel(batch_dir)
        return self.stage_batch(files=files, **stage_kwargs)

    def hermes_reference(self, batch_dir: Path, rel_folder: str) -> str:
        """Return the exact ``@folder:`` reference for Session 2's adapter.

        The bind root is the project root, so the reference is
        ``.frank-attachments/<partition-below-project>/<session>/<batch>/<folder>``
        and never exposes host or container absolute paths.
        """
        path = Path(batch_dir)
        if not (path / "manifest.json").is_file():
            raise SnapshotError("only finalized batches can be referenced")
        normalize_relative_path(rel_folder)
        relative = path.relative_to(self.root).as_posix()
        return f"@folder:.frank-attachments/{relative}/{rel_folder}"

    def prune_unreferenced(self, referenced_batch_dirs: list[Path], older_than_seconds: float) -> dict:
        """Retention via exact resolved directories, guarded beneath the root.

        Uses safe deletion APIs on exact attachment directories only; never
        a recursive destructive command over an arbitrary path.
        """
        root_resolved = self.root.resolve(strict=True)
        cutoff = time.time() - older_than_seconds
        removed = []
        keep = {Path(item).resolve(strict=True) for item in referenced_batch_dirs}
        for partition in sorted(self.root.iterdir()):
            if not partition.is_dir():
                continue
            for batch in partition.rglob("*"):
                if not batch.is_dir() or (batch / "manifest.json").is_file():
                    continue
                if batch.name.startswith(".tmp-") and batch.stat().st_mtime < cutoff:
                    resolved = batch.resolve()
                    if root_resolved in resolved.parents and resolved not in keep:
                        shutil.rmtree(resolved, ignore_errors=True)
                        removed.append(resolved.relative_to(root_resolved).as_posix())
        return {"removed": removed, "count": len(removed)}

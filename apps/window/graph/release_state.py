"""Immutable release records and the production-current release pointer.

This module deliberately treats templates as declarations, never as evidence.
It is filesystem-only so the pointer can be inspected and recovered without a
second state service.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

from .control_plane import ControlContractError, canonical_bytes


class ReleaseEvidenceError(ControlContractError):
    """Raised when a release cannot be promoted from its supplied evidence."""


_STAGES = ("step5", "step6c", "step7c", "step8")
_SHA = re.compile(r"^[0-9a-f]{40,64}$")
_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_ISO_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
_PLACEHOLDER = re.compile(r"(?:^|[-_ ])(?:todo|tbd|placeholder|example|changeme)(?:$|[-_ ])", re.I)


def _clean(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or _PLACEHOLDER.search(value.strip()):
        raise ReleaseEvidenceError(f"{name} is missing or is a template placeholder")
    return value.strip()


def _sha(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


class ReleaseStateStore:
    """Write immutable release records and atomically advance ``current.json``."""

    def __init__(self, root: Path):
        raw_root = Path(root)
        if self._contains_symlink(raw_root):
            raise ReleaseEvidenceError("release store paths must not be symlinks")
        self.root = raw_root.resolve()
        self.records = self.root / "releases"
        self.root.mkdir(parents=True, exist_ok=True)
        self.records.mkdir(parents=True, exist_ok=True)
        self._assert_secure_roots()

    @staticmethod
    def _contains_symlink(path: Path) -> bool:
        absolute = path.absolute()
        return any(candidate.is_symlink() for candidate in (absolute, *absolute.parents))

    def _assert_secure_roots(self) -> None:
        for path in (self.root, self.records):
            if path.is_symlink() or not path.is_dir():
                raise ReleaseEvidenceError("release store paths must remain real directories")
            cursor = path
            while cursor != cursor.parent:
                if cursor.is_symlink():
                    raise ReleaseEvidenceError("release store path contains a symlink")
                cursor = cursor.parent

    def _write(self, path: Path, value: Mapping[str, Any]) -> None:
        self._assert_secure_roots()
        if path.is_symlink() or path.parent.resolve() not in {self.root, self.records}:
            raise ReleaseEvidenceError("release target path is unsafe")
        fd, tmp = tempfile.mkstemp(prefix=".release-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(canonical_bytes(value)); stream.flush(); os.fsync(stream.fileno())
            os.replace(tmp, path)
            try:
                parent = os.open(path.parent, os.O_RDONLY); os.fsync(parent); os.close(parent)
            except OSError:
                if os.name != "nt": raise
        finally:
            if os.path.exists(tmp): os.unlink(tmp)

    @staticmethod
    def _validate_evidence(evidence: Mapping[str, Any], current_stage: str) -> dict[str, Any]:
        required = ("source_sha", "deployed_sha", "image_digest", "graph_revision",
                    "projection_manifests", "tests", "runtime_evidence", "browser_evidence",
                    "rollback_target", "feature_flags", "captured_at")
        missing = [key for key in required if key not in evidence]
        if missing: raise ReleaseEvidenceError("required release evidence absent: " + ", ".join(missing))
        source = _clean(evidence["source_sha"], "source_sha")
        deployed = _clean(evidence["deployed_sha"], "deployed_sha")
        if not _SHA.fullmatch(source) or not _SHA.fullmatch(deployed):
            raise ReleaseEvidenceError("source_sha and deployed_sha must be exact git SHAs")
        digest = _clean(evidence["image_digest"], "image_digest")
        if not _DIGEST.fullmatch(digest): raise ReleaseEvidenceError("image_digest must be a sha256 digest")
        for key in ("graph_revision", "rollback_target", "captured_at"):
            _clean(evidence[key], key)
        if not _DIGEST.fullmatch(evidence["graph_revision"]):
            raise ReleaseEvidenceError("graph_revision must be a sha256 digest")
        if not _SHA.fullmatch(evidence["rollback_target"]):
            raise ReleaseEvidenceError("rollback_target must be an exact git SHA")
        if not _ISO_TIME.fullmatch(evidence["captured_at"]):
            raise ReleaseEvidenceError("captured_at must be an ISO-8601 UTC timestamp")
        try:
            datetime.fromisoformat(evidence["captured_at"].replace("Z", "+00:00"))
        except ValueError as exc:
            raise ReleaseEvidenceError("captured_at must be a valid timestamp") from exc
        for key in ("projection_manifests", "tests", "runtime_evidence", "browser_evidence"):
            value = evidence[key]
            if not isinstance(value, (list, dict)) or not value: raise ReleaseEvidenceError(f"{key} evidence is absent")
        flags = evidence["feature_flags"]
        expected = {
            "step5": {"live_view", "map_view", "control_read", "reconciliation_schedules", "runtime_monitoring"},
            "step6c": {"live_view", "map_view", "control_read", "reconciliation_schedules", "runtime_monitoring", "safe_actions", "operational_actions", "source_actions"},
            "step7c": {"live_view", "map_view", "control_read", "reconciliation_schedules", "runtime_monitoring", "safe_actions", "operational_actions", "source_actions", "cleanup_jobs", "discovery_jobs", "evaluation_jobs", "chat_pattern_candidates"},
            "step8": {"live_view", "map_view", "control_read", "reconciliation_schedules", "runtime_monitoring", "safe_actions", "operational_actions", "source_actions", "cleanup_jobs", "discovery_jobs", "evaluation_jobs", "chat_pattern_candidates", "retention_restore_drills"},
        }
        if not isinstance(flags, dict) or set(flags) != expected[current_stage]: raise ReleaseEvidenceError("feature_flags must exactly match the release stage")
        if not all(flags.values()): raise ReleaseEvidenceError("release feature flags must all be enabled")
        if any(not isinstance(k, str) or not isinstance(v, bool) for k, v in flags.items()):
            raise ReleaseEvidenceError("feature_flags must be a boolean mapping")
        result = dict(evidence)
        result["feature_flag_hash"] = _sha(flags)
        return result

    def create_release(self, release_id: str, stage: str, evidence: Mapping[str, Any]) -> dict[str, Any]:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", release_id): raise ReleaseEvidenceError("invalid release id")
        if stage not in _STAGES: raise ReleaseEvidenceError("invalid release stage")
        record = {"id": "release:" + release_id, "release_id": release_id, "stage": stage,
                  "evidence": self._validate_evidence(evidence, stage)}
        target = self.records / (release_id + ".json")
        if target.is_symlink():
            raise ReleaseEvidenceError("release record path is unsafe")
        if target.exists():
            if json.loads(target.read_text(encoding="utf-8")) != record: raise ReleaseEvidenceError("immutable release collision")
            return record
        self._write(target, record)
        return record

    def advance_current(self, release_id: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", release_id):
            raise ReleaseEvidenceError("invalid release id")
        target = self.records / (release_id + ".json")
        if not target.is_file() or target.is_symlink(): raise ReleaseEvidenceError("release record not found")
        record = json.loads(target.read_text(encoding="utf-8"))
        current = self.read_current()
        if current:
            old, new = _STAGES.index(current["stage"]), _STAGES.index(record["stage"])
            if new != old + (0 if record["release_id"] == current["release_id"] else 1):
                raise ReleaseEvidenceError("release stage cannot skip or move backwards")
        elif record.get("stage") != "step5":
            raise ReleaseEvidenceError("the first promoted release must be step5")
        pointer = {"release_id": release_id, "record_hash": _sha(record)}
        self._write(self.root / "current.json", pointer)
        return record

    def read_release(self, release_id: str) -> dict[str, Any]:
        """Read and fully validate one immutable release record."""
        self._assert_secure_roots()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", release_id): raise ReleaseEvidenceError("invalid rollback release id")
        target = self.records / (release_id + ".json")
        if target.is_symlink() or not target.is_file(): raise ReleaseEvidenceError("rollback release not found")
        record = json.loads(target.read_text(encoding="utf-8"))
        if record.get("release_id") != release_id or record.get("id") != "release:" + release_id or record.get("stage") not in _STAGES:
            raise ReleaseEvidenceError("rollback release identity mismatch")
        checked = self._validate_evidence(record.get("evidence", {}), record["stage"])
        if checked != record.get("evidence"):
            raise ReleaseEvidenceError("rollback release evidence mismatch")
        return record

    def rollback_current(self, release_id: str, *, expected_current_release_id: str | None = None) -> dict[str, Any]:
        """Select an existing immutable release, deliberately permitting a prior stage."""
        record = self.read_release(release_id)
        if expected_current_release_id is not None:
            current = self.read_current()
            if current is None or current.get("release_id") != expected_current_release_id:
                raise ReleaseEvidenceError("current release changed before rollback")
        self._write(self.root / "current.json", {"release_id": release_id, "record_hash": _sha(record)})
        return record

    def clear_current(self, expected_release_id: str) -> None:
        """Remove only an expected pointer while compensating a failed first promotion."""
        self._assert_secure_roots()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", expected_release_id):
            raise ReleaseEvidenceError("invalid expected release id")
        path = self.root / "current.json"
        if path.is_symlink():
            raise ReleaseEvidenceError("invalid current release pointer")
        if not path.exists():
            return
        pointer = json.loads(path.read_text(encoding="utf-8"))
        if pointer.get("release_id") != expected_release_id:
            raise ReleaseEvidenceError("current release changed during compensation")
        path.unlink()
        try:
            parent = os.open(path.parent, os.O_RDONLY)
            os.fsync(parent)
            os.close(parent)
        except OSError:
            if os.name != "nt":
                raise

    def read_current(self) -> dict[str, Any] | None:
        self._assert_secure_roots()
        path = self.root / "current.json"
        if path.is_symlink(): raise ReleaseEvidenceError("invalid current release pointer")
        if not path.exists(): return None
        pointer = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(pointer.get("release_id"), str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", pointer["release_id"]): raise ReleaseEvidenceError("invalid current release pointer")
        record_path = self.records / (pointer.get("release_id", "") + ".json")
        if record_path.is_symlink() or not record_path.is_file(): raise ReleaseEvidenceError("invalid current release pointer")
        record = json.loads(record_path.read_text(encoding="utf-8"))
        if pointer.get("record_hash") != _sha(record): raise ReleaseEvidenceError("current release hash mismatch")
        return record

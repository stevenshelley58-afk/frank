"""Validated, immutable and atomic storage for control-graph generations."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Mapping

from .control_contract import (
    _validate_graph,
    derive_graph_revision,
    ensure_persisted_metadata_safe,
)
from .control_plane import ControlContractError, GRAPH_HASH_KEY, canonical_bytes


class ControlGraphStore:
    """Store generations below a private directory and expose one safe pointer."""

    def __init__(self, root: Path):
        supplied = Path(root)
        if self._contains_symlink(supplied):
            raise ControlContractError("store root must not be a symlink")
        self.root = supplied.resolve()
        self.graph_root = self.root / "graph"
        self._ensure_directory(self.root)
        self._ensure_directory(self.graph_root)
        # The parent is traversable by the locked report-job account, while
        # graph generations remain private and non-listable.
        os.chmod(self.root, 0o751)
        os.chmod(self.graph_root, 0o750)

    @staticmethod
    def _contains_symlink(path: Path) -> bool:
        absolute = path.absolute()
        return any(candidate.is_symlink() for candidate in (absolute, *absolute.parents))

    @staticmethod
    def _ensure_directory(path: Path) -> None:
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise ControlContractError("store path is not a real directory")
        path.mkdir(parents=True, exist_ok=True)
        if path.is_symlink() or not path.is_dir():
            raise ControlContractError("store path is not a real directory")

    def _assert_secure_roots(self) -> None:
        """Recheck mutable filesystem boundaries before every public operation."""
        for path in (self.root, self.graph_root):
            if path.is_symlink() or not path.is_dir():
                raise ControlContractError("store root must remain a real directory")
            cursor = path
            while cursor != cursor.parent:
                if cursor.is_symlink():
                    raise ControlContractError("store path contains a symlink")
                cursor = cursor.parent
    @staticmethod
    def _fsync_parent(path: Path) -> None:
        try:
            fd = os.open(path, os.O_RDONLY)
        except OSError:
            if os.name == "nt":
                return
            raise
        try:
            try:
                os.fsync(fd)
            except OSError:
                if os.name != "nt":
                    raise
        finally:
            os.close(fd)

    @classmethod
    def _atomic_file(cls, path: Path, value: object, mode: int = 0o640) -> None:
        cls._ensure_directory(path.parent)
        fd, temporary = tempfile.mkstemp(prefix=".tmp-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(canonical_bytes(value))
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, path)
            cls._fsync_parent(path.parent)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def _digest(value: object) -> str:
        return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()

    @staticmethod
    def _read_regular(path: Path) -> dict[str, Any]:
        if path.is_symlink() or not path.is_file():
            raise ControlContractError(f"target is not a regular file: {path.name}")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeError, ValueError) as error:
            raise ControlContractError(f"malformed control-graph JSON: {path.name}") from error
        if not isinstance(value, dict):
            raise ControlContractError(f"control-graph JSON must be an object: {path.name}")
        return value

    def _generation(self, graph_hash: str) -> Path:
        if not isinstance(graph_hash, str) or not GRAPH_HASH_KEY.fullmatch(graph_hash):
            raise ControlContractError("invalid graph hash")
        target = self.graph_root / graph_hash
        if target.is_symlink() or not target.is_dir():
            raise ControlContractError("invalid generation path")
        cursor = self.graph_root
        for part in target.relative_to(self.graph_root).parts:
            cursor = cursor / part
            if cursor.is_symlink() or not cursor.is_dir():
                raise ControlContractError("invalid generation path")
        return target

    @staticmethod
    def _validate_manifest(graph_hash: str, graph: Mapping[str, Any], assertions: Mapping[str, Any], findings: Any, manifest: Mapping[str, Any]) -> None:
        required = {"graph_revision", "graph_hash", "assertions_hash", "findings_hash"}
        if not required.issubset(manifest):
            raise ControlContractError("manifest is missing required hash fields")
        if manifest["graph_revision"] != graph_hash or graph.get("graph_revision") != graph_hash:
            raise ControlContractError("graph hash/revision mismatch")
        if derive_graph_revision(graph, manifest) != graph_hash:
            raise ControlContractError("graph revision is not derived from manifest inputs")
        expected = {
            "graph_hash": ControlGraphStore._digest(graph),
            "assertions_hash": ControlGraphStore._digest(assertions),
            "findings_hash": ControlGraphStore._digest(findings),
        }
        for key, value in expected.items():
            if manifest.get(key) != value:
                raise ControlContractError(f"{key} mismatch")

    def write_generation(self, graph_hash: str, graph: dict, assertions: dict, manifest: dict) -> Path:
        self._assert_secure_roots()
        if not GRAPH_HASH_KEY.fullmatch(graph_hash):
            raise ControlContractError("invalid graph hash")
        _validate_graph(graph)
        if not isinstance(assertions, dict) or not isinstance(manifest, dict):
            raise ControlContractError("assertions and manifest must be objects")
        ensure_persisted_metadata_safe(graph)
        ensure_persisted_metadata_safe(assertions)
        ensure_persisted_metadata_safe(manifest)
        findings = assertions.get("findings", [])
        if not isinstance(findings, list):
            raise ControlContractError("assertions findings must be an array")
        self._validate_manifest(graph_hash, graph, assertions, findings, manifest)
        target = self.graph_root / graph_hash
        values = {"graph.json": graph, "assertions.json": assertions, "findings.json": {"findings": findings}, "manifest.json": manifest}

        def existing_or_collision() -> Path:
            existing = self._generation(graph_hash)
            for name, value in values.items():
                if self._read_regular(existing / name) != value:
                    raise ControlContractError("immutable generation collision or tamper")
            return existing

        if target.exists() or target.is_symlink():
            return existing_or_collision()
        temporary = Path(tempfile.mkdtemp(prefix=".generation-", dir=self.graph_root))
        try:
            os.chmod(temporary, 0o750)
            values = {"graph.json": graph, "assertions.json": assertions, "findings.json": {"findings": findings}, "manifest.json": manifest}
            for name, value in values.items():
                self._atomic_file(temporary / name, value)
            # ``rename`` refuses to replace an existing non-empty directory.
            # That makes two writers converge on one immutable generation;
            # ``replace`` would silently overwrite a winner on POSIX.
            try:
                os.rename(temporary, target)
            except OSError:
                if not (target.exists() or target.is_symlink()):
                    raise
                shutil.rmtree(temporary, ignore_errors=True)
                return existing_or_collision()
            self._fsync_parent(self.graph_root)
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
        return target

    def advance_current(self, graph_hash: str) -> None:
        self._assert_secure_roots()
        generation = self._generation(graph_hash)
        snapshot = self._read_generation(generation, graph_hash)
        self._atomic_file(self.graph_root / "current.json", {"graph_hash": graph_hash, "path": f"{graph_hash}/manifest.json", "manifest_hash": self._digest(snapshot["manifest"])})

    def _read_generation(self, generation: Path, graph_hash: str) -> dict[str, Any]:
        graph = self._read_regular(generation / "graph.json")
        assertions = self._read_regular(generation / "assertions.json")
        findings_doc = self._read_regular(generation / "findings.json")
        manifest = self._read_regular(generation / "manifest.json")
        for value in (graph, assertions, findings_doc, manifest):
            ensure_persisted_metadata_safe(value)
        findings = findings_doc.get("findings")
        if not isinstance(findings, list):
            raise ControlContractError("findings document is malformed")
        _validate_graph(graph)
        self._validate_manifest(graph_hash, graph, assertions, findings, manifest)
        return {"graph": graph, "assertions": assertions, "findings": findings, "manifest": manifest}

    def read_current(self) -> dict[str, Any]:
        self._assert_secure_roots()
        pointer = self.graph_root / "current.json"
        if pointer.is_symlink():
            raise ControlContractError("current pointer must not be a symlink")
        if not pointer.exists():
            raise FileNotFoundError(pointer)
        value = self._read_regular(pointer)
        graph_hash = value.get("graph_hash")
        if not isinstance(graph_hash, str) or value.get("path") != f"{graph_hash}/manifest.json":
            raise ControlContractError("invalid current pointer path")
        snapshot = self._read_generation(self._generation(graph_hash), graph_hash)
        if value.get("manifest_hash") != self._digest(snapshot["manifest"]):
            raise ControlContractError("pointer hash mismatch")
        return snapshot["manifest"]

    def read_snapshot(self) -> dict[str, Any]:
        manifest = self.read_current()
        revision = manifest.get("graph_revision")
        return self._read_generation(self._generation(revision), revision)

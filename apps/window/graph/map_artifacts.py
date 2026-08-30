"""Immutable, preview-scoped storage for validated Archify map artifacts.

The map store deliberately owns only artifact bytes, manifests, and pointers.
It never promotes a preview to production; that is a separately governed Step 5
operation.  Every name which crosses the filesystem boundary is encoded from a
canonical stable ID, so IDs cannot become path traversal or symlink gadgets.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .control_plane import ControlContractError, canonical_bytes


_SHA256 = "sha256:"
MANDATORY_PROJECTIONS = frozenset({
    "projection:vps/world",
    "projection:frank/architecture",
    "projection:blockwise/runtime",
    "projection:mini-frank/knowledge-flow",
    "projection:ad-template-builder/architecture",
    "projection:ad-template-builder/workflow",
})
_ID_RE = re.compile(
    r"^(?:vps|project|repo|runtime|service|component|worker|store|route|"
    r"capability|rule|skill|tool|plugin|cli|mcp|app|template|library|hook|"
    r"gate|policy|runbook|eval|observer|source|release|projection|generation|"
    r"receipt|proposal|finding|mapping|run|edge):[a-z0-9]+(?:-[a-z0-9]+)*"
    r"(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$"
)


def _stable_id(value: str, label: str = "stable ID") -> str:
    if not isinstance(value, str) or _ID_RE.fullmatch(value) is None:
        raise ControlContractError(f"invalid {label}")
    if value != value.lower():
        raise ControlContractError(f"{label} must be canonical lowercase")
    return value


def id_key(stable_id: str) -> str:
    """Return the plan's reversible, filesystem-safe ``id_`` key."""
    value = _stable_id(stable_id)
    encoded = base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")
    return "id_" + encoded


def _decode_id_key(key: str, expected: str | None = None) -> str:
    if not isinstance(key, str) or not key.startswith("id_") or "/" in key or "\\" in key:
        raise ControlContractError("invalid encoded ID key")
    encoded = key[3:]
    if not encoded or "=" in encoded or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in encoded):
        raise ControlContractError("invalid encoded ID key")
    try:
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8")
    except (ValueError, UnicodeError) as exc:
        raise ControlContractError("invalid encoded ID key") from exc
    if id_key(raw) != key or (expected is not None and raw != expected):
        raise ControlContractError("non-canonical encoded ID key")
    return raw


def _hash_bytes(value: bytes) -> str:
    return _SHA256 + hashlib.sha256(value).hexdigest()


def _hash_json(value: object) -> str:
    return _hash_bytes(canonical_bytes(value))


def _regular(path: Path, root: Path, *, json_object: bool = False) -> Any:
    """Read a regular file whose unresolved and resolved paths stay in root."""
    root = root.resolve()
    try:
        path.absolute().relative_to(root)
    except ValueError as exc:
        raise ControlContractError("map artifact path escapes control root") from exc
    cursor = root
    for part in path.absolute().relative_to(root).parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ControlContractError("map artifact path contains a symlink")
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ControlContractError("map artifact path is unavailable") from exc
    if resolved != root and root not in resolved.parents:
        raise ControlContractError("map artifact path escapes control root")
    if not resolved.is_file() or resolved.is_symlink():
        raise ControlContractError("map artifact is not a regular file")
    data = resolved.read_bytes()
    if json_object:
        try:
            value = json.loads(data.decode("utf-8"))
        except (UnicodeError, ValueError) as exc:
            raise ControlContractError("map JSON is malformed") from exc
        if not isinstance(value, dict):
            raise ControlContractError("map JSON must be an object")
        return value
    return data


class MapArtifactStore:
    """Store immutable map generations and preview-only current pointers."""

    def __init__(self, root: Path | str):
        supplied = Path(root)
        if supplied.exists() and supplied.is_symlink():
            raise ControlContractError("map root must not be a symlink")
        self.root = supplied.resolve()
        self._ensure_dir(self.root)

    @staticmethod
    def _ensure_dir(path: Path) -> None:
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise ControlContractError("map storage path is not a real directory")
        path.mkdir(parents=True, exist_ok=True)
        if path.is_symlink() or not path.is_dir():
            raise ControlContractError("map storage path is not a real directory")

    def _secure(self) -> None:
        for path in (self.root, self.root / "maps", self.root / "previews"):
            if path.exists() and (path.is_symlink() or not path.is_dir()):
                raise ControlContractError("map storage boundary was replaced")
        cursor = self.root
        while cursor != cursor.parent:
            if cursor.is_symlink():
                raise ControlContractError("map storage boundary contains a symlink")
            cursor = cursor.parent

    @staticmethod
    def _atomic(path: Path, data: bytes) -> None:
        MapArtifactStore._ensure_dir(path.parent)
        fd, name = tempfile.mkstemp(prefix=".map-", dir=str(path.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(name, 0o640)
            os.replace(name, path)
        finally:
            try:
                os.unlink(name)
            except FileNotFoundError:
                pass

    @staticmethod
    def _validate_manifest(manifest: Mapping[str, Any], projection_id: str, generation_id: str, artifact: bytes | None) -> dict[str, Any]:
        value = copy.deepcopy(dict(manifest))
        required = {
            "projection_id", "graph_revision", "generation_id", "source_revisions",
            "deployed_revisions", "coverage", "exclusions", "archify_version",
            "archify_hash", "validation_receipt_id", "artifact_hash", "prior_passing_manifest",
            "generated_at", "freshness", "stale_reason",
        }
        missing = required - set(value)
        if missing:
            raise ControlContractError("map manifest missing required fields")
        if value["projection_id"] != projection_id or value["generation_id"] != generation_id:
            raise ControlContractError("map manifest identity mismatch")
        _stable_id(projection_id, "projection ID")
        _stable_id(generation_id, "generation ID")
        graph_revision = value["graph_revision"]
        if not isinstance(graph_revision, str) or not re.fullmatch(r"g_[0-9a-f]{64}", graph_revision):
            raise ControlContractError("invalid map graph revision")
        for name in ("source_revisions", "deployed_revisions"):
            if not isinstance(value[name], dict) or any(not isinstance(k, str) or not isinstance(v, str) or not v for k, v in value[name].items()):
                raise ControlContractError(f"invalid map {name}")
        if not isinstance(value["coverage"], list) or any(not isinstance(item, str) or not item for item in value["coverage"]) or len(set(value["coverage"])) != len(value["coverage"]):
            raise ControlContractError("map coverage must be a unique list")
        if not isinstance(value["exclusions"], list) or any(not isinstance(item, str) or not item for item in value["exclusions"]) or len(set(value["exclusions"])) != len(value["exclusions"]):
            raise ControlContractError("map exclusions must be a unique list")
        if value["freshness"] not in {"fresh", "stale", "unavailable", "unknown"}:
            raise ControlContractError("invalid map freshness")
        if value["freshness"] == "fresh" and value["stale_reason"] is not None:
            raise ControlContractError("fresh map cannot have a stale reason")
        value.setdefault("status", "generated")
        if value["status"] not in {"generated", "not_generated"}:
            raise ControlContractError("invalid map generation status")
        if value["status"] == "not_generated":
            missing_evidence = value.get("missing_evidence")
            if not isinstance(missing_evidence, list) or not missing_evidence:
                raise ControlContractError("missing map coverage must name missing evidence")
        if not isinstance(value["archify_version"], str) or not value["archify_version"]:
            raise ControlContractError("missing Archify version")
        if not isinstance(value["archify_hash"], str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", value["archify_hash"]):
            raise ControlContractError("invalid Archify hash")
        if not isinstance(value["artifact_hash"], str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", value["artifact_hash"]):
            raise ControlContractError("invalid map artifact hash")
        _stable_id(value["validation_receipt_id"], "validation receipt ID")
        if value["prior_passing_manifest"] is not None and not isinstance(value["prior_passing_manifest"], str):
            raise ControlContractError("invalid prior passing manifest")
        if not isinstance(value["generated_at"], str) or not value["generated_at"]:
            raise ControlContractError("missing map generation timestamp")
        try:
            datetime.fromisoformat(value["generated_at"].replace("Z", "+00:00"))
        except ValueError as exc:
            raise ControlContractError("invalid map generation timestamp") from exc
        if value["stale_reason"] is not None and not isinstance(value["stale_reason"], str):
            raise ControlContractError("invalid map stale reason")
        if artifact is not None:
            expected = _hash_bytes(artifact)
            if value.get("artifact_hash") != expected:
                raise ControlContractError("map artifact hash mismatch")
        elif value.get("status") == "generated":
            raise ControlContractError("generated map requires an artifact")
        if artifact is not None and value.get("status") == "not_generated":
            raise ControlContractError("not-generated map cannot contain an artifact")
        return value

    def _generation_dir(self, projection_id: str, generation_id: str) -> Path:
        _stable_id(projection_id, "projection ID")
        _stable_id(generation_id, "generation ID")
        return self.root / "maps" / id_key(projection_id) / id_key(generation_id)

    def write_generation(self, projection_id: str, generation_id: str, manifest: Mapping[str, Any], artifact: bytes | str | Path, *, root: Path | str | None = None) -> Path:
        """Write one generation; an existing generation can only be identical."""
        self._secure()
        if isinstance(artifact, (str, Path)):
            artifact_root = Path(root).resolve() if root is not None else self.root
            artifact_bytes = _regular(Path(artifact), artifact_root)
        elif isinstance(artifact, bytes):
            artifact_bytes = artifact
        else:
            raise ControlContractError("map artifact must be bytes or a regular file")
        if not artifact_bytes:
            raise ControlContractError("map artifact cannot be empty")
        checked = self._validate_manifest(manifest, projection_id, generation_id, artifact_bytes)
        target = self._generation_dir(projection_id, generation_id)
        if target.exists() or target.is_symlink():
            if target.is_symlink() or not target.is_dir():
                raise ControlContractError("map generation path is invalid")
            prior_manifest = _regular(target / "manifest.json", self.root, json_object=True)
            prior_artifact = _regular(target / "artifact.html", self.root)
            if prior_manifest != checked or prior_artifact != artifact_bytes:
                raise ControlContractError("immutable map generation collision or tamper")
            return target
        parent = target.parent
        self._ensure_dir(parent)
        temporary = Path(tempfile.mkdtemp(prefix=".generation-", dir=str(parent)))
        try:
            self._atomic(temporary / "manifest.json", canonical_bytes(checked))
            self._atomic(temporary / "artifact.html", artifact_bytes)
            try:
                os.rename(temporary, target)
            except OSError:
                if not target.exists() and not target.is_symlink():
                    raise
                prior_manifest = _regular(target / "manifest.json", self.root, json_object=True)
                prior_artifact = _regular(target / "artifact.html", self.root)
                if prior_manifest != checked or prior_artifact != artifact_bytes:
                    raise ControlContractError("immutable map generation collision or tamper")
                return target
        except Exception:
            if temporary.exists():
                for child in temporary.iterdir():
                    child.unlink(missing_ok=True)
                temporary.rmdir()
            raise
        return target

    def publish_preview(self, preview_run_key: str, manifests: Mapping[str, Mapping[str, Any]]) -> dict[str, str]:
        """Advance both mandatory map pointers for a single preview."""
        _stable_id(preview_run_key, "preview run ID")
        if not isinstance(manifests, Mapping) or set(manifests) != MANDATORY_PROJECTIONS:
            raise ControlContractError("preview must contain exactly six mandatory projections")
        pointers: dict[str, str] = {}
        for projection_id in sorted(manifests):
            generation_id = manifests[projection_id].get("generation_id")
            _stable_id(generation_id, "generation ID")
            pointers[projection_id] = str(self.advance_current(projection_id, generation_id, preview_run_key=preview_run_key))
        return pointers

    def write_missing(self, projection_id: str, generation_id: str, manifest: Mapping[str, Any], *, preview_run_key: str | None = None) -> Path:
        """Record an explicit not-generated/missing-evidence manifest."""
        self._secure()
        checked = self._validate_manifest(manifest, projection_id, generation_id, None)
        target = self._generation_dir(projection_id, generation_id)
        if target.exists() or target.is_symlink():
            if target.is_symlink() or not target.is_dir():
                raise ControlContractError("map generation path is invalid")
            existing = _regular(target / "manifest.json", self.root, json_object=True)
            if existing != checked or (target / "artifact.html").exists():
                raise ControlContractError("immutable missing-generation collision or tamper")
        else:
            self._ensure_dir(target.parent)
            self._ensure_dir(target)
            self._atomic(target / "manifest.json", canonical_bytes(checked))
        if preview_run_key is not None:
            self.advance_current(projection_id, generation_id, preview_run_key=preview_run_key, allow_missing=True)
        return target

    def advance_current(self, projection_id: str, generation_id: str, *, preview_run_key: str, allow_missing: bool = False) -> Path:
        """Atomically select a passing generation in one preview namespace."""
        self._secure()
        _stable_id(preview_run_key, "preview run ID")
        target = self._generation_dir(projection_id, generation_id)
        manifest = _regular(target / "manifest.json", self.root, json_object=True)
        artifact_path = target / "artifact.html"
        if manifest.get("status", "generated") != "generated" and not allow_missing:
            raise ControlContractError("only generated maps can become current")
        if manifest.get("status", "generated") == "generated":
            artifact = _regular(artifact_path, self.root)
            if manifest.get("artifact_hash") != _hash_bytes(artifact):
                raise ControlContractError("current map artifact is tampered")
        pointer_dir = self.root / "previews" / id_key(preview_run_key) / "maps" / id_key(projection_id)
        pointer = pointer_dir / "current.json"
        payload = {
            "manifest_id": generation_id,
            "manifest_path": (target.relative_to(self.root) / "manifest.json").as_posix(),
            "artifact_path": (target.relative_to(self.root) / "artifact.html").as_posix(),
            "manifest_hash": _hash_json(manifest),
            "artifact_hash": manifest.get("artifact_hash"),
        }
        self._atomic(pointer, canonical_bytes(payload))
        return pointer

    def resolve_current(self, projection_id: str, *, preview_run_key: str) -> dict[str, Any]:
        self._secure()
        _stable_id(preview_run_key, "preview run ID")
        _stable_id(projection_id, "projection ID")
        pointer = self.root / "previews" / id_key(preview_run_key) / "maps" / id_key(projection_id) / "current.json"
        value = _regular(pointer, self.root, json_object=True)
        generation_id = value.get("manifest_id")
        _stable_id(generation_id, "manifest ID")
        target = self._generation_dir(projection_id, generation_id)
        if value.get("manifest_path") != (target.relative_to(self.root) / "manifest.json").as_posix():
            raise ControlContractError("current map pointer path mismatch")
        manifest = _regular(target / "manifest.json", self.root, json_object=True)
        if value.get("manifest_hash") != _hash_json(manifest):
            raise ControlContractError("current map manifest hash mismatch")
        if manifest.get("status", "generated") != "generated":
            return {"pointer": value, "manifest": manifest, "artifact": None,
                    "artifact_path": value.get("artifact_path")}
        artifact = _regular(target / "artifact.html", self.root)
        if value.get("artifact_hash") != _hash_bytes(artifact) or manifest.get("artifact_hash") != _hash_bytes(artifact):
            raise ControlContractError("current map artifact hash mismatch")
        return {"pointer": value, "manifest": manifest, "artifact": artifact,
                "artifact_path": value["artifact_path"]}

    def rollback_current(self, projection_id: str, generation_id: str, *, preview_run_key: str) -> Path:
        """Repoint a preview to an existing validated generation.

        This intentionally has no deletion or mutation path: retention and any
        later governed cleanup remain outside the map provider.
        """
        return self.advance_current(projection_id, generation_id, preview_run_key=preview_run_key)

    def record_failure(self, projection_id: str | Mapping[str, Any], *, preview_run_key: str | None = None, reason: str | None = None,
                       generation_id: str | None = None) -> Path:
        """Persist a bounded failure receipt without touching the current pointer."""
        self._secure()
        if isinstance(projection_id, Mapping):
            receipt = projection_id
            projection_id = str(receipt.get("projection_id", "projection:vps/world"))
            preview_run_key = str(receipt.get("run_key", ""))
            reason = str(receipt.get("reason", "map generation failed"))
            generation_id = receipt.get("generation_id")
        _stable_id(projection_id, "projection ID")
        _stable_id(preview_run_key, "preview run ID")
        if not isinstance(reason, str) or not reason or len(reason) > 512:
            raise ControlContractError("invalid map failure reason")
        if generation_id is not None:
            _stable_id(generation_id, "generation ID")
        receipt = {
            "projection_id": projection_id,
            "preview_run_id": preview_run_key,
            "generation_id": generation_id,
            "status": "failure",
            "reason": reason,
        }
        target = self.root / "previews" / id_key(preview_run_key) / "maps" / id_key(projection_id) / "last-failure.json"
        self._atomic(target, canonical_bytes(receipt))
        return target

    def list_projections(self, *, preview_run_key: str) -> list[dict[str, Any]]:
        """List only projection IDs represented by safe preview pointers."""
        self._secure()
        _stable_id(preview_run_key, "preview run ID")
        directory = self.root / "previews" / id_key(preview_run_key) / "maps"
        if not directory.exists():
            return []
        if directory.is_symlink() or not directory.is_dir():
            raise ControlContractError("preview map directory is invalid")
        result = []
        for child in sorted(directory.iterdir(), key=lambda item: item.name):
            if child.is_symlink() or not child.is_dir():
                raise ControlContractError("preview map entry is invalid")
            projection_id = _decode_id_key(child.name)
            try:
                resolved = self.resolve_current(projection_id, preview_run_key=preview_run_key)
            except FileNotFoundError:
                continue
            result.append({"projection_id": projection_id, "manifest": resolved["manifest"], "pointer": resolved["pointer"]})
        return result


    def resolve_production_current(self, projection_id: str) -> dict[str, Any]:
        """Resolve one projection through the single atomic production selector."""
        self._secure(); _stable_id(projection_id, "projection ID")
        current = _regular(self.root / "current.json", self.root, json_object=True)
        if (
            current.get("schema") != "frank.map-promotion/v1"
            or current.get("status") != "promoted"
            or not isinstance(current.get("graph_revision"), str)
            or re.fullmatch(r"g_[0-9a-f]{64}", current["graph_revision"]) is None
            or not isinstance(current.get("projections"), dict)
            or set(current["projections"]) != MANDATORY_PROJECTIONS
        ):
            raise ControlContractError("production map selector is unavailable")
        pointer = current["projections"].get(projection_id)
        if not isinstance(pointer, dict) or pointer.get("graph_revision") != current.get("graph_revision"):
            raise ControlContractError("production map projection is not selected")
        for key in ("manifest_path", "artifact_path"):
            value = pointer.get(key)
            if not isinstance(value, str) or Path(value).is_absolute() or any(part in {"", ".", ".."} for part in Path(value).parts):
                raise ControlContractError("production map pointer path is unsafe")
        manifest_path = self.root / pointer["manifest_path"]; artifact_path = self.root / pointer["artifact_path"]
        manifest = _regular(manifest_path, self.root, json_object=True)
        artifact = _regular(artifact_path, self.root)
        if manifest.get("projection_id") != projection_id or manifest.get("generation_id") != pointer.get("generation_id") or manifest.get("graph_revision") != current.get("graph_revision"):
            raise ControlContractError("production map manifest identity mismatch")
        if pointer.get("manifest_hash") != _hash_json(manifest) or pointer.get("artifact_hash") != _hash_bytes(artifact) or manifest.get("artifact_hash") != _hash_bytes(artifact):
            raise ControlContractError("production map hash mismatch")
        return {"pointer": pointer, "manifest": manifest, "artifact": artifact, "artifact_path": pointer["artifact_path"]}

    def list_production_projections(self) -> list[dict[str, Any]]:
        current = _regular(self.root / "current.json", self.root, json_object=True)
        projections = current.get("projections", {})
        if not isinstance(projections, dict) or set(projections) != MANDATORY_PROJECTIONS:
            raise ControlContractError("production map selector is malformed")
        return [{"projection_id": projection, "manifest": self.resolve_production_current(projection)["manifest"], "pointer": pointer} for projection, pointer in sorted(projections.items())]


class MapArtifactProvider:
    """Read-only provider facade over preview or production map state."""

    def __init__(self, store: MapArtifactStore, preview_run_key: str | None = None):
        self.store = store
        if preview_run_key is not None: _stable_id(preview_run_key, "preview run ID")
        self.preview_run_key = preview_run_key

    def list_projections(self) -> list[dict[str, Any]]:
        return self.store.list_projections(preview_run_key=self.preview_run_key) if self.preview_run_key else self.store.list_production_projections()

    def resolve_current(self, projection_id: str) -> dict[str, Any]:
        return self.store.resolve_current(projection_id, preview_run_key=self.preview_run_key) if self.preview_run_key else self.store.resolve_production_current(projection_id)

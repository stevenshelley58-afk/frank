"""Fail-closed promotion boundary for validated map previews."""
from __future__ import annotations
import hashlib, json, os, re, tempfile, time
from pathlib import Path
from typing import Any, Mapping
from .control_plane import ControlContractError, canonical_bytes
from .map_artifacts import MapArtifactStore, id_key
try: import fcntl
except ImportError: fcntl = None

class PromotionError(ControlContractError): pass

def _secure_path(path: Path, root: Path) -> None:
    absolute_root = root.absolute()
    absolute = path.absolute()
    try: relative = absolute.relative_to(absolute_root)
    except ValueError as error: raise PromotionError("map promotion path escapes root") from error
    cursor = absolute_root
    if cursor.is_symlink(): raise PromotionError("map promotion path contains a symlink")
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink(): raise PromotionError("map promotion path contains a symlink")

def _atomic(path: Path, value: Mapping[str, Any], root: Path) -> None:
    _secure_path(path, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    _secure_path(path.parent, root)
    if path.is_symlink() or (path.exists() and not path.is_file()): raise PromotionError("map promotion target is unsafe")
    fd, name = tempfile.mkstemp(prefix=".promotion-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical_bytes(value)); stream.flush(); os.fsync(stream.fileno())
        os.chmod(name, 0o640)
        os.replace(name, path)
        try:
            parent = os.open(path.parent, os.O_RDONLY); os.fsync(parent); os.close(parent)
        except OSError:
            if os.name != "nt": raise
    finally:
        try: os.unlink(name)
        except FileNotFoundError: pass

def _regular(path: Path, root: Path) -> bytes:
    _secure_path(path, root)
    if path.is_symlink() or not path.is_file(): raise PromotionError("preview source is not a regular file")
    try: path.resolve().relative_to(root.resolve())
    except ValueError as error: raise PromotionError("preview source escapes production root") from error
    return path.read_bytes()

def _source_manifest(root: Path, projection: str, generation: str) -> tuple[Path, Path, dict[str, Any]]:
    manifest_path = root / "maps" / id_key(projection) / id_key(generation) / "manifest.json"
    artifact_path = manifest_path.parent / "artifact.html"
    try: manifest = json.loads(_regular(manifest_path, root).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error: raise PromotionError("preview manifest is invalid") from error
    if not isinstance(manifest, dict): raise PromotionError("preview manifest is invalid")
    return manifest_path, artifact_path, manifest

def promote(*, receipt: Mapping[str, Any], production_root: Path | str, mandatory: set[str], timeout_seconds: float = 300) -> dict[str, Any]:
    """Promote a receipt after verifying every immutable preview source byte."""
    started = time.monotonic(); run_key = receipt.get("run_key"); manifests = receipt.get("manifests")
    if receipt.get("status") != "passed" or not isinstance(run_key, str) or not isinstance(manifests, Mapping): raise PromotionError("preview receipt is not passing")
    try: release_key = id_key(run_key)
    except ControlContractError as error: raise PromotionError("preview run identity is invalid") from error
    if set(manifests) != mandatory or not mandatory: raise PromotionError("mandatory projection set is incomplete")
    supplied = Path(production_root)
    absolute = supplied.absolute()
    if any(candidate.is_symlink() for candidate in (absolute, *absolute.parents)): raise PromotionError("production path contains a symlink")
    supplied.mkdir(parents=True, exist_ok=True)
    if supplied.resolve() != absolute: raise PromotionError("production path must not contain symlinks")
    root = supplied.resolve()
    checked: dict[str, dict[str, Any]] = {}; graph_revision: str | None = None
    for projection, receipt_manifest in sorted(manifests.items()):
        if time.monotonic() - started > timeout_seconds: raise PromotionError("promotion deadline exceeded")
        if not isinstance(projection, str) or projection not in mandatory: raise PromotionError("invalid projection identity")
        if not isinstance(receipt_manifest, Mapping) or receipt_manifest.get("status") != "generated" or receipt_manifest.get("preview_only") is not True: raise PromotionError("projection is not a validated preview")
        generation = receipt_manifest.get("generation_id")
        if not isinstance(generation, str) or not generation.startswith("generation:"): raise PromotionError("generation identity missing")
        manifest_path, artifact_path, source_manifest = _source_manifest(root, projection, generation)
        artifact = _regular(artifact_path, root)
        try: validated_manifest = MapArtifactStore._validate_manifest(source_manifest, projection, generation, artifact)
        except ControlContractError as error: raise PromotionError("preview manifest schema is invalid") from error
        if validated_manifest != source_manifest: raise PromotionError("preview manifest is not canonical")
        for key in ("projection_id", "generation_id", "graph_revision", "artifact_hash", "status", "preview_only"):
            if key not in receipt_manifest or source_manifest.get(key) != receipt_manifest.get(key):
                raise PromotionError("preview manifest identity does not match receipt")
        artifact_hash = "sha256:" + hashlib.sha256(artifact).hexdigest()
        if source_manifest.get("artifact_hash") != artifact_hash: raise PromotionError("preview artifact hash mismatch")
        manifest_hash = "sha256:" + hashlib.sha256(canonical_bytes(source_manifest)).hexdigest()
        if receipt_manifest.get("manifest_hash") not in (None, manifest_hash): raise PromotionError("preview manifest hash mismatch")
        revision = source_manifest.get("graph_revision")
        if not isinstance(revision, str) or not re.fullmatch(r"g_[0-9a-f]{64}", revision): raise PromotionError("preview graph revision missing")
        if graph_revision is None: graph_revision = revision
        elif graph_revision != revision: raise PromotionError("preview graph revisions differ")
        checked[projection] = {"generation_id": generation, "graph_revision": revision, "manifest_path": manifest_path.relative_to(root).as_posix(), "artifact_path": artifact_path.relative_to(root).as_posix(), "manifest_hash": manifest_hash, "artifact_hash": artifact_hash}
    if graph_revision is None: raise PromotionError("preview graph revision missing")
    lock_path = root / ".promotion.lock"; _secure_path(lock_path, root)
    if lock_path.is_symlink() or (lock_path.exists() and not lock_path.is_file()): raise PromotionError("promotion lock is unsafe")
    lock = lock_path.open("a+")
    try:
        if fcntl:
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error: raise PromotionError("promotion already running") from error
        result = {"schema": "frank.map-promotion/v1", "run_key": run_key, "status": "promoted", "graph_revision": graph_revision, "projections": checked}
        release = root / "releases" / (release_key + ".json")
        if release.exists():
            if json.loads(_regular(release, root).decode("utf-8")) != result: raise PromotionError("immutable promotion collision")
        else: _atomic(release, result, root)
        _atomic(root / "current.json", result, root)
        return {"status": "promoted", "run_key": run_key, "graph_revision": graph_revision, "projection_count": len(checked)}
    finally:
        if fcntl: fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()

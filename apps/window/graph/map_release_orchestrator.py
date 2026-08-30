"""Fail-closed promotion boundary for validated map previews."""
from __future__ import annotations
import hashlib, json, os, re, tempfile, time
from pathlib import Path
from typing import Any, Mapping
from .control_plane import ControlContractError, canonical_bytes
try: import fcntl
except ImportError: fcntl = None

class PromotionError(ControlContractError): pass

def _atomic(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".promotion-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(canonical_bytes(value)); f.flush(); os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        try: os.unlink(name)
        except FileNotFoundError: pass

def promote(*, receipt: Mapping[str, Any], production_root: Path | str, mandatory: set[str], timeout_seconds: float = 300) -> dict[str, Any]:
    """Publish one exact, fully passing preview; leave LKG untouched on error."""
    started = time.monotonic()
    run_key = receipt.get("run_key")
    manifests = receipt.get("manifests")
    if receipt.get("status") != "passed" or not isinstance(run_key, str) or not isinstance(manifests, Mapping):
        raise PromotionError("preview receipt is not passing")
    if set(manifests) != mandatory or not mandatory:
        raise PromotionError("mandatory projection set is incomplete")
    checked = {}
    for projection, manifest in manifests.items():
        if time.monotonic() - started > timeout_seconds: raise PromotionError("promotion deadline exceeded")
        if not isinstance(manifest, Mapping) or manifest.get("status") != "generated" or manifest.get("preview_only") is not True:
            raise PromotionError("projection is not a validated preview")
        artifact_hash = manifest.get("artifact_hash")
        if not isinstance(artifact_hash, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", artifact_hash): raise PromotionError("projection hash missing")
        if not isinstance(manifest.get("generation_id"), str) or not manifest["generation_id"].startswith("generation:"): raise PromotionError("generation identity missing")
        checked[projection] = {"generation_id": manifest.get("generation_id"), "manifest_hash": "sha256:" + hashlib.sha256(canonical_bytes(manifest)).hexdigest(), "artifact_hash": artifact_hash}
    supplied = Path(production_root)
    if supplied.exists() and supplied.is_symlink(): raise PromotionError("production root must not be a symlink")
    probe = supplied.absolute(); missing = []
    while not probe.exists(): missing.append(probe.name); probe = probe.parent
    if probe.is_symlink() or any((probe / n).is_symlink() for n in reversed(missing)): raise PromotionError("production path contains symlink")
    supplied.mkdir(parents=True, exist_ok=True)
    if supplied.resolve() != supplied.absolute(): raise PromotionError("production path must not contain symlinks")
    root = supplied.resolve()
    lock = (root / ".promotion.lock").open("a+")
    if fcntl:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: lock.close(); raise PromotionError("promotion already running")
    result = {"schema": "frank.map-promotion/v1", "run_key": run_key, "status": "promoted", "projections": checked}
    release = root / "releases" / (run_key.replace(":", "-") + ".json")
    if release.exists():
        try:
            if json.loads(release.read_text(encoding="utf-8")) != result: raise PromotionError("immutable promotion collision")
        except (OSError, ValueError) as exc: raise PromotionError("immutable promotion record invalid") from exc
    else: _atomic(release, result)
    _atomic(root / "current.json", result)
    if fcntl: fcntl.flock(lock, fcntl.LOCK_UN)
    lock.close()
    return {"status": "promoted", "run_key": run_key, "projection_count": len(checked)}

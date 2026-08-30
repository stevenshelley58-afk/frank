"""Safe reconciliation-receipt to control-graph materialization pipeline."""
from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Mapping

from .control_contract import ControlContractError, graph_from_collector_receipt
from .control_store import ControlGraphStore
from scripts.control_reconcile import _receipt_is_fresh, _validate_receipt_schema

RUNTIME_FACT_KEYS = frozenset({"compose", "systemd", "health", "monitoring", "deployment"})


def _regular_json(path: Path, root: Path) -> Any:
    root = root.resolve()
    candidate = path.absolute()
    try:
        relative = candidate.relative_to(root)
    except ValueError as exc:
        raise ControlContractError("receipt artifact escapes fixed root") from exc
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ControlContractError("receipt artifact contains a symlink")
    resolved = path.resolve(strict=True)
    if root not in resolved.parents or not resolved.is_file():
        raise ControlContractError("receipt artifact escapes fixed root")
    return json.loads(resolved.read_text(encoding="utf-8"))


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_pointer(root: Path, scope: str) -> tuple[dict[str, Any], Path, str]:
    pointer = root / f"latest-{scope}.json"
    meta = _regular_json(pointer, root)
    receipt_ref = meta.get("receipt")
    if not isinstance(receipt_ref, str):
        raise ControlContractError("invalid reconciliation receipt path")
    relative = Path(receipt_ref)
    if relative.is_absolute() or len(relative.parts) != 2 or any(
        part in {"", ".", ".."} for part in relative.parts
    ):
        raise ControlContractError("invalid reconciliation receipt path")
    target_ref = root / relative
    # Validate the unresolved path first so resolving cannot hide a symlinked
    # run directory or receipt file.
    receipt = _regular_json(target_ref, root)
    target = target_ref.resolve(strict=True)
    if target.parent.parent != root or target.name != "receipt.json":
        raise ControlContractError("invalid reconciliation receipt path")
    if _digest(target) != meta.get("receipt_hash"):
        raise ControlContractError("reconciliation receipt hash mismatch")
    try:
        _validate_receipt_schema(receipt)
    except ValueError as exc:
        raise ControlContractError("reconciliation receipt schema mismatch") from exc
    hashes = receipt.get("artifact_hashes")
    if not isinstance(hashes, Mapping) or set(hashes) != {
        "declared.json", "observed.json", "findings.json",
    }:
        raise ControlContractError("receipt lacks artifact hashes")
    for name, expected in hashes.items():
        artifact = target_ref.parent / str(name)
        _regular_json(artifact, target_ref.parent)
        if artifact.parent != target_ref.parent or not artifact.is_file() or _digest(artifact) != expected:
            raise ControlContractError("reconciliation artifact hash mismatch")
    if not _receipt_is_fresh(receipt):
        raise ControlContractError("reconciliation receipt is stale")
    return receipt, target.parent, meta["receipt_hash"]


def _merge_facts(full: Mapping[str, Any], fast: Mapping[str, Any] | None) -> dict[str, Any]:
    merged = copy.deepcopy(dict(full))
    if not fast:
        return merged
    for key in sorted(RUNTIME_FACT_KEYS):
        if key in fast:
            merged[key] = copy.deepcopy(fast[key])
    return merged


def materialize(data_root: Path | str = "/data/control-graph") -> dict[str, Any]:
    """Materialize latest receipts; no full receipt is a typed empty result."""
    root = Path(data_root).resolve() / "reconciliations"
    try:
        full, full_dir, full_hash = _load_pointer(root, "full")
    except FileNotFoundError:
        return {"status": "empty", "scope": "full"}
    if full.get("status") != "success" or full.get("scope") != "full":
        raise ControlContractError("latest full receipt is not successful")
    fast = None
    fast_dir = None
    try:
        candidate, candidate_dir, candidate_hash = _load_pointer(root, "fast")
        if candidate.get("status") == "success" and candidate.get("scope") == "fast":
            fast, fast_dir, fast_hash = candidate, candidate_dir, candidate_hash
    except FileNotFoundError:
        pass
    except ControlContractError as exc:
        # A stale fast observation is safely omitted; it must never overwrite
        # fresh full facts in the materialized graph.  Tampering and schema
        # failures remain fatal and visible to the caller.
        if str(exc) != "reconciliation receipt is stale":
            raise
    declared = _regular_json(full_dir / "declared.json", full_dir)
    catalog = declared.get("catalog") if isinstance(declared, Mapping) else None
    if not isinstance(catalog, Mapping) or not isinstance(catalog.get("nodes"), list):
        raise ControlContractError("full declaration artifact lacks catalog")
    receipt = copy.deepcopy(full)
    receipt["facts"] = _merge_facts(full.get("facts", {}), fast.get("facts", {}) if fast else None)
    receipt_ids = [full["receipt_id"]]
    observation_ids = [full["receipt_id"]]
    receipt_hashes = {full["receipt_id"]: full_hash}
    if fast:
        observation_ids.append(fast["receipt_id"])
        receipt_hashes[fast["receipt_id"]] = fast_hash
    freshest = fast or full
    observation_metadata = {
        "captured_at": freshest["captured_at"],
        "fresh_until": freshest["fresh_until"],
        "freshness": "fresh",
        "confidence": "high",
    }
    graph, assertions, manifest = graph_from_collector_receipt(
        catalog,
        receipt,
        receipt_ids=receipt_ids,
        observation_receipt_ids=observation_ids,
        receipt_hashes=receipt_hashes,
        observation_metadata=observation_metadata,
    )
    store = ControlGraphStore(Path(data_root))
    graph_hash = graph["graph_revision"]
    store.write_generation(graph_hash, graph, assertions, manifest)
    store.advance_current(graph_hash)
    return {"status": "success", "graph_revision": graph_hash,
            "full_receipt_id": full["receipt_id"],
            "fast_receipt_id": fast.get("receipt_id") if fast else None,
            "full_run_dir": str(full_dir), "fast_run_dir": str(fast_dir) if fast_dir else None}


def main(argv: list[str] | None = None) -> int:
    try:
        result = materialize()
    except (ControlContractError, OSError, ValueError, json.JSONDecodeError) as exc:
        # Error class is useful for operations while exception detail may
        # contain paths, command output, or source-controlled instructions.
        result = {"status": "error", "error": type(exc).__name__}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] in {"success", "empty"} else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

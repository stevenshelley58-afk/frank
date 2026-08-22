"""Truthful read-only home projection for Ad Studio state."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
import re
from types import MappingProxyType
from typing import Any

from .contract import HOME_PROFILE, ImmutableRelease, MANIFEST, validate_release, validate_trace


SNAPSHOT_SCHEMA = "schema://frank.tool-home-snapshot/v1"
_ALLOWED_STATE_KEYS = frozenset({"connections", "trace", "releases"})
_CONNECTION_CAPABILITIES = tuple(HOME_PROFILE["connection_capabilities"])
_SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$")
_PRIVATE_VALUE = re.compile(
    r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|secret|token|password|api[_-]?key|private[_-]?key|-----BEGIN)",
    re.IGNORECASE,
)
_ATTENTION_STATES = frozenset({"awaiting_approval", "blocked", "error", "failed", "quarantined", "retryable_failure"})
_PRIVATE_REF = re.compile(r"^(?:openbao|vault|secret|file):", re.IGNORECASE)
_MAX_ITEMS = 20
_OVERVIEW = MappingProxyType({
    "name": HOME_PROFILE["name"],
    "blurb": HOME_PROFILE["blurb"],
    "version": MANIFEST["version"],
    "scopes": tuple(MANIFEST["scopes"]),
    "capabilities": tuple(HOME_PROFILE["capabilities"]),
    "adjustable_settings": tuple(sorted(MANIFEST["settings"]["properties"])),
    "pipeline_id": MANIFEST["pipelines"][0]["id"],
    "pipeline_version": MANIFEST["pipelines"][0]["version"],
})


def _safe_ref(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _SAFE_REF.fullmatch(value) or _PRIVATE_VALUE.search(value) or _PRIVATE_REF.search(value):
        raise ValueError(f"{label} must be a safe non-secret reference")
    return value


def _sequence(value: Any, label: str) -> Sequence[Any]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise TypeError(f"{label} must be a sequence")
    return value


def _connection_id(value: Any, label: str) -> str:
    value = _safe_ref(value, label)
    if ":" in value or "/" in value or ".." in value:
        raise ValueError(f"{label} must be an opaque connection ID")
    return value


def _section(status: str, summary: str, items: list[dict[str, Any]], total: int | None = None) -> dict[str, Any]:
    return {"status": status, "summary": summary, "count": len(items) if total is None else total, "items": items[-_MAX_ITEMS:]}


def _overview_snapshot() -> dict[str, Any]:
    return {
        key: list(value) if isinstance(value, tuple) else value
        for key, value in _OVERVIEW.items()
    }


def _connection_snapshot(value: Any = ()) -> dict[str, Any]:
    connections = _sequence(value, "runtime_state.connections")
    by_capability: dict[str, dict[str, Any]] = {}
    for index, connection in enumerate(connections):
        path = f"runtime_state.connections[{index}]"
        if not isinstance(connection, Mapping) or set(connection) != {"capability", "status", "connection_id"}:
            raise ValueError(f"{path} must contain capability, status, and connection_id")
        capability = connection["capability"]
        if capability not in _CONNECTION_CAPABILITIES or capability in by_capability:
            raise ValueError(f"{path}.capability is unsupported or duplicated")
        status = connection["status"]
        if status not in {"verified", "attention", "unavailable"}:
            raise ValueError(f"{path}.status is unsupported")
        connection_id = connection["connection_id"]
        if connection_id is not None:
            connection_id = _connection_id(connection_id, f"{path}.connection_id")
        if status == "verified" and connection_id is None:
            raise ValueError(f"{path}.connection_id is required for verified coverage")
        by_capability[capability] = {"capability": capability, "status": status, "connection_id": connection_id}

    items = [
        by_capability.get(capability, {"capability": capability, "status": "unavailable", "connection_id": None})
        for capability in _CONNECTION_CAPABILITIES
    ]
    if not items:
        return {"status": "ready", "summary": "No Tool-owned connection capabilities are required.", "total": 0, "recorded": 0, "verified": 0, "attention": 0, "items": []}
    recorded = sum(item["connection_id"] is not None for item in items)
    verified = sum(item["status"] == "verified" for item in items)
    attention = len(items) - verified
    explicitly_attention = any(item["status"] == "attention" for item in items)
    status = "ready" if not attention else ("attention" if recorded or explicitly_attention else "unavailable")
    return {
        "status": status,
        "summary": "All required connection capabilities are verified." if status == "ready" else "Some required connection capabilities need attention." if status == "attention" else "Connection coverage is not recorded in this Tool runtime state.",
        "total": len(items),
        "recorded": recorded,
        "verified": verified,
        "attention": attention,
        "items": items,
    }


def _release_projection(release: Mapping[str, Any] | ImmutableRelease) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    errors = validate_release(release)
    if errors:
        raise ValueError("invalid Ad Studio runtime release: " + "; ".join(errors))
    value = release.as_dict() if isinstance(release, ImmutableRelease) else dict(release)
    output = {
        "release_id": value["release_id"],
        "status": value["status"],
        "release_version": value["release_version"],
        "scope": dict(value["scope"]),
        "pack_id": value["template_pack"]["pack_id"],
        "released_at": value["released_at"],
        "release_hash": value["release_hash"],
    }
    receipts = [
        {"kind": "artifact", "receipt_ref": value["provenance"]["artifact_receipt_ref"], "status": "recorded"},
        {"kind": "qa", "receipt_ref": value["qa_receipt"]["receipt_ref"], "status": value["qa_receipt"]["decision"]},
        {"kind": "approval", "receipt_ref": value["approval_receipt"]["receipt_ref"], "status": value["approval_receipt"]["decision"]},
        {"kind": "sanitization", "receipt_ref": value["sanitization_receipt"]["receipt_ref"], "status": value["sanitization_receipt"]["decision"]},
    ]
    return output, receipts


def _trace_projection(trace: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    value = dict(trace)
    errors = validate_trace(value)
    if errors:
        raise ValueError("invalid Ad Studio runtime trace: " + "; ".join(errors))
    item = {
        "run_id": _safe_ref(value["run_id"], "trace.run_id"),
        "status": _safe_ref(value["status"], "trace.status"),
        "pipeline_id": _OVERVIEW["pipeline_id"],
    }
    receipts: list[dict[str, Any]] = []
    for index, receipt in enumerate(_sequence(value["receipts"], "trace.receipts")):
        if isinstance(receipt, str):
            receipts.append({"kind": "runtime", "receipt_ref": _safe_ref(receipt, f"trace.receipts[{index}]"), "status": "recorded"})
            continue
        if not isinstance(receipt, Mapping):
            raise TypeError(f"trace.receipts[{index}] must be an object or reference")
        kind = receipt.get("kind", "runtime")
        row = {"kind": _safe_ref(kind, f"trace.receipts[{index}].kind"), "status": "recorded"}
        if "receipt_ref" in receipt:
            row["receipt_ref"] = _safe_ref(receipt["receipt_ref"], f"trace.receipts[{index}].receipt_ref")
        receipts.append(row)
    return item, receipts


def build_home_snapshot(runtime_state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Project package-owned state without reading fixtures or calling providers."""
    overview = _overview_snapshot()
    if runtime_state is None:
        unavailable = _section("unavailable", "Runtime state is not connected.", [])
        return {
            "schema": SNAPSHOT_SCHEMA,
            "tool_id": HOME_PROFILE["id"],
            "status": "unavailable",
            "summary": "Ad Studio runtime state is unavailable.",
            "overview": deepcopy(overview),
            "connections": deepcopy(_connection_snapshot()),
            "current_work": dict(unavailable),
            "outputs": dict(unavailable),
            "receipts": dict(unavailable),
            "source_truth": "runtime",
        }
    if not isinstance(runtime_state, Mapping):
        raise TypeError("runtime_state must be a mapping or None")
    unknown = set(runtime_state) - _ALLOWED_STATE_KEYS
    if unknown:
        raise ValueError(f"runtime_state contains unsupported fields: {sorted(unknown)}")

    raw_connections = _sequence(runtime_state.get("connections", ()), "runtime_state.connections")
    connections = _connection_snapshot(raw_connections)
    work_items: list[dict[str, Any]] = []
    receipt_items: list[dict[str, Any]] = []
    if runtime_state.get("trace") is not None:
        if not isinstance(runtime_state["trace"], Mapping):
            raise TypeError("runtime_state.trace must be a mapping")
        work, trace_receipts = _trace_projection(runtime_state["trace"])
        work_items.append(work)
        receipt_items.extend(trace_receipts)

    releases = _sequence(runtime_state.get("releases", ()), "runtime_state.releases")
    output_items: list[dict[str, Any]] = []
    for release in releases:
        if not isinstance(release, (Mapping, ImmutableRelease)):
            raise TypeError("runtime_state.releases must contain validated release objects")
        output, release_receipts = _release_projection(release)
        output_items.append(output)
        receipt_items.extend(release_receipts)

    has_state = bool(work_items or output_items or receipt_items)
    connection_attention = (bool(raw_connections) or has_state) and connections["status"] != "ready"
    work_attention = bool(work_items) and (
        connections["status"] != "ready"
        or any(item["status"] in _ATTENTION_STATES for item in work_items)
    )
    attention = connection_attention or work_attention
    status = "attention" if attention else ("ready" if has_state else "empty")
    summary = "Runtime work or required connection coverage needs attention." if attention else ("Runtime work or releases are recorded." if has_state else "Runtime is connected; no work or releases are recorded.")
    return {
        "schema": SNAPSHOT_SCHEMA,
        "tool_id": HOME_PROFILE["id"],
        "status": status,
        "summary": summary,
        "overview": deepcopy(overview),
        "connections": deepcopy(connections),
        "current_work": _section("attention" if work_attention else ("ready" if work_items else "empty"), "Current runtime run." if work_items else "No current runtime work is recorded.", work_items),
        "outputs": _section("ready" if output_items else "empty", f"{len(output_items)} immutable release{'s' if len(output_items) != 1 else ''} recorded.", output_items, len(releases)),
        "receipts": _section("ready" if receipt_items else "empty", f"{len(receipt_items)} receipt record{'s' if len(receipt_items) != 1 else ''} available.", receipt_items),
        "source_truth": "runtime",
    }

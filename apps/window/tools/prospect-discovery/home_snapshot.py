"""Truthful read-only home projection for Prospect Discovery runtime state."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from datetime import datetime
import re
from typing import Any

from .release import PIPELINE_ID, PIPELINE_VERSION, TOOL_ID, validate_release


SNAPSHOT_SCHEMA = "schema://frank.tool-home-snapshot/v1"
_ALLOWED_STATE_KEYS = frozenset({"connections", "runs", "releases"})
_CONNECTION_CAPABILITIES = ("public-source-read",)
_PIPELINE_STAGES = frozenset({"discover", "enrich", "evidence", "qualify"})
_RUN_STATES = frozenset({
    "queued", "running", "awaiting_verification", "qualified", "completed",
    "blocked", "failed", "quarantined",
})
_ATTENTION_STATES = frozenset({
    "awaiting_verification", "blocked", "failed", "quarantined",
})
_SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$")
_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
_PRIVATE_VALUE = re.compile(
    r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|bearer\s+[a-z0-9._~+/=-]{12,}|"
    r"(?:sk|pk|rk)_(?:live|test)_[a-z0-9]+|api[_-]?key[_-][a-z0-9]+|"
    r"gh[pousr]_[a-z0-9]+|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|"
    r"-----begin [a-z ]+-----)",
    re.IGNORECASE,
)
_PRIVATE_SCHEME = re.compile(r"^(?:openbao|vault|secret|file)://", re.IGNORECASE)
_MAX_ITEMS = 20

OVERVIEW = {
    "name": "Prospect Discovery",
    "blurb": "Discover and qualify public prospects with source-backed evidence.",
    "version": "0.1.1",
    "scopes": ["profile", "project", "workspace"],
    "capabilities": ["public-contact-discovery", "evidence-review", "qualification"],
    "adjustable_settings": ["connection", "filters", "qualification_policy", "scoring", "sources"],
    "pipeline_id": PIPELINE_ID,
    "pipeline_version": PIPELINE_VERSION,
}


def _safe_ref(value: Any, path: str) -> str:
    if (
        not isinstance(value, str)
        or not _SAFE_REF.fullmatch(value)
        or ":" in value
        or "/" in value
        or ".." in value
        or _PRIVATE_VALUE.search(value)
        or _PRIVATE_SCHEME.search(value)
    ):
        raise ValueError(f"{path} must be a safe non-secret reference")
    return value


def _timestamp(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _TIMESTAMP.fullmatch(value):
        raise ValueError(f"{path} must be an ISO-8601 timestamp with timezone")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{path} must be an ISO-8601 timestamp with timezone")
    return value


def _sequence(value: Any, path: str) -> Sequence[Any]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise TypeError(f"{path} must be a sequence")
    return value


def _section(status: str, summary: str, items: list[dict[str, Any]], total: int | None = None) -> dict[str, Any]:
    return {
        "status": status,
        "summary": summary,
        "count": len(items) if total is None else total,
        "items": items[-_MAX_ITEMS:],
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
            connection_id = _safe_ref(connection_id, f"{path}.connection_id")
        if status == "verified" and connection_id is None:
            raise ValueError(f"{path}.connection_id is required for verified coverage")
        by_capability[capability] = {
            "capability": capability,
            "status": status,
            "connection_id": connection_id,
        }

    items = [
        by_capability.get(capability, {
            "capability": capability, "status": "unavailable", "connection_id": None,
        })
        for capability in _CONNECTION_CAPABILITIES
    ]
    recorded = sum(item["connection_id"] is not None for item in items)
    verified = sum(item["status"] == "verified" for item in items)
    attention = len(items) - verified
    explicitly_attention = any(item["status"] == "attention" for item in items)
    status = "ready" if not attention else ("attention" if recorded or explicitly_attention else "unavailable")
    summary = (
        "All required connection capabilities are verified."
        if status == "ready"
        else "Some required connection capabilities need attention."
        if status == "attention"
        else "Connection coverage is not recorded in this Tool runtime state."
    )
    return {
        "status": status,
        "summary": summary,
        "total": len(items),
        "recorded": recorded,
        "verified": verified,
        "attention": attention,
        "items": items,
    }


def _run_projection(value: Any, index: int) -> dict[str, Any]:
    path = f"runtime_state.runs[{index}]"
    if not isinstance(value, Mapping) or set(value) != {"run_id", "status", "stage", "updated_at"}:
        raise ValueError(f"{path} must contain exactly run_id, status, stage, and updated_at")
    if value["status"] not in _RUN_STATES or value["stage"] not in _PIPELINE_STAGES:
        raise ValueError(f"{path} contains an unsupported status or stage")
    return {
        "run_id": _safe_ref(value["run_id"], f"{path}.run_id"),
        "status": value["status"],
        "stage": value["stage"],
        "updated_at": _timestamp(value["updated_at"], f"{path}.updated_at"),
    }


def _release_projection(value: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(value, Mapping):
        raise TypeError("runtime_state.releases must contain release mappings")
    release = validate_release(value)
    output = {
        "release_id": release["release_id"],
        "status": release["status"],
        "version": release["version"],
        "project_scope": release["project_scope"],
        "candidate_count": len(release["candidates"]),
        "released_at": release["released_at"],
        "release_hash": release["release_hash"],
    }
    receipts = [
        {"kind": "verification", "receipt_ref": ref, "status": "recorded"}
        for ref in release["verification_receipt_refs"]
    ]
    receipts.extend(
        {"kind": "sanitization", "receipt_ref": ref, "status": "recorded"}
        for ref in release["sanitization_receipt_refs"]
    )
    return output, receipts


def build_home_snapshot(runtime_state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Project authorized package runtime state without I/O or provider calls."""
    if runtime_state is None:
        unavailable = _section("unavailable", "Runtime state is not connected.", [])
        return {
            "schema": SNAPSHOT_SCHEMA,
            "tool_id": TOOL_ID,
            "status": "unavailable",
            "summary": "Prospect Discovery runtime state is unavailable.",
            "overview": deepcopy(OVERVIEW),
            "connections": _connection_snapshot(),
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
    runs = _sequence(runtime_state.get("runs", ()), "runtime_state.runs")
    work_items = [_run_projection(value, index) for index, value in enumerate(runs)]
    releases = _sequence(runtime_state.get("releases", ()), "runtime_state.releases")
    output_items: list[dict[str, Any]] = []
    receipt_items: list[dict[str, Any]] = []
    for release in releases:
        output, receipts = _release_projection(release)
        output_items.append(output)
        receipt_items.extend(receipts)

    connection_attention = (
        bool(raw_connections) or bool(work_items or output_items or receipt_items)
    ) and connections["status"] != "ready"
    work_attention = bool(work_items) and (
        connections["status"] != "ready"
        or any(item["status"] in _ATTENTION_STATES for item in work_items)
    )
    attention = connection_attention or work_attention
    has_state = bool(work_items or output_items or receipt_items)
    status = "attention" if attention else ("ready" if has_state else "empty")
    summary = (
        "Prospect work or required connection coverage needs attention."
        if attention
        else "Runtime work or releases are recorded."
        if has_state
        else "Runtime is connected; no work or releases are recorded."
    )
    return {
        "schema": SNAPSHOT_SCHEMA,
        "tool_id": TOOL_ID,
        "status": status,
        "summary": summary,
        "overview": deepcopy(OVERVIEW),
        "connections": connections,
        "current_work": _section(
            "attention" if work_attention else ("ready" if work_items else "empty"),
            f"{len(work_items)} prospect run{'s' if len(work_items) != 1 else ''} recorded.",
            work_items,
            len(runs),
        ),
        "outputs": _section(
            "ready" if output_items else "empty",
            f"{len(output_items)} immutable release{'s' if len(output_items) != 1 else ''} recorded.",
            output_items,
            len(releases),
        ),
        "receipts": _section(
            "ready" if receipt_items else "empty",
            f"{len(receipt_items)} QA/sanitization receipt reference{'s' if len(receipt_items) != 1 else ''} available.",
            receipt_items,
        ),
        "source_truth": "runtime",
    }

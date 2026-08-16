"""Truthful read-only home projection for Mail runtime state."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from datetime import datetime
import re
from typing import Any


SNAPSHOT_SCHEMA = "schema://frank.tool-home-snapshot/v1"
TOOL_ID = "mail"
_ALLOWED_STATE_KEYS = frozenset({"connections", "sync_runs", "projections", "receipts"})
_CONNECTION_CAPABILITIES = ("mail-read", "mail-receipts", "mail-events")
_PIPELINE_STAGES = frozenset({"sync", "thread", "message", "receipt", "classify", "events"})
_SYNC_STATES = frozenset({"queued", "running", "completed", "blocked", "failed"})
_PROJECTION_KINDS = frozenset({
    "thread", "message", "delivery", "reply", "bounce", "complaint", "unsubscribe",
})
_PROJECTION_STATES = frozenset({"ready", "attention", "unavailable"})
_RECEIPT_KINDS = frozenset({"delivery", "reply", "bounce", "complaint", "unsubscribe"})
_RECEIPT_STATUS_BY_KIND = {
    "delivery": frozenset({"recorded", "delivered", "failed"}),
    "reply": frozenset({"recorded", "replied"}),
    "bounce": frozenset({"recorded", "bounced"}),
    "complaint": frozenset({"recorded", "complained"}),
    "unsubscribe": frozenset({"recorded", "unsubscribed"}),
}
_ATTENTION_STATES = frozenset({
    "attention", "unavailable", "blocked", "failed", "bounced", "complained",
})
_SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$")
_OPAQUE_SUFFIX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./-]{0,223}$")
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
    "name": "Mail",
    "blurb": "Read provider-neutral threads, messages, cursors, and delivery receipts.",
    "version": "0.1.1",
    "scopes": ["profile", "project", "workspace", "session"],
    "capabilities": [
        "thread-sync", "message-history", "delivery-receipts", "reply-classification",
    ],
    "adjustable_settings": ["connection", "reply_classification", "sync"],
    "pipeline_id": "sync-and-project",
    "pipeline_version": "1.0.0",
}


def _safe_ref(value: Any, path: str, prefix: str | None = None) -> str:
    if (
        not isinstance(value, str)
        or not _SAFE_REF.fullmatch(value)
        or ".." in value
        or _PRIVATE_VALUE.search(value)
        or _PRIVATE_SCHEME.search(value)
    ):
        raise ValueError(f"{path} must be a safe non-secret reference")
    if prefix is None:
        if ":" in value or "/" in value:
            raise ValueError(f"{path} must be an opaque identifier, not a URL or scheme")
    else:
        suffix = value[len(prefix):] if value.startswith(prefix) else ""
        if value.count("://") != 1 or not _OPAQUE_SUFFIX.fullmatch(suffix):
            raise ValueError(f"{path} must use {prefix} with a non-empty opaque ID")
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


def _sync_projection(value: Any, index: int) -> dict[str, Any]:
    path = f"runtime_state.sync_runs[{index}]"
    expected = {"sync_id", "status", "stage", "cursor_ref", "updated_at"}
    if not isinstance(value, Mapping) or set(value) != expected:
        raise ValueError(f"{path} must contain exactly the package sync snapshot fields")
    if value["status"] not in _SYNC_STATES or value["stage"] not in _PIPELINE_STAGES:
        raise ValueError(f"{path} contains an unsupported status or stage")
    return {
        "sync_id": _safe_ref(value["sync_id"], f"{path}.sync_id"),
        "status": value["status"],
        "stage": value["stage"],
        "cursor_ref": _safe_ref(value["cursor_ref"], f"{path}.cursor_ref", "cursor://mail/"),
        "updated_at": _timestamp(value["updated_at"], f"{path}.updated_at"),
    }


def _projection(value: Any, index: int) -> dict[str, Any]:
    path = f"runtime_state.projections[{index}]"
    expected = {"projection_id", "kind", "status", "count", "updated_at"}
    if not isinstance(value, Mapping) or set(value) != expected:
        raise ValueError(f"{path} must contain exactly the package projection snapshot fields")
    if value["kind"] not in _PROJECTION_KINDS or value["status"] not in _PROJECTION_STATES:
        raise ValueError(f"{path} contains an unsupported projection kind or status")
    if type(value["count"]) is not int or value["count"] < 0:
        raise ValueError(f"{path}.count must be a non-negative integer")
    return {
        "projection_id": _safe_ref(value["projection_id"], f"{path}.projection_id"),
        "kind": value["kind"],
        "status": value["status"],
        "count": value["count"],
        "updated_at": _timestamp(value["updated_at"], f"{path}.updated_at"),
    }


def _receipt_projection(value: Any, index: int) -> dict[str, Any]:
    path = f"runtime_state.receipts[{index}]"
    expected = {"kind", "receipt_ref", "status", "recorded_at"}
    if not isinstance(value, Mapping) or set(value) != expected:
        raise ValueError(f"{path} must contain exactly kind, receipt_ref, status, and recorded_at")
    if (
        value["kind"] not in _RECEIPT_KINDS
        or value["status"] not in _RECEIPT_STATUS_BY_KIND[value["kind"]]
    ):
        raise ValueError(f"{path} contains an unsupported receipt kind or status")
    return {
        "kind": value["kind"],
        "receipt_ref": _safe_ref(value["receipt_ref"], f"{path}.receipt_ref", "receipt://"),
        "status": value["status"],
        "recorded_at": _timestamp(value["recorded_at"], f"{path}.recorded_at"),
    }


def _receipt_needs_attention(value: Mapping[str, Any]) -> bool:
    return value["kind"] in {"bounce", "complaint"} or value["status"] in _ATTENTION_STATES


def build_home_snapshot(runtime_state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Project provider-neutral counts/refs, never raw message bodies or addresses."""
    if runtime_state is None:
        unavailable = _section("unavailable", "Runtime state is not connected.", [])
        return {
            "schema": SNAPSHOT_SCHEMA,
            "tool_id": TOOL_ID,
            "status": "unavailable",
            "summary": "Mail runtime state is unavailable.",
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
    sync_runs = _sequence(runtime_state.get("sync_runs", ()), "runtime_state.sync_runs")
    work_items = [_sync_projection(value, index) for index, value in enumerate(sync_runs)]
    raw_projections = _sequence(runtime_state.get("projections", ()), "runtime_state.projections")
    output_items = [_projection(value, index) for index, value in enumerate(raw_projections)]
    raw_receipts = _sequence(runtime_state.get("receipts", ()), "runtime_state.receipts")
    receipt_items = [_receipt_projection(value, index) for index, value in enumerate(raw_receipts)]

    connection_attention = (
        bool(raw_connections) or bool(work_items or output_items or receipt_items)
    ) and connections["status"] != "ready"
    work_attention = bool(work_items) and (
        connections["status"] != "ready"
        or any(item["status"] in _ATTENTION_STATES for item in work_items)
    )
    output_attention = bool(output_items) and (
        connections["status"] != "ready"
        or any(item["status"] in _ATTENTION_STATES for item in output_items)
    )
    receipt_attention = any(_receipt_needs_attention(item) for item in receipt_items)
    attention = connection_attention or work_attention or output_attention or receipt_attention
    has_state = bool(work_items or output_items or receipt_items)
    status = "attention" if attention else ("ready" if has_state else "empty")
    summary = (
        "Mail state or required connection coverage needs attention."
        if attention
        else "Runtime sync, projection, or receipt state is recorded."
        if has_state
        else "Runtime is connected; no mail state is recorded."
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
            f"{len(work_items)} mail sync run{'s' if len(work_items) != 1 else ''} recorded.",
            work_items,
            len(sync_runs),
        ),
        "outputs": _section(
            "attention" if output_attention else ("ready" if output_items else "empty"),
            f"{len(output_items)} provider-neutral projection summar{'ies' if len(output_items) != 1 else 'y'} recorded.",
            output_items,
            len(raw_projections),
        ),
        "receipts": _section(
            "attention" if receipt_attention else ("ready" if receipt_items else "empty"),
            f"{len(receipt_items)} delivery/event receipt reference{'s' if len(receipt_items) != 1 else ''} available.",
            receipt_items,
            len(raw_receipts),
        ),
        "source_truth": "runtime",
    }

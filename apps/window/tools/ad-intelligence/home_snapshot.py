"""Truthful read-only home projection for Ad Radar runtime state."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from datetime import datetime
import re
from types import MappingProxyType
from typing import Any

from .core import (
    ADJUSTABLE_SETTINGS,
    HOME_PROFILE,
    TOOL_SCOPES,
    AdIntelligenceRelease,
    AdIntelligenceManifest,
    HealthSnapshot,
    PIPELINE_ID,
    PIPELINE_VERSION,
)
from .pipeline import PipelineRun


SNAPSHOT_SCHEMA = "schema://frank.tool-home-snapshot/v1"
_ALLOWED_STATE_KEYS = frozenset({"connections", "runs", "releases", "health"})
_CONNECTION_CAPABILITIES = tuple(HOME_PROFILE["connection_capabilities"])
_SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$")
_PRIVATE_VALUE = re.compile(
    r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|secret|token|password|api[_-]?key|private[_-]?key|-----BEGIN)",
    re.IGNORECASE,
)
_RUN_STATES = frozenset({"ready", "running", "retryable_failure", "quarantined", "awaiting_approval", "published"})
_ATTENTION_STATES = frozenset({"awaiting_approval", "retryable_failure", "quarantined"})
_HEALTH_STATES = frozenset({"ready", "degraded", "blocked", "unavailable", "error"})
_PRIVATE_REF = re.compile(r"^(?:openbao|vault|secret|file):", re.IGNORECASE)
_ISO_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
_MAX_ITEMS = 20
_OVERVIEW = MappingProxyType({
    "name": HOME_PROFILE["name"],
    "blurb": HOME_PROFILE["blurb"],
    "version": AdIntelligenceManifest().version,
    "scopes": tuple(TOOL_SCOPES),
    "capabilities": tuple(HOME_PROFILE["capabilities"]),
    "adjustable_settings": tuple(sorted(ADJUSTABLE_SETTINGS)),
    "pipeline_id": PIPELINE_ID,
    "pipeline_version": PIPELINE_VERSION,
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


def _run_projection(run: PipelineRun) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(run, PipelineRun):
        raise TypeError("runtime_state.runs must contain PipelineRun objects")
    if run.status not in _RUN_STATES or run.stage not in run.manifest.pipeline:
        raise ValueError("runtime PipelineRun contains an unsupported status or stage")
    attempts = 0
    for stage, count in run.attempts.items():
        if stage not in run.manifest.pipeline or type(count) is not int or count < 0:
            raise ValueError("runtime PipelineRun contains invalid attempt state")
        attempts += count
    item = {
        "run_id": _safe_ref(run.run_id, "run.run_id"),
        "status": run.status,
        "stage": run.stage,
        "attempts": attempts,
        "approval_pending": run.status == "awaiting_approval",
    }
    receipts: list[dict[str, Any]] = []
    for trace_index, trace in enumerate(run.traces):
        for receipt_index, receipt_ref in enumerate(trace.receipt_refs):
            receipts.append({
                "kind": "runtime",
                "receipt_ref": _safe_ref(receipt_ref, f"run.traces[{trace_index}].receipt_refs[{receipt_index}]"),
                "status": "recorded",
            })
    return item, receipts


def _release_projection(release: AdIntelligenceRelease) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(release, AdIntelligenceRelease):
        raise TypeError("runtime_state.releases must contain AdIntelligenceRelease objects")
    value = release.to_dict()
    output = {
        "release_id": value["release_id"],
        "status": value["status"],
        "version": value["version"],
        "project_scope": value["project_scope"],
        "creative_count": len(value["public_export"]["creatives"]),
        "released_at": value["released_at"],
        "release_hash": value["release_hash"],
    }
    receipts = [{
        "kind": "qa",
        "receipt_ref": value["qa_receipt"]["receipt_ref"],
        "status": value["qa_receipt"]["decision"],
    }]
    for scan_name in ("pii_scan", "secret_scan"):
        scan = value["sanitization_receipts"][scan_name]
        receipts.append({"kind": scan_name, "receipt_ref": scan["receipt_id"], "status": scan["status"]})
    return output, receipts


def _health_projection(health: HealthSnapshot) -> dict[str, Any]:
    if not isinstance(health, HealthSnapshot):
        raise TypeError("runtime_state.health must be a HealthSnapshot")
    if health.status not in _HEALTH_STATES:
        raise ValueError("runtime HealthSnapshot contains an unsupported status")
    pipeline_stages = AdIntelligenceManifest().pipeline
    if health.stage is not None and health.stage not in pipeline_stages:
        raise ValueError("runtime HealthSnapshot contains an unsupported stage")
    if type(health.published) is not int or health.published < 0 or type(health.quarantined) is not int or health.quarantined < 0:
        raise ValueError("runtime HealthSnapshot counts must be non-negative integers")
    if health.last_run_at is not None:
        if not isinstance(health.last_run_at, str) or not _ISO_TIMESTAMP.fullmatch(health.last_run_at):
            raise ValueError("runtime HealthSnapshot last_run_at must be an ISO-8601 timestamp")
        parsed = datetime.fromisoformat(health.last_run_at.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("runtime HealthSnapshot last_run_at must include a timezone")
    return {
        "kind": "health",
        "status": health.status,
        "stage": health.stage,
        "last_run_at": health.last_run_at,
        "published": health.published,
        "quarantined": health.quarantined,
    }


def build_home_snapshot(runtime_state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Project typed package runtime objects without provider calls or fixture reads."""
    overview = _overview_snapshot()
    if runtime_state is None:
        unavailable = _section("unavailable", "Runtime state is not connected.", [])
        return {
            "schema": SNAPSHOT_SCHEMA,
            "tool_id": HOME_PROFILE["id"],
            "status": "unavailable",
            "summary": "Ad Radar runtime state is unavailable.",
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
    runs = _sequence(runtime_state.get("runs", ()), "runtime_state.runs")
    work_items: list[dict[str, Any]] = []
    receipt_items: list[dict[str, Any]] = []
    for run in runs:
        work, receipts = _run_projection(run)
        work_items.append(work)
        receipt_items.extend(receipts)
    health_status = None
    if runtime_state.get("health") is not None:
        health = _health_projection(runtime_state["health"])
        health_status = health["status"]
        work_items.append(health)

    releases = _sequence(runtime_state.get("releases", ()), "runtime_state.releases")
    output_items: list[dict[str, Any]] = []
    for release in releases:
        output, receipts = _release_projection(release)
        output_items.append(output)
        receipt_items.extend(receipts)

    has_state = bool(work_items or output_items or receipt_items)
    connection_attention = (bool(raw_connections) or has_state) and connections["status"] != "ready"
    work_attention = bool(work_items) and (
        connections["status"] != "ready"
        or any(item["status"] in _ATTENTION_STATES for item in work_items)
        or health_status in {"degraded", "blocked", "error"}
    )
    attention = connection_attention or work_attention
    if health_status == "unavailable" and not output_items and len(work_items) == 1 and not attention:
        status = "unavailable"
    else:
        status = "attention" if attention else ("ready" if has_state else "empty")
    if status == "unavailable":
        summary = "Ad Radar runtime health is unavailable."
    else:
        summary = "Ad Radar runtime state needs attention." if attention else ("Runtime work or releases are recorded." if has_state else "Runtime is connected; no work or releases are recorded.")
    work_status = "unavailable" if status == "unavailable" else ("attention" if work_attention else ("ready" if work_items else "empty"))
    return {
        "schema": SNAPSHOT_SCHEMA,
        "tool_id": HOME_PROFILE["id"],
        "status": status,
        "summary": summary,
        "overview": deepcopy(overview),
        "connections": deepcopy(connections),
        "current_work": _section(work_status, f"{len(work_items)} runtime state item{'s' if len(work_items) != 1 else ''} recorded.", work_items, len(runs) + int(runtime_state.get("health") is not None)),
        "outputs": _section("ready" if output_items else "empty", f"{len(output_items)} immutable release{'s' if len(output_items) != 1 else ''} recorded.", output_items, len(releases)),
        "receipts": _section("ready" if receipt_items else "empty", f"{len(receipt_items)} receipt record{'s' if len(receipt_items) != 1 else ''} available.", receipt_items),
        "source_truth": "runtime",
    }

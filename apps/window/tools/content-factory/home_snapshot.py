"""Truthful read-only home projection for Content Factory runtime state."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
import re
from types import MappingProxyType
from typing import Any

from .content_factory import CONTENT_FACTORY_MANIFEST, EVENT_KINDS, HOME_PROFILE, build_event, public_release


SNAPSHOT_SCHEMA = "schema://frank.tool-home-snapshot/v1"
_ALLOWED_STATE_KEYS = frozenset({"events", "releases"})
_SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$")
_PRIVATE_VALUE = re.compile(
    r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|secret|token|password|api[_-]?key|private[_-]?key|-----BEGIN)",
    re.IGNORECASE,
)
_EVENT_STATUS = {
    "stage-completed": "running",
    "review-requested": "awaiting_approval",
    "release-immutable": "completed",
    "quarantined": "quarantined",
    "withdrawn": "completed",
}
_EVENT_PAYLOAD_FIELDS = ("run_id", "content_id", "stage", "release_id")
_PRIVATE_REF = re.compile(r"^(?:openbao|vault|secret|file):", re.IGNORECASE)
_MAX_ITEMS = 20
_OVERVIEW = MappingProxyType({
    "name": HOME_PROFILE["name"],
    "blurb": HOME_PROFILE["blurb"],
    "version": CONTENT_FACTORY_MANIFEST["version"],
    "scopes": tuple(CONTENT_FACTORY_MANIFEST["scopes"]),
    "capabilities": tuple(HOME_PROFILE["capabilities"]),
    "adjustable_settings": tuple(sorted(CONTENT_FACTORY_MANIFEST["settings"]["properties"])),
    "pipeline_id": CONTENT_FACTORY_MANIFEST["pipelines"][0]["id"],
    "pipeline_version": CONTENT_FACTORY_MANIFEST["pipelines"][0]["version"],
})


def _safe_ref(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _SAFE_REF.fullmatch(value) or _PRIVATE_VALUE.search(value) or _PRIVATE_REF.search(value):
        raise ValueError(f"{label} must be a safe non-secret reference")
    return value


def _sequence(value: Any, label: str) -> Sequence[Any]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise TypeError(f"{label} must be a sequence")
    return value


def _section(status: str, summary: str, items: list[dict[str, Any]], total: int | None = None) -> dict[str, Any]:
    return {"status": status, "summary": summary, "count": len(items) if total is None else total, "items": items[-_MAX_ITEMS:]}


def _overview_snapshot() -> dict[str, Any]:
    return {
        key: list(value) if isinstance(value, tuple) else value
        for key, value in _OVERVIEW.items()
    }


def _connection_snapshot() -> dict[str, Any]:
    capabilities = list(HOME_PROFILE["connection_capabilities"])
    items = [{"capability": capability, "status": "unavailable", "connection_id": None} for capability in capabilities]
    if not items:
        return {"status": "ready", "summary": "No Tool-owned connection capabilities are required.", "total": 0, "recorded": 0, "verified": 0, "attention": 0, "items": []}
    return {
        "status": "unavailable",
        "summary": "Connection coverage is not recorded in this Tool package.",
        "total": len(items),
        "recorded": 0,
        "verified": 0,
        "attention": len(items),
        "items": items,
    }


def _event_projection(event: Mapping[str, Any]) -> dict[str, Any]:
    if set(event) != {"kind", "event_kind", "correlation_id", "payload"}:
        raise ValueError("runtime content event must contain the exact package event fields")
    if event.get("kind") != "event" or event.get("event_kind") not in EVENT_KINDS:
        raise ValueError("runtime content event is not declared by Content Factory")
    payload = event.get("payload")
    if not isinstance(payload, Mapping):
        raise TypeError("runtime content event payload must be a mapping")
    rebuilt = build_event(event["event_kind"], payload, event["correlation_id"])
    if rebuilt != dict(event):
        raise ValueError("runtime content event does not match the package event contract")
    item = {
        "correlation_id": _safe_ref(event["correlation_id"], "event.correlation_id"),
        "event_kind": event["event_kind"],
        "status": _EVENT_STATUS[event["event_kind"]],
    }
    for field in _EVENT_PAYLOAD_FIELDS:
        if field in payload:
            item[field] = _safe_ref(payload[field], f"event.payload.{field}")
    return item


def _release_projection(release: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(release, Mapping):
        raise TypeError("runtime_state.releases must contain release mappings")
    value = public_release(release)
    output = {
        "release_id": value["release_id"],
        "content_id": value["content_id"],
        "version": value["version"],
        "status": value["status"],
        "channel": value["channel"],
        "media_count": len(value["media"]),
        "published_at": value["published_at"],
        "release_hash": value["release_hash"],
    }
    receipts = [
        {"kind": "qa", "receipt_ref": value["qa_receipt"]["receipt_ref"], "status": value["qa_receipt"]["decision"]},
        {"kind": "approval", "receipt_ref": value["approval_receipt"]["receipt_ref"], "status": value["approval_receipt"]["decision"]},
    ]
    for scan_name in ("pii_scan", "secret_scan"):
        scan = value["sanitization_receipts"][scan_name]
        receipts.append({"kind": scan_name, "receipt_ref": scan["receipt_id"], "status": scan["status"]})
    return output, receipts


def build_home_snapshot(runtime_state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Project allowlisted events and validated releases, never article bodies."""
    overview = _overview_snapshot()
    if runtime_state is None:
        unavailable = _section("unavailable", "Runtime state is not connected.", [])
        return {
            "schema": SNAPSHOT_SCHEMA,
            "tool_id": HOME_PROFILE["id"],
            "status": "unavailable",
            "summary": "Content Factory runtime state is unavailable.",
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

    events = _sequence(runtime_state.get("events", ()), "runtime_state.events")
    work_items: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, Mapping):
            raise TypeError("runtime_state.events must contain event mappings")
        work_items.append(_event_projection(event))

    releases = _sequence(runtime_state.get("releases", ()), "runtime_state.releases")
    output_items: list[dict[str, Any]] = []
    receipt_items: list[dict[str, Any]] = []
    for release in releases:
        output, receipts = _release_projection(release)
        output_items.append(output)
        receipt_items.extend(receipts)

    attention = any(item["status"] in {"awaiting_approval", "quarantined"} for item in work_items)
    has_state = bool(work_items or output_items or receipt_items)
    status = "attention" if attention else ("ready" if has_state else "empty")
    summary = "Content work needs attention." if attention else ("Runtime work or releases are recorded." if has_state else "Runtime is connected; no work or releases are recorded.")
    return {
        "schema": SNAPSHOT_SCHEMA,
        "tool_id": HOME_PROFILE["id"],
        "status": status,
        "summary": summary,
        "overview": deepcopy(overview),
        "connections": deepcopy(_connection_snapshot()),
        "current_work": _section("attention" if attention else ("ready" if work_items else "empty"), f"{len(work_items)} runtime event{'s' if len(work_items) != 1 else ''} recorded.", work_items, len(events)),
        "outputs": _section("ready" if output_items else "empty", f"{len(output_items)} immutable release{'s' if len(output_items) != 1 else ''} recorded.", output_items, len(releases)),
        "receipts": _section("ready" if receipt_items else "empty", f"{len(receipt_items)} receipt record{'s' if len(receipt_items) != 1 else ''} available.", receipt_items),
        "source_truth": "runtime",
    }

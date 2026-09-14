"""Owner workspace source payloads.

The workspace host reads one payload per owner source. The projection lane owns
the *readers*; this module owns the *route contract* between them and the
browser, so neither side has to know the other's internal shape.

Two rules are enforced here rather than trusted to the reader:

* **A source that has no adapter is reported as unavailable, never as zero.**
  The host renders an explicit unavailable state from that, which is the honest
  answer before an adapter exists.
* **An item without a valid typed drill-down is dropped.** A summary line the
  owner cannot act on is worse than no line, because it looks like the work is
  reachable when it is not. Dropped items are counted so the loss is visible.

Only non-secret, already-sanitised values cross this boundary: a source name, a
status, counts, short labels and a typed target. No message body, no credential
and no third-party customer record is copied through.
"""

from __future__ import annotations

import time
from typing import Any, Callable

import owner_workspace as ow

# Statuses the workspace host understands. Kept identical to the client's
# SOURCE_STATUSES so a status this server can emit is never rendered as unknown.
SOURCE_STATUSES = frozenset({"ready", "empty", "attention", "stale", "unavailable", "error"})

# The owner sections an ``owner-section`` target may name. Mirrors the frozen
# vocabulary in owner_workspace; the parity test asserts they cannot drift.
SECTION_TARGETS = frozenset(ow.OWNER_SECTIONS)

# Source id -> reader. Each reader returns either:
#   * a full owner snapshot from owner_workspace.owner_snapshot, or
#   * a dict with an ``unavailable``/``empty`` status and a reason.
# A reader that raises is reported as unavailable for that source alone.
SOURCE_READERS: dict[str, Callable[[], dict[str, Any]]] = {}

# Human purpose per source, used in the unavailable detail so the owner learns
# what the section will show rather than only that it is not there yet.
SOURCE_PURPOSE: dict[str, str] = {
    "mail": "inbound mail that still needs a reply",
    "crm": "leads and follow-ups that need you",
    "support": "tickets waiting on you",
    "campaigns": "email flow and campaign activity",
    "revenue": "recurring revenue and payments",
    "results": "reach and acquisition performance",
    "notifications": "notification publish activity",
}

# Which typed target an empty source should offer. This is the destination the
# owner reaches when a source has nothing to report, so it must always be a real
# in-Frank route.
SOURCE_FALLBACK_TARGET: dict[str, dict[str, Any]] = {
    "mail": {"kind": "native-list", "app": "mail", "path": "/", "label": "Open the mailbox"},
    "crm": {"kind": "native-list", "app": "crm", "path": "/crm/leads", "label": "Open leads"},
    "support": {"kind": "native-list", "app": "support", "path": "/helpdesk/tickets", "label": "Open tickets"},
    "campaigns": {"kind": "native-list", "app": "campaigns", "path": "/s/campaigns", "label": "Open campaigns"},
    "revenue": {"kind": "owner-section", "section": "revenue", "label": "Open revenue"},
    "results": {"kind": "owner-section", "section": "results", "label": "Open results"},
    "notifications": {"kind": "owner-section", "section": "notifications", "label": "Open notifications"},
}


def register_source(source_id: str, reader: Callable[[], dict[str, Any]]) -> None:
    """Attach a reader to an owner source id."""
    if source_id not in ow.OWNER_SECTIONS:
        raise ValueError(f"unknown owner source: {source_id!r}")
    SOURCE_READERS[source_id] = reader


def _clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _target_from_link(link: Any, source_id: str) -> dict[str, Any] | None:
    """Convert one owner_workspace link into a typed drill-down target.

    A link that does not name a known destination is refused, so the browser
    never receives a target it would have to drop silently.
    """
    if not isinstance(link, dict):
        return None
    raw = link.get("target") if isinstance(link.get("target"), dict) else {}
    label = _clip(link.get("label"), 80)
    section = raw.get("section")
    if isinstance(section, str) and section in SECTION_TARGETS:
        return {"kind": "owner-section", "section": section, "label": label or section}
    customer = raw.get("customer")
    if isinstance(customer, str) and customer and "/" not in customer:
        return {"kind": "owner-record", "customerId": customer, "label": label or "Customer overview"}
    # A source-level item with no explicit destination falls back to the
    # section that owns it, which is always a real route.
    return SOURCE_FALLBACK_TARGET.get(source_id)


def _payload_from_snapshot(source_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Turn one owner snapshot into the host's source payload.

    The reader's own contract stays ``data.readings``; that is what
    ``owner_workspace`` froze. The projection lane also mirrors the same honest
    values into the standard ``data.metrics`` and ``data.rows`` vocabulary, and
    those are preferred here because they carry the renderer's own labels and
    units. A reading with no value contributes nothing either way, so an
    unreadable source can never be drawn as a real zero.
    """
    data = snapshot.get("data") if isinstance(snapshot.get("data"), dict) else {}
    readings = data.get("readings") if isinstance(data.get("readings"), dict) else {}

    metrics: list[dict[str, Any]] = []
    published = data.get("metrics") if isinstance(data.get("metrics"), list) else None
    if published is not None:
        for raw in published[:6]:
            if not isinstance(raw, dict):
                continue
            value = raw.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            label = _clip(raw.get("label"), 60)
            if label:
                metrics.append({"label": label, "value": int(value), "unit": _clip(raw.get("unit"), 16)})
    if not metrics:
        for name, reading in readings.items():
            if not isinstance(reading, dict):
                continue
            value = reading.get("value")
            if value is None or reading.get("status") not in {"ready", "stale", "attention"}:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            metrics.append({"label": _clip(name, 60), "value": int(value)})

    items: list[dict[str, Any]] = []
    dropped = 0
    raw_items: list[Any] = []
    if isinstance(data.get("items"), list):
        raw_items = data["items"]
    elif isinstance(data.get("rows"), list):
        raw_items = data["rows"]
    for index, raw in enumerate(raw_items[:50]):
        if not isinstance(raw, dict):
            dropped += 1
            continue
        label = _clip(raw.get("label") or raw.get("name") or raw.get("title"), 120)
        if not label:
            dropped += 1
            continue
        # A row from the standard view has no per-record destination; it falls
        # back to the section that owns it, which is always a real route.
        target = _target_from_link(raw.get("link"), source_id) if raw.get("link") else SOURCE_FALLBACK_TARGET.get(source_id)
        if target is None:
            dropped += 1
            continue
        count = raw.get("count")
        items.append({
            "id": _clip(raw.get("id"), 120) or f"{source_id}-{index + 1}",
            "label": label,
            "detail": _clip(raw.get("detail"), 200),
            "count": int(count) if isinstance(count, (int, float)) and not isinstance(count, bool) else None,
            "attention": bool(raw.get("attention")),
            "target": target,
        })

    status = str(snapshot.get("status") or "unavailable").lower()
    if status not in SOURCE_STATUSES:
        status = "unavailable"
    summary = _clip(snapshot.get("summary"), 240)
    if dropped and not items and raw_items:
        # Everything was unusable. Say so instead of implying an empty source.
        status = "error"
        summary = summary or "The source answered, but nothing in it had a destination the owner could open."

    return {
        "source": source_id,
        "status": status,
        "summary": summary,
        "generated_at": int(snapshot.get("generated_at") or time.time()),
        "observed_at": data.get(ow.OBSERVED_AT),
        "metrics": metrics,
        "items": items,
        "dropped": dropped,
        "unavailable_sources": data.get("unavailable_sources") or [],
        "target": SOURCE_FALLBACK_TARGET.get(source_id),
    }


def unavailable_payload(source_id: str, detail: str) -> dict[str, Any]:
    """An honest unavailable source. Never a zero, never a fabricated item."""
    return {
        "source": source_id,
        "status": "unavailable",
        "summary": "",
        "generated_at": int(time.time()),
        "observed_at": None,
        "metrics": [],
        "items": [],
        "dropped": 0,
        "detail": _clip(detail, 240),
        "target": SOURCE_FALLBACK_TARGET.get(source_id),
    }


def source_payload(source_id: str) -> dict[str, Any]:
    """The payload for one owner source, isolated from every other source."""
    if source_id not in ow.OWNER_SECTIONS:
        return unavailable_payload(source_id, "Frank does not run that owner source.")
    purpose = SOURCE_PURPOSE.get(source_id, "this section")
    reader = SOURCE_READERS.get(source_id)
    if reader is None:
        return unavailable_payload(
            source_id,
            f"Frank cannot read {purpose} yet. No adapter is attached to this source in this release.",
        )
    try:
        snapshot = reader()
    except Exception as exc:  # noqa: BLE001 - reported for this source only
        return unavailable_payload(
            source_id,
            f"Frank could not read {purpose} just now ({type(exc).__name__}). "
            "Nothing is shown rather than a number Frank cannot confirm.",
        )
    if not isinstance(snapshot, dict):
        return unavailable_payload(source_id, f"Frank read {purpose} but could not interpret the answer.")
    return _payload_from_snapshot(source_id, snapshot)


def all_source_payloads() -> dict[str, Any]:
    """Every owner source payload, gathered without one failure touching another."""
    return {
        "schema": "schema://frank.owner-sources/v1",
        "sources": {source_id: source_payload(source_id) for source_id in ow.OWNER_SECTIONS},
        "generated_at": int(time.time()),
    }


def create_blueprint():
    """The owner source routes the workspace host reads."""
    from flask import Blueprint, abort, jsonify

    api = Blueprint("owner_sources", __name__)

    def _no_store(payload: dict[str, Any]):
        response = jsonify(payload)
        # A read model is a dated observation, never a cacheable claim.
        response.headers["Cache-Control"] = "no-store"
        return response

    @api.get("/api/owner/workspace/sources")
    def owner_sources_list():
        return _no_store(all_source_payloads())

    @api.get("/api/owner/workspace/sources/<source_id>")
    def owner_source(source_id: str):
        if source_id not in ow.OWNER_SECTIONS:
            abort(404, description="unknown owner source")
        return _no_store(source_payload(source_id))

    return api

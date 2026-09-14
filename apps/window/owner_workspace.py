"""Owner workspace read contract.

This module owns the two server-side facts the owner workspace depends on and
that must not drift from the browser:

1. The **section vocabulary**. Every drill-down target is a typed owner section,
   never an arbitrary URL. The browser source of truth is ``OWNER_SECTIONS`` in
   ``web/js/view-routing.js``; the parity test in
   ``tests/test_owner_workspace.py`` fails if the two lists diverge.

2. The **Home snapshot shape** for owner cards, built on the existing
   ``schema://frank.widget-snapshot/v1`` envelope rather than a second widget
   framework. Nothing here invents a new envelope.

Observed versus refreshed time
------------------------------

The brief requires a summary to carry both the actual source observation time
and the last successful refresh time. ``home_providers.snapshot`` already owns
the envelope and ``status``, so the two stamps are carried inside ``data`` under
reserved keys. That is additive: existing consumers ignore them, and no second
snapshot format is created.

This module performs **no** provider I/O. Callers inject readings, so a source
that is slow, refused or unconfigured is reported honestly and cannot blank the
page or turn missing data into zero.
"""

from __future__ import annotations

import time
from typing import Any, Callable

# Frozen owner sections. Order matches the navigation contract in
# docs/OWNER_WORKSPACE.md and web/js/view-routing.js.
OWNER_SECTIONS: tuple[str, ...] = (
    "mail",
    "crm",
    "support",
    "campaigns",
    "revenue",
    "results",
    "notifications",
)

OWNER_PROJECT_ID = "blockwise"
OWNER_CUSTOMER_SEGMENT = "customer"

# Status vocabulary. ``attention`` is the existing Home vocabulary for an item
# that is ready but needs the owner; ``stale`` means the value is cached and its
# freshness is no longer trustworthy.
STATUSES = frozenset({"ready", "empty", "attention", "stale", "unavailable", "error"})

# Reserved keys inside ``data``. Prefixed so they cannot collide with a
# provider's own field names.
OBSERVED_AT = "owner_observed_at"
REFRESHED_AT = "owner_refreshed_at"

# Metric identities, so a card cannot silently present one authority as another.
# See the metric definitions in docs/OWNER_WORKSPACE.md.
METRIC_AUTHORITY: dict[str, str] = {
    "research_prospects": "ad_radar",
    "crm_leads": "frappe_crm",
    "registered_customers": "blockwise",
    "paying_customers": "stripe",
    "trial_state": "blockwise",
    "payment_state": "stripe",
    "cash_collected": "stripe",
    "recurring_revenue": "stripe",
    "unread_mail": "mailbox",
    "tickets_awaiting_owner": "frappe_helpdesk",
    "website_visits": "ga4",
    "paid_ad_leads": "advertising",
}

# The temporary display assumption recorded in the contract, listed for
# resolution rather than presented as configured fact.
DEFAULT_TIMEZONE_ASSUMPTION = "Australia/Perth"


def owner_section_path(section: str | None) -> str:
    """Return the canonical owner path for a section.

    An unknown section resolves to the workspace overview rather than raising,
    because a link to a section that no longer exists must not become a broken
    navigation target.
    """
    if section in OWNER_SECTIONS:
        return f"/project/{OWNER_PROJECT_ID}/{section}"
    return f"/project/{OWNER_PROJECT_ID}"


def owner_customer_path(customer_id: str | None) -> str:
    """Return the canonical owner path for one customer, or the overview."""
    value = str(customer_id or "")
    if not value or "/" in value or value.startswith("."):
        return f"/project/{OWNER_PROJECT_ID}"
    if not all(char.isalnum() or char in "._~-" for char in value):
        return f"/project/{OWNER_PROJECT_ID}"
    return f"/project/{OWNER_PROJECT_ID}/{OWNER_CUSTOMER_SEGMENT}/{value}"


def owner_section_link(label: str, section: str) -> dict[str, Any]:
    """A typed internal drill-down target for an owner section."""
    return {
        "label": label,
        "kind": "internal",
        "target": {"view": "project", "project": OWNER_PROJECT_ID, "section": section},
        "path": owner_section_path(section),
    }


def owner_customer_link(label: str, customer_id: str) -> dict[str, Any]:
    """A typed internal drill-down target for one customer record."""
    return {
        "label": label,
        "kind": "internal",
        "target": {"view": "project", "project": OWNER_PROJECT_ID, "customer": customer_id},
        "path": owner_customer_path(customer_id),
    }


def reading(
    *,
    status: str,
    value: Any = None,
    source: str,
    source_ids: list[str] | None = None,
    observed_at: int | None = None,
    detail: str = "",
) -> dict[str, Any]:
    """One honest source reading.

    ``missing is not zero`` is enforced structurally: a value may only be absent
    when the status says so. ``ready`` and ``stale`` require a concrete value,
    and every other status forbids one, so a failed source can never be rendered
    as ``0`` by a careless consumer.
    """
    if status not in STATUSES:
        raise ValueError(f"unknown reading status: {status!r}")
    has_value = value is not None
    if status in {"ready", "stale"} and not has_value:
        raise ValueError(f"status {status!r} requires a concrete value")
    if status in {"unavailable", "error"} and has_value:
        raise ValueError(f"status {status!r} must not carry a value")
    return {
        "status": status,
        "value": value,
        "source": source,
        "source_ids": list(source_ids or []),
        "observed_at": int(observed_at) if observed_at else None,
        "detail": detail,
    }


def unconfigured(source: str, detail: str = "No connection is configured for this source.") -> dict[str, Any]:
    """A source that has never been connected. Not zero, not an error."""
    return reading(status="unavailable", source=source, detail=detail)


def owner_snapshot(
    *,
    summary: str,
    readings: dict[str, dict[str, Any]],
    links: list[dict[str, Any]] | None = None,
    now: int | None = None,
) -> dict[str, Any]:
    """Build an owner Home snapshot on the existing v1 envelope.

    The envelope status is derived from the readings rather than supplied, so a
    caller cannot label a page ``ready`` while one of its sources is
    unavailable. One unavailable source degrades the card; it never blanks the
    page, because the readings that did succeed are still returned.
    """
    generated_at = int(now if now is not None else time.time())
    statuses = {name: item.get("status") for name, item in readings.items()}
    if not readings:
        envelope_status = "empty"
    elif all(state == "error" for state in statuses.values()):
        envelope_status = "error"
    elif all(state == "unavailable" for state in statuses.values()):
        envelope_status = "unavailable"
    elif any(state == "error" for state in statuses.values()):
        envelope_status = "error"
    elif any(state in {"unavailable", "stale"} for state in statuses.values()):
        envelope_status = "stale"
    elif any(state == "attention" for state in statuses.values()):
        envelope_status = "attention"
    elif all(state == "empty" for state in statuses.values()):
        envelope_status = "empty"
    else:
        envelope_status = "ready"

    observed = [item["observed_at"] for item in readings.values() if item.get("observed_at")]
    data: dict[str, Any] = {
        "section": OWNER_PROJECT_ID,
        "readings": readings,
        REFRESHED_AT: generated_at,
        OBSERVED_AT: max(observed) if observed else None,
        "timezone": DEFAULT_TIMEZONE_ASSUMPTION,
        "timezone_is_assumption": True,
        "authority": dict(METRIC_AUTHORITY),
    }
    return {
        "schema": "schema://frank.widget-snapshot/v1",
        "status": envelope_status,
        "summary": summary,
        "data": data,
        "links": list(links or []),
        "generated_at": generated_at,
        "source_truth": "provider",
    }


def attention_item(
    *,
    item_id: str,
    label: str,
    source: str,
    detail: str,
    link: dict[str, Any] | None = None,
    observed_at: int | None = None,
) -> dict[str, Any]:
    """One entry in the owner attention list.

    Every item names the source that owns it and carries a typed drill-down, so
    the owner can act in the application that owns the work instead of in a
    Frank replica of it.
    """
    if not item_id or not source:
        raise ValueError("an attention item requires a stable id and a source")
    return {
        "id": item_id,
        "label": label,
        "source": source,
        "detail": detail,
        "link": link,
        "observed_at": int(observed_at) if observed_at else None,
    }


def collect_attention(collections: dict[str, Callable[[], list[dict[str, Any]]]]) -> dict[str, Any]:
    """Gather attention items from independent sources without letting one fail.

    A source that raises is reported as an unavailable source and contributes no
    items. The remaining sources still produce their items, which is the
    behaviour the matrix requires when one integration is down.
    """
    items: list[dict[str, Any]] = []
    unavailable: list[dict[str, str]] = []
    for source, loader in collections.items():
        try:
            loaded = loader()
        except Exception as exc:  # noqa: BLE001 - reported, never swallowed silently
            unavailable.append({"source": source, "detail": f"{type(exc).__name__}: {exc}"})
            continue
        for item in loaded or []:
            if isinstance(item, dict) and item.get("id"):
                items.append(item)
    return {"items": items, "unavailable_sources": unavailable, "count": len(items)}

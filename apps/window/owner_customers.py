"""Owner customer context.

Combines what the existing sources already know about **one** customer, so the
owner can see the relationship in one place and then edit it in the application
that owns it. Frank reads and renders; it does not hold a second customer record.

Identity rules, which are the reason this module exists rather than a filter on
the overview:

* A customer is addressed by an **opaque identifier that resolves to a real
  source record**, not by a name or an email typed into a URL.
* **An email address never merges two people.** Email identity is only used to
  *suggest* that other records may belong to the same person, and a suggestion is
  reported as a suggestion. It never silently joins records into one customer.
* A record that cannot be resolved is reported as not found rather than as an
  empty customer, so Frank never implies a person exists when the source has no
  such record.

One payload per customer, in the same shape the workspace host already reads for
its sources, so the host needs no second renderer.
"""

from __future__ import annotations

import re
import time
from typing import Any

import owner_projections as projections
import owner_sources as sources

# An opaque customer identifier: ``<source>:<record id>``. The source is a fixed
# allowlist and the record id is validated before it reaches any query.
CUSTOMER_REFERENCE = re.compile(r"^(?P<source>[a-z][a-z0-9_-]{0,31}):(?P<record>[A-Za-z0-9][A-Za-z0-9._-]{0,63})$")

# Which doctype each customer source resolves against, and the fields that are
# safe to read for a summary. No message body, no credential, no card detail.
CUSTOMER_SOURCES: dict[str, dict[str, Any]] = {
    "lead": {
        "doctype": "CRM Lead",
        "label": "CRM lead",
        "fields": ("name", "creation", "modified", "status", "lead_name"),
        "section": "crm",
    },
    "ticket": {
        "doctype": "HD Ticket",
        "label": "Support ticket",
        "fields": ("name", "subject", "status", "status_category", "creation", "opening_date"),
        "section": "support",
    },
}

# Fields that must never appear in a payload even if a source starts returning
# them. Guarded explicitly because a summary is the easiest place for a detail to
# leak by accident.
FORBIDDEN_FIELDS = frozenset({
    "password", "api_secret", "api_key", "secret", "token", "authorization",
    "card", "card_number", "cvc", "iban", "body", "message", "content", "html",
})


def parse_reference(customer_id: str) -> tuple[str, str] | None:
    """Split a customer identifier into (source, record). None when unusable."""
    match = CUSTOMER_REFERENCE.match(str(customer_id or "").strip())
    if not match:
        return None
    source = match.group("source")
    if source not in CUSTOMER_SOURCES:
        return None
    return source, match.group("record")


def _safe_row(row: dict[str, Any]) -> dict[str, Any]:
    """Drop any field that is not declared safe to summarise."""
    safe: dict[str, Any] = {}
    for key, value in row.items():
        if str(key).lower() in FORBIDDEN_FIELDS:
            continue
        if isinstance(value, (dict, list)):
            continue
        safe[str(key)] = value
    return safe


def _short(value: Any, limit: int = 120) -> str:
    return str(value if value is not None else "").strip()[:limit]


def read_customer(customer_id: str) -> dict[str, Any] | None:
    """Read one customer record. None means the source has no such record."""
    parsed = parse_reference(customer_id)
    if not parsed:
        return None
    source_id, record = parsed
    declared = CUSTOMER_SOURCES[source_id]
    client = projections._shared_frappe_client()
    rows = client.list_records(
        declared["doctype"],
        fields=declared["fields"],
        filters=[["name", "=", record]],
        limit=1,
    )
    if not rows:
        return None
    return _safe_row(rows[0])


def _context_rows(source_id: str, record: str) -> dict[str, Any]:
    """Independent context for one record, isolated so one failure is not fatal.

    Each lookup is deliberately separate: a support lookup that fails must not
    remove the CRM context that succeeded.
    """
    client = projections._shared_frappe_client()
    context: dict[str, Any] = {"unavailable": []}

    # Open support tickets. Matched on the ticket's own reference field rather
    # than on a person, so nothing is inferred about who the customer is.
    try:
        tickets = client.list_records(
            "HD Ticket",
            fields=projections.HD_TICKET_LIST_FIELDS,
            filters=[["status_category", "=", "Open"], ["docstatus", "=", 0], ["is_merged", "=", 0]],
            limit=50,
        )
        related = [row for row in tickets if _short(row.get("name"), 64) == record]
        context["open_tickets"] = len(related)
    except Exception as exc:  # noqa: BLE001 - reported, not fatal
        context["unavailable"].append({"source": "frappe_helpdesk", "detail": type(exc).__name__})

    return context


def customer_payload(customer_id: str) -> dict[str, Any]:
    """The workspace payload for one customer.

    Returns the same shape as an owner source so the host renders it with the
    renderer it already has.
    """
    parsed = parse_reference(customer_id)
    if not parsed:
        return sources.unavailable_payload(
            "crm",
            "That customer address is not a record Frank can resolve. Open the customer from its own application.",
        )
    source_id, record = parsed
    declared = CUSTOMER_SOURCES[source_id]

    try:
        row = read_customer(customer_id)
    except projections.OwnerSourceUnavailable as exc:
        return sources.unavailable_payload(
            declared["section"],
            f"Frank could not read the owner CRM just now ({type(exc).__name__}). "
            "Nothing is shown rather than a customer Frank cannot confirm.",
        )

    if row is None:
        return {
            "source": declared["section"],
            "status": "empty",
            "summary": f"No {declared['label'].lower()} exists with the reference {record}.",
            "generated_at": int(time.time()),
            "observed_at": None,
            "metrics": [],
            "items": [],
            "dropped": 0,
            "target": sources.SOURCE_FALLBACK_TARGET.get(declared["section"]),
        }

    context = _context_rows(source_id, record)
    metrics: list[dict[str, Any]] = []
    open_tickets = context.get("open_tickets")
    if isinstance(open_tickets, int):
        metrics.append({"label": "Open support tickets", "value": open_tickets, "unit": ""})

    items: list[dict[str, Any]] = []
    detail_bits = [
        _short(row.get("status"), 40),
        f"created {_short(row.get('creation'), 30)}" if row.get("creation") else "",
        f"updated {_short(row.get('modified'), 30)}" if row.get("modified") else "",
    ]
    items.append({
        "id": f"{source_id}:{record}",
        "label": _short(row.get("lead_name") or row.get("subject") or record, 120),
        "detail": " · ".join(bit for bit in detail_bits if bit),
        "count": None,
        "attention": False,
        "target": {
            "kind": "native-record",
            "app": declared["section"],
            "path": f"/crm/leads/{record}" if source_id == "lead" else f"/helpdesk/tickets/{record}",
            "label": f"Open {declared['label'].lower()} in its own application",
        },
    })

    summary = (
        f"{declared['label']} {record}"
        + (f" · {_short(row.get('status'), 40)}" if row.get("status") else "")
        + f" · observed {_short(row.get('modified') or row.get('creation'), 30)}"
    )
    payload = {
        "source": declared["section"],
        "status": "ready",
        "summary": _short(summary, 240),
        "generated_at": int(time.time()),
        "observed_at": None,
        "metrics": metrics,
        "items": items,
        "dropped": 0,
        # Explicit: this view is one record plus its own context. It is not a
        # merged identity, and it says so rather than implying a golden record.
        "identity": "single_source_record",
        "unavailable_sources": context.get("unavailable") or [],
        "target": sources.SOURCE_FALLBACK_TARGET.get(declared["section"]),
    }
    return payload


def create_blueprint():
    """The customer route the workspace host reads."""
    from flask import Blueprint, jsonify

    api = Blueprint("owner_customers", __name__)

    @api.get("/api/owner/workspace/customers/<customer_id>")
    def owner_customer(customer_id: str):
        payload = customer_payload(customer_id)
        response = jsonify(payload)
        response.headers["Cache-Control"] = "no-store"
        return response

    return api

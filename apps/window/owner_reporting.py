"""Owner Results and Revenue reporting.

Reports reach and acquisition performance, and revenue, from the sources that
actually own those numbers. It never estimates one source from another and never
presents an unconnected source as a zero.

Three states, and the difference between them matters:

``ready``
    A reader returned observed data. The payload carries the values, the source
    they came from and the moment they were observed.
``unconfigured``
    No usable credential exists for this source. This is **not** an empty result
    and it is **not** a zero. The payload names the exact connection step that is
    missing so the owner can act, and the section stays useful for the sources
    that do work.
``error``
    A credential exists but the read failed. Reported with the failure category
    and nothing else, so a transient outage is never mistaken for a measurement.

An unconnected source is never marked complete merely because an empty-state
component renders. That is the specific failure the acceptance ledger is meant to
prevent, and it is why ``state`` is derived from the observation rather than
declared by the caller.
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable

import owner_sources as sources

# Connection states. ``unconfigured`` exists so that "we have not connected this"
# can never be confused with "this measured zero".
REPORTING_STATES = frozenset({"ready", "empty", "unconfigured", "error", "stale"})

# The environment variable that records a source's connector state, and the
# dashboard URL variable, mirroring the existing /api/providers/readiness
# contract. A URL is never treated as proof that a source is collecting data.
CONNECTOR_STATUS_ENV = {
    "ga4": "GA4_CONNECTOR_STATUS",
    "clarity": "CLARITY_CONNECTOR_STATUS",
    "stripe": "STRIPE_CONNECTOR_STATUS",
    "search_console": "SEARCH_CONSOLE_CONNECTOR_STATUS",
    "meta_ads": "META_ADS_CONNECTOR_STATUS",
    "google_ads": "GOOGLE_ADS_CONNECTOR_STATUS",
}

# What each source measures, what it needs, and the limits of what it can tell
# the owner. The limits are part of the contract: attribution is genuinely
# limited and saying so is more useful than a precise-looking number.
REPORTING_SOURCES: dict[str, dict[str, Any]] = {
    # --- Results: reach and acquisition ---
    "ga4": {
        "section": "results",
        "label": "Website visits",
        "measures": "Sessions and engaged sessions on the business site.",
        "needs": "A Google Analytics 4 property id and a read-only service account with access to it.",
        "limits": "Visits are not people. A visit does not prove the visitor saw an advertisement.",
        "authority": "Google Analytics 4",
    },
    "search_console": {
        "section": "results",
        "label": "Search performance",
        "measures": "Impressions, clicks and average position for the verified property.",
        "needs": "Search Console API access for the verified site property.",
        "limits": "Search Console reports queries it chose to report; it is not a complete record of demand.",
        "authority": "Google Search Console",
    },
    "meta_ads": {
        "section": "results",
        "label": "Paid social",
        "measures": "Spend, impressions and leads attributed by Meta for the selected business ad account.",
        "needs": "Marketing API access to the business ad account, never to a client's account.",
        "limits": "Provider-attributed results. A platform claim is not independent proof that a lead is real or qualified.",
        "authority": "Meta Ads",
    },
    "google_ads": {
        "section": "results",
        "label": "Paid search",
        "measures": "Spend, clicks and conversions attributed by Google for the selected business account.",
        "needs": "Google Ads API access for the business account.",
        "limits": "Provider-attributed results, and conversion definitions are the account's own, not Blockwise's.",
        "authority": "Google Ads",
    },
    "clarity": {
        "section": "results",
        "label": "Behaviour recordings",
        "measures": "Session recordings and heatmaps for the configured project.",
        "needs": "Clarity Data Export API access for the project.",
        "limits": "Recordings are a sample and are not a statistically valid measurement.",
        "authority": "Microsoft Clarity",
    },
    # --- Revenue ---
    "stripe": {
        "section": "revenue",
        "label": "Revenue",
        "measures": "Payments collected and active subscriptions, separated.",
        "needs": "A restricted Stripe API key with read access to payments and subscriptions.",
        "limits": (
            "Cash collected and recurring revenue are different quantities and are reported separately. "
            "Amounts are never summed across currencies, and cancelled or free plans are not counted as paying."
        ),
        "authority": "Stripe",
    },
}

# Readers, attached by the composition root. A source with no reader stays
# unconfigured, which is the honest state before its adapter exists.
REPORTING_READERS: dict[str, Callable[[], dict[str, Any]]] = {}


def register_reader(source_id: str, reader: Callable[[], dict[str, Any]]) -> None:
    if source_id not in REPORTING_SOURCES:
        raise ValueError(f"unknown reporting source: {source_id!r}")
    REPORTING_READERS[source_id] = reader


def _connector_state(source_id: str) -> str:
    """The recorded connector state for a source, or an empty string.

    This reports what is *recorded*. It is deliberately not treated as proof of
    data, and a connector marked ready with no reader is still unconfigured here,
    because a recorded state is not an observation.
    """
    name = CONNECTOR_STATUS_ENV.get(source_id)
    if not name:
        return ""
    return str(os.environ.get(name, "")).strip().lower()


def _connection_payload(source_id: str, declared: dict[str, Any], detail: str) -> dict[str, Any]:
    recorded = _connector_state(source_id)
    payload = sources.unavailable_payload(declared["section"], detail)
    payload["source"] = source_id
    payload["connection"] = {
        "state": "unconfigured",
        "recorded_connector_state": recorded or "absent",
        "needs": declared["needs"],
        "authority": declared["authority"],
        "limits": declared["limits"],
        "measures": declared["measures"],
        "label": declared["label"],
    }
    return payload


def source_report(source_id: str) -> dict[str, Any]:
    """One reporting source, isolated from every other source."""
    declared = REPORTING_SOURCES.get(source_id)
    if declared is None:
        return sources.unavailable_payload("results", "Frank does not report that source.")

    reader = REPORTING_READERS.get(source_id)
    if reader is None:
        return _connection_payload(
            source_id, declared,
            f"Frank cannot report {declared['label'].lower()} yet: {declared['needs']}",
        )

    try:
        observed = reader()
    except Exception as exc:  # noqa: BLE001 - reported for this source alone
        payload = _connection_payload(
            source_id, declared,
            f"Frank has a connection for {declared['label'].lower()} but the read failed "
            f"({type(exc).__name__}). Nothing is shown rather than a figure Frank cannot confirm.",
        )
        payload["status"] = "error"
        payload["connection"]["state"] = "error"
        return payload

    if not isinstance(observed, dict):
        payload = _connection_payload(source_id, declared, f"Frank could not interpret the {declared['label'].lower()} answer.")
        payload["status"] = "error"
        payload["connection"]["state"] = "error"
        return payload

    # A reader that answers must declare its own observation, so the section can
    # always show when the figure was true rather than when the page was drawn.
    payload = dict(observed)
    payload.setdefault("source", source_id)
    payload.setdefault("status", "ready")
    payload.setdefault("generated_at", int(time.time()))
    connection = dict(payload.get("connection") or {})
    connection.update({
        "state": payload["status"],
        "recorded_connector_state": _connector_state(source_id) or "absent",
        "needs": declared["needs"],
        "authority": declared["authority"],
        "limits": declared["limits"],
        "measures": declared["measures"],
        "label": declared["label"],
    })
    payload["connection"] = connection
    return payload


def section_payload(section: str) -> dict[str, Any]:
    """A reporting section, gathered so one failing source cannot blank it."""
    declared_ids = [sid for sid, item in REPORTING_SOURCES.items() if item["section"] == section]
    reports = {sid: source_report(sid) for sid in declared_ids}
    ready = [sid for sid, payload in reports.items() if payload.get("status") in {"ready", "empty"}]
    unconfigured = [sid for sid, payload in reports.items() if payload.get("connection", {}).get("state") == "unconfigured"]
    errored = [sid for sid, payload in reports.items() if payload.get("status") == "error"]

    if ready and not unconfigured and not errored:
        status = "ready"
    elif ready:
        # Partly connected: the section still works, and it says what is missing.
        status = "attention"
    elif errored:
        status = "error"
    else:
        status = "unconfigured"

    summary = {
        "ready": f"{len(ready)} of {len(declared_ids)} sources are reporting.",
        "attention": (
            f"{len(ready)} of {len(declared_ids)} sources are reporting. "
            f"{len(unconfigured)} still need a connection."
        ),
        "error": "Every connected source failed its last read.",
        "unconfigured": "No source in this section is connected yet.",
    }[status]

    # The workspace source vocabulary is the one the host renders. "Nothing is
    # connected here" is an unavailable source rather than a new status, so the
    # client needs no new state; the richer per-source connection state travels
    # alongside in ``reports`` rather than being flattened away.
    host_status = "unavailable" if status == "unconfigured" else status

    return {
        "source": section,
        "status": host_status,
        "connection_state": status,
        "summary": summary,
        "generated_at": int(time.time()),
        "observed_at": None,
        "metrics": [],
        "items": [
            {
                "id": sid,
                "label": payload["connection"]["label"],
                "detail": payload.get("detail") or payload.get("summary") or "",
                "count": None,
                "attention": payload.get("status") == "error",
                "target": sources.SOURCE_FALLBACK_TARGET.get(section),
            }
            for sid, payload in reports.items()
        ],
        "dropped": 0,
        "reports": reports,
        "ready_sources": ready,
        "unconfigured_sources": unconfigured,
        "errored_sources": errored,
        "target": sources.SOURCE_FALLBACK_TARGET.get(section),
    }


def attach_reporting_sources() -> tuple[str, ...]:
    """Expose Results and Revenue through the workspace source routes.

    The section payloads become the payloads for their sections, so the owner
    workspace renders them with the renderer it already has. No source has a
    reader yet, so every one of them reports unconfigured with the exact
    connection step it needs.
    """
    attached = []
    for section in ("results", "revenue"):
        sources.register_source(section, lambda s=section: section_payload(s))
        attached.append(section)
    return tuple(attached)

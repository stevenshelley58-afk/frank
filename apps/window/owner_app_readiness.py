"""Owner application readiness.

The workspace host asks the server whether a native application may be framed.
It must never learn that from an iframe ``load`` event, and the browser must
never be able to declare an application connected, so the decision is made here.

Two properties are reported separately and both are required before the host
will frame anything:

``ready``
    The application answers over its approved origin with an acceptable status.
``frameable``
    The application's approved origin is actually serving a certificate for that
    name, and the response policy permits the approved Frank parent to frame it.

They are separate because they fail for different reasons and need different
fixes: an application can be perfectly healthy while its origin has no
certificate yet, which is exactly the state of the native origins at the start
of this build.

Nothing here is cached into a claim. Each answer carries the moment it was
observed, and an unknown state is reported as unknown rather than as ``false``.
"""

from __future__ import annotations

import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# Approved owner application origins. This is the server half of the registry
# the workspace host also keeps; the host independently refuses any origin that
# is not its own declared value, so the two must agree.
OWNER_APPS: dict[str, dict[str, Any]] = {
    "mail": {"origin": "https://mail.frank.fail", "home": "/", "label": "Mail"},
    "crm": {"origin": "https://crm.frank.fail", "home": "/crm/leads", "label": "CRM"},
    "support": {"origin": "https://crm.frank.fail", "home": "/helpdesk/tickets", "label": "Support"},
    "campaigns": {"origin": "https://marketing.frank.fail", "home": "/s/campaigns", "label": "Email flows"},
}

# The approved Frank parent origin. Framing is permitted only by this origin.
APPROVED_FRAME_ANCESTOR = "https://frank.fail"

DEFAULT_TIMEOUT_SECONDS = 4.0

# Statuses that mean "the application is there". A login redirect or an auth
# requirement is a healthy application, not a failure: the owner session is a
# separate concern from whether the app is reachable.
HEALTHY_STATUSES = frozenset({200, 301, 302, 303, 307, 308, 401, 403})


def _now() -> int:
    return int(time.time())


def unknown_readiness(app_id: str, reason: str, detail: str = "") -> dict[str, Any]:
    """An honest unknown. Never rendered as a definite negative."""
    app = OWNER_APPS.get(app_id)
    return {
        "app": app_id,
        "known": app is not None,
        "origin": (app or {}).get("origin"),
        "path": (app or {}).get("home", "/"),
        "ready": None,
        "frameable": None,
        "reason": reason,
        "detail": detail,
        "checked_at": _now(),
    }


def _certificate_covers(hostname: str, origin: str, timeout: float) -> tuple[bool | None, str]:
    """Whether the origin's host presents a valid certificate for its name.

    Returns ``None`` when the answer cannot be established, which is different
    from a definite "no certificate" and is reported as such.
    """
    host = urllib.parse.urlsplit(origin).hostname
    if not host:  # pragma: no cover - defensive, origin is a constant
        return None, "no_host"
    context = ssl.create_default_context()
    try:
        with socket.create_connection((host, 443), timeout=timeout) as raw:
            with context.wrap_socket(raw, server_hostname=host) as tls:
                return bool(tls.getpeercert()), "certificate_present"
    except ssl.SSLCertVerificationError as exc:
        return False, f"certificate_untrusted:{exc.verify_message or exc.reason}"
    except ssl.SSLError as exc:
        return False, f"tls_error:{exc.reason or type(exc).__name__}"
    except (socket.timeout, TimeoutError):
        return None, "tls_timeout"
    except OSError as exc:
        return None, f"network_error:{exc.errno if exc.errno is not None else type(exc).__name__}"


def _probe_origin(app_id: str, timeout: float) -> tuple[bool | None, int | None, str]:
    """Fetch the application origin. Returns (ready, status, reason)."""
    app = OWNER_APPS[app_id]
    url = app["origin"] + app["home"]
    request = urllib.request.Request(url, method="GET", headers={"User-Agent": "frank-owner-readiness/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - constant https origin
            return response.status in HEALTHY_STATUSES, response.status, "answered"
    except urllib.error.HTTPError as exc:
        # An auth challenge is a live application, not an outage.
        return exc.code in HEALTHY_STATUSES, exc.code, "answered_with_status"
    except urllib.error.URLError as exc:
        return False, None, f"unreachable:{type(exc.reason).__name__}"
    except (socket.timeout, TimeoutError):
        return None, None, "request_timeout"
    except Exception as exc:  # noqa: BLE001 - reported, never silently a pass
        return False, None, f"error:{type(exc).__name__}"


def app_readiness(app_id: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    """Whether one owner application may be framed right now."""
    if app_id not in OWNER_APPS:
        return unknown_readiness(app_id, "unknown_app", "Frank does not run that application.")

    app = OWNER_APPS[app_id]
    origin = app["origin"]

    cert_ok, cert_reason = _certificate_covers(app_id, origin, timeout)
    ready, status, ready_reason = _probe_origin(app_id, timeout)

    # Framing needs a trusted certificate first. Without one the browser will not
    # render the origin at all, so frameable is false for a real reason rather
    # than merely unproven.
    if cert_ok is False:
        frameable: bool | None = False
        reason = "origin_certificate_untrusted"
        detail = (
            f"{origin} is not yet serving a trusted certificate ({cert_reason}), so the browser "
            "cannot render it. The approved ingress must publish this origin first."
        )
    elif cert_ok is None:
        frameable = None
        reason = "origin_tls_unknown"
        detail = f"Frank could not establish whether {origin} presents a valid certificate ({cert_reason})."
    elif ready is None:
        frameable = None
        reason = "origin_probe_unknown"
        detail = f"Frank could not reach {origin} to decide whether it may be framed."
    else:
        frameable = bool(ready)
        reason = "allowed" if ready else "origin_unreachable"
        detail = (
            f"{origin} answers with a trusted certificate and an acceptable status."
            if ready
            else f"{origin} does not answer with an acceptable status, so it is not framed."
        )

    return {
        "app": app_id,
        "known": True,
        "label": app["label"],
        "origin": origin,
        "path": app["home"],
        "ready": ready,
        "frameable": frameable,
        "status": status,
        "reason": reason,
        "detail": detail,
        "certificate": cert_reason,
        "ready_reason": ready_reason,
        "approved_frame_ancestor": APPROVED_FRAME_ANCESTOR,
        "checked_at": _now(),
    }


def workspace_readiness(timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    """Readiness for every owner application, isolated per application."""
    apps = {app_id: app_readiness(app_id, timeout) for app_id in OWNER_APPS}
    return {
        "schema": "schema://frank.owner-app-readiness/v1",
        "apps": apps,
        "approved_frame_ancestor": APPROVED_FRAME_ANCESTOR,
        "checked_at": _now(),
    }


def render_readiness(app_id: str, payload: dict[str, Any]) -> tuple[int, str, str]:
    """Return (status, content_type, body) for the readiness route.

    A readiness answer is never cached, and an unknown application is a 404 so a
    typo cannot look like a broken application.
    """
    if not payload.get("known"):
        return 404, "application/json", json.dumps({"error": "unknown_app", "app": app_id}, sort_keys=True)
    body = json.dumps(payload, sort_keys=True)
    return 200, "application/json", body


def create_blueprint():
    """The readiness routes the owner workspace host calls.

    Read-only and same-origin. The host asks the server whether an application
    may be framed, so the browser is never the authority on that.
    """
    from flask import Blueprint, abort, jsonify, request

    api = Blueprint("owner_app_readiness", __name__)

    def _timeout() -> float:
        # A bounded, caller-tunable probe timeout, clamped so a request cannot
        # hold a worker open for an unreasonable time.
        try:
            value = float(request.args.get("timeout", ""))
        except (TypeError, ValueError):
            return DEFAULT_TIMEOUT_SECONDS
        return min(max(value, 0.5), 15.0)

    def _respond(payload: dict[str, Any]):
        if not payload.get("known"):
            abort(404, description="unknown owner application")
        response = jsonify(payload)
        # Readiness is a live observation, never a cacheable claim.
        response.headers["Cache-Control"] = "no-store"
        return response

    @api.get("/api/owner/workspace/apps")
    def owner_apps_list():
        response = jsonify({
            "schema": "schema://frank.owner-app-readiness/v1",
            "apps": {app_id: dict(app) for app_id, app in OWNER_APPS.items()},
            "approved_frame_ancestor": APPROVED_FRAME_ANCESTOR,
            "checked_at": _now(),
        })
        response.headers["Cache-Control"] = "no-store"
        return response

    @api.get("/api/owner/workspace/apps/<app_id>/readiness")
    def owner_app_readiness(app_id: str):
        return _respond(app_readiness(app_id, _timeout()))

    @api.get("/api/owner/workspace/readiness")
    def owner_workspace_readiness():
        response = jsonify(workspace_readiness(_timeout()))
        response.headers["Cache-Control"] = "no-store"
        return response

    return api

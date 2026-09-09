import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, abort, jsonify, redirect, request


def _operator_attested() -> None:
    expected = os.environ.get("FRANK_BASIC_AUTH_HASH", "").strip()
    presented = request.headers.get("X-Frank-Operator-Attestation", "").strip()
    if not expected:
        abort(503, "Frank operator authentication is unavailable.")
    if not presented or not hmac.compare_digest(expected, presented):
        abort(401, "Frank operator authentication is required.")


def _upstream_base() -> str:
    raw = os.environ.get("MINI_PARTNER_URL", "").strip().rstrip("/")
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        abort(503, "Mini operator feed is not configured.")
    if (parsed.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}:
        abort(503, "Mini operator feed is not reachable from Frank's container.")
    return raw


def _upstream(path: str, *, method: str = "GET", payload: dict | None = None):
    token = os.environ.get("MINI_PARTNER_TOKEN", "").strip()
    if not token:
        abort(503, "Mini operator feed is not configured.")
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    upstream = urllib.request.Request(
        _upstream_base() + path, data=body, method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(upstream, timeout=8) as response:
            data = response.read()
            status = int(getattr(response, "status", 200))
    except urllib.error.HTTPError as error:
        data = error.read()
        status = int(error.code)
    except (TimeoutError, urllib.error.URLError):
        if method == "PATCH":
            abort(504, "Mini did not confirm the update. It may have been applied; refresh before retrying.")
        abort(503, "Mini operator feed is temporarily unavailable.")

    try:
        decoded = json.loads(data.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        abort(502, "Mini operator feed returned an invalid response.")
    return jsonify(decoded), status


def create_blueprint() -> Blueprint:
    api = Blueprint("mini_operator_proxy", __name__)

    @api.get("/api/operator/mini/service-requests")
    def service_requests():
        _operator_attested()
        return _upstream("/api/operator/mini/service-requests")

    @api.patch("/api/operator/mini/service-requests/<request_id>")
    def update_service_request(request_id: str):
        _operator_attested()
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            abort(400, "A JSON status update is required.")
        target = urllib.parse.quote(request_id, safe="")
        return _upstream(
            f"/api/operator/mini/service-requests/{target}", method="PATCH", payload=body
        )

    @api.get("/frank/mini-service-requests")
    def operator_panel():
        _operator_attested()
        return redirect("/?project=mini-frank&panel=mini-service-requests", code=302)

    return api

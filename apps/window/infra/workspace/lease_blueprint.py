"""Narrowly authenticated private server-to-server lease endpoint (Session 5).

Mounted by Session 1's central wiring on the loopback/private bridge only.
The credential is runtime-only (read from the environment at request time),
compared in constant time, redacted from every response, and never available
to the browser. Missing or unset credential configuration fails closed.
"""
from __future__ import annotations

import hmac
import os

from flask import Blueprint, abort, jsonify, request

from .lease import LeaseError, LeaseRefused, StaleGeneration, WorkspaceLease
from .schemas import LeaseOwner


def _runtime_credential(env_name: str) -> str:
    value = os.environ.get(env_name, "")
    if not value:
        abort(503, "lease credential is not configured")
    return value


def _authorized(env_name: str) -> None:
    presented = request.headers.get("Authorization", "")
    expected = _runtime_credential(env_name)
    prefix = "Bearer "
    if not presented.startswith(prefix) or not hmac.compare_digest(presented[len(prefix):], expected):
        abort(403)


def _owner_from(body: dict) -> LeaseOwner:
    owner = LeaseOwner.from_dict(body.get("owner"))
    if owner is None or not owner.executor_kind or not owner.executor_id:
        abort(400, "owner executor kind and id are required")
    return owner


def create_lease_blueprint(
    lease: WorkspaceLease,
    *,
    url_prefix: str = "/internal/leases",
    credential_env: str = "FRANK_LEASE_CREDENTIAL",
) -> Blueprint:
    api = Blueprint("workspace_lease", __name__, url_prefix=url_prefix)

    @api.errorhandler(LeaseError)
    def lease_error(error: LeaseError):
        status = 409 if isinstance(error, (LeaseRefused, StaleGeneration)) else 503
        return jsonify({"error": str(error)}), status

    @api.post("/<workspace_id>/acquire")
    def acquire(workspace_id: str):
        _authorized(credential_env)
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"owner", "max_wait_seconds"}:
            abort(400, "unsupported acquire fields")
        grant = lease.acquire(
            workspace_id,
            _owner_from(body),
            max_wait_seconds=float(body.get("max_wait_seconds") or 0.0),
        )
        return jsonify({"ok": True, "lease": grant.to_dict()}), 201

    @api.post("/<workspace_id>/heartbeat")
    def heartbeat(workspace_id: str):
        _authorized(credential_env)
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"generation"}:
            abort(400, "unsupported heartbeat fields")
        grant = lease.heartbeat(workspace_id, str(body.get("generation") or ""))
        return jsonify({"ok": True, "lease": grant.to_dict()})

    @api.post("/<workspace_id>/release")
    def release(workspace_id: str):
        _authorized(credential_env)
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"generation"}:
            abort(400, "unsupported release fields")
        return jsonify({"ok": True, **lease.release(workspace_id, str(body.get("generation") or ""))})

    @api.post("/<workspace_id>/cancel-queued")
    def cancel_queued(workspace_id: str):
        _authorized(credential_env)
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"generation"}:
            abort(400, "unsupported cancel fields")
        return jsonify({"ok": True, **lease.cancel_queued(workspace_id, str(body.get("generation") or ""))})

    @api.get("/<workspace_id>")
    def inspect(workspace_id: str):
        _authorized(credential_env)
        return jsonify({"ok": True, "record": lease.inspect(workspace_id)})

    return api

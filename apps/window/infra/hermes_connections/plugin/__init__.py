"""Hermes tools for Frank's authenticated Connections Agent boundary."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

SAFE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
MAX_RESPONSE_BYTES = 512 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        raise RuntimeError("Frank redirected a private Connections request")


def _settings() -> tuple[str, str]:
    try:
        import yaml
    except ImportError:
        raise RuntimeError("Hermes PyYAML dependency is unavailable") from None
    home = Path(os.environ.get("HERMES_HOME", "/home/hermes/.hermes"))
    config_path = Path(os.environ.get("HERMES_CONFIG_FILE", str(home / "config.yaml")))
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    settings = (
        data.get("plugins", {})
        .get("entries", {})
        .get("connections-agent", {})
        .get("settings", {})
    )
    if settings.get("enabled") is not True:
        raise RuntimeError("Connections Agent is not enabled in the default Hermes profile")
    frank_url = str(settings.get("frank_url", "")).rstrip("/")
    if frank_url != "http://127.0.0.1:18080":
        raise RuntimeError("Connections Agent requires Frank's loopback-only endpoint")
    key = os.environ.get("HERMES_CONNECTIONS_AGENT_KEY", "").strip()
    if not SAFE_KEY.fullmatch(key):
        raise RuntimeError("HERMES_CONNECTIONS_AGENT_KEY is missing or invalid")
    return frank_url, key


def _request(method: str, path: str, payload: dict | None = None) -> dict:
    frank_url, key = _settings()
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        frank_url + path,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "X-Hermes-Profile": "default",
        },
    )
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(request, timeout=10) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        raw = error.read(MAX_RESPONSE_BYTES + 1)
        try:
            detail = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            detail = {"error": "Frank rejected the Connections request"}
        return {"ok": False, "status": error.code, "response": detail}
    except (OSError, TimeoutError, urllib.error.URLError):
        return {"ok": False, "status": 503, "error": "Frank Connections is unavailable"}
    if len(raw) > MAX_RESPONSE_BYTES:
        return {"ok": False, "status": 502, "error": "Frank Connections response was too large"}
    try:
        decoded = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"ok": False, "status": 502, "error": "Frank Connections returned invalid JSON"}
    return {"ok": True, "status": response.status, "response": decoded}


def _inspect(params: dict, **kwargs) -> str:
    del kwargs
    limit = int(params.get("activity_limit", 20))
    limit = max(1, min(limit, 50))
    return json.dumps(_request("GET", f"/api/connections/agent/inspect?activity_limit={limit}"))


def _plan(params: dict, **kwargs) -> str:
    del kwargs
    return json.dumps(_request("POST", "/api/connections/agent/plan", params))


def _apply(params: dict, **kwargs) -> str:
    del kwargs
    return json.dumps(_request("POST", "/api/connections/agent/apply", params))


INSPECT_SCHEMA = {
    "name": "frank_connections_inspect",
    "description": "Inspect Frank's safe Connections read model, attention queue, and recent action activity.",
    "parameters": {
        "type": "object",
        "properties": {"activity_limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        "additionalProperties": False,
    },
}

PLAN_SCHEMA = {
    "name": "frank_connections_plan",
    "description": "Create a durable Frank connection action plan. This does not claim provider work has completed.",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["discover", "create", "update", "verify", "sync", "revoke", "delete"]},
            "connection_id": {"type": "string"},
            "expected_revision": {"type": "integer", "minimum": 1},
            "provider": {"type": "string"},
            "consumer": {"type": "string"},
            "project": {"type": "string"},
            "environment": {"type": "string"},
            "target": {"type": "object"},
            "body": {"type": "object"},
            "idempotency_key": {"type": "string", "minLength": 8, "maxLength": 128},
        },
        "required": ["action", "idempotency_key"],
        "additionalProperties": False,
    },
}

APPLY_SCHEMA = {
    "name": "frank_connections_apply",
    "description": "Apply a Hermes-issued Frank connection plan with provider evidence or a safe failure receipt.",
    "parameters": {
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
            "confirmation_token": {"type": "string"},
            "idempotency_key": {"type": "string", "minLength": 8, "maxLength": 128},
            "provider_receipt": {"type": "string"},
            "provider_outcome": {"type": "string"},
            "provider_error_code": {"type": "string"},
            "provider_error_category": {"type": "string"},
        },
        "required": ["plan_id", "idempotency_key"],
        "additionalProperties": False,
    },
}


def register(ctx):
    ctx.register_tool(
        name="frank_connections_inspect",
        toolset="frank-connections",
        schema=INSPECT_SCHEMA,
        handler=_inspect,
        description="Inspect Frank Connections safely.",
    )
    ctx.register_tool(
        name="frank_connections_plan",
        toolset="frank-connections",
        schema=PLAN_SCHEMA,
        handler=_plan,
        description="Plan a Frank connection action.",
    )
    ctx.register_tool(
        name="frank_connections_apply",
        toolset="frank-connections",
        schema=APPLY_SCHEMA,
        handler=_apply,
        description="Apply a Frank connection plan with provider evidence.",
    )

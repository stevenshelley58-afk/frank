"""Reusable Frank home pages, widgets, and connection metadata.

Frank renders provider-owned state. It never stores provider secrets or executes
provider actions; Hermes and the connected provider remain authoritative.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from flask import Blueprint, abort, jsonify, request
from werkzeug.exceptions import HTTPException


api = Blueprint("home_platform", __name__)


@api.errorhandler(HTTPException)
def _api_error(error: HTTPException):
    return jsonify({"error": error.description}), error.code

DATA_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
HOME_STORE_FILE = Path(os.environ.get("HOME_STORE_FILE", str(DATA_DIR / "home-layouts.json")))
CONNECTIONS_FILE = Path(os.environ.get("CONNECTIONS_STORE_FILE", str(DATA_DIR / "connections.json")))

MAX_WIDGETS_PER_HOME = 25
ENTITY_KINDS = {"project", "tool", "agent", "service"}
WIDGET_SIZES = {"small", "medium", "wide"}
CONNECTION_STATUSES = {"setup_needed", "connected", "verified", "error"}
CONNECTION_PROVIDERS = {"resend", "stripe", "activepieces", "mcp", "api"}
CONNECTION_SCOPES = {"global", *ENTITY_KINDS}
CONNECTION_FIELDS = {
    "provider", "name", "scope_kind", "scope_id", "status", "connection_ref",
    "credential_ref", "admin_url", "capabilities", "notes", "last_verified_at",
}
CONNECTION_PUBLIC_FIELDS = CONNECTION_FIELDS | {"id", "created_at", "updated_at"}
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
OPAQUE_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$")
VAULT_REFERENCE = re.compile(
    r"^(?:vault|openbao|bitwarden|1password|pass|keyring|secret)://[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._/-]*$",
    re.I,
)
FORBIDDEN_FIELDS = {
    "password", "passphrase", "secret", "token", "api_key", "apikey",
    "private_key", "access_key", "refresh_token", "client_secret",
    "card_number", "cvc", "cvv", "expiry", "bank_account", "iban",
    "payment_details", "card_details",
}
SECRET_VALUE = re.compile(
    r"\b(?:password|passphrase|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*\S+",
    re.I,
)
BEARER_VALUE = re.compile(r"\bBearer\s+\S+", re.I)
PROVIDER_SECRET = re.compile(
    r"(?:\b(?:re|resend)_[A-Za-z0-9_-]{8,}|\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}|\bwhsec_[A-Za-z0-9_-]{8,}|\b(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,})",
    re.I,
)
JWT_VALUE = re.compile(r"\b(?:eyJ[A-Za-z0-9_-]{4,}\.){2}[A-Za-z0-9_-]{4,}\b")

_home_lock = threading.RLock()
_connections_lock = threading.RLock()
_project_loader: Callable[[], list[dict]] = lambda: []
_account_loader: Callable[[], list[dict]] = lambda: []
_hermes_health: Callable[[], dict] = lambda: {"ok": False, "reason": "not configured"}
_roots: dict[str, Path] = {}


BUILTIN_WIDGETS = [
    {
        "id": "entity-overview", "version": "1.0.0", "title": "Overview",
        "description": "Identity, purpose, and current recorded state.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "wide",
        "allowed_sizes": ["medium", "wide"], "provider": "frank.entity",
        "freshness": "on_demand", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "application-status", "version": "1.0.0", "title": "Application",
        "description": "Recorded live URL and health-connection state.",
        "surfaces": ["project", "service"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "frank.projects",
        "freshness": "on_demand", "accepts_connection": True, "multiple": False,
    },
    {
        "id": "repository-status", "version": "1.0.0", "title": "Repository",
        "description": "Read-only repository branch and checkout presence.",
        "surfaces": ["project", "tool", "service"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "frank.explorer",
        "freshness": "on_demand", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "connections-summary", "version": "1.0.0", "title": "Connections",
        "description": "Recorded provider connections and setup issues.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "frank.connections",
        "freshness": "on_demand", "accepts_connection": True, "multiple": False,
    },
    {
        "id": "accounts-summary", "version": "1.0.0", "title": "Accounts",
        "description": "Project account and customer-directory totals.",
        "surfaces": ["project", "tool"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "frank.accounts",
        "freshness": "on_demand", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "hermes-status", "version": "1.0.0", "title": "Hermes",
        "description": "Reachability of the sole Frank brain.",
        "surfaces": ["project", "tool", "agent", "service"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "hermes.health",
        "freshness": "poll", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "work-status", "version": "1.0.0", "title": "Work",
        "description": "Running and waiting work when a work-event provider is connected.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "hermes.work",
        "freshness": "poll", "accepts_connection": True, "multiple": False,
    },
    {
        "id": "recent-receipts", "version": "1.0.0", "title": "Recent receipts",
        "description": "Verified outcomes from a connected receipt provider.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "hermes.receipts",
        "freshness": "poll", "accepts_connection": True, "multiple": False,
    },
    {
        "id": "analytics-summary", "version": "1.0.0", "title": "Analytics",
        "description": "Capability-aware analytics, including Umami when connected.",
        "surfaces": ["project", "tool", "service"], "default_size": "wide",
        "allowed_sizes": ["medium", "wide"], "provider": "frank.analytics",
        "freshness": "poll", "accepts_connection": True, "multiple": False,
    },
    {
        "id": "quick-links", "version": "1.0.0", "title": "Links",
        "description": "Safe shortcuts configured for this home.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "small",
        "allowed_sizes": ["small", "medium"], "provider": "frank.links",
        "freshness": "snapshot", "accepts_connection": False, "multiple": True,
    },
]

DEFAULT_WIDGET_IDS = {
    "project": ["entity-overview", "application-status", "connections-summary", "accounts-summary", "repository-status", "analytics-summary"],
    "tool": ["entity-overview", "connections-summary", "accounts-summary", "work-status", "recent-receipts"],
    "agent": ["entity-overview", "hermes-status", "connections-summary", "work-status", "recent-receipts"],
    "service": ["entity-overview", "application-status", "connections-summary", "analytics-summary", "recent-receipts"],
}

CONNECTION_CATALOG = [
    {
        "provider": "resend", "title": "Resend", "description": "Transactional email delivery.",
        "capabilities": ["email.send", "email.status"], "setup_mode": "provider",
    },
    {
        "provider": "stripe", "title": "Stripe", "description": "Billing and subscription provider.",
        "capabilities": ["billing.status", "billing.manage"], "setup_mode": "provider",
    },
    {
        "provider": "activepieces", "title": "Activepieces", "description": "Open-source connectors and workflows.",
        "capabilities": ["workflow.run", "workflow.status", "connector.setup"], "setup_mode": "activepieces",
        "adapter_status_map": {"ACTIVE": "verified", "MISSING": "setup_needed", "ERROR": "error"},
        "adapter_note": "Future Hermes adapter reads Activepieces MCP status; credentials are configured in Activepieces UI.",
    },
    {
        "provider": "mcp", "title": "MCP", "description": "A tool exposed to Hermes through an MCP boundary.",
        "capabilities": ["tool.invoke", "tool.status"], "setup_mode": "reference",
    },
    {
        "provider": "api", "title": "API", "description": "A generic API connection registered for later provider adapters.",
        "capabilities": ["api.read", "api.write"], "setup_mode": "reference",
    },
]


def configure(
    *,
    project_loader: Callable[[], list[dict]],
    account_loader: Callable[[], list[dict]],
    hermes_health: Callable[[], dict],
    roots: dict[str, Path],
) -> None:
    global _project_loader, _account_loader, _hermes_health, _roots
    _project_loader = project_loader
    _account_loader = account_loader
    _hermes_health = hermes_health
    _roots = roots


def _now() -> int:
    return int(time.time())


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _read_json(path: Path, empty: dict) -> dict:
    if not path.exists():
        return dict(empty)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else dict(empty)
    except (OSError, json.JSONDecodeError):
        return dict(empty)


def _home_store() -> dict:
    data = _read_json(HOME_STORE_FILE, {"version": 1, "homes": {}, "custom_widgets": []})
    if data.get("version") != 1 or not isinstance(data.get("homes"), dict) or not isinstance(data.get("custom_widgets"), list):
        return {"version": 1, "homes": {}, "custom_widgets": []}
    return data


def _connection_store() -> dict:
    data = _read_json(CONNECTIONS_FILE, {"version": 1, "connections": []})
    if data.get("version") != 1 or not isinstance(data.get("connections"), list):
        return {"version": 1, "connections": []}
    return data


def _clean_id(value: object, label: str) -> str:
    text = str(value or "").strip().lower()
    if not SAFE_ID.fullmatch(text):
        abort(400, f"invalid {label}")
    return text


def _clean_text(value: object, limit: int, *, required: bool = False) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()[:limit]
    if required and not text:
        abort(400, "required text is missing")
    return text


def _clean_plain_text(value: object, limit: int, *, required: bool = False) -> str:
    text = _clean_text(value, limit, required=required)
    if re.search(r"<\/?[A-Za-z][^>]*>", text):
        abort(400, "custom widgets accept plain text, not HTML")
    return text


def _contains_payment_data(text: str) -> bool:
    if re.search(r"\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b", text, re.I):
        return True
    for candidate in re.findall(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)", text):
        digits = re.sub(r"\D", "", candidate)
        if not 13 <= len(digits) <= 19:
            continue
        total = 0
        parity = len(digits) % 2
        for index, char in enumerate(digits):
            value = int(char)
            if index % 2 == parity:
                value *= 2
                if value > 9:
                    value -= 9
            total += value
        if total % 10 == 0:
            return True
    return False


def _reject_sensitive(body: dict) -> None:
    if not isinstance(body, dict):
        abort(400, "request body must be an object")
    lowered = {str(key).lower() for key in body}
    if lowered & FORBIDDEN_FIELDS:
        abort(400, "secrets and payment data must stay with the vault or provider")
    for key, value in body.items():
        key_name = str(key).lower()
        text = str(value or "")
        if key_name == "credential_ref":
            if text and not VAULT_REFERENCE.fullmatch(text):
                abort(400, "credential_ref must be an opaque vault reference")
            continue
        if SECRET_VALUE.search(text) or BEARER_VALUE.search(text) or PROVIDER_SECRET.search(text) or JWT_VALUE.search(text):
            abort(400, "secret values are not accepted; save only an opaque reference")
        if _contains_payment_data(text):
            abort(400, "card and bank details must stay with the billing provider")


def _clean_https_url(value: object, label: str, *, optional: bool = True) -> str:
    text = str(value or "").strip()[:500]
    if not text and optional:
        return ""
    parsed = urlparse(text)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        abort(400, f"{label} must be a secure https URL without credentials")
    return text


def _project(entity_id: str) -> dict | None:
    return next((item for item in _project_loader() if str(item.get("id")) == entity_id), None)


def _entity(kind: str, entity_id: str) -> dict:
    project = _project(entity_id) if kind == "project" else None
    name = str(project.get("name")) if project else entity_id.replace("-", " ").replace("_", " ").title()
    return {"kind": kind, "id": entity_id, "name": name, "project": project}


def _all_widgets(store: dict | None = None) -> list[dict]:
    custom = (store or _home_store()).get("custom_widgets", [])
    return [*BUILTIN_WIDGETS, *custom]


def _widget_by_id(widget_id: str, store: dict | None = None) -> dict | None:
    return next((item for item in _all_widgets(store) if item.get("id") == widget_id), None)


def _default_instances(kind: str) -> list[dict]:
    by_id = {item["id"]: item for item in BUILTIN_WIDGETS}
    return [
        {
            "instance_id": f"{widget_id}-1",
            "widget_id": widget_id,
            "size": by_id[widget_id]["default_size"],
            "config": {},
        }
        for widget_id in DEFAULT_WIDGET_IDS[kind]
    ]


def _clean_widget_config(config: object) -> dict:
    if config is None:
        return {}
    if not isinstance(config, dict):
        abort(400, "widget config must be an object")
    _reject_sensitive(config)
    allowed = {"connection_id", "label", "body", "url"}
    if set(config) - allowed:
        abort(400, "widget config contains unsupported fields")
    result: dict[str, str] = {}
    if config.get("connection_id"):
        result["connection_id"] = _clean_id(config["connection_id"], "connection id")
    if config.get("label"):
        result["label"] = _clean_text(config["label"], 80)
    if config.get("body"):
        result["body"] = _clean_text(config["body"], 800)
    if config.get("url"):
        result["url"] = _clean_https_url(config["url"], "widget link")
    return result


def _clean_instances(raw: object, kind: str, entity_id: str, store: dict) -> list[dict]:
    if not isinstance(raw, list):
        abort(400, "instances must be a list")
    if len(raw) > MAX_WIDGETS_PER_HOME:
        abort(400, f"a home supports at most {MAX_WIDGETS_PER_HOME} widgets")
    result = []
    seen_instances: set[str] = set()
    seen_widgets: set[str] = set()
    connection_records = {item.get("id"): item for item in _connection_store().get("connections", [])}
    for entry in raw:
        if not isinstance(entry, dict):
            abort(400, "invalid widget instance")
        instance_id = _clean_id(entry.get("instance_id"), "widget instance id")
        widget_id = _clean_id(entry.get("widget_id"), "widget id")
        if instance_id in seen_instances:
            abort(400, "duplicate widget instance id")
        manifest = _widget_by_id(widget_id, store)
        if not manifest or kind not in manifest.get("surfaces", []):
            abort(400, "widget is unavailable on this home")
        if not manifest.get("multiple") and widget_id in seen_widgets:
            abort(400, "this widget supports one instance per home")
        size = str(entry.get("size") or manifest.get("default_size"))
        if size not in WIDGET_SIZES or size not in manifest.get("allowed_sizes", []):
            abort(400, "widget size is not supported")
        config = _clean_widget_config(entry.get("config"))
        connection_id = config.get("connection_id")
        if connection_id and not manifest.get("accepts_connection"):
            abort(400, "this widget cannot bind a connection")
        if connection_id and connection_id not in connection_records:
            abort(400, "connection does not exist")
        if connection_id and not _scope_matches(connection_records[connection_id], kind, entity_id):
            abort(400, "connection is outside this home scope")
        result.append({"instance_id": instance_id, "widget_id": widget_id, "size": size, "config": config})
        seen_instances.add(instance_id)
        seen_widgets.add(widget_id)
    return result


def _home_payload(kind: str, entity_id: str, store: dict) -> dict:
    key = f"{kind}:{entity_id}"
    saved = store["homes"].get(key)
    return {
        "schema": "schema://frank.home/v1",
        "entity": _entity(kind, entity_id),
        "revision": int(saved.get("revision", 0)) if isinstance(saved, dict) else 0,
        "instances": saved.get("instances", _default_instances(kind)) if isinstance(saved, dict) else _default_instances(kind),
        "updated_at": saved.get("updated_at") if isinstance(saved, dict) else None,
        "max_widgets": MAX_WIDGETS_PER_HOME,
    }


def _scope_matches(connection: dict, kind: str, entity_id: str) -> bool:
    return connection.get("scope_kind") == "global" or (
        connection.get("scope_kind") == kind and connection.get("scope_id") == entity_id
    )


def _public_connection(item: dict) -> dict:
    return {key: value for key, value in item.items() if key in CONNECTION_PUBLIC_FIELDS}


def _snapshot(status: str, summary: str, data: dict | None = None, links: list[dict] | None = None) -> dict:
    return {
        "schema": "schema://frank.widget-snapshot/v1",
        "status": status,
        "summary": summary,
        "data": data or {},
        "links": links or [],
        "generated_at": _now(),
        "source_truth": "provider",
    }


def _instance_snapshot(kind: str, entity_id: str, instance: dict) -> dict:
    widget_id = instance["widget_id"]
    entity = _entity(kind, entity_id)
    config = instance.get("config", {})
    connections = [
        item for item in _connection_store().get("connections", [])
        if _scope_matches(item, kind, entity_id)
    ]
    bound = next((item for item in connections if item.get("id") == config.get("connection_id")), None)

    if widget_id == "entity-overview":
        project = entity.get("project") or {}
        return _snapshot("ready", f"{entity['name']} {kind}", {
            "kind": kind,
            "name": entity["name"],
            "description": str(project.get("blurb") or "No description recorded."),
        })
    if widget_id == "connections-summary":
        counts = {status: sum(1 for item in connections if item.get("status") == status) for status in sorted(CONNECTION_STATUSES)}
        problems = counts["setup_needed"] + counts["error"]
        state = "attention" if problems else ("ready" if connections else "empty")
        summary = f"{len(connections)} recorded connection{'s' if len(connections) != 1 else ''}"
        return _snapshot(state, summary, {
            "counts": counts,
            "connections": [
                {"id": item.get("id"), "name": item.get("name"), "provider": item.get("provider"), "status": item.get("status")}
                for item in connections[:4]
            ],
            "status_is_recorded": True,
        })
    if widget_id == "accounts-summary":
        accounts = [item for item in _account_loader() if kind != "project" or item.get("project_id") == entity_id]
        customers = sum(1 for item in accounts if item.get("kind") == "customer")
        attention = sum(1 for item in accounts if item.get("status") == "attention")
        return _snapshot("attention" if attention else ("ready" if accounts else "empty"), f"{len(accounts)} account records", {
            "customers": customers, "attention": attention, "status_is_recorded": True,
        })
    if widget_id == "hermes-status":
        health = _hermes_health() or {}
        ok = bool(health.get("ok"))
        return _snapshot("ready" if ok else "unavailable", "Hermes reachable" if ok else "Hermes unavailable", {
            "profile": health.get("profile"), "reason": health.get("reason", ""),
        })
    if widget_id == "repository-status":
        project = entity.get("project") or {}
        root_name = str(project.get("root") or entity_id)
        base = _roots.get("vps")
        target = (base / "projects" / root_name).resolve() if base else None
        allowed = (base / "projects").resolve() if base else None
        if not target or not allowed:
            return _snapshot("unavailable", "Repository mount is unavailable")
        try:
            target.relative_to(allowed)
        except ValueError:
            return _snapshot("error", "Repository path was rejected")
        if not target.is_dir():
            return _snapshot("empty", "Repository is not present on the VPS", {"root": root_name})
        branch = "unknown"
        try:
            head = (target / ".git" / "HEAD").read_text(encoding="utf-8").strip()
            branch = head.rsplit("/", 1)[-1] if head.startswith("ref:") else head[:12]
        except OSError:
            pass
        return _snapshot("ready", f"Repository present on {branch}", {"root": root_name, "branch": branch})
    if widget_id == "application-status":
        project = entity.get("project") or {}
        live = str(project.get("live") or "")
        links = [{"label": "Open application", "url": live}] if live.startswith("https://") else []
        if bound:
            return _snapshot("ready" if bound.get("status") == "verified" else "attention", f"Recorded connection: {bound.get('status')}", {
                "connection_id": bound.get("id"), "status_is_recorded": True,
            }, links)
        if live.startswith("https://"):
            return _snapshot("attention", "Live URL recorded; health is not connected", {"health_connected": False}, links)
        return _snapshot("empty", "No live application is recorded")
    if widget_id == "analytics-summary":
        analytics = bound or next((
            item for item in connections
            if "analytics.read" in item.get("capabilities", []) or "umami" in str(item.get("name", "")).lower()
        ), None)
        if not analytics:
            return _snapshot("empty", "Connect an analytics provider such as Umami", {"metrics": []})
        return _snapshot("attention", f"{analytics.get('name')} is registered; analytics adapter is not connected", {
            "connection_id": analytics.get("id"), "status": analytics.get("status"), "metrics": [], "status_is_recorded": True,
        })
    if widget_id == "work-status":
        return _snapshot("unavailable", "No Hermes work-event provider is connected", {"running": 0, "waiting": 0})
    if widget_id == "recent-receipts":
        return _snapshot("unavailable", "No receipt provider is connected", {"receipts": []})
    if widget_id == "quick-links":
        url = str(config.get("url") or "")
        links = [{"label": config.get("label") or "Open link", "url": url}] if url.startswith("https://") else []
        return _snapshot("ready" if links else "empty", config.get("body") or ("One shortcut" if links else "No link configured"), {}, links)
    if widget_id.startswith("custom-"):
        with _home_lock:
            manifest = _widget_by_id(widget_id, _home_store()) or {}
        definition = manifest.get("definition", {})
        url = str(config.get("url") or definition.get("url") or "")
        links = [{"label": config.get("label") or definition.get("label") or "Open link", "url": url}] if url.startswith("https://") else []
        body = config.get("body") or definition.get("body") or "No content configured."
        return _snapshot("ready", body, {}, links)
    return _snapshot("error", "Widget provider is not registered")


@api.get("/api/widgets")
def widgets_list():
    with _home_lock:
        return jsonify({"schema": "schema://frank.widget-catalog/v1", "widgets": _all_widgets(_home_store())})


@api.post("/api/widgets")
def widgets_create():
    body = request.get_json(silent=True) or {}
    _reject_sensitive(body)
    kind = str(body.get("kind") or "note").lower()
    if kind not in {"note", "link"}:
        abort(400, "custom widgets support note or link")
    title = _clean_plain_text(body.get("title"), 80, required=True)
    description = _clean_plain_text(body.get("description"), 180)
    definition = {
        "body": _clean_plain_text(body.get("body"), 800),
        "label": _clean_plain_text(body.get("label"), 80),
        "url": _clean_https_url(body.get("url"), "widget link") if body.get("url") else "",
    }
    if kind == "link" and not definition["url"]:
        abort(400, "a link widget needs a secure URL")
    surfaces = body.get("surfaces") or sorted(ENTITY_KINDS)
    if not isinstance(surfaces, list) or not surfaces or set(surfaces) - ENTITY_KINDS:
        abort(400, "invalid widget surfaces")
    now = _now()
    manifest = {
        "id": f"custom-{uuid.uuid4().hex[:12]}", "version": "1.0.0", "title": title,
        "description": description or f"Custom {kind} widget.", "surfaces": sorted(set(surfaces)),
        "default_size": "medium", "allowed_sizes": ["small", "medium", "wide"],
        "provider": "frank.custom", "freshness": "snapshot", "accepts_connection": False,
        "multiple": True, "custom": True, "kind": kind, "definition": definition,
        "created_at": now, "updated_at": now,
    }
    with _home_lock:
        store = _home_store()
        store["custom_widgets"].append(manifest)
        _write_json(HOME_STORE_FILE, store)
    return jsonify({"widget": manifest}), 201


@api.patch("/api/widgets/<widget_id>")
def widgets_update(widget_id: str):
    widget_id = _clean_id(widget_id, "widget id")
    body = request.get_json(silent=True) or {}
    _reject_sensitive(body)
    with _home_lock:
        store = _home_store()
        manifest = next((item for item in store["custom_widgets"] if item.get("id") == widget_id), None)
        if not manifest:
            abort(404, "custom widget not found")
        if "title" in body:
            manifest["title"] = _clean_plain_text(body.get("title"), 80, required=True)
        if "description" in body:
            manifest["description"] = _clean_plain_text(body.get("description"), 180)
        definition = manifest.setdefault("definition", {})
        for key, limit in (("body", 800), ("label", 80)):
            if key in body:
                definition[key] = _clean_plain_text(body.get(key), limit)
        if "url" in body:
            definition["url"] = _clean_https_url(body.get("url"), "widget link") if body.get("url") else ""
        manifest["version"] = f"1.0.{int(str(manifest.get('version', '1.0.0')).rsplit('.', 1)[-1]) + 1}"
        manifest["updated_at"] = _now()
        _write_json(HOME_STORE_FILE, store)
    return jsonify({"widget": manifest})


@api.delete("/api/widgets/<widget_id>")
def widgets_delete(widget_id: str):
    widget_id = _clean_id(widget_id, "widget id")
    with _home_lock:
        store = _home_store()
        if any(
            instance.get("widget_id") == widget_id
            for home in store["homes"].values() if isinstance(home, dict)
            for instance in home.get("instances", [])
        ):
            abort(409, "remove this widget from every home before deleting it")
        before = len(store["custom_widgets"])
        store["custom_widgets"] = [item for item in store["custom_widgets"] if item.get("id") != widget_id]
        if len(store["custom_widgets"]) == before:
            abort(404, "custom widget not found")
        _write_json(HOME_STORE_FILE, store)
    return jsonify({"removed": widget_id})


@api.get("/api/homes/<kind>/<entity_id>")
def homes_get(kind: str, entity_id: str):
    kind = _clean_id(kind, "entity kind")
    entity_id = _clean_id(entity_id, "entity id")
    if kind not in ENTITY_KINDS:
        abort(404, "unknown home kind")
    with _home_lock:
        return jsonify(_home_payload(kind, entity_id, _home_store()))


@api.put("/api/homes/<kind>/<entity_id>")
def homes_save(kind: str, entity_id: str):
    kind = _clean_id(kind, "entity kind")
    entity_id = _clean_id(entity_id, "entity id")
    if kind not in ENTITY_KINDS:
        abort(404, "unknown home kind")
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get("expected_revision"), int):
        abort(400, "expected_revision is required")
    with _home_lock:
        store = _home_store()
        current = _home_payload(kind, entity_id, store)
        if body["expected_revision"] != current["revision"]:
            return jsonify({"error": "layout changed", "current": current}), 409
        instances = _clean_instances(body.get("instances"), kind, entity_id, store)
        revision = current["revision"] + 1
        store["homes"][f"{kind}:{entity_id}"] = {
            "revision": revision, "instances": instances, "updated_at": _now(),
        }
        _write_json(HOME_STORE_FILE, store)
        return jsonify(_home_payload(kind, entity_id, store))


@api.post("/api/homes/<kind>/<entity_id>/reset")
def homes_reset(kind: str, entity_id: str):
    kind = _clean_id(kind, "entity kind")
    entity_id = _clean_id(entity_id, "entity id")
    if kind not in ENTITY_KINDS:
        abort(404, "unknown home kind")
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get("expected_revision"), int):
        abort(400, "expected_revision is required")
    with _home_lock:
        store = _home_store()
        current = _home_payload(kind, entity_id, store)
        if body["expected_revision"] != current["revision"]:
            return jsonify({"error": "layout changed", "current": current}), 409
        store["homes"][f"{kind}:{entity_id}"] = {
            "revision": current["revision"] + 1,
            "instances": _default_instances(kind),
            "updated_at": _now(),
        }
        _write_json(HOME_STORE_FILE, store)
        return jsonify(_home_payload(kind, entity_id, store))


@api.get("/api/homes/<kind>/<entity_id>/widgets/<instance_id>")
def home_widget_snapshot(kind: str, entity_id: str, instance_id: str):
    kind = _clean_id(kind, "entity kind")
    entity_id = _clean_id(entity_id, "entity id")
    instance_id = _clean_id(instance_id, "widget instance id")
    if kind not in ENTITY_KINDS:
        abort(404, "unknown home kind")
    with _home_lock:
        home = _home_payload(kind, entity_id, _home_store())
        instance = next((item for item in home["instances"] if item.get("instance_id") == instance_id), None)
    if not instance:
        abort(404, "widget instance not found")
    snapshot = _instance_snapshot(kind, entity_id, instance)
    snapshot.update({"entity_kind": kind, "entity_id": entity_id, "instance_id": instance_id, "widget_id": instance["widget_id"]})
    return jsonify(snapshot)


def _catalog() -> list[dict]:
    activepieces_url = os.environ.get("ACTIVEPIECES_CONNECTIONS_URL", "").strip()
    parsed_activepieces = urlparse(activepieces_url)
    safe_activepieces_url = activepieces_url if (
        parsed_activepieces.scheme == "https" and parsed_activepieces.netloc
        and not parsed_activepieces.username and not parsed_activepieces.password
    ) else ""
    result = []
    for item in CONNECTION_CATALOG:
        entry = dict(item)
        entry["setup_url"] = safe_activepieces_url if item["provider"] == "activepieces" else ""
        result.append(entry)
    return result


def _clean_connection(body: dict, existing: dict | None = None) -> dict:
    if not isinstance(body, dict):
        abort(400, "connection body must be an object")
    if set(body) - CONNECTION_FIELDS:
        abort(400, "connection contains unsupported fields")
    previous = {key: value for key, value in (existing or {}).items() if key in CONNECTION_FIELDS}
    candidate = {**previous, **body}
    _reject_sensitive(candidate)
    provider = str(candidate.get("provider", "api")).lower()
    status = str(candidate.get("status", "setup_needed")).lower()
    scope_kind = str(candidate.get("scope_kind", "global")).lower()
    if provider not in CONNECTION_PROVIDERS:
        abort(400, "invalid connection provider")
    if status not in CONNECTION_STATUSES:
        abort(400, "invalid connection status")
    if scope_kind not in CONNECTION_SCOPES:
        abort(400, "invalid connection scope")
    scope_id = "" if scope_kind == "global" else _clean_id(candidate.get("scope_id"), "scope id")
    name = _clean_text(candidate.get("name"), 120, required=True)
    connection_ref = _clean_text(candidate.get("connection_ref"), 300)
    credential_ref = _clean_text(candidate.get("credential_ref"), 300)
    if connection_ref and not OPAQUE_REFERENCE.fullmatch(connection_ref):
        abort(400, "connection_ref must be an opaque provider reference")
    if credential_ref and not VAULT_REFERENCE.fullmatch(credential_ref):
        abort(400, "credential_ref must be an opaque vault reference")
    raw_capabilities = candidate.get("capabilities", [])
    if not isinstance(raw_capabilities, list) or len(raw_capabilities) > 24:
        abort(400, "capabilities must be a short list")
    capabilities = sorted({_clean_id(value, "capability") for value in raw_capabilities})
    now = _now()
    item = {key: value for key, value in (existing or {}).items() if key in {"id", "created_at"}}
    item.update({
        "provider": provider, "name": name, "scope_kind": scope_kind, "scope_id": scope_id,
        "status": status, "connection_ref": connection_ref, "credential_ref": credential_ref,
        "admin_url": _clean_https_url(candidate.get("admin_url"), "admin link") if candidate.get("admin_url") else "",
        "capabilities": capabilities,
        "notes": _clean_text(candidate.get("notes"), 600),
        "last_verified_at": _clean_text(candidate.get("last_verified_at"), 40),
        "updated_at": now,
    })
    item.setdefault("id", uuid.uuid4().hex[:16])
    item.setdefault("created_at", now)
    return item


@api.get("/api/connections")
def connections_list():
    with _connections_lock:
        items = [_public_connection(item) for item in _connection_store()["connections"]]
    return jsonify({
        "schema": "schema://frank.connection-catalog/v1",
        "catalog": _catalog(), "connections": items,
        "notice": "Statuses are recorded metadata. Provider systems remain authoritative.",
    })


@api.post("/api/connections")
def connections_create():
    body = request.get_json(silent=True) or {}
    item = _clean_connection(body)
    with _connections_lock:
        store = _connection_store()
        if any(existing.get("name", "").casefold() == item["name"].casefold() and existing.get("scope_kind") == item["scope_kind"] and existing.get("scope_id") == item["scope_id"] for existing in store["connections"]):
            abort(409, "this connection already exists in the selected scope")
        store["connections"].append(item)
        _write_json(CONNECTIONS_FILE, store)
    return jsonify({"connection": _public_connection(item)}), 201


@api.patch("/api/connections/<connection_id>")
def connections_update(connection_id: str):
    connection_id = _clean_id(connection_id, "connection id")
    body = request.get_json(silent=True) or {}
    with _home_lock, _connections_lock:
        store = _connection_store()
        index = next((position for position, item in enumerate(store["connections"]) if item.get("id") == connection_id), None)
        if index is None:
            abort(404, "connection not found")
        previous = store["connections"][index]
        item = _clean_connection(body, previous)
        scope_changed = (
            item.get("scope_kind") != previous.get("scope_kind")
            or item.get("scope_id") != previous.get("scope_id")
        )
        if scope_changed and any(
            instance.get("config", {}).get("connection_id") == connection_id
            for home in _home_store()["homes"].values() if isinstance(home, dict)
            for instance in home.get("instances", [])
        ):
            abort(409, "cannot change connection scope while home widgets are bound; unbind it first")
        if any(
            position != index
            and existing.get("name", "").casefold() == item["name"].casefold()
            and existing.get("scope_kind") == item["scope_kind"]
            and existing.get("scope_id") == item["scope_id"]
            for position, existing in enumerate(store["connections"])
        ):
            abort(409, "this connection already exists in the selected scope")
        store["connections"][index] = item
        _write_json(CONNECTIONS_FILE, store)
    return jsonify({"connection": _public_connection(item)})


@api.delete("/api/connections/<connection_id>")
def connections_delete(connection_id: str):
    connection_id = _clean_id(connection_id, "connection id")
    with _home_lock, _connections_lock:
        homes = _home_store()["homes"].values()
        if any(
            instance.get("config", {}).get("connection_id") == connection_id
            for home in homes if isinstance(home, dict)
            for instance in home.get("instances", [])
        ):
            abort(409, "remove this connection from home widgets before deleting it")
        store = _connection_store()
        before = len(store["connections"])
        store["connections"] = [item for item in store["connections"] if item.get("id") != connection_id]
        if len(store["connections"]) == before:
            abort(404, "connection not found")
        _write_json(CONNECTIONS_FILE, store)
    return jsonify({"removed": connection_id})

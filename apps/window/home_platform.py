"""Reusable Frank home pages, widgets, and connection metadata.

Frank renders provider-owned state. It never stores provider secrets or executes
provider actions; Hermes and the connected provider remain authoritative.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from flask import Blueprint, abort, jsonify, request
from werkzeug.exceptions import HTTPException

import home_defaults
import home_providers
import connections_agent


api = Blueprint("home_platform", __name__)


@api.errorhandler(HTTPException)
def _api_error(error: HTTPException):
    response = jsonify({"error": error.description})
    response.status_code = error.code
    response.headers["Cache-Control"] = "no-store"
    return response


@api.errorhandler(connections_agent.ContractError)
def _connection_contract_error(error: connections_agent.ContractError):
    response = jsonify({"error": error.message, "code": error.code})
    response.status_code = error.status
    response.headers["Cache-Control"] = "no-store"
    return response

DATA_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
HOME_STORE_FILE = Path(os.environ.get("HOME_STORE_FILE", str(DATA_DIR / "home-layouts.json")))
CONNECTIONS_FILE = Path(os.environ.get("CONNECTIONS_STORE_FILE", str(DATA_DIR / "connections.json")))
CONNECTION_ACTIONS_FILE = Path(os.environ.get("CONNECTION_ACTIONS_FILE", str(DATA_DIR / "connection-actions.jsonl")))
CONNECTION_PLANS_FILE = Path(os.environ.get("CONNECTION_PLANS_FILE", str(DATA_DIR / "connection-plans.json")))

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
CONNECTION_PUBLIC_FIELDS = CONNECTION_FIELDS | {"id", "created_at", "updated_at", "revision"}
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
_hermes_sessions: Callable[[], dict] | None = None
_roots: dict[str, Path] = {}
_connection_service: connections_agent.ConnectionsMutationService | None = None
_connections_agent_key = os.environ.get("HERMES_CONNECTIONS_AGENT_KEY", "").strip()
_connections_agent_profile = os.environ.get("HERMES_CONNECTIONS_AGENT_PROFILE", "default").strip() or "default"
_connection_allowed_origins = {
    item.strip().rstrip("/") for item in os.environ.get(
        "FRANK_CONNECTION_ALLOWED_ORIGINS",
        "https://frank.fail,http://localhost,http://localhost:5000,http://127.0.0.1,http://127.0.0.1:5000,http://127.0.0.1:8080",
    ).split(",") if item.strip()
}
_connection_rate_lock = threading.RLock()
_connection_rate: dict[tuple[str, str], list[float]] = {}
CONNECTION_REQUEST_BYTES = 64 * 1024
CONNECTION_RATE_WINDOW = 60
CONNECTION_RATE_LIMIT = 120


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
        "id": "repository-activity", "version": "1.0.0", "title": "Repository activity",
        "description": "Recent read-only Git changes from the mounted project checkout.",
        "surfaces": ["project"], "default_size": "wide",
        "allowed_sizes": ["medium", "wide"], "provider": "frank.git",
        "freshness": "on_demand", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "project-files", "version": "1.0.0", "title": "Project files",
        "description": "A compact summary of the mounted project root.",
        "surfaces": ["project"], "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "frank.files",
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
        "id": "connection-attention", "version": "1.0.0", "title": "Connection attention",
        "description": "Setup, verification, and connection errors needing review.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "frank.connections",
        "freshness": "poll", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "provider-catalog", "version": "1.0.0", "title": "Provider catalog",
        "description": "Available provider capabilities and safe setup boundaries.",
        "surfaces": ["project", "tool", "agent", "service"], "default_size": "wide",
        "allowed_sizes": ["medium", "wide"], "provider": "frank.connections",
        "freshness": "on_demand", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "provider-coverage", "version": "1.0.0", "title": "Provider coverage",
        "description": "Recorded, verified, setup-needed, and error states by provider.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "medium",
        "allowed_sizes": ["small", "medium", "wide"], "provider": "frank.connections",
        "freshness": "poll", "accepts_connection": False, "multiple": False,
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
        "id": "hermes-session", "version": "1.0.0", "title": "Hermes sessions",
        "description": "Read-only session and work summaries from Hermes.",
        "surfaces": ["agent"], "entity_scope": {"kind": "agent", "id": "hermes"}, "default_size": "wide",
        "allowed_sizes": ["medium", "wide"], "provider": "hermes.sessions",
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
        "id": "widget-catalog", "version": "1.0.0", "title": "Widget catalog",
        "description": "Registered widgets and their compatible home surfaces.",
        "surfaces": ["tool"], "default_size": "wide",
        "allowed_sizes": ["medium", "wide"], "provider": "frank.widgets",
        "freshness": "on_demand", "accepts_connection": False, "multiple": False,
    },
    {
        "id": "quick-links", "version": "1.0.0", "title": "Links",
        "description": "Safe shortcuts configured for this home.",
        "surfaces": sorted(ENTITY_KINDS), "default_size": "small",
        "allowed_sizes": ["small", "medium"], "provider": "frank.links",
        "freshness": "snapshot", "accepts_connection": False, "multiple": True,
    },
]

DEFAULT_WIDGET_IDS = {kind: list(widget_ids) for kind, widget_ids in home_defaults.KIND_DEFAULT_WIDGET_IDS.items()}

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
    hermes_sessions: Callable[[], dict] | None = None,
    hermes_connections_agent_key: str | None = None,
    hermes_connections_agent_profile: str | None = None,
    connection_allowed_origins: list[str] | None = None,
) -> None:
    global _project_loader, _account_loader, _hermes_health, _hermes_sessions, _roots, _connection_service
    global _connections_agent_key, _connections_agent_profile, _connection_allowed_origins
    _project_loader = project_loader
    _account_loader = account_loader
    _hermes_health = hermes_health
    _hermes_sessions = hermes_sessions
    _roots = roots
    if hermes_connections_agent_key is not None:
        _connections_agent_key = str(hermes_connections_agent_key).strip()
    if hermes_connections_agent_profile is not None:
        _connections_agent_profile = str(hermes_connections_agent_profile).strip() or "default"
    if connection_allowed_origins is not None:
        _connection_allowed_origins = {str(item).strip().rstrip("/") for item in connection_allowed_origins if str(item).strip()}
    _connection_service = connections_agent.ConnectionsMutationService(
        load_store=_connection_store,
        save_store=_write_connection_store,
        clean_connection=_clean_connection,
        public_connection=_public_connection,
        normalize_plan=_normalize_connection_plan,
        delete_allowed=_connection_delete_allowed,
        scope_change_allowed=lambda connection_id: _connection_delete_allowed(connection_id),
        ledger_path=CONNECTION_ACTIONS_FILE,
        plans_path=CONNECTION_PLANS_FILE,
    )


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


def _write_connection_store(data: dict) -> None:
    _write_json(CONNECTIONS_FILE, data)


def _connection_delete_allowed(connection_id: str) -> bool:
    return not any(
        instance.get("config", {}).get("connection_id") == connection_id
        for home in _home_store().get("homes", {}).values() if isinstance(home, dict)
        for instance in home.get("instances", [])
    )


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
    profile = project or home_defaults.api_entity_profile(kind, entity_id)
    name = str(profile.get("name")) if profile else entity_id.replace("-", " ").replace("_", " ").title()
    return {
        "kind": kind,
        "id": entity_id,
        "name": name,
        "project": project,
        "profile": profile,
    }


def _all_widgets(store: dict | None = None) -> list[dict]:
    custom = (store or _home_store()).get("custom_widgets", [])
    return [*BUILTIN_WIDGETS, *custom]


def _widget_by_id(widget_id: str, store: dict | None = None) -> dict | None:
    return next((item for item in _all_widgets(store) if item.get("id") == widget_id), None)


def _widget_allowed_on_home(manifest: dict | None, kind: str, entity_id: str) -> bool:
    if not manifest or kind not in manifest.get("surfaces", []):
        return False
    scope = manifest.get("entity_scope")
    if not scope:
        return True
    return isinstance(scope, dict) and scope.get("kind") == kind and scope.get("id") == entity_id


def _default_instances(kind: str, entity_id: str, entity: dict | None = None, store: dict | None = None) -> list[dict]:
    entity = entity or _entity(kind, entity_id)
    requested = home_defaults.default_widget_ids(kind, entity_id, entity.get("profile"))
    by_id = {item["id"]: item for item in BUILTIN_WIDGETS}
    result = []
    for widget_id in requested:
        manifest = by_id.get(widget_id)
        if not _widget_allowed_on_home(manifest, kind, entity_id):
            continue
        result.append({
            "instance_id": f"{widget_id}-1",
            "widget_id": widget_id,
            "size": manifest["default_size"],
            "config": {},
        })
    return result


def _clean_widget_config(config: object) -> dict:
    if config is None:
        return {}
    if not isinstance(config, dict):
        abort(400, "widget config must be an object")
    allowed = {"connection_id", "label", "body", "url"}
    if set(config) - allowed:
        abort(400, "widget config contains unsupported fields")
    # connection_id is an internal opaque identifier and is validated against the
    # connection store below. Scanning it as free text can misclassify random hex
    # IDs as payment data; scan only the user-authored fields here.
    _reject_sensitive({key: value for key, value in config.items() if key != "connection_id"})
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
        if not _widget_allowed_on_home(manifest, kind, entity_id):
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
        if connection_id and not _connection_allowed_for_home(connection_records[connection_id], kind, entity_id):
            abort(400, "connection is outside this home scope")
        result.append({"instance_id": instance_id, "widget_id": widget_id, "size": size, "config": config})
        seen_instances.add(instance_id)
        seen_widgets.add(widget_id)
    return result


def _home_payload(kind: str, entity_id: str, store: dict) -> dict:
    key = f"{kind}:{entity_id}"
    saved = store["homes"].get(key)
    entity = _entity(kind, entity_id)
    defaults = _default_instances(kind, entity_id, entity, store)
    return {
        "schema": "schema://frank.home/v1",
        "entity": entity,
        "revision": int(saved.get("revision", 0)) if isinstance(saved, dict) else 0,
        "instances": saved.get("instances", defaults) if isinstance(saved, dict) else defaults,
        "updated_at": saved.get("updated_at") if isinstance(saved, dict) else None,
        "max_widgets": MAX_WIDGETS_PER_HOME,
    }


def _scope_matches(connection: dict, kind: str, entity_id: str) -> bool:
    return connection.get("scope_kind") == "global" or (
        connection.get("scope_kind") == kind and connection.get("scope_id") == entity_id
    )


def _connection_allowed_for_home(connection: dict, kind: str, entity_id: str) -> bool:
    """Central Connections can operate on all scopes; other homes are scoped."""
    return (kind == "tool" and entity_id == "connections") or _scope_matches(connection, kind, entity_id)


def _public_connection(item: dict) -> dict:
    return {key: value for key, value in item.items() if key in CONNECTION_PUBLIC_FIELDS}


def _instance_snapshot(kind: str, entity_id: str, instance: dict) -> dict:
    manifest = _widget_by_id(instance.get("widget_id"))
    if not _widget_allowed_on_home(manifest, kind, entity_id):
        return home_providers.snapshot(
            "unavailable", "This widget is not available on this home.",
            {"widget_id": instance.get("widget_id")}, now=_now(),
        )
    entity = _entity(kind, entity_id)
    config = instance.get("config", {})
    all_connections = _connection_store().get("connections", [])
    # Connections is the central control-plane home and must see every scope;
    # every other home receives only global plus its exact entity scope.
    connections = [item for item in all_connections if _connection_allowed_for_home(item, kind, entity_id)]
    bound = next((item for item in connections if item.get("id") == config.get("connection_id")), None)
    accounts = list(_account_loader() or [])
    catalog = _catalog()
    store = _home_store()
    allowed_health_urls = {
        str(profile.get("health"))
        for profile in (_project_loader() or [])
        if isinstance(profile, dict) and profile.get("health")
    }
    context = home_providers.ProviderContext(
        kind=kind,
        entity_id=entity_id,
        entity=entity,
        project=entity.get("profile") or {},
        connections=connections,
        bound_connection=bound,
        accounts=accounts,
        hermes_health=_hermes_health,
        hermes_sessions=_hermes_sessions,
        roots=_roots,
        catalog=catalog,
        widget_catalog=_all_widgets(store),
        now=_now(),
        probe_health=lambda profile: home_providers.probe_profile_health(profile, allowed_health_urls),
        extra={"config": config, "all_connections": all_connections},
    )
    return home_providers.render(instance["widget_id"], context)


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
            "instances": _default_instances(kind, entity_id, current["entity"], store),
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


def _normalize_connection_plan(action: str, target: dict, body: dict) -> tuple[dict, dict]:
    """Validate through the owning connection schema before plan persistence."""
    if not isinstance(body, dict):
        raise connections_agent.ContractError("request body must be an object")
    normalized_target = dict(target or {})
    if action in {"create", "update"}:
        connection_id = str(normalized_target.get("connection_id") or "")
        existing = None
        if action == "update":
            existing = next((item for item in _connection_store().get("connections", []) if item.get("id") == connection_id), None)
            if not existing:
                raise connections_agent.ContractError("connection not found", 404, "connection_not_found")
        try:
            cleaned = _clean_connection(body, existing)
        except HTTPException as error:
            raise connections_agent.ContractError("connection metadata rejected") from error
        fields = set(CONNECTION_FIELDS)
        normalized_body = {key: cleaned[key] for key in fields} if action == "create" else {key: cleaned[key] for key in body if key in fields}
        normalized_target["provider"] = normalized_target.get("provider") or cleaned.get("provider", "")
        normalized_target["connection_id"] = connection_id
        return normalized_target, normalized_body
    if body:
        raise connections_agent.ContractError("this action does not accept a mutation body")
    return normalized_target, {}


@api.get("/api/connections")
def connections_list():
    with _connections_lock:
        items = [_public_connection(item) for item in _connection_store()["connections"]]
    return jsonify({
        "schema": "schema://frank.connection-catalog/v1",
        "catalog": _catalog(), "connections": items,
        "notice": "Statuses are recorded metadata. Provider systems remain authoritative.",
    })


def _connection_command(body: dict | None = None) -> tuple[dict, int | None, str, str, str, str]:
    payload = dict(body or {})
    expected_revision = payload.pop("expected_revision", None)
    if expected_revision is not None and not isinstance(expected_revision, int):
        abort(400, "expected_revision must be an integer")
    idempotency_key = str(payload.pop("idempotency_key", request.headers.get("Idempotency-Key", "")) or "").strip()[:200]
    try:
        idempotency_key = connections_agent.ConnectionsMutationService.require_idempotency(idempotency_key)
    except connections_agent.ContractError as error:
        raise error
    actor = "manual.browser"
    correlation_id = str(request.headers.get("X-Correlation-Id", "") or "").strip()[:120]
    confirmation_token = str(
        payload.pop("confirmation_token", request.headers.get("X-Confirmation-Token", "")) or ""
    ).strip()
    return payload, expected_revision, idempotency_key, actor, confirmation_token, correlation_id


def _connection_target(body: dict, connection_id: str = "") -> dict:
    return {
        "provider": body.get("provider", ""),
        "connection_id": connection_id or body.get("connection_id", ""),
        "consumer": body.get("consumer", ""),
        "project": body.get("project", body.get("scope_id", "")),
        "environment": body.get("environment", ""),
    }


def _require_same_origin() -> None:
    """Reject browser writes unless Origin is in the explicit Frank allowlist."""
    if request.headers.get("Sec-Fetch-Site", "").strip().lower() == "cross-site":
        abort(403, "cross-origin connection mutation rejected")
    origin = request.headers.get("Origin", "").strip()
    if not origin or origin.lower() == "null":
        abort(403, "same-origin connection mutation required")
    parsed = urlparse(origin)
    candidate = origin.rstrip("/")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or candidate not in _connection_allowed_origins:
        abort(403, "cross-origin connection mutation rejected")


def _connection_request_guard(bucket: str) -> None:
    if request.content_length and request.content_length > CONNECTION_REQUEST_BYTES:
        abort(413, "connection request is too large")
    # Content-Length is absent for chunked requests and is not a sufficient
    # body-size authority. Cache the actual bytes before JSON parsing.
    request_bytes = request.get_data(cache=True, as_text=False)
    if len(request_bytes) > CONNECTION_REQUEST_BYTES:
        abort(413, "connection request is too large")
    key = (bucket, request.remote_addr or "unknown")
    now = time.monotonic()
    with _connection_rate_lock:
        recent = [stamp for stamp in _connection_rate.get(key, []) if stamp > now - CONNECTION_RATE_WINDOW]
        if len(recent) >= CONNECTION_RATE_LIMIT:
            abort(429, "connection mutation rate limit exceeded")
        recent.append(now)
        _connection_rate[key] = recent


def _require_hermes_agent_auth() -> None:
    """Authenticate the narrow Hermes ingress with a separate service key."""
    if not _connections_agent_key:
        abort(503, "Hermes Connections Agent ingress is not configured")
    authorization = request.headers.get("Authorization", "")
    presented = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if not presented or not secrets.compare_digest(presented, _connections_agent_key):
        abort(401, "Hermes Connections Agent authentication required")
    profile = request.headers.get("X-Hermes-Profile", "default").strip() or "default"
    if profile != _connections_agent_profile or profile != "default":
        abort(403, "Connections Agent must use the default Hermes profile")


def _connection_service_or_abort() -> connections_agent.ConnectionsMutationService:
    if _connection_service is None:
        abort(503, "connections service is unavailable")
    return _connection_service


def _connection_result(result: dict, status: int = 200):
    action = result.get("action") or {}
    payload = {"action": action, "replayed": bool(result.get("replayed"))}
    if result.get("connection") is not None:
        payload["connection"] = result["connection"]
    if action.get("result", {}).get("removed"):
        payload["removed"] = action["result"].get("connection_id")
    response = jsonify(payload)
    response.status_code = status
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def _connection_json(payload: dict, status: int = 200):
    response = jsonify(payload)
    response.status_code = status
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


@api.post("/api/connections/plan")
@api.post("/api/connections/agent/plan")
def connections_plan():
    _connection_request_guard("agent-plan" if request.path.startswith("/api/connections/agent/") else "manual-plan")
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        abort(400, "request body must be an object")
    is_agent = request.path.startswith("/api/connections/agent/")
    _require_hermes_agent_auth() if is_agent else _require_same_origin()
    raw_payload = body.get("body") if isinstance(body.get("body"), dict) else body
    command_payload = dict(raw_payload)
    for command_field in ("idempotency_key", "expected_revision", "confirmation_token"):
        if command_field not in command_payload and command_field in body:
            command_payload[command_field] = body[command_field]
    payload, expected_revision, idempotency_key, actor, _, _ = _connection_command(command_payload)
    action = str(body.get("action") or "").strip().lower()
    for field in ("action", "connection_id", "consumer", "project", "environment", "actor"):
        payload.pop(field, None)
    raw_target = body.get("target") if isinstance(body.get("target"), dict) else {}
    target_input = dict(raw_target)
    for field in ("provider", "connection_id", "consumer", "project", "environment"):
        if field in body:
            target_input[field] = body[field]
    target = _connection_target(target_input, str(body.get("connection_id") or raw_target.get("connection_id", "")))
    source = "connections-agent" if is_agent else "manual"
    if is_agent:
        actor = "hermes.connections-agent"
    try:
        result = _connection_service_or_abort().plan(
            action=action, source=source, actor=actor, target=target, body=payload,
            expected_revision=body.get("expected_revision", expected_revision), idempotency_key=idempotency_key,
        )
    except connections_agent.ContractError as error:
        raise error
    return _connection_json(result)


@api.post("/api/connections/agent/apply")
def connections_agent_apply():
    _connection_request_guard("agent-apply")
    _require_hermes_agent_auth()
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or not body.get("plan_id"):
        abort(400, "plan_id is required")
    if set(body) - {"plan_id", "confirmation_token", "idempotency_key", "provider_receipt", "provider_outcome", "provider_error_code", "provider_error_category"}:
        abort(400, "unsupported apply fields")
    confirmation = str(body.get("confirmation_token") or request.headers.get("X-Confirmation-Token", ""))
    idempotency_key = str(body.get("idempotency_key") or request.headers.get("Idempotency-Key", ""))
    try:
        idempotency_key = connections_agent.ConnectionsMutationService.require_idempotency(idempotency_key)
        result = _connection_service_or_abort().apply_plan(
            plan_id=str(body["plan_id"]), confirmation_token=confirmation, idempotency_key=idempotency_key,
            expected_source="connections-agent", authenticated_provider=True, executor_actor="hermes.connections-agent",
            provider_receipt=str(body.get("provider_receipt") or ""), provider_outcome=str(body.get("provider_outcome") or ""),
            provider_error_code=str(body.get("provider_error_code") or ""), provider_error_category=str(body.get("provider_error_category") or ""),
        )
    except connections_agent.ContractError as error:
        raise error
    return _connection_result(result, 202 if result.get("pending") else 200)


@api.post("/api/connections/apply")
def connections_manual_apply():
    _connection_request_guard("manual-apply")
    _require_same_origin()
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or not body.get("plan_id"):
        abort(400, "plan_id is required")
    if set(body) - {"plan_id", "confirmation_token", "idempotency_key"}:
        abort(400, "unsupported apply fields")
    try:
        key = connections_agent.ConnectionsMutationService.require_idempotency(
            str(body.get("idempotency_key") or request.headers.get("Idempotency-Key", ""))
        )
        result = _connection_service_or_abort().apply_plan(
            plan_id=str(body["plan_id"]), confirmation_token=str(body.get("confirmation_token") or ""),
            idempotency_key=key, expected_source="manual",
        )
    except connections_agent.ContractError as error:
        raise error
    return _connection_result(result, 202 if result.get("pending") else 200)


@api.get("/api/connections/attention")
def connections_attention():
    limit = request.args.get("limit", default=50, type=int)
    return jsonify({"schema": "schema://frank.connections-attention/v1", "items": _connection_service_or_abort().attention(limit=limit)})


@api.get("/api/connections/activity")
@api.get("/api/connections/events")
def connections_activity():
    after = request.args.get("after", default=0, type=int)
    limit = request.args.get("limit", default=50, type=int)
    latest = request.args.get("latest", "0").strip().lower() in {"1", "true"}
    items = _connection_service_or_abort().activity(after=after, limit=limit, latest=latest)
    return jsonify({"schema": "schema://frank.connections-activity/v1", "after": after, "latest": latest, "items": items})


@api.get("/api/connections/receipts/<receipt_id>")
def connections_receipt(receipt_id: str):
    receipt = _connection_service_or_abort().receipt(receipt_id)
    if not receipt:
        abort(404, "receipt not found")
    return jsonify({"schema": "schema://frank.connections-receipt/v1", "receipt": receipt})


@api.after_request
def _connections_no_store(response):
    """Keep additive connection plans, activity, attention, and receipts private."""
    if request.path.startswith("/api/connections/") and request.path != "/api/connections":
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response


@api.post("/api/connections")
def connections_create():
    _connection_request_guard("manual-create")
    _require_same_origin()
    body = request.get_json(silent=True) or {}
    payload, expected_revision, idempotency_key, actor, _, _ = _connection_command(body)
    if expected_revision is not None:
        abort(400, "expected_revision is not valid for connection creation")
    try:
        result = _connection_service_or_abort().execute(
            action="create", source="manual", actor=actor, target=_connection_target(payload), body=payload,
            expected_revision=expected_revision, idempotency_key=idempotency_key,
        )
    except connections_agent.ContractError as error:
        raise error
    return _connection_result(result, 200 if result.get("replayed") else 201)


@api.patch("/api/connections/<connection_id>")
def connections_update(connection_id: str):
    _connection_request_guard("manual-update")
    _require_same_origin()
    connection_id = _clean_id(connection_id, "connection id")
    body = request.get_json(silent=True) or {}
    payload, expected_revision, idempotency_key, actor, _, _ = _connection_command(body)
    try:
        result = _connection_service_or_abort().execute(
            action="update", source="manual", actor=actor, target=_connection_target(payload, connection_id),
            body=payload, expected_revision=expected_revision, idempotency_key=idempotency_key,
        )
    except connections_agent.ContractError as error:
        raise error
    return _connection_result(result)


@api.delete("/api/connections/<connection_id>")
def connections_delete(connection_id: str):
    _connection_request_guard("manual-delete")
    _require_same_origin()
    connection_id = _clean_id(connection_id, "connection id")
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or not body.get("plan_id"):
        abort(409, "use POST /api/connections/plan then POST /api/connections/apply for confirmed deletion")
    if set(body) - {"plan_id", "confirmation_token", "idempotency_key"}:
        abort(400, "unsupported delete fields")
    try:
        key = connections_agent.ConnectionsMutationService.require_idempotency(
            str(body.get("idempotency_key") or request.headers.get("Idempotency-Key", ""))
        )
        result = _connection_service_or_abort().apply_plan(
            plan_id=str(body["plan_id"]), confirmation_token=str(body.get("confirmation_token") or ""),
            idempotency_key=key, expected_source="manual", expected_connection_id=connection_id,
        )
    except connections_agent.ContractError as error:
        raise error
    return _connection_result(result)

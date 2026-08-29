"""Frank Window API — display only. Hermes is the brain."""
from __future__ import annotations

import json
import base64
import hashlib
import math
import mimetypes
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
from types import MappingProxyType
from copy import deepcopy
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from flask import Flask, Response, abort, jsonify, redirect, request, send_file, send_from_directory, stream_with_context

import home_platform
import home_defaults
import mini_frank
from memory_inspector import HindsightClient, MemoryInspector, create_blueprint as create_memory_blueprint
from project_store import ProjectStore, ProjectStoreError
import vault_broker
from graph.provider import (
    ReadOnlyProvider,
    ProviderUnavailable,
    create_blueprint as create_graph_blueprint,
    manifest_reader,
)
from tool_apps import discover_tool_apps

WEB = Path(os.environ.get("FRANK_WEB", "/web")).resolve()
FRANK_PUBLIC_ASSETS = {
    "style.css": "mini.css",
    "app.js": "mini.js",
    "stream.mjs": "mini_stream.mjs",
    "api.mjs": "mini_api.mjs",
    "site-preview.html": "site-preview.html",
    "site-preview.css": "site-preview.css",
    "site-preview.js": "site-preview.js",
    "assets/demo-business-hero.png": "assets/demo-business-hero.png",
}
LEGACY_MINI_ASSETS = {
    "mini.css": "style.css",
    "mini.js": "app.js",
    "mini_stream.mjs": "stream.mjs",
    "mini_api.mjs": "api.mjs",
}
CHAT_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
UPLOAD_DIR = CHAT_DIR / "uploads"
ACCOUNTS_FILE = Path(os.environ.get("ACCOUNTS_STORE_FILE", str(CHAT_DIR / "accounts.json")))
PROJECTS_FILE = Path(os.environ.get("PROJECTS_STORE_FILE", str(CHAT_DIR / "projects.json")))
DATA_DIR = CHAT_DIR


def _mini_data_root() -> Path:
    """Keep import-time Mini storage writable in local Windows test runs."""
    if os.name != "nt" or "CHAT_STORE_DIR" in os.environ:
        return DATA_DIR
    return Path(tempfile.gettempdir()) / f"frank-window-{os.getpid()}"


def _mini_preview_root() -> Path:
    configured = os.environ.get("MINI_PREVIEW_ROOT")
    if configured:
        return Path(configured)
    if os.name == "nt" and "CHAT_STORE_DIR" not in os.environ:
        return _mini_data_root() / "previews"
    return Path("/previews/mini")


def _mini_legacy_root() -> Path | None:
    configured = os.environ.get("MINI_LEGACY_PROJECT_ROOT")
    if configured:
        return Path(configured)
    if os.name == "nt" and "CHAT_STORE_DIR" not in os.environ:
        return None
    return Path("/legacy-mini-projects")
HERMES_UPLOAD_ROOT = Path(os.environ.get("HERMES_SHARED_UPLOAD_ROOT", "/frank/window/data/uploads"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(250 * 1024 * 1024)))
MAX_INLINE_IMAGE_BYTES = int(os.environ.get("MAX_INLINE_IMAGE_BYTES", str(6 * 1024 * 1024)))
HERMES_URL = os.environ.get("HERMES_API_URL", "http://172.16.1.1:8642").rstrip("/")
HERMES_KEY = os.environ.get("HERMES_API_KEY", "")
HERMES_PROFILE = os.environ.get("HERMES_PROFILE", "default")
HINDSIGHT_URL = os.environ.get("HINDSIGHT_API_URL", "http://172.16.1.1:9178").rstrip("/")
ROOTS = {
    # The container receives only the explicitly approved read-only VPS mounts
    # beneath /vps. This presents one familiar tree without exposing the
    # container filesystem, chat data, credentials, or Hermes state.
    "vps": Path(os.environ.get("VPS_ROOT", "/vps")),
}
SKIP = {".git", "node_modules", ".next", "__pycache__", ".turbo", "dist"}
CURATED_MODELS = [
    {"id": "qwen3.8-max", "provider": "custom", "note": "default"},
    {"id": "deepseek-v4-flash", "provider": "deepseek", "note": "fast · cheap"},
    {"id": "deepseek-v4-pro", "provider": "deepseek", "note": "stronger"},
    {"id": "grok-4.6", "provider": "xai", "note": "escalate"},
    {"id": "gpt-5.6-sol", "provider": "custom", "note": "escalate"},
    {"id": "claude-fable-5", "provider": "custom", "note": "escalate"},
]

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
_accounts_lock = threading.RLock()

_authorized_tool_manifests = MappingProxyType({
    item["id"]: deepcopy(item)
    for item in discover_tool_apps(Path(__file__).resolve().parent / "tools")
})
_graph_provider = ReadOnlyProvider(graph_reader=manifest_reader(_authorized_tool_manifests))


def _graph_projection(**kwargs):
    try:
        return _graph_provider.graph(**kwargs)
    except ProviderUnavailable:
        return None


def _graph_available(kind: str, entity_id: str) -> bool:
    manifest = _authorized_tool_manifests.get(entity_id) if kind == "tool" else None
    return isinstance(manifest, dict) and "global" in manifest.get("scopes", [])

ACCOUNT_KINDS = {"customer", "email", "service", "domain"}
ACCOUNT_STATUSES = {"planned", "setup", "ready", "attention", "disabled"}
ACCOUNT_MODES = {"selfserve", "managed", "internal"}
ACCOUNT_ENVIRONMENTS = {"test", "live"}
AUTH_STATUSES = {"not_connected", "invited", "active", "suspended", "closed"}
BILLING_STATUSES = {"not_connected", "trial", "active", "past_due", "canceled"}
AD_STUDIO_RUN_ID = re.compile(r"trun_[0-9a-f]{32}")
AD_STUDIO_PLACEMENTS = {"square", "portrait", "story"}
AD_STUDIO_IMAGE_EXTENSIONS = {
    ".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg",
    ".png", ".tif", ".tiff", ".webp",
}
ACCOUNT_FIELDS = {
    "project_id", "kind", "name", "identity", "provider", "purpose",
    "admin_url", "credential_ref", "notes", "status", "account_mode",
    "environment", "auth_status", "auth_provider", "auth_user_ref",
    "billing_status", "billing_provider", "billing_customer_ref",
    "billing_subscription_ref", "plan_name",
}
FORBIDDEN_ACCOUNT_FIELDS = {
    "password", "secret", "token", "api_key", "apikey", "private_key",
    "access_key", "refresh_token", "card_number", "cvc", "cvv", "expiry",
    "bank_account", "iban", "payment_details", "card_details",
}
VAULT_REFERENCE = re.compile(
    r"^(?:vault|openbao|bitwarden|1password|pass|keyring|secret)://[A-Za-z0-9][A-Za-z0-9._/-]*$",
    re.I,
)
SECRET_VALUE_PATTERNS = (
    re.compile(r"\b(?:password|passphrase|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+", re.I),
    re.compile(r"\b(?:sk|re|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,}\b", re.I),
    re.compile(r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b"),
)
CONNECTOR_STATUSES = {"unconfigured", "configured", "ready", "error"}
EXTERNAL_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$")
DEFAULT_PROJECTS = [
    {
        "id": "blockwise", "name": "Blockwise", "root": "blockwise",
        "blurb": "Meta ads workflow for real-estate teams.",
        "live": "https://blockwise.sale", "health": "https://blockwise.sale/api/health",
        "capabilities": ["application.health", "repository.activity", "repository.summary", "project.files", "accounts.directory", "connections.read", "analytics.setup"],
        "default_widgets": list(home_defaults.PROJECT_DEFAULT_WIDGET_IDS),
    },
    {
        "id": "merrypaws", "name": "Merrypaws", "root": "merrypaws",
        "blurb": "Merrypaws project workspace and storefront operations.",
        "capabilities": ["repository.activity", "repository.summary", "project.files", "accounts.directory", "connections.read", "analytics.setup"],
        "default_widgets": list(home_defaults.PROJECT_DEFAULT_WIDGET_IDS),
    },
    {
        "id": "elfwonder", "name": "Elf & Wonder", "root": "elfandwonder",
        "blurb": "Elf & Wonder project workspace.",
        "capabilities": ["repository.activity", "repository.summary", "project.files", "connections.read", "analytics.setup"],
        "default_widgets": list(home_defaults.PROJECT_DEFAULT_WIDGET_IDS),
    },
    {
        "id": "pavone", "name": "Pavone", "root": "pavone-demo",
        "blurb": "Pavone automotive project workspace.",
        "live": "https://pavoneauto.com", "health": "https://pavoneauto.com/api/health",
        "capabilities": ["application.health", "repository.activity", "repository.summary", "project.files", "accounts.directory", "connections.read", "analytics.setup"],
        "default_widgets": list(home_defaults.PROJECT_DEFAULT_WIDGET_IDS),
    },
    {
        "id": "mini-frank", "name": "Frank", "root": "mini-frank",
        "blurb": "Frank project workspace.",
        "capabilities": ["repository.activity", "repository.summary", "project.files", "accounts.directory", "connections.read", "analytics.setup"],
        "default_widgets": list(home_defaults.PROJECT_DEFAULT_WIDGET_IDS),
    },
]
PROJECT_ID = re.compile(r"^(?=.{1,48}$)[a-z0-9]+(?:-[a-z0-9]+)*$")
PROJECT_STATES = {"starting", "ready", "attention"}
PROJECT_DEFAULT_CAPABILITIES = [
    "repository.activity", "repository.summary", "project.files",
    "accounts.directory", "connections.read", "analytics.setup",
]
_project_store = ProjectStore(PROJECTS_FILE, DEFAULT_PROJECTS)


def _contains_payment_data(text: str) -> bool:
    iban = re.compile(r"\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b", re.I)
    if iban.search(text):
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


def jail(root_key: str, rel: str = "") -> Path:
    base = ROOTS.get(root_key)
    if base is None:
        abort(404, "unknown root")
    target = (base / rel).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        abort(400, "path escapes root")
    return target


def _write_accounts(data: dict) -> None:
    ACCOUNTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = ACCOUNTS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(ACCOUNTS_FILE)


def _ensure_accounts() -> dict:
    with _accounts_lock:
        if ACCOUNTS_FILE.exists():
            try:
                data = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
                if data.get("version") == 1 and isinstance(data.get("accounts"), list):
                    return data
            except (OSError, json.JSONDecodeError, AttributeError):
                pass
        data = {"version": 1, "accounts": []}
        _write_accounts(data)
        return data


def _clean_account(body: dict, existing: dict | None = None) -> dict:
    lowered = {str(key).lower() for key in body}
    blocked = lowered & FORBIDDEN_ACCOUNT_FIELDS
    if blocked:
        abort(400, "credentials must be stored in the vault; save only credential_ref")

    for key, value in body.items():
        if str(key).lower() == "credential_ref":
            continue
        text = str(value or "")
        if any(pattern.search(text) for pattern in SECRET_VALUE_PATTERNS):
            abort(400, "credentials must be stored in the vault; remove the secret value")
        if _contains_payment_data(text):
            abort(400, "card and bank details must stay with the billing provider")

    item = dict(existing or {})
    for field in ACCOUNT_FIELDS:
        if field in body:
            item[field] = re.sub(r"\s+", " ", str(body.get(field, ""))).strip()

    item["project_id"] = item.get("project_id", "main")[:80] or "main"
    item["kind"] = item.get("kind", "service").lower()
    item["name"] = item.get("name", "")[:120]
    item["identity"] = item.get("identity", "")[:240]
    item["provider"] = item.get("provider", "")[:120]
    item["purpose"] = item.get("purpose", "")[:160]
    item["admin_url"] = item.get("admin_url", "")[:500]
    item["credential_ref"] = item.get("credential_ref", "")[:300]
    item["notes"] = item.get("notes", "")[:800]
    item["status"] = item.get("status", "planned").lower()
    item["account_mode"] = item.get("account_mode", "selfserve").lower()
    item["environment"] = item.get("environment", "test").lower()
    item["auth_status"] = item.get("auth_status", "not_connected").lower()
    item["auth_provider"] = item.get("auth_provider", "")[:120]
    item["auth_user_ref"] = item.get("auth_user_ref", "")[:240]
    item["billing_status"] = item.get("billing_status", "not_connected").lower()
    item["billing_provider"] = item.get("billing_provider", "")[:120]
    item["billing_customer_ref"] = item.get("billing_customer_ref", "")[:240]
    item["billing_subscription_ref"] = item.get("billing_subscription_ref", "")[:240]
    item["plan_name"] = item.get("plan_name", "")[:120]

    if item["kind"] not in ACCOUNT_KINDS:
        abort(400, "invalid account kind")
    if item["status"] not in ACCOUNT_STATUSES:
        abort(400, "invalid account status")
    if item["account_mode"] not in ACCOUNT_MODES:
        abort(400, "invalid account mode")
    if item["environment"] not in ACCOUNT_ENVIRONMENTS:
        abort(400, "invalid account environment")
    if item["auth_status"] not in AUTH_STATUSES:
        abort(400, "invalid auth status")
    if item["billing_status"] not in BILLING_STATUSES:
        abort(400, "invalid billing status")
    if not item["name"] or not item["identity"]:
        abort(400, "name and identity are required")
    if item["kind"] in {"customer", "email"} and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", item["identity"]):
        abort(400, "email identity must be a valid email address")
    if item["admin_url"] and not re.match(r"^https?://", item["admin_url"], re.I):
        abort(400, "admin_url must use http or https")
    if item["credential_ref"] and not VAULT_REFERENCE.fullmatch(item["credential_ref"]):
        abort(400, "credential_ref must be an opaque vault locator such as openbao://frank/email/main")
    for field in ("auth_user_ref", "billing_customer_ref", "billing_subscription_ref"):
        if item[field] and not EXTERNAL_REFERENCE.fullmatch(item[field]):
            abort(400, f"{field} must be an opaque provider reference")
    return item


def _connector_status(variable: str, fallback: str = "unconfigured") -> str:
    status = os.environ.get(variable, "").strip().lower() or fallback
    return status if status in CONNECTOR_STATUSES else "unconfigured"


def hermes_base() -> str:
    url = HERMES_URL
    if url.endswith("/v1"):
        url = url[:-3]
    profile = HERMES_PROFILE.strip() or "default"
    if profile in ("default", "hermes-agent"):
        return url
    return f"{url}/p/{profile}"


def hermes_request(
    path: str,
    payload: dict | None = None,
    *,
    method: str | None = None,
    timeout: float = 30,
):
    url = hermes_base() + path
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if HERMES_KEY:
        headers["Authorization"] = f"Bearer {HERMES_KEY}"
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method=method or ("GET" if data is None else "POST"),
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        return json.loads(body.decode("utf-8") or "{}")


def _hermes_error(err: Exception):
    if isinstance(err, urllib.error.HTTPError):
        detail = err.read().decode("utf-8", errors="replace")[:1200]
        message = f"Hermes returned HTTP {err.code}."
        try:
            parsed = json.loads(detail)
            message = parsed.get("error", {}).get("message") or parsed.get("message") or message
        except (json.JSONDecodeError, AttributeError):
            pass
        return jsonify({"error": message}), err.code if 400 <= err.code < 600 else 502
    return jsonify({"error": f"Could not reach Hermes: {str(err).split(chr(10))[0][:180]}"}), 502


def _session_path(session_id: str, suffix: str = "") -> str:
    safe_id = urllib.parse.quote(str(session_id), safe="")
    return f"/api/sessions/{safe_id}{suffix}"


def _public_hermes_session(session: dict, *, project_id: str = "") -> dict:
    preview = re.sub(r"\s+", " ", str(session.get("preview") or "")).strip()
    title = re.sub(r"\s+", " ", str(session.get("title") or "")).strip()
    if not title:
        title = (preview[:52] + ("…" if len(preview) > 52 else "")) or "New chat"
    result = {
        "id": str(session.get("id") or ""),
        "title": title,
        "created_at": session.get("started_at") or 0,
        "updated_at": session.get("last_active") or session.get("ended_at") or session.get("started_at") or 0,
        "message_count": int(session.get("message_count") or 0),
        "preview": preview[:100],
        "model": str(session.get("model") or ""),
        "source": str(session.get("source") or ""),
    }
    if project_id:
        result["project_id"] = project_id
    return result


def _public_hermes_session_list(payload: dict, bindings: dict[str, str] | None = None) -> list[dict] | None:
    """Parse the production Hermes session-list shape used by chat and homes."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return None
    return [
        _public_hermes_session(item, project_id=(bindings or {}).get(str(item.get("id") or ""), ""))
        for item in payload["data"]
        if isinstance(item, dict) and item.get("id")
    ]


def _message_text(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content or "")
    parts = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            if item.get("type") in ("text", "input_text", "output_text") and item.get("text"):
                parts.append(str(item["text"]))
            elif item.get("type") in ("image_url", "input_image"):
                parts.append("[Image]")
    return "\n".join(parts)


def _public_hermes_messages(items: list) -> list:
    messages = []
    for item in items:
        role = str(item.get("role") or "")
        if role not in ("user", "assistant"):
            continue
        text = _message_text(item.get("content")).strip()
        tool_calls = item.get("tool_calls") or []
        tools = []
        if isinstance(tool_calls, list):
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                function = call.get("function") if isinstance(call.get("function"), dict) else {}
                name = function.get("name") or call.get("name")
                if name:
                    tools.append(str(name))
        if not text and not tools:
            continue
        messages.append({
            "role": role,
            "text": text,
            "tools": tools,
            "attachments": [],
            "ts": item.get("timestamp") or 0,
        })
    return messages


def hermes_reachable() -> dict:
    if not HERMES_KEY:
        return {"ok": False, "reason": "HERMES_API_KEY is not set"}
    try:
        with urllib.request.urlopen(
            urllib.request.Request(
                f"{HERMES_URL.rstrip('/')}/v1/health",
                headers={"Authorization": f"Bearer {HERMES_KEY}"},
            ),
            timeout=3,
        ):
            pass
        return {"ok": True}
    except urllib.error.HTTPError as err:
        if err.code in (200, 401, 403):
            return {"ok": True, "auth": err.code}
        return {"ok": False, "reason": f"HTTP {err.code}"}
    except Exception as err:
        return {"ok": False, "reason": str(err).split("\n")[0][:180]}


def hermes_session_summaries() -> dict:
    """Read-only home data from the existing Hermes sessions API.

    This callback is intentionally separate from the chat routes. It returns
    the same public, redacted session shape used by the existing session list
    endpoint and never exposes messages, credentials, or Hermes state files.
    """
    if not HERMES_KEY:
        return {"ok": False, "reason": "HERMES_API_KEY is not set", "sessions": []}
    try:
        payload = hermes_request("/api/sessions?limit=20&include_children=true", timeout=3)
        sessions = _public_hermes_session_list(payload)
        if sessions is None:
            return {"ok": False, "reason": "Hermes returned an invalid session summary", "sessions": []}
        return {
            "ok": True,
            "profile": HERMES_PROFILE.strip() or "default",
            "sessions": sessions[:20],
        }
    except Exception as err:
        return {"ok": False, "reason": str(err).split("\n", 1)[0][:180], "sessions": []}


@app.get("/api/health")
def health():
    brain = hermes_reachable()
    return jsonify({"ok": True, "service": "frank-window", "hermes": brain})


@app.errorhandler(ProjectStoreError)
def project_store_error(error: ProjectStoreError):
    return jsonify({"error": str(error)}), 503


@app.get("/api/projects")
def projects():
    try:
        return jsonify({"schema": "schema://frank.projects/v1", "projects": _project_items()})
    except ProjectStoreError as error:
        abort(503, str(error))


def _project_workspace(project: dict) -> str:
    return f"/projects/{project['root']}"


def _project_setup_state(project: dict) -> str:
    root = ROOTS.get("vps")
    if not root:
        return "attention"
    try:
        return "ready" if (root / "projects" / str(project["root"])).is_dir() else "starting"
    except OSError:
        return "attention"


def _project_public(project: dict) -> dict:
    item = deepcopy(project)
    item["capabilities"] = list(item.get("capabilities", []))
    item["default_widgets"] = list(item.get("default_widgets", []))
    item["workspace"] = _project_workspace(item)
    item["hermes_profile"] = HERMES_PROFILE.strip() or "default"
    item["memory_scope"] = f"workspace/{item['root']}"
    item["setup_state"] = _project_setup_state(item)
    return item


def _project_items() -> list[dict]:
    return [_project_public(item) for item in _project_store.list_projects()]


def _clean_project_id(raw: object, name: str = "") -> str:
    value = str(raw or "").strip().lower()
    if not value:
        value = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48]
    if not PROJECT_ID.fullmatch(value):
        abort(400, "project id must use lowercase letters, numbers, and single hyphens")
    return value


def _clean_project_text(raw: object, limit: int, *, required: bool = False) -> str:
    value = re.sub(r"\s+", " ", str(raw or "")).strip()[:limit]
    if required and not value:
        abort(400, "project name is required")
    if any(ord(char) < 32 for char in value):
        abort(400, "project text contains unsupported characters")
    return value


def _clean_project_url(raw: object, label: str) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        abort(400, f"{label} is invalid")
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        abort(400, f"{label} must be an https URL without embedded credentials")
    if parsed.query or parsed.fragment:
        abort(400, f"{label} must not contain a query or fragment")
    return urllib.parse.urlunsplit(parsed)[:500]


def _project_context(
    project: dict, *, canonical_workspace: str = "", memory_scope: str = ""
) -> str:
    workspace = canonical_workspace or _project_workspace(project)
    memory_workspace = memory_scope or str(project["root"])
    return (
        "You are Hermes, the sole brain for a project displayed through Frank.\n"
        f"Frank project id: {project['id']}\n"
        f"Project name: {project['name']}\n"
        f"Canonical workspace: {workspace}\n"
        f"Memory workspace: {memory_workspace}\n\n"
        "Keep all project file operations inside the canonical workspace. Read and follow "
        "the workspace AGENTS.md and other repository instructions before changing files. "
        "Use the existing Hermes default profile; never create another Hermes profile, Frank "
        "runtime, memory store, or agent loop. Durable memory must remain scoped to this exact "
        "workspace. Project files and explicit user corrections override recalled memory."
    )


def _project_bootstrap_prompt(project: dict) -> str:
    repository = str(project.get("repository_url") or "")
    setup = (
        f"If {_project_workspace(project)} is not already a Git repository, clone {repository} "
        "into that existing workspace (clone into `.` when it is empty), then inspect its "
        "instructions. Do not place credentials in the clone URL."
        if repository else
        f"Create {_project_workspace(project)} if it does not exist, initialize a Git repository "
        "on main, and add a concise README.md and AGENTS.md that preserve the Frank/Hermes boundary."
    )
    return (
        f"Start the {project['name']} project. {setup}\n\n"
        f"Project brief: {project.get('blurb') or 'No brief supplied yet.'}\n\n"
        "First report what already exists, then create the smallest useful project foundation and "
        "a milestone plan. Keep working in this project workspace and record durable project "
        "decisions only in its scoped memory."
    )


def _create_project_session(
    project: dict,
    *,
    session_id_override: str = "",
    title: str = "New chat",
    model: str = "",
    provider: str = "",
    system_prompt_suffix: str = "",
    tool_policy: str = "",
    workspace_override: str = "",
    display_workspace_override: str = "",
    memory_scope_override: str = "",
) -> dict:
    workspace = _project_workspace(project)
    if workspace_override:
        normalized = workspace_override.replace("\\", "/").rstrip("/")
        allowed_root = str(HERMES_UPLOAD_ROOT.parent / "mini-shared" / "workspaces").replace("\\", "/").rstrip("/")
        if (
            not normalized.startswith(allowed_root + "/")
            or any(part in {"", ".", ".."} for part in normalized.removeprefix(allowed_root + "/").split("/"))
        ):
            raise ValueError("unsupported Hermes session workspace override")
        workspace = normalized
    if display_workspace_override and display_workspace_override != "/workspace":
        raise ValueError("unsupported Hermes display workspace override")
    if memory_scope_override and not re.fullmatch(r"mini-(?:intake|job)/[A-Za-z0-9_-]{8,80}", memory_scope_override):
        raise ValueError("unsupported Hermes memory scope override")
    system_prompt = _project_context(
        project,
        canonical_workspace=display_workspace_override or workspace,
        memory_scope=memory_scope_override,
    )
    if system_prompt_suffix:
        system_prompt = f"{system_prompt}\n\n{system_prompt_suffix.strip()}"
    payload = {
        "source": "api_server",
        "cwd": workspace,
        "workspace": workspace,
        "system_prompt": system_prompt,
    }
    if session_id_override:
        if not re.fullmatch(
            r"mini-(?:intake|job)-[A-Za-z0-9_-]{8,80}", session_id_override
        ):
            raise ValueError("unsupported deterministic Hermes session id")
        payload["id"] = session_id_override
    if title and title != "New chat":
        payload["title"] = title
    if model:
        payload.update({"model": model, "require_model_lock": True})
    if provider:
        payload["provider"] = provider
    if tool_policy:
        if tool_policy not in {"none", "isolated_terminal"}:
            raise ValueError("unsupported Hermes session tool policy")
        payload["tool_policy"] = tool_policy
    data = hermes_request("/api/sessions", payload, method="POST")
    session = data.get("session") or {}
    if not session.get("id"):
        raise RuntimeError("Hermes did not return a session id")
    return session


@app.post("/api/projects")
def projects_create():
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        abort(400, "request body must be an object")
    allowed = {"name", "id", "blurb", "repository_url", "live", "model", "provider"}
    if set(body) - allowed:
        abort(400, "unsupported project fields")
    name = _clean_project_text(body.get("name"), 80, required=True)
    project_id = _clean_project_id(body.get("id"), name)
    project = {
        "id": project_id,
        "name": name,
        "root": project_id,
        "blurb": _clean_project_text(body.get("blurb"), 240) or f"{name} project workspace.",
        "repository_url": _clean_project_url(body.get("repository_url"), "repository URL"),
        "live": _clean_project_url(body.get("live"), "live URL"),
        "capabilities": list(PROJECT_DEFAULT_CAPABILITIES),
        "default_widgets": list(home_defaults.PROJECT_DEFAULT_WIDGET_IDS),
        "created_at": int(time.time()),
    }
    if _project_store.get_project(project_id):
        abort(409, "project already exists")
    try:
        session = _create_project_session(
            project,
            title=f"{name} · start",
            model=str(body.get("model") or "").strip(),
            provider=str(body.get("provider") or "").strip(),
        )
    except Exception as error:
        return _hermes_error(error)
    try:
        _project_store.create_project(project, str(session["id"]))
    except ValueError as error:
        try:
            hermes_request(_session_path(str(session["id"])), method="DELETE")
        except Exception:
            pass
        abort(409, str(error))
    except ProjectStoreError as error:
        try:
            hermes_request(_session_path(str(session["id"])), method="DELETE")
        except Exception:
            pass
        abort(503, str(error))
    return jsonify({
        "ok": True,
        "project": _project_public({**project, "chat_count": 1, "default_chat_id": str(session["id"])}),
        "session": _public_hermes_session(session, project_id=project_id),
        "bootstrap_prompt": _project_bootstrap_prompt(project),
    }), 201


@app.get("/api/accounts")
def accounts_list():
    data = _ensure_accounts()
    items = sorted(
        data["accounts"],
        key=lambda item: (
            str(item.get("project_id", "main")).lower(),
            str(item.get("name", "")).lower(),
        ),
    )
    return jsonify({"accounts": items})


@app.post("/api/accounts")
def accounts_create():
    body = request.get_json(silent=True) or {}
    item = _clean_account(body)
    now = int(time.time())
    item.update({"id": secrets.token_hex(8), "created_at": now, "updated_at": now})
    with _accounts_lock:
        data = _ensure_accounts()
        duplicate = next((entry for entry in data["accounts"] if (
            entry.get("project_id") == item["project_id"]
            and entry.get("kind") == item["kind"]
            and str(entry.get("identity", "")).lower() == item["identity"].lower()
        )), None)
        if duplicate:
            abort(409, "this identity already exists for the project")
        data["accounts"].append(item)
        _write_accounts(data)
    return jsonify({"ok": True, "account": item}), 201


@app.patch("/api/accounts/<account_id>")
def accounts_update(account_id: str):
    body = request.get_json(silent=True) or {}
    with _accounts_lock:
        data = _ensure_accounts()
        item = next((entry for entry in data["accounts"] if entry.get("id") == account_id), None)
        if item is None:
            abort(404)
        cleaned = _clean_account(body, item)
        cleaned["id"] = item["id"]
        cleaned["created_at"] = item.get("created_at", int(time.time()))
        cleaned["updated_at"] = int(time.time())
        duplicate = next((entry for entry in data["accounts"] if (
            entry.get("id") != account_id
            and entry.get("project_id") == cleaned["project_id"]
            and entry.get("kind") == cleaned["kind"]
            and str(entry.get("identity", "")).lower() == cleaned["identity"].lower()
        )), None)
        if duplicate:
            abort(409, "this identity already exists for the project")
        item.clear()
        item.update(cleaned)
        _write_accounts(data)
    return jsonify({"ok": True, "account": item})


@app.delete("/api/accounts/<account_id>")
def accounts_delete(account_id: str):
    with _accounts_lock:
        data = _ensure_accounts()
        before = len(data["accounts"])
        data["accounts"] = [entry for entry in data["accounts"] if entry.get("id") != account_id]
        if len(data["accounts"]) == before:
            abort(404)
        _write_accounts(data)
    return jsonify({"ok": True})


@app.get("/api/email-tools")
def email_tools():
    mautic_url = os.environ.get("MAUTIC_URL", "").strip()
    mautic_fallback = "configured" if mautic_url else "unconfigured"
    return jsonify({
        "resend": {
            "status": _connector_status("RESEND_CONNECTOR_STATUS"),
            "mcp_status": _connector_status("RESEND_MCP_STATUS"),
            "url": "https://resend.com/emails",
        },
        "mautic": {
            "status": _connector_status("MAUTIC_CONNECTOR_STATUS", mautic_fallback),
            "url": mautic_url,
        },
    })


@app.get("/api/roots")
def roots():
    out = []
    labels = {"vps": "VPS"}
    for key, path in ROOTS.items():
        out.append({"id": key, "name": labels.get(key, key), "exists": path.exists()})
    return jsonify({"roots": out})


@app.get("/api/tree")
def tree():
    root = request.args.get("root", "vps")
    rel = request.args.get("path", "").lstrip("/")
    base = jail(root, rel)
    if not base.exists():
        return jsonify({"ok": False, "missing": True, "root": root, "path": rel, "entries": []})
    if not base.is_dir():
        abort(400, "not a directory")
    entries = []
    try:
        children = sorted(base.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        abort(403)
    for child in children:
        if child.name in SKIP or child.name.startswith("."):
            continue
        try:
            st = child.stat()
        except OSError:
            continue
        entries.append(
            {
                "name": child.name,
                "dir": child.is_dir(),
                "path": str((Path(rel) / child.name).as_posix()).lstrip("/"),
                "size": st.st_size if child.is_file() else None,
                "mtime": int(st.st_mtime),
                "ext": (child.suffix[1:].lower() if child.suffix else None),
            }
        )
        if len(entries) >= 500:
            break
    return jsonify({"ok": True, "missing": False, "root": root, "path": rel, "entries": entries})


@app.get("/api/tree/search")
def tree_search():
    """Bounded recursive image search inside an explicitly mounted root."""
    root = request.args.get("root", "vps")
    query = str(request.args.get("q") or "").strip().lower()
    if len(query) < 2 or len(query) > 120:
        abort(400, "search requires between 2 and 120 characters")
    try:
        cursor = max(0, int(request.args.get("cursor", "0")))
        limit = min(100, max(1, int(request.args.get("limit", "50"))))
    except ValueError:
        abort(400, "invalid search page")
    base = jail(root, "")
    if not base.is_dir():
        return jsonify({"ok": False, "missing": True, "entries": [], "next_cursor": None})
    matches = []
    inspected = 0
    stack = [base]
    while stack and inspected < 20_000 and len(matches) < cursor + limit + 1:
        folder = stack.pop()
        try:
            children = sorted(folder.iterdir(), key=lambda path: path.name.lower(), reverse=True)
        except (OSError, PermissionError):
            continue
        for child in children:
            inspected += 1
            if inspected > 20_000:
                break
            if child.name.startswith(".") or child.name in SKIP or child.is_symlink():
                continue
            try:
                if child.is_dir():
                    stack.append(child)
                    continue
                if child.suffix.lower() not in AD_STUDIO_IMAGE_EXTENSIONS or query not in child.name.lower():
                    continue
                resolved = child.resolve()
                resolved.relative_to(base.resolve())
                st = resolved.stat()
            except (OSError, ValueError):
                continue
            matches.append({
                "name": child.name,
                "dir": False,
                "path": resolved.relative_to(base.resolve()).as_posix(),
                "size": st.st_size,
                "mtime": int(st.st_mtime),
                "ext": child.suffix[1:].lower(),
            })
    page = matches[cursor:cursor + limit]
    next_cursor = cursor + limit if len(matches) > cursor + limit else None
    return jsonify({
        "ok": True,
        "missing": False,
        "entries": page,
        "next_cursor": next_cursor,
        "inspected": inspected,
        "truncated": inspected >= 20_000,
    })


@app.get("/api/file")
def file_get():
    root = request.args.get("root", "vps")
    rel = request.args.get("path", "").lstrip("/")
    raw = request.args.get("raw") == "1"
    download = request.args.get("download") == "1"
    if not rel:
        abort(400, "path required")
    target = jail(root, rel)
    if not target.is_file():
        abort(404)
    if target.stat().st_size > 8_000_000:
        abort(413, "too large")
    if raw or download:
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        return send_file(
            target,
            mimetype=mime,
            as_attachment=download,
            download_name=target.name if download else None,
            max_age=0,
        )
    if target.stat().st_size > 400_000:
        abort(413, "too large for text preview")
    text = target.read_text(encoding="utf-8", errors="replace")
    return jsonify({"ok": True, "root": root, "path": rel, "text": text})


@app.get("/api/models")
def models():
    items = list(CURATED_MODELS)
    hermes = hermes_reachable()
    return jsonify({"models": items, "profile": HERMES_PROFILE, "hermes": hermes})


@app.get("/api/chat/sessions")
def chat_sessions_list():
    try:
        data = hermes_request("/api/sessions?limit=100&include_children=true")
    except Exception as err:
        return _hermes_error(err)
    sessions = _public_hermes_session_list(data, _project_store.session_bindings()) or []
    return jsonify({"sessions": sessions, "profile": HERMES_PROFILE})


@app.post("/api/chat/sessions")
def chat_sessions_create():
    body = request.get_json(silent=True) or {}
    title = re.sub(r"\s+", " ", str(body.get("title", "New chat"))).strip()[:80] or "New chat"
    model = str(body.get("model", "")).strip()
    provider = str(body.get("provider", "")).strip()
    project_id = _clean_project_id(body.get("project_id")) if body.get("project_id") else ""
    project = _project_store.get_project(project_id) if project_id else None
    if project_id and not project:
        abort(404, "project not found")
    try:
        if project:
            session = _create_project_session(project, title=title, model=model, provider=provider)
        else:
            payload = {"source": "api_server"}
            if title != "New chat":
                payload["title"] = title
            if model:
                payload.update({"model": model, "require_model_lock": True})
            if provider:
                payload["provider"] = provider
            data = hermes_request("/api/sessions", payload, method="POST")
            session = data.get("session") or {}
    except Exception as err:
        return _hermes_error(err)
    if project_id:
        try:
            _project_store.bind_session(project_id, str(session.get("id") or ""))
        except (KeyError, ValueError) as error:
            try:
                hermes_request(_session_path(str(session.get("id") or "")), method="DELETE")
            except Exception:
                pass
            abort(409, str(error))
    return jsonify({"ok": True, "session": _public_hermes_session(session, project_id=project_id)}), 201


@app.patch("/api/chat/sessions/<chat_id>")
def chat_sessions_rename(chat_id: str):
    body = request.get_json(silent=True) or {}
    title = re.sub(r"\s+", " ", str(body.get("title", ""))).strip()[:80]
    if not title:
        abort(400, "title required")
    try:
        data = hermes_request(_session_path(chat_id), {"title": title}, method="PATCH")
    except Exception as err:
        return _hermes_error(err)
    return jsonify({
        "ok": True,
        "session": _public_hermes_session(
            data.get("session") or {}, project_id=_project_store.project_id_for_session(chat_id)
        ),
    })


@app.post("/api/chat/sessions/<chat_id>/model")
def chat_sessions_model(chat_id: str):
    body = request.get_json(silent=True) or {}
    model = str(body.get("model", "")).strip()
    provider = str(body.get("provider", "")).strip()
    if not model:
        abort(400, "model required")
    payload = {"model": model, "require_model_lock": True}
    if provider:
        payload["provider"] = provider
    try:
        data = hermes_request(_session_path(chat_id, "/model"), payload, method="POST")
    except Exception as err:
        return _hermes_error(err)
    return jsonify({"ok": True, "runtime": data.get("runtime") or {}})


@app.get("/api/chat")
def chat_list():
    chat_id = str(request.args.get("session_id", "")).strip()
    if not chat_id:
        abort(400, "session_id required")
    try:
        data = hermes_request(_session_path(chat_id, "/messages") + "?limit=500&order=oldest")
    except Exception as err:
        return _hermes_error(err)
    return jsonify({
        "messages": _public_hermes_messages(data.get("data") or []),
        "session_id": chat_id,
        "project_id": _project_store.project_id_for_session(chat_id),
    })


def _clean_atts(raw) -> list:
    if not isinstance(raw, list):
        return []
    out = []
    for a in raw:
        if not isinstance(a, dict):
            continue
        upload_id = str(a.get("id", "")).replace("\\", "/").lstrip("/")
        target = _upload_target(upload_id)
        if target is None or not target.is_file():
            continue
        rel = target.relative_to(UPLOAD_DIR).as_posix()
        media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        out.append({
            "id": rel,
            "name": target.name,
            "relative_path": str(a.get("relative_path", "") or target.name),
            "size": target.stat().st_size,
            "type": media_type,
            "url": f"/api/chat/uploads/{rel}",
            "hermes_path": str(HERMES_UPLOAD_ROOT / Path(rel)).replace("\\", "/"),
            "origin": "vps" if a.get("source") == "vps" else "device",
        })
        if len(out) >= 500:
            break
    return out


def _safe_relative_path(raw: str, fallback: str) -> Path:
    value = str(raw or fallback).replace("\\", "/").lstrip("/")
    pieces = [re.sub(r"[^A-Za-z0-9._ ()\[\]-]", "_", part) for part in value.split("/")]
    pieces = [part for part in pieces if part not in ("", ".", "..")]
    return Path(*pieces) if pieces else Path(fallback)


def _upload_target(upload_id: str) -> Path | None:
    if not upload_id:
        return None
    target = (UPLOAD_DIR / upload_id).resolve()
    try:
        target.relative_to(UPLOAD_DIR.resolve())
    except ValueError:
        return None
    return target


@app.post("/api/chat/uploads")
def chat_upload():
    """Materialise browser files where Hermes can read them."""
    files = request.files.getlist("files")
    paths = request.form.getlist("paths")
    if not files:
        abort(400, "no files")
    if len(files) > 500:
        abort(413, "too many files")
    batch = f"{int(time.time())}-{secrets.token_hex(6)}"
    saved = []
    for index, item in enumerate(files):
        rel = _safe_relative_path(paths[index] if index < len(paths) else item.filename, item.filename or f"file-{index + 1}")
        target = (UPLOAD_DIR / batch / rel).resolve()
        try:
            target.relative_to((UPLOAD_DIR / batch).resolve())
        except ValueError:
            abort(400, "invalid upload path")
        target.parent.mkdir(parents=True, exist_ok=True)
        item.save(target)
        upload_id = target.relative_to(UPLOAD_DIR).as_posix()
        media_type = item.mimetype or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        saved.append({
            "id": upload_id,
            "name": target.name,
            "relative_path": rel.as_posix(),
            "size": target.stat().st_size,
            "type": media_type,
            "url": f"/api/chat/uploads/{upload_id}",
        })
    return jsonify({"ok": True, "attachments": saved})


@app.post("/api/chat/uploads/vps")
def chat_upload_vps():
    """Copy selected images from the read-only VPS tree for Hermes."""
    body = request.get_json(silent=True) or {}
    files = body.get("files")
    if not isinstance(files, list) or not files:
        abort(400, "no files")
    if len(files) > 100:
        abort(413, "too many files")

    sources = []
    total_size = 0
    for item in files:
        if not isinstance(item, dict):
            abort(400, "invalid file")
        root = str(item.get("root", "vps")).strip() or "vps"
        rel = str(item.get("path", "")).replace("\\", "/").lstrip("/")
        parts = Path(rel).parts
        if not rel or any(part.startswith(".") or part in SKIP for part in parts):
            abort(400, "invalid file path")
        source = jail(root, rel)
        if not source.is_file():
            abort(404, "file not found")
        media_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        if not media_type.startswith("image/"):
            abort(415, "source must be an image")
        size = source.stat().st_size
        total_size += size
        if total_size > MAX_UPLOAD_BYTES:
            abort(413, "files are too large")
        sources.append((source, rel, media_type, size))

    batch = f"{int(time.time())}-{secrets.token_hex(6)}"
    saved = []
    for source, rel, media_type, size in sources:
        stored_rel = _safe_relative_path(f"vps/{rel}", source.name)
        target = (UPLOAD_DIR / batch / stored_rel).resolve()
        try:
            target.relative_to((UPLOAD_DIR / batch).resolve())
        except ValueError:
            abort(400, "invalid upload path")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        upload_id = target.relative_to(UPLOAD_DIR).as_posix()
        saved.append({
            "id": upload_id,
            "name": source.name,
            "relative_path": rel,
            "size": size,
            "type": media_type,
            "url": f"/api/chat/uploads/{upload_id}",
            "source": "vps",
        })
    return jsonify({"ok": True, "attachments": saved})


@app.delete("/api/chat/uploads")
def chat_upload_delete():
    """Delete staged attachments that the user removed before sending."""
    body = request.get_json(silent=True) or {}
    raw_ids = body.get("ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        abort(400, "no upload ids")
    if len(raw_ids) > 500:
        abort(413, "too many upload ids")

    upload_root = UPLOAD_DIR.resolve()
    targets = []
    for raw_id in raw_ids:
        upload_id = str(raw_id or "").replace("\\", "/").lstrip("/")
        target = _upload_target(upload_id)
        if target is None:
            abort(400, "invalid upload id")
        targets.append((upload_id, target))

    deleted = []
    missing = []
    for upload_id, target in targets:
        if not target.is_file():
            missing.append(upload_id)
            continue
        target.unlink()
        deleted.append(upload_id)
        parent = target.parent
        while parent != upload_root:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent

    return jsonify({"ok": True, "deleted": deleted, "missing": missing})


@app.get("/api/chat/uploads/<path:upload_id>")
def chat_upload_get(upload_id: str):
    target = _upload_target(upload_id)
    if target is None or not target.is_file():
        abort(404)
    return send_file(
        target,
        mimetype=mimetypes.guess_type(target.name)[0] or "application/octet-stream",
        as_attachment=request.args.get("download") == "1",
        download_name=target.name,
        max_age=0,
    )


def _attachment_prompt(text: str, attachments: list) -> str:
    if not attachments:
        return text
    listing = "\n".join(
        f"- {a['relative_path']} ({a['type']}, {a['size']} bytes) — available to your tools at {a['hermes_path']}"
        for a in attachments
    )
    prompt = (text or "Please inspect and respond to the attached material.").strip()
    prompt += "\n\nAttached files have already been uploaded and are readable at these exact local paths:\n" + listing
    return prompt


def _hermes_input(text: str, attachments: list) -> str | list:
    if not attachments:
        return text
    prompt = _attachment_prompt(text, attachments)
    content = [{"type": "input_text", "text": prompt}]
    inline_total = 0
    for attachment in attachments:
        if not attachment["type"].startswith("image/") or attachment["type"] == "image/svg+xml":
            continue
        target = _upload_target(attachment["id"])
        if target is None or not target.is_file():
            continue
        size = target.stat().st_size
        if inline_total + size > MAX_INLINE_IMAGE_BYTES:
            continue
        encoded = base64.b64encode(target.read_bytes()).decode("ascii")
        content.append({"type": "input_image", "image_url": f"data:{attachment['type']};base64,{encoded}"})
        inline_total += size
    return content


def _public_generation_text(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()[:400]
    if any(pattern.search(text) for pattern in SECRET_VALUE_PATTERNS):
        return "Protected revision detail recorded in Hermes."
    if re.search(r"[A-Za-z]:\\|/(?:home|srv|opt|projects|root|tmp|var|etc)/", text):
        return "Protected revision detail recorded in Hermes."
    if re.search(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d", text):
        return "Protected revision detail recorded in Hermes."
    return text


def _public_ad_studio_generations(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    public = []
    for index, raw in enumerate(value[:30], 1):
        if not isinstance(raw, dict):
            continue
        comparison = raw.get("comparison") if isinstance(raw.get("comparison"), dict) else {}
        public.append({
            "iteration": int(_number_from(raw.get("iteration"), index) or index),
            "decision": str(raw.get("decision") or "revise")[:20],
            "comparison": {
                "score": _number_from(comparison.get("score")),
                "reason": _public_generation_text(comparison.get("reason")),
            },
        })
    return public


def _public_ad_studio_run(run: dict, *, title: str = "", project_id: str = "") -> dict:
    """Project Hermes state for Frank's internal operator monitor."""
    now = int(time.time())
    payload = run.get("payload") if isinstance(run.get("payload"), dict) else {}
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    source = sources[0] if sources and isinstance(sources[0], dict) else {}
    output = run.get("output") if isinstance(run.get("output"), dict) else {}
    scope = run.get("scope") if isinstance(run.get("scope"), dict) else {}
    safe_output = {key: output.get(key) for key in (
        "template", "deterministic_documents", "iterations", "final_review", "import", "process",
    ) if key in output}
    previews = []
    for item in output.get("previews") if isinstance(output.get("previews"), list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", name):
            continue
        previews.append({"name": name, "placement": str(item.get("placement") or ""), "url": f"/api/ad-studio/runs/{run.get('run_id') or run.get('id')}/artifacts/{urllib.parse.quote(name, safe='')}"})
    if previews:
        safe_output["previews"] = previews
    if "iterations" in output:
        safe_output["iterations"] = _public_ad_studio_generations(output.get("iterations"))
    return {
        "id": str(run.get("id") or run.get("run_id") or ""),
        "request_id": str(run.get("request_id") or ""),
        "status": str(run.get("status") or "queued"),
        "stage": str(run.get("stage") or "source"),
        "progress": float(run.get("progress") or 0),
        "attention": bool(run.get("attention")),
        "created_at": run.get("created_at") or now,
        "updated_at": run.get("updated_at") or run.get("created_at") or now,
        "policy_revision": str(run.get("model_policy_revision") or ""),
        "source": {"name": str(source.get("name") or ""), "size": int(source.get("size") or 0), "media_type": str(source.get("media_type") or ""), "origin": str(source.get("origin") or "")},
        "output": safe_output,
        "title": title or str(run.get("title") or payload.get("job_name") or "Ad template"),
        "project_id": project_id or str(scope.get("project_id") or payload.get("project_id") or ""),
        **({"error": str(run.get("error"))[:1200]} if run.get("error") else {}),
    }


def _ad_studio_source(attachment: dict) -> dict:
    target = _upload_target(attachment["id"])
    if target is None or not target.is_file():
        abort(400, "source image is no longer available")
    return {
        "path": attachment["hermes_path"],
        "name": attachment["name"],
        "size": attachment["size"],
        "media_type": attachment["type"],
        "origin": attachment.get("origin") or "device",
    }


def _tool_run_path(run_id: str, suffix: str = "") -> str:
    if not AD_STUDIO_RUN_ID.fullmatch(run_id):
        abort(404)
    return f"/v1/tool-runs/{urllib.parse.quote(run_id, safe='')}{suffix}"


@app.post("/api/ad-studio/runs")
def ad_studio_run_create():
    """Start the canonical Ad Studio work as a detached Hermes run."""
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        abort(400, "request body must be an object")
    project_id = _clean_project_id(body.get("project_id")) if body.get("project_id") else ""
    project = _project_store.get_project(project_id) if project_id else None
    if not project:
        abort(404, "project not found")
    raw_attachments = body.get("attachments")
    if not isinstance(raw_attachments, list) or not raw_attachments or len(raw_attachments) > 100:
        abort(400, "choose between 1 and 100 source images")
    attachments = _clean_atts(raw_attachments)
    if len(attachments) != len(raw_attachments):
        abort(400, "one or more source images were not accepted")
    if any(not item["type"].startswith("image/") for item in attachments):
        abort(400, "Ad Studio accepts image sources only")

    raw_placements = body.get("placements")
    placements = [str(item).strip().lower() for item in raw_placements] if isinstance(raw_placements, list) else []
    if not placements or any(item not in AD_STUDIO_PLACEMENTS for item in placements):
        abort(400, "choose one or more supported placements")
    placements = list(dict.fromkeys(placements))
    name = _clean_project_text(body.get("name"), 60) or (
        re.sub(r"\.[^.]+$", "", attachments[0]["name"])
        if len(attachments) == 1 else f"{len(attachments)} source images"
    )
    brief = _clean_project_text(body.get("brief"), 800)
    policy_revision = str(body.get("policy_revision") or "").strip()
    policy_override = body.get("policy_override") if isinstance(body.get("policy_override"), dict) else None
    batch_id = f"batch_{secrets.token_hex(16)}"
    runs = []
    try:
        for index, attachment in enumerate(attachments):
            child_name = name if len(attachments) == 1 else f"{name} · {index + 1} of {len(attachments)}"
            command_payload = {
                "batch_id": batch_id,
                "job_name": child_name,
                "brief": brief,
                "placements": placements,
                "sources": [_ad_studio_source(attachment)],
                "project_context": _project_context(project),
            }
            request_payload = {
                "schema": "schema://hermes.tool-run-command/v1",
                "request_id": f"req_{secrets.token_hex(16)}",
                "tool_id": "ad-template-generator",
                "action": "build-template",
                "scope": {"project_id": project_id},
                "payload": command_payload,
                "idempotency_key": f"{batch_id}:{index}",
            }
            if policy_revision:
                try:
                    request_payload["model_policy_revision"] = int(policy_revision)
                except ValueError:
                    abort(400, "invalid model policy revision")
            if policy_override:
                request_payload["model_policy_override"] = policy_override
            data = hermes_request("/v1/tool-runs", request_payload, method="POST", timeout=15)
            run_data = data.get("run") if isinstance(data.get("run"), dict) else data
            run_id = str(run_data.get("id") or run_data.get("run_id") or "")
            if not AD_STUDIO_RUN_ID.fullmatch(run_id):
                return jsonify({"error": "Hermes did not return a valid Tool run id"}), 502
            runs.append(_public_ad_studio_run(run_data, title=f"Ad Studio · {child_name}", project_id=project_id))
            staging_target = _upload_target(attachment["id"])
            if staging_target is not None:
                try:
                    staging_target.unlink(missing_ok=True)
                except OSError:
                    pass
    except Exception as error:
        return _hermes_error(error)
    return jsonify({"ok": True, "batch_id": batch_id, "run": runs[0], "runs": runs}), 202


@app.get("/api/ad-studio/runs")
def ad_studio_run_list():
    query = urllib.parse.urlencode({
        "tool_id": "ad-template-generator",
        "project_id": str(request.args.get("project_id") or ""),
        "limit": min(200, max(1, request.args.get("limit", type=int) or 100)),
    })
    try:
        data = hermes_request(f"/v1/tool-runs?{query}", timeout=8)
    except Exception as error:
        return _hermes_error(error)
    raw_runs = data.get("runs") if isinstance(data.get("runs"), list) else data.get("data", [])
    return jsonify({"runs": [_public_ad_studio_run(item) for item in raw_runs if isinstance(item, dict)]})


@app.get("/api/ad-studio/runs/<run_id>")
def ad_studio_run_get(run_id: str):
    """Read authoritative Tool-run status without creating a Hub chat."""
    try:
        data = hermes_request(_tool_run_path(run_id), timeout=8)
    except Exception as error:
        return _hermes_error(error)
    run = data.get("run") if isinstance(data.get("run"), dict) else data
    return jsonify({"run": _public_ad_studio_run(run)})


@app.get("/api/ad-studio/runs/<run_id>/events")
def ad_studio_run_events(run_id: str):
    after = request.args.get("after", type=int)
    if after is None:
        try:
            after = int(request.headers.get("Last-Event-ID") or 0)
        except ValueError:
            after = 0
    url = hermes_base() + _tool_run_path(run_id, "/events") + "?" + urllib.parse.urlencode({"after": max(-1, after)})

    def generate():
        headers = {"Accept": "text/event-stream"}
        if HERMES_KEY:
            headers["Authorization"] = f"Bearer {HERMES_KEY}"
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=75) as response:
                # SSE records are small and long-lived. A fixed-size read can
                # wait for its whole buffer, hiding live activity for minutes.
                for line in response:
                    yield line
        except (urllib.error.URLError, TimeoutError):
            yield b"event: disconnected\ndata: {}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream", headers=_sse_headers())


@app.get("/api/ad-studio/runs/<run_id>/download")
def ad_studio_run_download(run_id: str):
    url = hermes_base() + _tool_run_path(run_id, "/download")
    headers = {"Accept": "application/zip, application/json"}
    if HERMES_KEY:
        headers["Authorization"] = f"Bearer {HERMES_KEY}"
    try:
        upstream = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30)
    except Exception as error:
        return _hermes_error(error)

    def generate():
        try:
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            upstream.close()

    response_headers = {"Cache-Control": "private, no-store"}
    disposition = upstream.headers.get("Content-Disposition")
    if disposition:
        response_headers["Content-Disposition"] = disposition
    return Response(stream_with_context(generate()), mimetype=upstream.headers.get_content_type(), headers=response_headers)


@app.get("/api/ad-studio/runs/<run_id>/artifacts/<name>")
def ad_studio_run_artifact(run_id: str, name: str):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", name):
        abort(404)
    url = hermes_base() + _tool_run_path(run_id, f"/artifacts/{urllib.parse.quote(name, safe='')}")
    headers = {"Accept": "image/png,image/jpeg,image/webp"}
    if HERMES_KEY:
        headers["Authorization"] = f"Bearer {HERMES_KEY}"
    try:
        upstream = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15)
        data = upstream.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024:
            abort(413)
        return Response(data, mimetype=upstream.headers.get_content_type(), headers={"Cache-Control": "private, no-store"})
    except Exception as error:
        return _hermes_error(error)


def _proxy_ad_studio_action(run_id: str, suffix: str, allowed: set[str]):
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or any(key not in allowed for key in body):
        abort(400, "invalid action")
    try:
        data = hermes_request(_tool_run_path(run_id, suffix), body, method="POST", timeout=15)
    except Exception as error:
        return _hermes_error(error)
    run = data.get("run") if isinstance(data.get("run"), dict) else data
    return jsonify({"ok": True, "run": _public_ad_studio_run(run)})


def _number_from(*values):
    for value in values:
        if isinstance(value, bool) or value is None or value == "":
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            return number
    return None


@app.post("/api/ad-studio/runs/<run_id>/approval")
def ad_studio_run_approval(run_id: str):
    return jsonify({"error": "This process completes automatically; human approval is not used."}), 410


@app.post("/api/ad-studio/runs/<run_id>/models")
def ad_studio_run_models(run_id: str):
    return _proxy_ad_studio_action(run_id, "/models", {"policy", "reason"})


@app.post("/api/ad-studio/runs/<run_id>/retry")
def ad_studio_run_retry(run_id: str):
    return _proxy_ad_studio_action(run_id, "/retry", {"from_stage"})


@app.post("/api/ad-studio/runs/<run_id>/cancel")
def ad_studio_run_cancel(run_id: str):
    return _proxy_ad_studio_action(run_id, "/cancel", {"reason"})


@app.get("/api/ad-studio/models")
def ad_studio_models():
    try:
        return jsonify(hermes_request("/v1/tool-runs/models?tool_id=ad-template-generator", timeout=8))
    except Exception as error:
        return _hermes_error(error)


@app.route("/api/ad-studio/model-policies", methods=["GET", "POST"])
def ad_studio_model_policies():
    path = "/v1/tool-runs/policies/ad-template-generator"
    if request.method == "GET":
        query = urllib.parse.urlencode({"project_id": str(request.args.get("project_id") or "")})
        try:
            return jsonify(hermes_request(f"{path}?{query}", timeout=8))
        except Exception as error:
            return _hermes_error(error)
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or not isinstance(body.get("policy"), dict):
        abort(400, "model policy required")
    payload = {"project_id": str(body.get("project_id") or ""), "policy": body["policy"]}
    try:
        return jsonify(hermes_request(path, payload, method="POST", timeout=15))
    except Exception as error:
        return _hermes_error(error)


def _hermes_chat_stream(chat_id: str, payload: dict, *, read_timeout: float | None = None):
    """Yield one authoritative Hermes session turn as raw SSE lines."""
    url = hermes_base() + _session_path(chat_id, "/chat/stream")
    base_headers = {
        "Authorization": f"Bearer {HERMES_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=base_headers,
            method="POST",
        )
        # Operator chat has no client-side turn deadline. Public Mini callers
        # supply a finite read timeout so an abandoned upstream cannot occupy
        # one of the deliberately small number of guide slots forever.
        response = (
            urllib.request.urlopen(req)
            if read_timeout is None
            else urllib.request.urlopen(req, timeout=read_timeout)
        )
        with response as resp:
            for raw_line in resp:
                yield raw_line
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:1200]
        msg = f"Hermes returned HTTP {err.code}."
        try:
            parsed = json.loads(detail)
            msg = parsed.get("error", {}).get("message") or parsed.get("message") or msg
        except (json.JSONDecodeError, AttributeError):
            pass
        yield f"event: error\ndata: {json.dumps({'type': 'error', 'content': msg})}\n\n".encode()
    except Exception as err:
        msg = f"Could not reach Hermes: {str(err).split(chr(10))[0][:180]}"
        yield f"event: error\ndata: {json.dumps({'type': 'error', 'content': msg})}\n\n".encode()
        yield b"event: done\ndata: {\"type\":\"done\"}\n\n"


@app.post("/api/chat/turn")
def chat_turn():
    """Stream one turn through the authoritative Hermes session."""
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", "")).strip()
    attachments = _clean_atts(body.get("attachments"))
    model = str(body.get("model", "")).strip()
    provider = str(body.get("provider", "")).strip()
    chat_id = str(body.get("chat_id", "")).strip()
    if not chat_id:
        abort(400, "chat_id required")
    if not text and not attachments:
        abort(400, "empty message")
    payload = {"message": _hermes_input(text, attachments)}
    if model:
        payload.update({"model": model, "require_model_lock": True})
    if provider:
        payload["provider"] = provider
    return Response(
        stream_with_context(_hermes_chat_stream(chat_id, payload)),
        mimetype="text/event-stream",
        headers=_sse_headers(),
    )


def _sse_headers():
    return {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }


home_platform.configure(
    project_loader=_project_items,
    account_loader=lambda: list(_ensure_accounts().get("accounts", [])),
    hermes_health=hermes_reachable,
    hermes_sessions=hermes_session_summaries,
    roots=ROOTS,
    graph_reader=_graph_projection,
    graph_available=_graph_available,
)
app.register_blueprint(home_platform.api)
app.register_blueprint(create_graph_blueprint(_graph_provider))
app.register_blueprint(vault_broker.api)
app.register_blueprint(create_memory_blueprint(MemoryInspector(
    _project_store.get_project,
    HindsightClient(HINDSIGHT_URL),
    Path(os.environ.get("PROJECT_KNOWLEDGE_ROOT", "/data/knowledge")),
)))


app.register_blueprint(mini_frank.create_blueprint(
    data_root=_mini_data_root(),
    project_view_root=_mini_preview_root(),
    legacy_project_root=_mini_legacy_root(),
    project_getter=_project_store.get_project,
    session_creator=_create_project_session,
    hermes_request=hermes_request,
    hermes_chat_stream=_hermes_chat_stream,
    # Hermes runs on the VPS host, while Frank writes through the /data
    # container mount. The shared upload root already names that host path.
    hermes_data_root=HERMES_UPLOAD_ROOT.parent,
    # Keep claim links stable across restarts when a dedicated Mini key has not
    # yet been provisioned. HERMES_KEY is already a persistent server secret.
    rate_limit_key=os.environ.get("MINI_RATE_LIMIT_KEY", "").strip() or HERMES_KEY,
    free_project_limit=int(os.environ.get("MINI_FREE_PROJECT_LIMIT", "1")),
    start_reconciler=True,
))


@app.get("/frank")
def frank_root_redirect():
    target = "/frank/"
    if request.query_string:
        target = f"{target}?{request.query_string.decode('latin-1')}"
    return redirect(target, code=308)


@app.get("/frank/", defaults={"frank_path": ""})
@app.get("/frank/<path:frank_path>")
def frank_spa(frank_path: str):
    public_path = str(frank_path or "").strip("/")
    if public_path == "":
        return send_from_directory(WEB / "mini", "index.html")
    if public_path == "index.html":
        return redirect("/frank/", code=308)
    source_name = FRANK_PUBLIC_ASSETS.get(public_path)
    if not source_name:
        abort(404)
    return send_from_directory(WEB / "mini", source_name)


@app.get("/mini", defaults={"mini_path": ""}, strict_slashes=False)
@app.get("/mini/<path:mini_path>")
def mini_legacy_redirect(mini_path: str):
    legacy_path = str(mini_path or "").strip("/")
    if legacy_path in {"", "index.html"}:
        target = "/frank/"
    elif legacy_path in LEGACY_MINI_ASSETS:
        target = f"/frank/{LEGACY_MINI_ASSETS[legacy_path]}"
    else:
        abort(404)
    if request.query_string:
        target = f"{target}?{request.query_string.decode('latin-1')}"
    return redirect(target, code=308)


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def spa(path: str):
    if path == "releases/ad-template-generator" or path.startswith("releases/ad-template-generator/"):
        abort(404)
    candidate = (WEB / path).resolve()
    try:
        candidate.relative_to(WEB)
    except ValueError:
        abort(400)
    if path and candidate.is_file():
        return send_from_directory(WEB, path)
    return send_from_directory(WEB, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))

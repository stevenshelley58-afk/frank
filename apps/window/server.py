"""Frank Window API — display only. Hermes is the brain."""
from __future__ import annotations

import json
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import math
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from types import MappingProxyType
from copy import deepcopy
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from flask import Flask, Response, abort, jsonify, redirect, request, send_file, send_from_directory, stream_with_context
from werkzeug.exceptions import HTTPException

import home_platform
import home_defaults
import mini_frank
from memory_inspector import HindsightClient, MemoryInspector, create_blueprint as create_memory_blueprint
from project_store import ProjectStore, ProjectStoreError
import vault_broker
import control_plane_view
import ops_projections
import customer_ops_actions
from graph.provider import (
    ReadOnlyProvider,
    ProviderUnavailable,
    create_blueprint as create_graph_blueprint,
    manifest_reader,
)
from tool_apps import discover_tool_apps

WEB = Path(os.environ.get("FRANK_WEB", "/web")).resolve()
MINI_PUBLIC_ASSETS = {
    "style.css": "mini.css",
    "app.js": "mini.js",
    "stream.mjs": "mini_stream.mjs",
    "api.mjs": "mini_api.mjs",
    "site-preview.html": "site-preview.html",
    "site-preview.css": "site-preview.css",
    "site-preview.js": "site-preview.js",
    "favicon.svg": "favicon.svg",
    "assets/demo-business-hero.png": "assets/demo-business-hero.png",
}
MINI_PUBLIC_FILE = re.compile(
    r"(?:[A-Za-z0-9][A-Za-z0-9._-]*/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:css|js|mjs|svg|png|webp|woff2)"
)
LEGACY_MINI_ASSETS = {
    "mini.css": "mini.css",
    "mini.js": "mini.js",
    "mini_stream.mjs": "mini_stream.mjs",
    "mini_api.mjs": "mini_api.mjs",
}
CHAT_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
UPLOAD_DIR = CHAT_DIR / "uploads"
ACCOUNTS_FILE = Path(os.environ.get("ACCOUNTS_STORE_FILE", str(CHAT_DIR / "accounts.json")))
SUPPORT_CONVERSATIONS_FILE = Path(os.environ.get("SUPPORT_CONVERSATIONS_FILE", str(CHAT_DIR / "support-conversations.json")))
PROJECTS_FILE = Path(os.environ.get("PROJECTS_STORE_FILE", str(CHAT_DIR / "projects.json")))
DATA_DIR = CHAT_DIR
TEMPLATE_RELEASE_ROOT = Path(os.environ.get(
    "AD_TEMPLATE_GENERATOR_RELEASE_ROOT", "/data/releases/ad-template-generator"
)).resolve()


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
AD_STUDIO_MAX_SOURCES = min(50, max(1, int(os.environ.get("AD_STUDIO_MAX_SOURCES", "20"))))
AD_STUDIO_MAX_SOURCE_BYTES = min(
    MAX_UPLOAD_BYTES,
    max(1, int(os.environ.get("AD_STUDIO_MAX_SOURCE_BYTES", str(25 * 1024 * 1024)))),
)
AD_STUDIO_MAX_BATCH_BYTES = min(
    MAX_UPLOAD_BYTES,
    max(AD_STUDIO_MAX_SOURCE_BYTES, int(os.environ.get("AD_STUDIO_MAX_BATCH_BYTES", str(100 * 1024 * 1024)))),
)
AD_STUDIO_MAX_BRIEF_CHARACTERS = 4000
# HERMES_ENDPOINT is the canonical dispatcher contract; retain the legacy
# variable only as an explicit compatibility fallback for older deployments.
HERMES_URL = os.environ.get("HERMES_ENDPOINT", os.environ.get("HERMES_API_URL", "http://172.16.1.1:8642")).rstrip("/")
HERMES_KEY = os.environ.get("HERMES_API_KEY", "")
HERMES_PROFILE = os.environ.get("HERMES_PROFILE", "default")
HINDSIGHT_URL = os.environ.get("HINDSIGHT_API_URL", "http://172.16.1.1:9178").rstrip("/")
# Read-only implementation monitors; Hermes remains template-run truth.
ARCHIFY_ARTIFACT = Path(os.environ.get("ARCHIFY_ARTIFACT", str(Path(__file__).resolve().parent / "archify" / "ad-template-process.html"))).resolve()
ARCHIFY_SPEC = Path(os.environ.get("ARCHIFY_SPEC", str(Path(__file__).resolve().parent / "archify" / "ad-template-process.json"))).resolve()
ARCHIFY_CLI = Path(os.environ.get("ARCHIFY_CLI", str(Path(__file__).resolve().parent / "vendor" / "archify" / "archify" / "bin" / "archify.mjs"))).resolve()
ARCHIFY_RECEIPT = Path(os.environ.get("ARCHIFY_RECEIPT", str(Path(__file__).resolve().parent / "archify" / "validation-receipt.json"))).resolve()
AGENTTRAIL_URL = os.environ.get("AGENTTRAIL_URL", "").strip().rstrip("/")
ROOTS = {
    # The container receives only the explicitly approved read-only VPS mounts
    # beneath /vps. This presents one familiar tree without exposing the
    # container filesystem, chat data, credentials, or Hermes state.
    "vps": Path(os.environ.get("VPS_ROOT", "/vps")),
}
SKIP = {".git", "node_modules", ".next", "__pycache__", ".turbo", "dist"}

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
TEMPLATE_RELEASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
TEMPLATE_RELEASE_EXTENSIONS = {
    ".json", ".png", ".webp", ".jpg", ".jpeg", ".woff", ".woff2", ".ttf", ".otf",
}
TEMPLATE_RELEASE_MAX_BYTES = int(os.environ.get(
    "AD_TEMPLATE_GENERATOR_RELEASE_MAX_BYTES", str(100 * 1024 * 1024)
))
TEMPLATE_RELEASE_MIME_TYPES = {
    ".json": "application/json",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
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
SUPPORT_CONVERSATION_STATUSES = {"open", "pending", "snoozed", "resolved", "closed"}
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
        "id": "mini-frank", "name": "Mini Frank", "root": "mini-frank",
        "blurb": "Mini Frank project workspace.",
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


_AD_DB_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$")
_AD_DB_QUERY_KEYS = frozenset({"q", "cursor", "limit", "agentId", "agentName", "agencyId", "agencyName", "state", "suburb", "postcode", "locationRelation", "status"})


def _ad_db_id(value: str) -> str:
    if not _AD_DB_ID.fullmatch(value or ""):
        abort(404)
    return value


def _ad_db_query() -> str:
    pairs = []
    for key, value in request.args.items(multi=True):
        if key not in _AD_DB_QUERY_KEYS or len(value) > 240:
            abort(400, description="unsupported Ad DB filter")
        pairs.append((key, value))
    return urllib.parse.urlencode(pairs)


def _ad_db_public_payload(payload: object) -> object:
    """Replace internal media routes; source URLs never reach the browser."""
    if not isinstance(payload, dict):
        return payload
    result = deepcopy(payload)
    records = result.get("items") if isinstance(result.get("items"), list) else [result]
    for record in records:
        if not isinstance(record, dict) or not _AD_DB_ID.fullmatch(str(record.get("id") or "")):
            continue
        for asset in record.get("media") if isinstance(record.get("media"), list) else []:
            if not isinstance(asset, dict):
                continue
            asset_id = str(asset.get("id") or "")
            if _AD_DB_ID.fullmatch(asset_id):
                asset["archiveUrl"] = f"/api/ad-db/ads/{urllib.parse.quote(record['id'], safe='')}/media/{urllib.parse.quote(asset_id, safe='')}"
            asset.pop("sourceUrl", None)
            asset.pop("sourceURLs", None)
    return result


class _AdDbNoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _ad_db_media_redirect(ad_id: str, asset_id: str) -> Response:
    """Relay Hermes' integrity-gated archive redirect without downloading it."""
    path = f"/v1/ad-db/ads/{urllib.parse.quote(ad_id, safe='')}/media/{urllib.parse.quote(asset_id, safe='')}"
    headers = {"Accept": "application/octet-stream"}
    if HERMES_KEY:
        headers["Authorization"] = f"Bearer {HERMES_KEY}"
    req = urllib.request.Request(hermes_base() + path, headers=headers, method="GET")
    try:
        upstream = urllib.request.build_opener(_AdDbNoRedirect()).open(req, timeout=15)
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise
        upstream = error
    location = upstream.headers.get("Location")
    if getattr(upstream, "status", upstream.getcode()) != 302 or not location:
        abort(502, description="Hermes did not return an archived-media redirect")
    return redirect(location, code=302)


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
            "text": _redact_public_text(text),
            "tools": tools,
            "attachments": [],
            "ts": item.get("timestamp") or 0,
        })
    return messages


def _redact_public_text(text: str) -> str:
    """Browser-facing chat text must never carry host paths or secrets.

    Hermes may legitimately see staging/agent paths inside a turn; the served
    projection redacts them so /api/chat stays within the public boundary.
    """
    try:
        from hermes_adapter.redaction import redact_text
        return redact_text(text)
    except Exception:
        return text


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
    # Release identity only (Phase E): safe fields, no paths or secrets.
    identity = {
        "source_sha": os.environ.get("FRANK_SOURCE_SHA", "unknown"),
        "build_id": os.environ.get("FRANK_BUILD_TIME", "unknown"),
        "schema_version": "frank.release-identity/v1",
    }
    return jsonify({"ok": True, "service": "frank-window", "hermes": brain,
                    "release": identity})


@app.errorhandler(ProjectStoreError)
def project_store_error(error: ProjectStoreError):
    return jsonify({"error": str(error)}), 503


@app.errorhandler(HTTPException)
def api_http_exception(error: HTTPException):
    """Return API validation failures as JSON so operator messages stay visible."""
    if not request.path.startswith("/api/"):
        return error
    description = error.description
    message = description.strip()[:300] if isinstance(description, str) and description.strip() else error.name
    return jsonify({"error": {"message": message}}), error.code or 500


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
    system_prompt_override: str = "",
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
    if system_prompt_override:
        if system_prompt_suffix:
            raise ValueError("system prompt override cannot be combined with a suffix")
        if tool_policy != "none" or not workspace_override or not memory_scope_override:
            raise ValueError("system prompt override is restricted to isolated tool-free sessions")
        system_prompt = system_prompt_override.strip()
        if not system_prompt:
            raise ValueError("system prompt override cannot be empty")
    else:
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
    mautic_url = _safe_provider_url(_mautic_base_url())
    return jsonify({
        "stalwart": {
            "status": _connector_status("STALWART_CONNECTOR_STATUS"),
            "url": _safe_provider_url(os.environ.get("STALWART_BASE_URL", "")),
        },
        "resend": {
            "role": "compatibility",
            "status": _connector_status("RESEND_CONNECTOR_STATUS"),
            "mcp_status": _connector_status("RESEND_MCP_STATUS"),
            "url": "https://resend.com/emails",
        },
        "mautic": {
            # A URL is configuration metadata, not proof that Hermes verified it.
            "status": _connector_status("MAUTIC_CONNECTOR_STATUS"),
            "url": mautic_url,
        },
    })


def _safe_provider_url(value: str) -> str:
    """Return one normalized HTTP(S) origin without credentials or paths."""
    parsed = urllib.parse.urlparse(str(value or "").strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return ""
    try:
        port = parsed.port
    except ValueError:
        return ""
    scheme = parsed.scheme.lower()
    host = parsed.hostname.lower().rstrip(".")
    suffix = f":{port}" if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)) else ""
    return f"{scheme}://{host}{suffix}"


def _safe_support_url(value: str) -> str:
    parsed = urllib.parse.urlparse(str(value or "").strip())
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        return ""
    return f"{_safe_provider_url(value)}{parsed.path}"


def _mautic_base_url() -> str:
    return os.environ.get("MAUTIC_BASE_URL", "").strip() or os.environ.get("MAUTIC_URL", "").strip()


@app.get("/api/providers/readiness")
def providers_readiness():
    """Provider-neutral readiness projection; verification remains Hermes-owned."""
    providers = {
        "stalwart": ("STALWART_CONNECTOR_STATUS", "STALWART_BASE_URL"),
        "mautic": ("MAUTIC_CONNECTOR_STATUS", "MAUTIC_BASE_URL"),
        "chatwoot": ("CHATWOOT_CONNECTOR_STATUS", "CHATWOOT_BASE_URL"),
    }
    items = []
    for provider, (status_var, url_var) in providers.items():
        status = _connector_status(status_var)
        items.append({
            "provider": provider,
            "status": status,
            "configured": status in {"configured", "ready"},
            "verified": status == "ready",
            "base_url": _safe_provider_url(_mautic_base_url() if provider == "mautic" else os.environ.get(url_var, "")),
            "error": status == "error",
        })
    return jsonify({"schema": "schema://frank.provider-readiness/v1", "providers": items})


def _support_projection() -> list[dict]:
    if not SUPPORT_CONVERSATIONS_FILE.exists():
        return []
    try:
        data = json.loads(SUPPORT_CONVERSATIONS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        abort(503, "support conversation state is unavailable")
    if not isinstance(data, dict) or set(data) != {"version", "conversations"} or data.get("version") != 1:
        abort(503, "support conversation state is corrupt")
    records = data.get("conversations")
    if not isinstance(records, list) or any(not isinstance(item, dict) for item in records):
        abort(503, "support conversation state is corrupt")
    allowed = {"id", "account_id", "project_id", "status", "subject", "updated_at", "external_ref", "url"}
    output = []
    for item in records:
        if set(item) - allowed or not isinstance(item.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,119}", item["id"]):
            abort(503, "support conversation state is corrupt")
        if not isinstance(item.get("status", "open"), str):
            abort(503, "support conversation state is corrupt")
        status = item.get("status", "open").lower()
        if status not in SUPPORT_CONVERSATION_STATUSES:
            abort(503, "support conversation state is corrupt")
        for field in ("account_id", "project_id", "subject", "external_ref", "url"):
            if field in item and not isinstance(item[field], str):
                abort(503, "support conversation state is corrupt")
        account_id_value = item.get("account_id", "")
        project_id_value = item.get("project_id", "main")
        if account_id_value and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", account_id_value):
            abort(503, "support conversation state is corrupt")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", project_id_value):
            abort(503, "support conversation state is corrupt")
        external_ref = item.get("external_ref", "")
        if external_ref and not EXTERNAL_REFERENCE.fullmatch(external_ref):
            abort(503, "support conversation state is corrupt")
        updated_at = item.get("updated_at")
        if updated_at is not None:
            if not isinstance(updated_at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", updated_at):
                abort(503, "support conversation state is corrupt")
            try:
                datetime.fromisoformat(updated_at[:-1] + "+00:00")
            except ValueError:
                abort(503, "support conversation state is corrupt")
        chatwoot_ready = _connector_status("CHATWOOT_CONNECTOR_STATUS") == "ready"
        chatwoot_origin = _safe_provider_url(os.environ.get("CHATWOOT_BASE_URL", ""))
        parsed = urllib.parse.urlparse(item.get("url", "")) if isinstance(item.get("url", ""), str) else None
        valid_origin = bool(parsed and _safe_provider_url(item.get("url", "")) == chatwoot_origin and not parsed.username and not parsed.password)
        url = _safe_support_url(item.get("url", "")) if chatwoot_ready and chatwoot_origin and valid_origin else ""
        output.append({
            "id": item["id"], "account_id": account_id_value,
            "project_id": project_id_value, "status": status,
            "subject": item.get("subject", ""), "updated_at": updated_at,
            "external_ref": external_ref, "url": url,
        })
    return output


@app.get("/api/support/conversations")
def support_conversations():
    account_id = str(request.args.get("account_id", "")).strip()
    if account_id and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,79}", account_id):
        abort(400, "invalid account id")
    items = _support_projection()
    if account_id:
        items = [item for item in items if item["account_id"] == account_id]
    return jsonify({"schema": "schema://frank.support-conversations/v1", "conversations": items})


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


def _hermes_model_rows(payload: dict) -> list[dict]:
    """Normalize Hermes's authoritative picker payload into browser rows.

    Live v0.21 shape: per-provider rows carry `models` (strings or dicts),
    `capabilities` ({model: {fast, reasoning}}) and an `authenticated` flag.
    Only authenticated providers are selectable; nothing is inferred.
    """
    rows: list[dict] = []
    options = payload.get("options") if isinstance(payload, dict) else None
    if isinstance(options, list):
        for entry in options:
            if isinstance(entry, dict) and entry.get("id"):
                rows.append({
                    "id": str(entry.get("id")),
                    "provider": entry.get("provider"),
                    "note": entry.get("note"),
                    "reasoning": entry.get("reasoning"),
                })
        return rows
    if not isinstance(payload, dict):
        return rows
    for row in payload.get("providers", []) or []:
        if not isinstance(row, dict) or not row.get("authenticated"):
            continue
        provider = str(row.get("slug") or row.get("id") or "")
        capabilities = row.get("capabilities") if isinstance(row.get("capabilities"), dict) else {}
        for entry in row.get("models", []) or []:
            if isinstance(entry, dict) and entry.get("id"):
                model_id = str(entry.get("id"))
                note = entry.get("note")
            elif isinstance(entry, str) and entry.strip():
                model_id = entry.strip()
                note = None
            else:
                continue
            cap = capabilities.get(model_id)
            rows.append({
                "id": model_id,
                "provider": provider,
                "note": note or row.get("name"),
                "reasoning": bool(cap.get("reasoning")) if isinstance(cap, dict) else None,
            })
    return rows


@app.get("/api/models")
def models():
    """Model truth lives in Hermes.  No Frank catalogue; failures are visible."""
    if _serve_client is None:
        abort(503, description="hermes serve bridge is not configured; model options unavailable")
    try:
        payload = _serve_client().model_options()
    except Exception as err:
        return jsonify({
            "error": {"type": "hermes.model_unavailable", "message": f"Hermes model options are unavailable: {err}"}
        }), 503
    rows = _hermes_model_rows(payload)
    if not rows:
        return jsonify({
            "error": {"type": "hermes.model_unavailable", "message": "Hermes returned no selectable models."}
        }), 503
    return jsonify({"models": rows, "profile": HERMES_PROFILE, "hermes": hermes_reachable()})


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


def _public_ad_studio_generations(value: object, run_id: str = "") -> list[dict]:
    if not isinstance(value, list):
        return []
    public = []
    for index, raw in enumerate(value[:30], 1):
        if not isinstance(raw, dict):
            continue
        comparison = raw.get("comparison") if isinstance(raw.get("comparison"), dict) else {}
        iteration = int(_number_from(raw.get("iteration"), index) or index)
        previews = []
        candidate = raw.get("candidate") if isinstance(raw.get("candidate"), dict) else {}
        for item in candidate.get("previews") if isinstance(candidate.get("previews"), list) else []:
            if not isinstance(item, dict): continue
            name = str(item.get("name") or "").strip()
            if not re.fullmatch(r"iteration-[0-9]{2}-(feed|story)\.png", name): continue
            previews.append({"name": name, "placement": str(item.get("placement") or ""), "url": f"/api/ad-studio/runs/{run_id}/artifacts/{urllib.parse.quote(name, safe='')}"})
        public.append({
            "iteration": iteration,
            "decision": str(raw.get("decision") or "revise")[:20],
            "comparison": {"score": _number_from(comparison.get("score")), "reason": _public_generation_text(comparison.get("reason"))},
            "previews": previews,
        })
    return public


def _public_ad_studio_import(value: object) -> dict:
    """Project only a verified Blockwise template destination from Hermes output."""
    if not isinstance(value, dict):
        return {}
    public = {}
    status = str(value.get("status") or "").strip().lower()
    if re.fullmatch(r"[a-z0-9_-]{1,32}", status):
        public["status"] = status

    raw_template_id = str(value.get("template_id") or "").strip()
    template_id = raw_template_id if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._~-]{0,127}", raw_template_id) else ""
    raw_url = str(value.get("template_url") or value.get("url") or "").strip()
    url_template_id = ""
    if raw_url:
        try:
            parsed = urllib.parse.urlsplit(raw_url)
            prefix = "/ad-studio/templates/"
            if (
                parsed.scheme == "https"
                and parsed.netloc == "blockwise.sale"
                and parsed.path.startswith(prefix)
                and not parsed.query
                and not parsed.fragment
            ):
                candidate = urllib.parse.unquote(parsed.path[len(prefix):])
                if "/" not in candidate and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._~-]{0,127}", candidate):
                    url_template_id = candidate
        except ValueError:
            url_template_id = ""

    if raw_url and not url_template_id:
        return public
    if template_id and url_template_id and template_id != url_template_id:
        return public
    verified_id = template_id or url_template_id
    if verified_id:
        public["template_id"] = verified_id
        public["template_url"] = (
            "https://blockwise.sale/ad-studio/templates/"
            + urllib.parse.quote(verified_id, safe="")
        )
    return public


def _public_ad_studio_review_artifact(value: object, run_id: str) -> dict:
    """Project one image artifact through Frank's authenticated artifact route."""
    raw = {"name": value} if isinstance(value, str) else value
    if not isinstance(raw, dict):
        return {}
    name = str(raw.get("name") or raw.get("artifact") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.(?:avif|gif|jpe?g|png|webp)", name, re.IGNORECASE):
        return {}
    public = {
        "name": name,
        "url": f"/api/ad-studio/runs/{run_id}/artifacts/{urllib.parse.quote(name, safe='')}",
    }
    for key in ("kind", "label", "placement", "view"):
        cleaned = _public_generation_text(raw.get(key))
        if cleaned:
            public[key] = cleaned[:80]
    return public


def _public_ad_studio_review_artifacts(value: object, run_id: str) -> list[dict]:
    raw_values = value if isinstance(value, list) else list(value.values()) if isinstance(value, dict) else [value]
    projected = []
    for raw in raw_values[:24]:
        artifact = _public_ad_studio_review_artifact(raw, run_id)
        if artifact and artifact["name"] not in {item["name"] for item in projected}:
            projected.append(artifact)
    return projected


def _public_ad_studio_review_scores(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    public = {}
    for key, raw in list(value.items())[:24]:
        safe_key = str(key or "").strip().lower().replace(" ", "_")
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", safe_key):
            continue
        number = _number_from(raw)
        if number is not None:
            public[safe_key] = number
            continue
        if safe_key != "reviewers" or not isinstance(raw, list):
            continue
        reviewers = []
        for index, item in enumerate(raw[:4], 1):
            if not isinstance(item, dict):
                continue
            score = _number_from(item.get("score"), item.get("overall"), item.get("likeness"))
            reviewer = {
                "label": _public_generation_text(item.get("label") or f"Reviewer {index}")[:80],
                "decision": _public_generation_text(item.get("decision"))[:40],
            }
            if score is not None:
                reviewer["score"] = score
            if reviewer["label"] or reviewer["decision"] or "score" in reviewer:
                reviewers.append(reviewer)
        if reviewers:
            public["reviewers"] = reviewers
    return public


def _public_ad_studio_review_warnings(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    public = []
    for raw in value[:24]:
        item = raw if isinstance(raw, dict) else {"message": raw}
        message = _public_generation_text(item.get("message") or item.get("detail") or item.get("warning"))
        if not message:
            continue
        warning = {"message": message}
        for key in ("code", "placement"):
            cleaned = _public_generation_text(item.get(key))
            if cleaned:
                warning[key] = cleaned[:80]
        public.append(warning)
    return public


def _public_ad_studio_font_substitution(value: object) -> list[dict]:
    raw_values = value if isinstance(value, list) else [value]
    public = []
    for raw in raw_values[:12]:
        item = raw if isinstance(raw, dict) else {"replacement": raw}
        substitution = {}
        for key in ("source", "replacement", "reason"):
            cleaned = _public_generation_text(item.get(key))
            if cleaned:
                substitution[key] = cleaned[:160]
        if substitution:
            public.append(substitution)
    return public


def _public_ad_studio_smoke_test(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    status = str(value.get("status") or "").strip().lower()
    passed = value.get("passed") if isinstance(value.get("passed"), bool) else status in {"passed", "pass", "complete", "completed"}
    checks = []
    for raw in value.get("checks") if isinstance(value.get("checks"), list) else []:
        item = raw if isinstance(raw, dict) else {"label": raw}
        label = _public_generation_text(item.get("label") or item.get("name") or item.get("message"))
        if not label:
            continue
        check = {"label": label[:160]}
        if isinstance(item.get("passed"), bool):
            check["passed"] = item["passed"]
        checks.append(check)
    return {
        "status": status[:32] if re.fullmatch(r"[a-z0-9_-]{1,32}", status) else "passed" if passed else "pending",
        "passed": passed,
        "checks": checks[:20],
    }


def _public_ad_studio_layers(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    public = []
    for index, raw in enumerate(value[:240], 1):
        if not isinstance(raw, dict):
            continue
        layer = {}
        for key in ("id", "name", "type", "role", "placement"):
            cleaned = _public_generation_text(raw.get(key))
            if cleaned:
                layer[key] = cleaned[:100]
        if isinstance(raw.get("editable"), bool):
            layer["editable"] = raw["editable"]
        if layer:
            layer.setdefault("name", f"Layer {index}")
            public.append(layer)
    return public


def _public_ad_studio_review_model_profile(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    roles = []
    for raw in value.get("roles") if isinstance(value.get("roles"), list) else []:
        if not isinstance(raw, dict):
            continue
        role = {}
        for key in ("role", "label", "provider", "model"):
            cleaned = str(raw.get(key) or "").strip()
            if cleaned and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._+:/-]{0,119}", cleaned):
                role[key] = cleaned
        if role.get("model") and role.get("provider"):
            roles.append(role)
    public = {"roles": roles[:12]} if roles else {}
    source = _public_generation_text(value.get("source"))
    if source:
        public["source"] = source[:120]
    revision = value.get("revision")
    if isinstance(revision, int) and not isinstance(revision, bool) and 0 <= revision <= 1_000_000:
        public["revision"] = revision
    if isinstance(value.get("immutable"), bool):
        public["immutable"] = value["immutable"]
    return public


def _public_ad_studio_review_summary(value: object, run_id: str) -> dict:
    """Expose the bounded evidence Hermes has declared ready for operator review."""
    if not isinstance(value, dict):
        return {}
    public = {}
    source = _public_ad_studio_review_artifact(value.get("source"), run_id)
    if source:
        public["source"] = source
    for key in ("references", "previews", "diffs"):
        artifacts = _public_ad_studio_review_artifacts(value.get(key), run_id)
        if artifacts:
            public[key] = artifacts
    scores = _public_ad_studio_review_scores(value.get("scores"))
    if scores:
        public["scores"] = scores
    warnings = _public_ad_studio_review_warnings(value.get("warnings"))
    if warnings:
        public["warnings"] = warnings
    substitutions = _public_ad_studio_font_substitution(value.get("font_substitution"))
    if substitutions:
        public["font_substitution"] = substitutions
    for key in ("elapsed_seconds", "cost_usd"):
        number = _number_from(value.get(key))
        if number is not None and number >= 0:
            public[key] = number
    iterations = value.get("iterations")
    if isinstance(iterations, int) and not isinstance(iterations, bool) and 0 <= iterations <= 10_000:
        public["iterations"] = iterations
    smoke_test = _public_ad_studio_smoke_test(value.get("smoke_test"))
    if smoke_test:
        public["smoke_test"] = smoke_test
    layers = _public_ad_studio_layers(value.get("layers"))
    if layers:
        public["layers"] = layers
    model_profile = _public_ad_studio_review_model_profile(value.get("model_profile"))
    if model_profile:
        public["model_profile"] = model_profile
    return public


def _exact_clone_review_summary(output: dict, model_profile: dict) -> dict:
    """Adapt Hermes' sole exact-clone root output to Frank's review view."""
    if output.get("process") != "exact-clone":
        return {}
    references = output.get("references") if isinstance(output.get("references"), list) else []
    source_placement = next((
        str(item.get("sourcePlacement") or "").lower()
        for item in references if isinstance(item, dict) and item.get("sourcePlacement") in {"feed", "story"}
    ), "")
    reciprocal = next((
        item for item in references
        if isinstance(item, dict) and item.get("kind") == "reciprocal-image-reference"
    ), None)
    if not source_placement and isinstance(reciprocal, dict):
        source_placement = "story" if reciprocal.get("placement") == "feed" else "feed"

    raw_source = output.get("source")
    source_name = str(raw_source.get("name") if isinstance(raw_source, dict) else raw_source or "").strip()
    summary = {
        "source": {"name": source_name, "kind": "original-source", "placement": source_placement},
        "references": references,
        "previews": [],
        "diffs": output.get("diffs"),
        "warnings": output.get("warnings"),
        "font_substitution": output.get("font_substitution"),
        "smoke_test": output.get("smoke_test"),
        "model_profile": model_profile,
    }
    iterations = output.get("iterations") if isinstance(output.get("iterations"), list) else []
    accepted = next((
        item for item in reversed(iterations)
        if isinstance(item, dict) and str(item.get("decision") or "").lower() in {"accept", "accepted", "pass", "passed"}
    ), {})
    for name in accepted.get("previews") if isinstance(accepted.get("previews"), list) else []:
        match = re.fullmatch(r"iteration-[0-9]{2}-(feed|story)\.png", str(name or ""))
        if match:
            summary["previews"].append({"name": name, "placement": match.group(1), "kind": "qa-source-filled"})
    for item in output.get("previews") if isinstance(output.get("previews"), list) else []:
        if isinstance(item, dict):
            summary["previews"].append(item)

    comparator = (output.get("scores") or {}).get("comparator") if isinstance(output.get("scores"), dict) else {}
    if not isinstance(comparator, dict):
        comparator = accepted.get("scores") if isinstance(accepted.get("scores"), dict) else {}
    def normalized(value):
        number = _number_from(value)
        return round(number * 10, 4) if number is not None and 0 <= number <= 1 else number
    scores = {"overall": normalized(comparator.get("overall"))}
    reviewers = []
    final = output.get("final_review") if isinstance(output.get("final_review"), dict) else {}
    for index, item in enumerate(final.get("reviewers") if isinstance(final.get("reviewers"), list) else [], 1):
        if not isinstance(item, dict):
            continue
        item_scores = item.get("scores") if isinstance(item.get("scores"), dict) else {}
        reviewers.append({
            "label": f"Final reviewer {index}",
            "decision": "pass" if str(item.get("decision") or "").lower() in {"accept", "accepted", "pass", "passed"} else str(item.get("decision") or ""),
            "score": normalized(item_scores.get("overall")),
        })
    scores["reviewers"] = reviewers
    summary["scores"] = scores
    summary["iterations"] = len(iterations)
    summary["elapsed_seconds"] = output.get("elapsed_seconds")

    layers = output.get("layers") if isinstance(output.get("layers"), dict) else {}
    summary["layers"] = [
        {
            "id": str(layer.get("layerId") or ""),
            "name": str(layer.get("inputKey") or layer.get("layerId") or "Layer"),
            "type": str(layer.get("type") or "unknown"),
            "placement": placement,
            "editable": bool(layer.get("inputKey")),
        }
        for placement in ("feed", "story")
        for layer in ((layers.get(placement) or {}).get("ordered") or [])
        if isinstance(layer, dict)
    ]
    return summary


def _ad_studio_source_url(run_id: str, name: str) -> str | None:
    suffix = Path(str(name or "")).suffix.lower()
    if suffix not in {".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}:
        return None
    artifact = f"source{suffix}"
    return f"/api/ad-studio/runs/{run_id}/artifacts/{urllib.parse.quote(artifact, safe='')}"


_AD_STUDIO_MODEL_ROLES = MappingProxyType({
    "builder": "analyse",
    "comparator": "compare",
    "final_review_a": "final-review-a",
    "final_review_b": "final-review-b",
    "quality_fallback": "quality-escalation",
})
_AD_STUDIO_REQUIRED_MODEL_STAGES = frozenset({
    "analyse", "compare", "final-review-a", "final-review-b",
})
_AD_STUDIO_OPTIONAL_MODEL_STAGES = frozenset({"quality-escalation"})


def _public_ad_studio_candidate(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    provider = str(value.get("provider") or "").strip()
    model = str(value.get("model") or "").strip()
    capabilities = value.get("capabilities") if isinstance(value.get("capabilities"), list) else []
    capabilities = [str(item) for item in capabilities if isinstance(item, str) and len(item) <= 80]
    if not provider or not model or len(provider) > 80 or len(model) > 200:
        return {}
    return {
        "provider": provider,
        "model": model,
        "capability_verified": value.get("capability_verified") is True,
        "capabilities": capabilities,
        "supports_vision": value.get("supports_vision") is True,
        "supports_tools": value.get("supports_tools") is True,
    }


def _public_ad_studio_policy(value: object) -> dict:
    """Expose only the non-secret Hermes model policy fields needed for one run."""
    if not isinstance(value, dict):
        return {}
    stages = value.get("stages") if isinstance(value.get("stages"), dict) else {}
    public_stages = {}
    for stage_id in (*_AD_STUDIO_REQUIRED_MODEL_STAGES, *_AD_STUDIO_OPTIONAL_MODEL_STAGES):
        stage = stages.get(stage_id)
        if not isinstance(stage, dict):
            continue
        primary = _public_ad_studio_candidate(stage.get("primary"))
        if not primary:
            continue
        public_stages[stage_id] = {
            "capability": str(stage.get("capability") or ""),
            "primary": primary,
            "fallbacks": [],
            "max_attempts": stage.get("max_attempts"),
            "timeout_seconds": stage.get("timeout_seconds"),
            "max_cost_usd": stage.get("max_cost_usd"),
        }
    result = {
        "schema": str(value.get("schema") or ""),
        "tool_id": str(value.get("tool_id") or ""),
        "name": str(value.get("name") or "")[:160],
        "preset": str(value.get("preset") or "")[:80],
        "stages": public_stages,
        "deterministic_stages": [
            str(item) for item in value.get("deterministic_stages", [])
            if isinstance(item, str) and len(item) <= 80
        ],
    }
    if isinstance(value.get("seed_revision"), int):
        result["seed_revision"] = value["seed_revision"]
    return result


def _ad_studio_model_catalogue(project_id: str = "") -> dict:
    """Read Hermes-owned capabilities and its current Ad Studio policy."""
    model_data = hermes_request("/v1/tool-runs/models", timeout=8)
    raw_models = model_data.get("ad_studio_capabilities") if isinstance(model_data, dict) else []
    models = []
    for raw in raw_models if isinstance(raw_models, list) else []:
        candidate = _public_ad_studio_candidate(raw)
        if not candidate or "vision_structured" not in candidate["capabilities"]:
            continue
        candidate.update({
            "available": raw.get("available") is True,
            "credential_ready": raw.get("credential_ready") is True,
        })
        models.append(candidate)
    query = urllib.parse.urlencode({"project_id": project_id}) if project_id else ""
    path = "/v1/tool-runs/policies/ad-template-generator" + (f"?{query}" if query else "")
    policy_data = hermes_request(path, timeout=8)
    records = policy_data.get("data") if isinstance(policy_data, dict) else []
    records = [item for item in records if isinstance(item, dict)] if isinstance(records, list) else []
    record = next((item for item in records if item.get("is_default") is True), records[0] if records else {})
    policy = _public_ad_studio_policy(record.get("policy"))
    return {
        "models": models,
        "policy_schema": str(model_data.get("policy_schema") or "") if isinstance(model_data, dict) else "",
        "policy_revision": record.get("revision") if isinstance(record.get("revision"), int) else None,
        "policy": policy,
    }


def _validated_ad_studio_model_policy(value: object, *, project_id: str) -> dict:
    """Fail visibly unless every selected route is currently verified by Hermes."""
    policy = _public_ad_studio_policy(value)
    stages = policy.get("stages") if isinstance(policy.get("stages"), dict) else {}
    if (
        policy.get("schema") != "schema://hermes.tool-model-policy/v1"
        or policy.get("tool_id") != "ad-template-generator"
        or not _AD_STUDIO_REQUIRED_MODEL_STAGES.issubset(stages)
        or set(stages) - (_AD_STUDIO_REQUIRED_MODEL_STAGES | _AD_STUDIO_OPTIONAL_MODEL_STAGES)
    ):
        raise _AdStudioSourceError("invalid_model_policy", "Choose a valid Ad Studio model setup.")
    catalogue = _ad_studio_model_catalogue(project_id)
    available = {
        (item["provider"], item["model"]): item
        for item in catalogue["models"]
        if item.get("available") and item.get("credential_ready")
        and item.get("supports_vision") and item.get("supports_tools")
        and "vision_structured" in item.get("capabilities", [])
    }
    for stage_id, stage in stages.items():
        primary = stage.get("primary") if isinstance(stage, dict) else {}
        route = (primary.get("provider"), primary.get("model")) if isinstance(primary, dict) else (None, None)
        verified = available.get(route)
        if not verified:
            label = stage_id.replace("-", " ")
            raise _AdStudioSourceError(
                "model_unavailable",
                f"The selected {label} model is not currently available with verified vision and structured output in Hermes.",
            )
        # Candidate capabilities come from the live Hermes catalogue, never
        # from browser claims or provider-specific logic in Frank.
        stage["primary"] = {
            "provider": verified["provider"],
            "model": verified["model"],
            "capability_verified": True,
            "capabilities": ["vision_structured"],
            "supports_vision": True,
            "supports_tools": True,
        }
    return policy


@app.get("/api/ad-studio/models")
def ad_studio_models():
    project_id = _clean_project_id(request.args.get("project_id")) if request.args.get("project_id") else ""
    try:
        data = _ad_studio_model_catalogue(project_id)
    except Exception as error:
        return _hermes_error(error)
    if not data["models"] or not data["policy"]:
        return jsonify({"error": "Hermes has no verified Ad Studio model setup available."}), 503
    return jsonify(data)
def _public_ad_studio_model_profile(run: dict) -> dict:
    """Expose only the immutable provider/model choices frozen for this run."""
    policy = run.get("model_policy") if isinstance(run.get("model_policy"), dict) else {}
    stages = policy.get("stages") if isinstance(policy.get("stages"), dict) else {}
    role_specs = (
        ("builder", "Builder & analysis", ("analyse", "build")),
        ("comparator", "Comparator", ("compare",)),
        ("quality-escalation", "Quality escalation", ("quality-escalation",)),
        ("final-review-a", "Final review A", ("final-review-a",)),
        ("final-review-b", "Final review B", ("final-review-b",)),
    )
    roles = []
    for role, label, stage_names in role_specs:
        stage = next((stages.get(name) for name in stage_names if isinstance(stages.get(name), dict)), {})
        primary = stage.get("primary") if isinstance(stage.get("primary"), dict) else {}
        provider = str(primary.get("provider") or "").strip()
        model = str(primary.get("model") or "").strip()
        if not (
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,119}", provider)
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,119}", model)
        ):
            continue
        roles.append({"role": role, "label": label, "provider": provider, "model": model})
    revision = run.get("model_policy_revision")
    return {
        "source": "Hermes frozen run policy",
        "immutable": True,
        "roles": roles,
        **({"revision": int(revision)} if isinstance(revision, int) and not isinstance(revision, bool) else {}),
    } if roles else {}


def _exact_clone_event_layers(value: object) -> list[dict]:
    """Project only layer metadata explicitly recorded in durable evidence."""
    if isinstance(value, list):
        return _public_ad_studio_layers(value)
    if not isinstance(value, dict):
        return []
    layers = []
    for placement in ("feed", "story"):
        placement_value = value.get(placement)
        ordered = placement_value.get("ordered") if isinstance(placement_value, dict) else None
        for raw in ordered if isinstance(ordered, list) else []:
            if not isinstance(raw, dict):
                continue
            layers.append({
                "id": str(raw.get("layerId") or ""),
                "name": str(raw.get("inputKey") or raw.get("layerId") or "Layer"),
                "type": str(raw.get("type") or "unknown"),
                "placement": placement,
                "editable": bool(raw.get("inputKey")),
            })
    return _public_ad_studio_layers(layers)


def _exact_clone_event_model_profile(events: list[dict]) -> dict:
    """Adapt the immutable profile snapshot recorded with command.accepted."""
    snapshot = {}
    for event in events:
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        candidate = data.get("model_profile")
        if event.get("kind") == "command.accepted" and isinstance(candidate, dict):
            snapshot = candidate
    role_specs = (
        ("builder", "Builder & analysis"),
        ("comparator", "Comparator"),
        ("fallback", "Quality escalation"),
        ("final-review-a", "Final review A"),
        ("final-review-b", "Final review B"),
    )
    roles = []
    for role, label in role_specs:
        raw = snapshot.get(role)
        if not isinstance(raw, dict):
            continue
        provider = str(raw.get("provider") or "").strip()
        model = str(raw.get("model") or "").strip()
        if not (
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,119}", provider)
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,119}", model)
        ):
            continue
        roles.append({"role": role, "label": label, "provider": provider, "model": model})
    revision = snapshot.get("profile_revision")
    return {
        "source": "Hermes durable run event", "immutable": True, "roles": roles,
        **({"revision": revision} if isinstance(revision, int) and not isinstance(revision, bool) else {}),
    } if roles else {}


def _exact_clone_event_output(run: dict, events: object, model_profile: dict) -> dict:
    """Recover a bounded monitor view from already-durable exact-clone events."""
    if not isinstance(events, list):
        return {}
    ordered = [item for item in events[:1000] if isinstance(item, dict)]
    ordered.sort(key=lambda item: item.get("sequence") if isinstance(item.get("sequence"), int) else -1)
    process_kinds = {
        "source-map.completed", "aspect-reference-image.started",
        "aspect-reference-image.completed", "aspect-reference.started",
        "aspect-reference.completed", "iteration.rendered", "iteration.compared",
        "final-review.started", "final-review.completed",
    }
    if not any(str(item.get("kind") or "") in process_kinds for item in ordered):
        return {}

    source_placement = target_placement = ""
    reference_available = False
    source_available = False
    iteration_records = {}
    latest_previews = []
    latest_diffs = []
    latest_scores = {}
    latest_reviewers = []
    layers = []

    def score(value: object) -> int | float | None:
        number = _number_from(value)
        return round(number * 10, 4) if number is not None and 0 <= number <= 1 else number

    for event in ordered:
        kind = str(event.get("kind") or "")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        if kind.startswith("aspect-reference"):
            for key, destination in (("source_placement", "source"), ("target_placement", "target")):
                placement = str(data.get(key) or "").lower()
                if placement in {"feed", "story"}:
                    if destination == "source":
                        source_placement = placement
                    else:
                        target_placement = placement
        if kind == "source-map.completed":
            source_available = True
        # Emitted only after the reciprocal image is in the public preview root.
        if kind in {"aspect-reference.started", "aspect-reference.completed"}:
            reference_available = True
        event_layers = _exact_clone_event_layers(data.get("layers")) if kind in process_kinds else []
        if event_layers:
            layers = event_layers
        if kind == "final-review.completed":
            reviewers = []
            for index, raw in enumerate(data.get("reviewers") if isinstance(data.get("reviewers"), list) else [], 1):
                if not isinstance(raw, dict):
                    continue
                raw_scores = raw.get("scores") if isinstance(raw.get("scores"), dict) else {}
                reviewer_score = score(raw_scores.get("overall"))
                reviewer = {
                    "label": f"Final reviewer {index}",
                    "decision": "pass" if str(raw.get("decision") or "").lower() in {"accept", "accepted", "pass", "passed"} else str(raw.get("decision") or "")[:40],
                }
                if reviewer_score is not None:
                    reviewer["score"] = reviewer_score
                reviewers.append(reviewer)
            if reviewers:
                latest_reviewers = reviewers
            continue
        if kind not in {"iteration.rendered", "iteration.compared"}:
            continue

        iteration = data.get("iteration")
        if not isinstance(iteration, int) or isinstance(iteration, bool) or not 1 <= iteration <= 10_000:
            continue
        record = iteration_records.setdefault(iteration, {
            "iteration": iteration, "decision": "revise", "comparison": {}, "previews": [],
        })
        if kind == "iteration.rendered":
            previews = []
            for raw_name in data.get("previews") if isinstance(data.get("previews"), list) else []:
                name = str(raw_name.get("name") if isinstance(raw_name, dict) else raw_name or "").strip()
                match = re.fullmatch(r"iteration-[0-9]{2}-(feed|story)\.png", name, re.IGNORECASE)
                if not match:
                    continue
                artifact = _public_ad_studio_review_artifact({
                    "name": name, "placement": match.group(1).lower(), "kind": "qa-source-filled",
                }, str(run.get("id") or run.get("run_id") or ""))
                if artifact:
                    previews.append(artifact)
            diffs = []
            for raw_name in data.get("diffs") if isinstance(data.get("diffs"), list) else []:
                name = str(raw_name.get("name") if isinstance(raw_name, dict) else raw_name or "").strip()
                match = re.fullmatch(
                    r"iteration-[0-9]{2}-(feed|story)-(overlay|difference)\.png", name, re.IGNORECASE,
                )
                if not match:
                    continue
                artifact = _public_ad_studio_review_artifact({
                    "name": name, "placement": match.group(1).lower(), "kind": match.group(2).lower(),
                    "view": match.group(2).lower(),
                }, str(run.get("id") or run.get("run_id") or ""))
                if artifact:
                    diffs.append(artifact)
            if previews:
                record["previews"] = previews
            if previews or diffs:
                latest_previews = previews
                latest_diffs = diffs
        elif kind == "iteration.compared":
            raw_scores = data.get("scores") if isinstance(data.get("scores"), dict) else {}
            comparison_scores = {}
            for key, value in list(raw_scores.items())[:24]:
                normalized = score(value)
                if normalized is not None:
                    comparison_scores[str(key)] = normalized
            overall = score(data.get("score"))
            if overall is not None:
                comparison_scores["overall"] = overall
            if comparison_scores:
                latest_scores = comparison_scores
                record["comparison"] = {"score": comparison_scores.get("overall")}
            decision = str(data.get("decision") or "").lower()
            if decision in {"accept", "accepted", "pass", "passed"}:
                record["decision"] = "accepted"

    run_id = str(run.get("id") or run.get("run_id") or "")
    summary = {"previews": latest_previews, "diffs": latest_diffs}
    source_values = (run.get("payload") or {}).get("sources") if isinstance(run.get("payload"), dict) else []
    source_item = source_values[0] if isinstance(source_values, list) and source_values and isinstance(source_values[0], dict) else {}
    source_url = _ad_studio_source_url(run_id, str(source_item.get("name") or "")) if source_available else None
    if source_url:
        summary["source"] = {
            "name": urllib.parse.unquote(source_url.rsplit("/", 1)[-1]), "kind": "original-source",
            **({"placement": source_placement} if source_placement else {}),
        }
    if reference_available and target_placement:
        summary["references"] = [{
            "name": f"reference-{target_placement}.png", "placement": target_placement,
            "kind": "reciprocal-image-reference",
        }]
    if latest_scores or latest_reviewers:
        summary["scores"] = {**latest_scores, **({"reviewers": latest_reviewers} if latest_reviewers else {})}
    profile = model_profile or _exact_clone_event_model_profile(ordered)
    if profile:
        summary["model_profile"] = profile
    if layers:
        summary["layers"] = layers
    iterations = [iteration_records[key] for key in sorted(iteration_records)[-30:]]
    if iterations:
        summary["iterations"] = len(iterations)
    public_summary = _public_ad_studio_review_summary(summary, run_id)
    return {
        "process": "exact-clone",
        **({"review_summary": public_summary} if public_summary else {}),
        **({"previews": latest_previews} if latest_previews else {}),
        **({"iterations": iterations} if iterations else {}),
    }


def _read_ad_studio_run_events(run_id: str) -> list[dict]:
    """Read the current durable SSE backlog with strict time/size bounds."""
    if not AD_STUDIO_RUN_ID.fullmatch(run_id):
        return []
    url = hermes_base() + _tool_run_path(run_id, "/events") + "?" + urllib.parse.urlencode({"after": -1})
    headers = {"Accept": "text/event-stream"}
    if HERMES_KEY:
        headers["Authorization"] = f"Bearer {HERMES_KEY}"
    events = []
    total = 0
    data_lines = []
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=0.75) as response:
            while total < 1_000_000 and len(events) < 1000:
                line = response.readline(min(65_537, 1_000_001 - total))
                if not line:
                    break
                total += len(line)
                if len(line) > 65_536:
                    data_lines = []
                    continue
                text = line.decode("utf-8", errors="replace").rstrip("\r\n")
                if text.startswith("data:"):
                    data_lines.append(text[5:].lstrip())
                elif not text and data_lines:
                    try:
                        event = json.loads("\n".join(data_lines))
                    except (json.JSONDecodeError, ValueError):
                        event = None
                    if isinstance(event, dict):
                        events.append(event)
                    data_lines = []
    except (OSError, TimeoutError, urllib.error.URLError):
        pass
    return events


def _public_ad_studio_final_review(value: object) -> dict:
    """Project only the bounded reviewer evidence the monitor renders."""
    if not isinstance(value, dict):
        return {}
    reviewers = []
    raw_reviewers = value.get("reviewers") if isinstance(value.get("reviewers"), list) else []
    for item in raw_reviewers[:8]:
        if not isinstance(item, dict):
            continue
        reviewer = {"decision": str(item.get("decision") or "")[:40]}
        scores = item.get("scores") if isinstance(item.get("scores"), dict) else {}
        score = _number_from(scores.get("overall"))
        if score is not None:
            reviewer["score"] = score
        reviewers.append(reviewer)
    decision = str(value.get("decision") or "")[:40]
    return {"decision": decision, "reviewers": reviewers} if reviewers or decision else {}


def _public_ad_studio_run(run: dict, *, title: str = "", project_id: str = "", events: object = None) -> dict:
    """Project Hermes state for Frank's internal operator monitor."""
    now = int(time.time())
    payload = run.get("payload") if isinstance(run.get("payload"), dict) else {}
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    source = sources[0] if sources and isinstance(sources[0], dict) else {}
    output = run.get("output") if isinstance(run.get("output"), dict) else {}
    scope = run.get("scope") if isinstance(run.get("scope"), dict) else {}
    run_id = str(run.get("id") or run.get("run_id") or "")
    model_profile = _public_ad_studio_model_profile(run)
    if not model_profile and isinstance(events, list):
        model_profile = _exact_clone_event_model_profile(events[:1000])
    safe_output = {key: output.get(key) for key in (
        "iterations", "process",
    ) if key in output}
    public_final_review = _public_ad_studio_final_review(output.get("final_review"))
    if public_final_review:
        safe_output["final_review"] = public_final_review
    review_value = output.get("review_summary") if isinstance(output.get("review_summary"), dict) else _exact_clone_review_summary(output, model_profile)
    review_summary = _public_ad_studio_review_summary(review_value, run_id)
    if review_summary:
        safe_output["review_summary"] = review_summary
    public_import = _public_ad_studio_import(output.get("import"))
    if public_import:
        safe_output["import"] = public_import
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
        safe_output["iterations"] = _public_ad_studio_generations(output.get("iterations"), str(run.get("run_id") or run.get("id") or ""))
    if str(run.get("status") or "") not in {"ready_for_review", "completed", "approved"}:
        event_output = _exact_clone_event_output(run, events, model_profile)
        for key, value in event_output.items():
            if key not in safe_output or not safe_output[key]:
                safe_output[key] = value
    source_public = {
        "name": str(source.get("name") or ""),
        "size": int(source.get("size") or 0),
        "media_type": str(source.get("media_type") or ""),
        "origin": str(source.get("origin") or ""),
    }
    source_url = _ad_studio_source_url(run_id, source_public["name"])
    if source_url:
        source_public["url"] = source_url
    raw_usage = output.get("usage") if isinstance(output.get("usage"), dict) else {}
    raw_cost = output.get("cost") if isinstance(output.get("cost"), dict) else {}
    usage = {}
    for key in ("input_tokens", "output_tokens", "total_tokens", "estimated_cost_usd"):
        number = _number_from(raw_usage.get(key))
        if number is not None and number >= 0:
            usage[key] = number
    reported_cost = _number_from(raw_cost.get("reported_usd"), raw_usage.get("reported_cost_usd"))
    if reported_cost is not None and reported_cost >= 0:
        usage["reported_cost_usd"] = reported_cost
    providers = {str(role.get("provider") or "") for role in model_profile.get("roles", [])}
    usage.update({
        "source": "Hermes run ledger",
        "status": "reported" if any(key in usage for key in ("input_tokens", "output_tokens", "total_tokens", "estimated_cost_usd", "reported_cost_usd")) else "not_reported",
        "billing": "ChatGPT/Codex OAuth — not OpenAI API dashboard" if providers == {"openai-codex"} else "Provider account",
    })
    return {
        "id": run_id,
        "request_id": str(run.get("request_id") or ""),
        "status": str(run.get("status") or "queued"),
        "stage": str(run.get("stage") or "source"),
        "progress": float(run.get("progress") or 0),
        "attention": bool(run.get("attention")),
        "created_at": run.get("created_at") or now,
        "updated_at": run.get("updated_at") or run.get("created_at") or now,
        "source": source_public,
        "output": safe_output,
        "cost": reported_cost,
        "usage": usage,
        "model_profile": model_profile,
        "title": title or str(run.get("title") or payload.get("job_name") or "Ad template"),
        "project_id": project_id or str(scope.get("project_id") or payload.get("project_id") or ""),
        "model_policy_revision": run.get("model_policy_revision"),
        **({"error": str(run.get("error"))[:1200]} if run.get("error") else {}),
    }


@app.get("/api/ad-studio/architecture")
def ad_studio_architecture():
    validated = _archify_build_validated()
    return jsonify({
        "available": validated, "source": "archify",
        "read_only": True, "validated": validated,
        "artifact_url": "/api/ad-studio/architecture/artifact" if validated else None,
        "message": "Archify build validation or its content binding is unavailable." if not validated else "Archify typed-IR artifact is validated and available.",
    })


def _archify_build_validated() -> bool:
    files = {
        "artifactSha256": ARCHIFY_ARTIFACT,
        "specSha256": ARCHIFY_SPEC,
        "validatorSha256": ARCHIFY_CLI,
    }
    try:
        receipt = json.loads(ARCHIFY_RECEIPT.read_text(encoding="utf-8"))
        if receipt.get("schema") != "frank.archify-build-validation.v1" or receipt.get("validated") is not True:
            return False
        for key, path in files.items():
            if not path.is_file():
                return False
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if not secrets.compare_digest(str(receipt.get(key) or ""), actual):
                return False
        return True
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False


@app.get("/api/ad-studio/architecture/artifact")
def ad_studio_architecture_artifact():
    if not _archify_build_validated():
        abort(404, "Archify artifact is not available")
    return send_file(ARCHIFY_ARTIFACT, mimetype="text/html", max_age=0)


@app.get("/api/ad-studio/implementation-activity")
def ad_studio_implementation_activity():
    # AgentTrail shares only Frank's loopback namespace. Frank proxies one read
    # endpoint and never exposes AgentTrail's hook/setup/control surfaces.
    if not AGENTTRAIL_URL:
        return jsonify({"available": False, "source": "agenttrail", "read_only": True, "message": "AgentTrail observer is not configured for this deployment."}), 503
    try:
        req = urllib.request.Request(f"{AGENTTRAIL_URL}/summary", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=2) as response:
            board = json.loads(response.read(2 * 1024 * 1024 + 1).decode("utf-8"))
    except Exception:
        return jsonify({"available": False, "source": "agenttrail", "read_only": True, "message": "AgentTrail read-only observer is unavailable."}), 503
    if not isinstance(board, (dict, list)):
        return jsonify({"available": False, "source": "agenttrail", "read_only": True, "message": "AgentTrail returned an unsupported board shape."}), 503
    return jsonify({"available": True, "source": "agenttrail", "read_only": True, "board": board})


# AgentTrail remains the Live authority.  The board is proxied through the
# authenticated Window origin so its native fleet/repository selectors keep
# working without making the observer port public.  Mutation paths are denied
# before prefix stripping; this is intentionally an edge boundary, not an
# AgentTrail replacement or a second control surface.
_AGENTTRAIL_READ_PATHS = {"", "/", "/world", "/suggest", "/tree-of", "/summary", "/fleet", "/model", "/events"}
_AGENTTRAIL_MUTATION_PATHS = {"/setup", "/setup-board", "/spawn", "/hook", "/nudge"}


@app.route("/agenttrail", defaults={"agenttrail_path": ""}, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
@app.route("/agenttrail/", defaults={"agenttrail_path": ""}, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
@app.route("/agenttrail/<path:agenttrail_path>", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def agenttrail_proxy(agenttrail_path: str):
    path = "/" + str(agenttrail_path or "").strip("/")
    if request.method not in {"GET", "HEAD"} or path in _AGENTTRAIL_MUTATION_PATHS:
        abort(403, description="AgentTrail mutation routes are not available through Frank")
    if path not in _AGENTTRAIL_READ_PATHS:
        abort(404)
    if not AGENTTRAIL_URL:
        abort(503, description="AgentTrail observer is not configured")
    target = f"{AGENTTRAIL_URL}{path}"
    if request.query_string:
        target += "?" + request.query_string.decode("latin-1")
    try:
        upstream = urllib.request.urlopen(urllib.request.Request(target, headers={"Accept": request.headers.get("Accept", "*/*")} ), timeout=5)
    except urllib.error.HTTPError as error:
        return Response(error.read(64 * 1024), status=error.code, mimetype="text/plain")
    except (OSError, urllib.error.URLError):
        abort(503, description="AgentTrail observer is unavailable")
    content_type = upstream.headers.get("Content-Type", "text/plain").split(";", 1)[0]
    if request.method == "HEAD":
        upstream.close()
        return Response(status=200, content_type=content_type)
    if path == "/events":
        def _events():
            try:
                while True:
                    # ``HTTPResponse.read(n)`` may wait until it has collected
                    # n bytes.  SSE emits tiny frames and keeps the connection
                    # open, so that turns a healthy stream into a timeout (and
                    # leaves the browser stuck on its connecting placeholder).
                    # ``read1`` returns as soon as one buffered frame is
                    # available while retaining the bounded read size.
                    reader = getattr(upstream, "read1", None) or upstream.read
                    chunk = reader(64 * 1024)
                    if not chunk:
                        break
                    yield chunk
            except (OSError, TimeoutError, urllib.error.URLError):
                # A disconnected observer is equivalent to the stream ending;
                # the browser's EventSource will reconnect on its own.
                return
            finally:
                upstream.close()
        return Response(stream_with_context(_events()), content_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
    body = upstream.read(4 * 1024 * 1024 + 1)
    upstream.close()
    if len(body) > 4 * 1024 * 1024:
        abort(502, description="AgentTrail response exceeded the Window bound")
    if path in {"/", ""} and content_type == "text/html":
        text_body = body.decode("utf-8", errors="replace")
        # Keep the pinned board same-origin regardless of quote style used by
        # its bundled JavaScript.  Restrict this to root-relative observer
        # calls; external URLs and mutation routes are never rewritten into a
        # more privileged path.
        text_body = re.sub(r"(fetch\(\s*[\"'])/(?!agenttrail/)", r"\1/agenttrail/", text_body)
        text_body = re.sub(r"(EventSource\(\s*[\"'])/(?!agenttrail/)", r"\1/agenttrail/", text_body)
        body = text_body.encode("utf-8")
    return Response(body, status=200, content_type=content_type, headers={"Cache-Control": "no-store"})


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


_AD_STUDIO_IMAGE_EXTENSIONS = MappingProxyType({
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
})


class _AdStudioSourceError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class _AdStudioBriefError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def _ad_studio_brief(raw: object) -> str:
    """Validate without rewriting the immutable UTF-8 generator brief."""
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise _AdStudioBriefError("brief_invalid", "The generator brief must be text.")
    if len(raw) > AD_STUDIO_MAX_BRIEF_CHARACTERS:
        raise _AdStudioBriefError(
            "brief_too_long",
            f"Brief is {len(raw):,} characters. Keep it to {AD_STUDIO_MAX_BRIEF_CHARACTERS:,} or fewer; Frank did not shorten it.",
            413,
        )
    try:
        raw.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise _AdStudioBriefError("brief_invalid_utf8", "The generator brief must be valid UTF-8 text.") from error
    return raw


def _ad_studio_safe_filename(raw: object, index: int) -> str:
    """Return one display-safe basename; staging prefixes prevent collisions."""
    basename = Path(str(raw or "").replace("\\", "/")).name.strip()
    if not basename or basename in {".", ".."}:
        basename = f"source-{index + 1}.bin"
    suffix = Path(basename).suffix.lower()
    stem = Path(basename).stem
    stem = re.sub(r"[^A-Za-z0-9._ -]", "_", stem).strip(" ._") or f"source-{index + 1}"
    return f"{stem[:96]}{suffix[:12]}"


def _ad_studio_signature_matches(media_type: str, header: bytes) -> bool:
    if media_type == "image/png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if media_type == "image/jpeg":
        return header.startswith(b"\xff\xd8\xff")
    if media_type == "image/gif":
        return header.startswith((b"GIF87a", b"GIF89a"))
    if media_type == "image/webp":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    if media_type == "image/bmp":
        return header.startswith(b"BM")
    if media_type == "image/tiff":
        return header.startswith((b"II*\x00", b"MM\x00*"))
    if media_type in {"image/avif", "image/heic", "image/heif"}:
        if len(header) < 12 or header[4:8] != b"ftyp":
            return False
        brands = {header[8:12]}
        brands.update(header[offset:offset + 4] for offset in range(16, min(len(header), 64), 4))
        if media_type == "image/avif":
            return bool(brands & {b"avif", b"avis"})
        return bool(brands & {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"})
    return False


def _validate_ad_studio_attachment(attachment: dict) -> dict:
    target = _upload_target(str(attachment.get("id") or ""))
    if target is None or not target.is_file():
        raise _AdStudioSourceError("source_missing", "source image is no longer available")
    size = target.stat().st_size
    if size <= 0:
        raise _AdStudioSourceError("empty_file", "source image is empty")
    if size > AD_STUDIO_MAX_SOURCE_BYTES:
        raise _AdStudioSourceError("file_too_large", "source image exceeds the per-file size limit")
    suffix = target.suffix.lower()
    media_type = _AD_STUDIO_IMAGE_EXTENSIONS.get(suffix)
    if not media_type:
        raise _AdStudioSourceError("unsupported_type", "source must use a supported image file type")
    declared_type = str(attachment.get("type") or "").lower().split(";", 1)[0].strip()
    if declared_type and declared_type not in {media_type, "application/octet-stream"}:
        raise _AdStudioSourceError("type_mismatch", "source image type does not match its filename")
    try:
        with target.open("rb") as source_file:
            header = source_file.read(64)
    except OSError as error:
        raise _AdStudioSourceError("source_unreadable", "source image could not be read") from error
    if not _ad_studio_signature_matches(media_type, header):
        raise _AdStudioSourceError("invalid_image", "source image content does not match its file type")
    clean = dict(attachment)
    clean.update({"name": target.name, "size": size, "type": media_type})
    return clean


def _remove_ad_studio_staging(attachment: dict) -> None:
    target = _upload_target(str(attachment.get("id") or ""))
    if target is None:
        return
    try:
        target.unlink(missing_ok=True)
    except OSError:
        return
    upload_root = UPLOAD_DIR.resolve()
    parent = target.parent
    while parent != upload_root:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent


def _remove_raw_ad_studio_attachments(raw_attachments: list) -> None:
    for raw_attachment in raw_attachments:
        if not isinstance(raw_attachment, dict):
            continue
        cleaned = _clean_atts([raw_attachment])
        if cleaned:
            _remove_ad_studio_staging(cleaned[0])


def _start_ad_studio_source_run(
    source_item: dict,
    *,
    total_items: int,
    common_name: str,
    brief: str,
    project_id: str,
    project: dict,
    model_policy: dict,
) -> tuple[dict | None, dict]:
    index = source_item["index"]
    attachment = source_item["attachment"]
    source_name = re.sub(r"\.[^.]+$", "", attachment["name"])
    name = common_name if total_items == 1 else (
        f"{common_name} · {source_name}"[:60] if common_name else source_name[:60]
    )
    command_payload = {
        "job_name": name,
        "brief": brief,
        "brief_sha256": hashlib.sha256(brief.encode("utf-8")).hexdigest(),
        "placements": ["feed", "story"],
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
        "idempotency_key": f"ad-template:{secrets.token_hex(16)}",
        "model_policy_override": deepcopy(model_policy),
    }
    try:
        data = hermes_request("/v1/tool-runs", request_payload, method="POST", timeout=8)
        run_data = data.get("run") if isinstance(data.get("run"), dict) else data
        run_id = str(run_data.get("id") or run_data.get("run_id") or "")
        if not AD_STUDIO_RUN_ID.fullmatch(run_id):
            raise _AdStudioSourceError("invalid_hermes_response", "Hermes did not return a valid Tool run id")
        run = _public_ad_studio_run(run_data, title=f"Ad Studio · {name}", project_id=project_id)
        return run, {"index": index, "name": attachment["name"], "status": "accepted", "run": run}
    except _AdStudioSourceError as error:
        return None, {"index": index, "name": attachment["name"], "status": "failed", "error": {"code": error.code, "message": str(error)}}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1200]
        message = f"Hermes returned HTTP {error.code}."
        try:
            parsed = json.loads(detail)
            message = parsed.get("error", {}).get("message") or parsed.get("message") or message
        except (json.JSONDecodeError, AttributeError):
            pass
        return None, {"index": index, "name": attachment["name"], "status": "failed", "error": {"code": "hermes_rejected", "message": str(message)[:240]}}
    except Exception as error:
        return None, {"index": index, "name": attachment["name"], "status": "failed", "error": {"code": "hermes_unavailable", "message": f"Could not reach Hermes: {str(error).split(chr(10))[0][:180]}"}}
    finally:
        _remove_ad_studio_staging(attachment)


def _tool_run_path(run_id: str, suffix: str = "") -> str:
    if not AD_STUDIO_RUN_ID.fullmatch(run_id):
        abort(404)
    return f"/v1/tool-runs/{urllib.parse.quote(run_id, safe='')}{suffix}"


@app.get("/api/ad-db/ads")
@app.get("/api/ad-db/prospects")
@app.get("/api/ad-db/runs")
def ad_db_collection():
    """Read-only Ad DB facade; canonical data and policy stay in Hermes."""
    collection = request.path.rsplit("/", 1)[-1]
    query = _ad_db_query()
    try:
        payload = hermes_request(f"/v1/ad-db/{collection}" + (f"?{query}" if query else ""), timeout=15)
    except Exception as error:
        return _hermes_error(error)
    return jsonify(_ad_db_public_payload(payload))


@app.get("/api/ad-db/ads/<ad_id>")
def ad_db_ad(ad_id: str):
    ad_id = _ad_db_id(ad_id)
    try:
        payload = hermes_request(f"/v1/ad-db/ads/{urllib.parse.quote(ad_id, safe='')}", timeout=15)
    except Exception as error:
        return _hermes_error(error)
    return jsonify(_ad_db_public_payload(payload))


@app.get("/api/ad-db/ads/<ad_id>/media/<asset_id>")
def ad_db_media(ad_id: str, asset_id: str):
    try:
        return _ad_db_media_redirect(_ad_db_id(ad_id), _ad_db_id(asset_id))
    except Exception as error:
        return _hermes_error(error)


@app.post("/api/ad-studio/runs")
def ad_studio_run_create():
    """Start one durable canonical Feed + Story Hermes run per source image."""
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        abort(400, "request body must be an object")
    raw_attachments = body.get("attachments")
    if not isinstance(raw_attachments, list) or not raw_attachments:
        abort(400, "choose at least one source image")
    if len(raw_attachments) > AD_STUDIO_MAX_SOURCES:
        _remove_raw_ad_studio_attachments(raw_attachments)
        abort(413, f"choose no more than {AD_STUDIO_MAX_SOURCES} source images")

    try:
        brief = _ad_studio_brief(body.get("brief"))
    except _AdStudioBriefError as error:
        _remove_raw_ad_studio_attachments(raw_attachments)
        return jsonify({
            "ok": False,
            "error": {"code": error.code, "message": str(error)},
            "limit": AD_STUDIO_MAX_BRIEF_CHARACTERS,
        }), error.status

    project_id = _clean_project_id(body.get("project_id")) if body.get("project_id") else ""
    project = _project_store.get_project(project_id) if project_id else None
    if not project:
        _remove_raw_ad_studio_attachments(raw_attachments)
        abort(404, "project not found")

    try:
        model_policy = _validated_ad_studio_model_policy(
            body.get("model_policy_override"), project_id=project_id,
        )
    except _AdStudioSourceError as error:
        _remove_raw_ad_studio_attachments(raw_attachments)
        return jsonify({"error": str(error), "code": error.code}), 422
    except Exception as error:
        _remove_raw_ad_studio_attachments(raw_attachments)
        return _hermes_error(error)

    sources = []
    results = []
    total_size = 0
    for index, raw_attachment in enumerate(raw_attachments):
        name = _ad_studio_safe_filename(raw_attachment.get("name") if isinstance(raw_attachment, dict) else "", index)
        cleaned = _clean_atts([raw_attachment]) if isinstance(raw_attachment, dict) else []
        attachment = cleaned[0] if cleaned else None
        try:
            if attachment is None:
                raise _AdStudioSourceError("source_missing", "source image is no longer available")
            attachment = _validate_ad_studio_attachment(attachment)
            total_size += attachment["size"]
            if total_size > AD_STUDIO_MAX_BATCH_BYTES:
                raise _AdStudioSourceError("batch_too_large", "source images exceed the batch size limit")
            sources.append({"index": index, "attachment": attachment})
        except _AdStudioSourceError as error:
            if attachment is not None:
                _remove_ad_studio_staging(attachment)
            results.append({"index": index, "name": name, "status": "rejected", "error": {"code": error.code, "message": str(error)}})

    common_name = _clean_project_text(body.get("name"), 60)
    runs = []
    if sources:
        total_items = len(sources) + len(results)
        worker_count = min(4, len(sources))
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="ad-studio-start") as executor:
            outcomes = executor.map(
                lambda source_item: _start_ad_studio_source_run(
                    source_item,
                    total_items=total_items,
                    common_name=common_name,
                    brief=brief,
                    project_id=project_id,
                    project=project,
                    model_policy=model_policy,
                ),
                sources,
            )
            for run, result in outcomes:
                if run is not None:
                    runs.append(run)
                results.append(result)

    results.sort(key=lambda item: item["index"])
    failed = len(results) - len(runs)
    response = {
        "ok": bool(runs),
        "partial": bool(runs and failed),
        "accepted": len(runs),
        "failed": failed,
        "runs": runs,
        "results": results,
    }
    if len(results) == 1 and len(runs) == 1:
        response["run"] = runs[0]
    if runs and not failed:
        status = 202
    elif runs:
        status = 207
    elif any(item["status"] == "failed" for item in results):
        status = 502
    else:
        status = 422
    return jsonify(response), status


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
    events = _read_ad_studio_run_events(run_id) if isinstance(run, dict) and str(run.get("status") or "") not in {"ready_for_review", "completed", "approved"} else []
    return jsonify({"run": _public_ad_studio_run(run, events=events)})


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


def _template_release_target(release_id: str, artifact: str) -> Path | None:
    """Resolve one sealed, source-free release artifact without traversal."""
    if not TEMPLATE_RELEASE_ID.fullmatch(release_id or ""):
        return None
    if not artifact or "\\" in artifact or artifact.startswith("/"):
        return None
    parts = artifact.split("/")
    if any(not part or part in {".", ".."} or part.startswith(".") for part in parts):
        return None
    target = (TEMPLATE_RELEASE_ROOT / release_id / Path(*parts)).resolve()
    try:
        target.relative_to(TEMPLATE_RELEASE_ROOT)
    except ValueError:
        return None
    if target.suffix.lower() not in TEMPLATE_RELEASE_EXTENSIONS:
        return None
    current = TEMPLATE_RELEASE_ROOT
    try:
        for part in (release_id, *parts):
            current = current / part
            if current.is_symlink():
                return None
    except OSError:
        return None
    if not target.exists() or not target.is_file() or target.is_symlink():
        return None
    try:
        if target.stat().st_size > TEMPLATE_RELEASE_MAX_BYTES:
            return None
    except OSError:
        return None
    return target


@app.route("/releases/ad-template-generator/<release_id>/<path:artifact>", methods=["GET", "HEAD"])
def ad_template_generator_release_artifact(release_id: str, artifact: str):
    target = _template_release_target(release_id, artifact)
    if target is None:
        abort(404)
    try:
        stat = target.stat()
        etag = hashlib.sha256(f"{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()
        headers = {
            "ETag": f'"{etag}"',
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": str(stat.st_size),
        }
        if request.if_none_match and request.if_none_match.contains(etag):
            return Response(status=304, headers=headers)
        content_type = (
            TEMPLATE_RELEASE_MIME_TYPES.get(target.suffix.lower())
            or mimetypes.guess_type(target.name)[0]
            or "application/octet-stream"
        )
        if request.method == "HEAD":
            return Response(status=200, headers=headers, mimetype=content_type)

        def stream():
            with target.open("rb") as handle:
                while chunk := handle.read(64 * 1024):
                    yield chunk

        return Response(
            stream_with_context(stream()),
            headers=headers,
            mimetype=content_type,
            direct_passthrough=True,
        )
    except OSError:
        abort(404)


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


@app.post("/api/ad-studio/runs/<run_id>/retry")
def ad_studio_run_retry(run_id: str):
    return _proxy_ad_studio_action(run_id, "/retry", {"from_stage"})


@app.post("/api/ad-studio/runs/<run_id>/cancel")
def ad_studio_run_cancel(run_id: str):
    return _proxy_ad_studio_action(run_id, "/cancel", {"reason"})


@app.post("/api/ad-studio/runs/<run_id>/approve")
def ad_studio_run_approve(run_id: str):
    """Forward the operator's explicit template publication decision to Hermes."""
    return _proxy_ad_studio_action(run_id, "/approve", set())


@app.post("/api/ad-studio/runs/<run_id>/request-changes")
def ad_studio_run_request_changes(run_id: str):
    body = request.get_json(silent=True) or {}
    instructions = str(body.get("instructions") or "").strip() if isinstance(body, dict) else ""
    if set(body) != {"instructions"} or not instructions or len(instructions) > 2_000:
        abort(400, "change instructions must contain 1–2,000 characters")
    try:
        data = hermes_request(_tool_run_path(run_id, "/request-changes"), {"instructions": instructions}, method="POST", timeout=15)
    except Exception as error:
        return _hermes_error(error)
    run = data.get("run") if isinstance(data.get("run"), dict) else data
    return jsonify({"ok": True, "run": _public_ad_studio_run(run)})


@app.post("/api/ad-studio/runs/<run_id>/discard")
def ad_studio_run_discard(run_id: str):
    body = request.get_json(silent=True) or {}
    reason = str(body.get("reason") or "").strip() if isinstance(body, dict) else ""
    if not isinstance(body, dict) or any(key != "reason" for key in body) or len(reason) > 1_000:
        abort(400, "discard reason must be no more than 1,000 characters")
    try:
        data = hermes_request(_tool_run_path(run_id, "/discard"), {"reason": reason} if reason else {}, method="POST", timeout=15)
    except Exception as error:
        return _hermes_error(error)
    run = data.get("run") if isinstance(data.get("run"), dict) else data
    return jsonify({"ok": True, "run": _public_ad_studio_run(run)})


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
        stream_with_context(_project_chat_stream(chat_id, payload)),
        mimetype="text/event-stream",
        headers=_sse_headers(),
    )


def _sse_headers():
    return {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }


# ============================================================================
# v0.21 central wiring (Session 1; contract v1.0.0 §2–§8)
# ============================================================================

from urllib.parse import urlsplit as _urlsplit
from hermes_adapter.http import RestSurface as _RestSurface, RestError as _RestError
from hermes_adapter.serve import ServeClient as _ServeClient, ServeError as _ServeError
from hermes_adapter.projection import EventProjection as _EventProjection
from hermes_adapter.events import derived_label as _derived_label

_HERMES_SERVE_URL = os.environ.get("HERMES_SERVE_URL", "")
_HERMES_SERVE_TOKEN = os.environ.get("HERMES_SERVE_TOKEN", "")

# Terminal run events used to release the active-run binding.
_RUN_TERMINAL = frozenset({
    "run.completed", "run.cancelled", "run.stopped", "run.failed",
    "run.expired", "error", "done",
})


def _serve_client():
    if not (_HERMES_SERVE_URL and _HERMES_SERVE_TOKEN):
        return None
    return _ServeClient(_RestSurface(
        "serve", _HERMES_SERVE_URL, lambda: {"X-Hermes-Session-Token": _HERMES_SERVE_TOKEN}))


def _same_origin_guard():
    """Strict same-origin mutation guard for browser state changes."""
    sec_site = request.headers.get("Sec-Fetch-Site")
    if sec_site not in (None, "same-origin", "same-site", "none"):
        abort(403, description="cross-site mutation rejected")
    origin = request.headers.get("Origin", "")
    if origin:
        netloc = _urlsplit(origin).netloc
        if netloc and netloc != request.host:
            abort(403, description="cross-origin mutation rejected")
    if request.content_type and "application/json" not in request.content_type:
        abort(415, description="expected application/json")


# --- one redacted event projection under the Window data root ---------------
_EVENT_PROJECTION = _EventProjection(Path(os.environ.get(
    "FRANK_EVENT_PROJECTION_ROOT", str(Path(os.environ.get("CHAT_STORE_DIR", "/data")) / "events-projection"))))
_active_runs_lock = threading.Lock()
_ACTIVE_RUNS: dict[str, str] = {}


def _projection_key(chat_id: str) -> str:
    return _EventProjection.scope_key("operator", "frank", chat_id)


def _record_projected_event(chat_id: str, native_event: str, data_text: str) -> None:
    data = None
    try:
        data = json.loads(data_text) if data_text else {}
    except json.JSONDecodeError:
        data = {"raw": data_text[:2000]}
    if not isinstance(data, dict):
        data = {"raw": str(data)[:2000]}
    run_id = str(data.get("run_id") or "")
    if run_id:
        with _active_runs_lock:
            _ACTIVE_RUNS[chat_id] = run_id
        if native_event in _RUN_TERMINAL:
            with _active_runs_lock:
                if _ACTIVE_RUNS.get(chat_id) == run_id:
                    _ACTIVE_RUNS.pop(chat_id, None)
    envelope = {
        "native_event": native_event or "message",
        "derived_label": _derived_label(native_event or "message"),
        "payload": data,
        "run_id": run_id,
    }
    try:
        _EVENT_PROJECTION.append(_projection_key(chat_id), envelope, run_id=run_id)
    except Exception:
        # Projection failure must never corrupt the live turn stream.
        pass


def _project_chat_stream(chat_id: str, payload: dict):
    """Pass the authoritative turn through unchanged while persisting a
    redacted, sequence-stamped projection for replay (contract §5)."""
    event_name = "message"
    data_buf: list[str] = []

    def _flush() -> None:
        nonlocal event_name
        if data_buf:
            _record_projected_event(chat_id, event_name, "\n".join(data_buf))
            event_name = "message"
            data_buf.clear()

    try:
        for raw_line in _hermes_chat_stream(chat_id, payload):
            yield raw_line
            text = raw_line.decode("utf-8", errors="replace")
            for line in text.splitlines():
                if line.startswith("event:"):
                    _flush()
                    event_name = line[6:].strip() or "message"
                elif line.startswith("data:"):
                    data_buf.append(line[5:].strip())
                elif not line.strip():
                    _flush()
        _flush()
    finally:
        with _active_runs_lock:
            _ACTIVE_RUNS.pop(chat_id, None)


@app.post("/api/chat/stop")
def chat_stop():
    _same_origin_guard()
    body = request.get_json(silent=True) or {}
    chat_id = str(body.get("chat_id", "")).strip()
    if not chat_id:
        abort(400, "chat_id required")
    with _active_runs_lock:
        run_id = str(body.get("run_id", "")).strip() or _ACTIVE_RUNS.get(chat_id, "")
    if not run_id:
        return jsonify({"error": {"type": "no_active_run",
                                  "message": "No active Hermes run to stop for this chat."}}), 409
    try:
        result = hermes_request(f"/v1/runs/{run_id}/stop",
                                {"reason": str(body.get("reason", "user stop"))[:200]})
    except Exception as err:
        return _hermes_error(err)
    _record_projected_event(chat_id, "run.stopped", json.dumps(
        {"type": "run.stopped", "run_id": run_id, "frank_origin": True}))
    return jsonify(result)


@app.post("/api/chat/respond")
def chat_respond():
    """Resolve one blocking input against the exact native request."""
    _same_origin_guard()
    body = request.get_json(silent=True) or {}
    chat_id = str(body.get("chat_id", "")).strip()
    kind = str(body.get("kind", "approval")).strip().lower()
    value = body.get("value")
    request_id = str(body.get("request_id", "")).strip()
    with _active_runs_lock:
        run_id = str(body.get("run_id", "")).strip() or _ACTIVE_RUNS.get(chat_id, "")
    if not chat_id:
        abort(400, "chat_id required")
    if not run_id:
        return jsonify({"error": {"type": "no_active_run",
                                  "message": "No active Hermes run is waiting on this chat."}}), 409
    if kind == "clarify":
        answer = str(value or "").strip()
        if not answer:
            abort(400, "clarification answer required")
        try:
            result = hermes_request(f"/v1/runs/{run_id}/steer", {"input": answer[:8000]})
        except Exception as err:
            return _hermes_error(err)
    elif kind in ("approval", "sudo"):
        choice = str(value or "once").strip().lower()
        choice = {"approve": "once", "approved": "once", "allow": "once", "yes": "once",
                  "deny": "deny", "no": "deny"}.get(choice, choice)
        if choice not in ("once", "session", "always", "deny"):
            abort(400, "invalid approval choice")
        payload: dict = {"choice": choice}
        if request_id:
            payload["request_id"] = request_id
        try:
            result = hermes_request(f"/v1/runs/{run_id}/approval", payload)
        except Exception as err:
            return _hermes_error(err)
    elif kind == "secret":
        return jsonify({"error": {"type": "unsupported",
                                  "message": "Secret input is not exposed by the pinned run-mode gateway."}}), 501
    else:
        abort(400, "unknown blocking-input kind")
    _record_projected_event(chat_id, f"input.resolved", json.dumps(
        {"type": "input.resolved", "run_id": run_id, "kind": kind, "frank_origin": True}))
    return jsonify(result)


@app.post("/api/chat/steer")
def chat_steer():
    _same_origin_guard()
    body = request.get_json(silent=True) or {}
    chat_id = str(body.get("chat_id", "")).strip()
    instruction = str(body.get("instruction", "")).strip()
    with _active_runs_lock:
        run_id = str(body.get("run_id", "")).strip() or _ACTIVE_RUNS.get(chat_id, "")
    if not chat_id or not instruction:
        abort(400, "chat_id and instruction required")
    if not run_id:
        return jsonify({"error": {"type": "no_active_run",
                                  "message": "No active Hermes run to steer."}}), 409
    try:
        result = hermes_request(f"/v1/runs/{run_id}/steer", {"input": instruction[:8000]})
    except Exception as err:
        return _hermes_error(err)
    _record_projected_event(chat_id, "run.steered", json.dumps(
        {"type": "run.steered", "run_id": run_id, "frank_origin": True}))
    return jsonify(result)


@app.get("/api/chat/events")
def chat_events():
    """Replay the redacted projection after a browser reload/disconnect."""
    chat_id = request.args.get("session_id", "").strip()
    if not chat_id:
        abort(400, "session_id required")
    try:
        after = int(request.args.get("after", "-1"))
    except ValueError:
        abort(400, "after must be an integer")
    events = list(_EVENT_PROJECTION.iter_events(_projection_key(chat_id), after_frank_sequence=after))
    return jsonify({"events": events, "session_id": chat_id})


@app.post("/api/audio/transcribe")
def audio_transcribe():
    """Server-side STT via the pinned Hermes endpoint (contract §6)."""
    _same_origin_guard()
    client = _serve_client()
    if client is None:
        abort(503, description="hermes serve bridge is not configured")
    body = request.get_json(silent=True) or {}
    data_url = str(body.get("data_url", ""))
    mime_type = str(body.get("mime_type")) if body.get("mime_type") else None
    try:
        result = client.transcribe(data_url, mime_type=mime_type)
    except _ServeError as err:
        status = 413 if err.frank_code == "hermes.payload_too_large" else (
            400 if err.frank_code == "hermes.invalid_params" else 503)
        return jsonify({"error": {"type": err.frank_code, "message": str(err)}}), status
    return jsonify(result)


@app.post("/api/chat/attachments/vps")
def chat_attachments_vps():
    """Attach one allowlisted VPS file/folder to the current chat."""
    _same_origin_guard()
    if _ws_catalog is None:
        abort(503, description="workspace estate is not configured")
    body = request.get_json(silent=True) or {}
    root_id = str(body.get("root", "")).strip()
    rel = str(body.get("path", "")).strip()
    kind = str(body.get("kind", "file")).strip()
    chat_id = str(body.get("chat_id", "")).strip()
    if not chat_id:
        abort(400, "chat_id required")
    if kind not in ("file", "folder"):
        abort(400, "kind must be file or folder")
    workspace = _chat_workspace(chat_id)
    if workspace is None:
        return jsonify({"error": {"type": "outside_workspace",
                                  "message": "This chat has no registered project workspace; VPS folders cannot be attached live. Start the chat from a project, or upload a local snapshot."}}), 403
    contract = None
    for candidate in _ws_catalog.roots_for(workspace.workspace_id):
        if candidate.kind != "live-reference":
            continue
        # The Explorer presents one tree under the "vps" root id; per-workspace
        # live roots are also accepted by their registered id.
        if root_id in ("vps", candidate.root_id):
            contract = candidate
            break
    if contract is None:
        abort(403, "root is not permitted for this chat's workspace")
    try:
        manifest = _build_manifest(Path(contract.container_path), rel)
    except Exception as err:
        return jsonify({"error": {"type": "path_rejected", "message": str(err)}}), 400
    chip = {
        "id": f"vps-{manifest.get('attachment_id') or _uuid.uuid4().hex}",
        "name": manifest.get("display_name") or rel.rsplit("/", 1)[-1],
        "relative_path": rel,
        "type": manifest.get("media_type") or ("inode/directory" if kind == "folder" else "application/octet-stream"),
        "size": manifest.get("total_bytes"),
        "source": "vps",
        "file_count": manifest.get("file_count"),
    }
    return jsonify(chip)


# --- workspace estate foundation (flag-gated) ------------------------------
_ws_registry = None
_ws_catalog = None
_ws_leases = None
_ws_resolver = None
_build_manifest = None
import uuid as _uuid

if os.environ.get("FRANK_V021_FOUNDATION", "").lower() in ("1", "true", "yes"):
    from infra.workspace.resolver import WorkspaceRegistry as _WSRegistry
    from infra.workspace.roots import RootCatalog as _WSCatalog
    from infra.workspace.manifest import build_manifest as _ws_build_manifest
    from infra.workspace.lease import WorkspaceLease as _WSLease
    import work_api as _work_api
    import work_cron as _work_cron
    from kanban_bridge_port import BridgeKanbanPort as _BridgeKanbanPort

    def _legacy_bank_for(project: dict) -> str:
        try:
            from memory_inspector import _bank_id as _legacy_bank_id
            return _legacy_bank_id(project)
        except Exception:
            return ""

    def _seed_registry(registry: _WSRegistry) -> dict:
        """Backward-compatible migration through Session 5's own migration
        API. Every registered project becomes an opaque workspace whose
        immutable memory_scope is the exact legacy root-derived bank."""
        candidates = []
        for project in _project_store.list_projects() or []:
            project_id = str(project.get("id") or "").strip()
            if not project_id:
                continue
            root = str(project.get("root") or "").strip()
            if root and not root.startswith("/"):
                # Legacy project roots are relative names; the canonical host
                # location is /projects/<name> (resolver's canonical prefix).
                root = f"/projects/{root.lstrip('/')}"
            slug = re.sub(r"[^a-z0-9-]+", "-", project_id.lower()).strip("-") or "project"
            candidates.append({
                "project_id": project_id,
                "slug": slug,
                "host_path": root,
                "hermes_path": root,
                "container_path": f"/vps/projects/{slug}" if root else "",
                "root_kind": "live-reference" if root else "upload-staging",
                "legacy_memory_scope": _legacy_bank_for(project) or f"steven-{slug}",
            })
        return registry.migrate_registry(candidates)

    _ws_registry = _WSRegistry(Path(os.environ.get(
        "FRANK_WORKSPACE_REGISTRY", str(Path(os.environ.get("CHAT_STORE_DIR", "/data")) / "workspace-registry.json"))))
    try:
        _seed_registry(_ws_registry)
    except Exception:
        # Registry corruption must not stop Frank; estate features fail closed.
        _ws_registry = None
    if _ws_registry is not None:
        _ws_catalog = _WSCatalog(_ws_registry)
        _ws_leases = _WSLease(Path(os.environ.get(
            "FRANK_WORKSPACE_LEASES", str(Path(os.environ.get("CHAT_STORE_DIR", "/data")) / "workspace-leases.json"))))
        _build_manifest = _ws_build_manifest

        class _ResolverShim:
            """The minimal resolver view work_api consumes."""
            def __init__(self, registry):
                self._registry = registry
            def get(self, workspace_id):
                return self._registry.get(workspace_id)
            def get_active(self, workspace_id):
                return self._registry.get_active(workspace_id)
            def hermes_path(self, workspace_id):
                record = self._registry.get(workspace_id)
                return record.hermes_path if record else ""

        _ws_resolver = _ResolverShim(_ws_registry)
        _kanban_port = _BridgeKanbanPort(
            base_url=os.environ.get("FRANK_KANBAN_BRIDGE_URL", ""),
            key_provider=lambda: os.environ.get("FRANK_KANBAN_BRIDGE_KEY", ""),
            slug_for=lambda binding: (
                _ws_registry.get_active(_binding_workspace(binding)).board_slug_private
                if _ws_registry.get(_binding_workspace(binding)) else None),
        )
        _cron_client = _work_cron.CronClient(
            _HERMES_SERVE_URL, lambda: _HERMES_SERVE_TOKEN)
        _work_api.configure(
            project_loader=_project_store.get_project,
            kanban=_kanban_port,
            resolver=_ws_resolver,
            leases=_ws_leases,
            cron_client=_cron_client,
        )
        app.register_blueprint(_work_api.api)

        import hmac as _hmac
        from infra.workspace.lease_blueprint import create_lease_blueprint as _create_lease_blueprint
        app.register_blueprint(_create_lease_blueprint(_ws_leases))

        @app.post("/internal/workspaces")
        def _internal_workspace_resolve():
            """Private server-to-server resolve (codex launcher contract).

            Same runtime-only credential and constant-time compare as the
            lease endpoints; only active workspaces resolve, and only to the
            canonical host path — never to the browser.
            """
            presented = request.headers.get("Authorization", "")
            expected = os.environ.get("FRANK_LEASE_CREDENTIAL", "")
            if not expected:
                abort(503, "lease credential is not configured")
            prefix = "Bearer "
            if not presented.startswith(prefix) or not _hmac.compare_digest(presented[len(prefix):], expected):
                abort(403)
            body = request.get_json(silent=True) or {}
            workspace_id = str(body.get("workspace_id") or "")
            if not workspace_id:
                abort(400, "workspace_id is required")
            record = _ws_registry.get(workspace_id)
            if record is None or record.status != "active" or not record.host_path:
                abort(404)
            return jsonify({
                "ok": True,
                "workspace_id": workspace_id,
                "host_path": record.host_path,
                "hermes_path": record.hermes_path,
                "root_kind": record.root_kind,
            })


def _binding_workspace(binding_id: str) -> str:
    """Board bindings map 1:1 to their project workspace in this migration."""
    return binding_id[3:] if binding_id.startswith("bb-") else binding_id


def _chat_workspace(chat_id: str):
    """Resolve the chat's bound project to its opaque workspace record."""
    if _ws_registry is None:
        return None
    project_id = ""
    try:
        if hasattr(_project_store, "project_id_for_session"):
            project_id = str(_project_store.project_id_for_session(chat_id) or "")
    except Exception:
        project_id = ""
    if not project_id and hasattr(_project_store, "session_bindings"):
        try:
            project_id = str(_project_store.session_bindings().get(chat_id) or "")
        except Exception:
            project_id = ""
    if not project_id:
        return None
    try:
        return _ws_registry.get_active(project_id)
    except Exception:
        return None


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
app.register_blueprint(control_plane_view.api)
app.register_blueprint(ops_projections.create_blueprint())
app.register_blueprint(customer_ops_actions.create_blueprint())
app.register_blueprint(vault_broker.api)
app.register_blueprint(create_memory_blueprint(MemoryInspector(
    _project_store.get_project,
    HindsightClient(HINDSIGHT_URL),
    Path(os.environ.get("PROJECT_KNOWLEDGE_ROOT", "/data/knowledge")),
    global_bank_id=os.environ.get("FRANK_GLOBAL_MEMORY_BANK", "steven-global"),
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


@app.get("/mini-frank")
def mini_frank_root_redirect():
    return _mini_redirect("/mini-frank/")


def _mini_redirect(target: str):
    if request.query_string:
        target = f"{target}?{request.query_string.decode('latin-1')}"
    return redirect(target, code=308)


def _mini_legacy_target(legacy_path: str, aliases: dict[str, str] | None = None) -> str:
    public_path = str(legacy_path or "").strip("/")
    if public_path in {"", "index.html"}:
        return "/mini-frank/"
    public_path = (aliases or {}).get(public_path, public_path)
    segments = public_path.split("/")
    if any(not segment or segment in {".", ".."} for segment in segments):
        abort(404)
    encoded = "/".join(urllib.parse.quote(segment, safe="-._~") for segment in segments)
    return f"/mini-frank/{encoded}"


@app.get("/mini-frank/", defaults={"mini_frank_path": ""})
@app.get("/mini-frank/<path:mini_frank_path>")
def mini_frank_spa(mini_frank_path: str):
    public_path = str(mini_frank_path or "").strip("/")
    if public_path == "":
        return send_from_directory(WEB / "mini", "index.html")
    if public_path == "index.html":
        return _mini_redirect("/mini-frank/")
    source_name = MINI_PUBLIC_ASSETS.get(public_path, public_path)
    if public_path not in MINI_PUBLIC_ASSETS and not MINI_PUBLIC_FILE.fullmatch(source_name):
        abort(404)
    root = (WEB / "mini").resolve()
    candidate = (root / source_name).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        abort(404)
    if not candidate.is_file():
        abort(404)
    return send_from_directory(root, source_name)


@app.get("/frank", defaults={"frank_path": ""}, strict_slashes=False)
@app.get("/frank/<path:frank_path>")
def frank_legacy_redirect(frank_path: str):
    return _mini_redirect(_mini_legacy_target(frank_path))


@app.get("/mini", defaults={"mini_path": ""}, strict_slashes=False)
@app.get("/mini/<path:mini_path>")
def mini_legacy_redirect(mini_path: str):
    return _mini_redirect(_mini_legacy_target(mini_path, LEGACY_MINI_ASSETS))


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def spa(path: str):
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

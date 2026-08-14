"""Frank Window API — display only. Hermes is the brain."""
from __future__ import annotations

import json
import base64
import mimetypes
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory, stream_with_context

import home_platform

WEB = Path(os.environ.get("FRANK_WEB", "/web")).resolve()
CHAT_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
UPLOAD_DIR = CHAT_DIR / "uploads"
ACCOUNTS_FILE = Path(os.environ.get("ACCOUNTS_STORE_FILE", str(CHAT_DIR / "accounts.json")))
HERMES_UPLOAD_ROOT = Path(os.environ.get("HERMES_SHARED_UPLOAD_ROOT", "/frank/window/data/uploads"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(250 * 1024 * 1024)))
MAX_INLINE_IMAGE_BYTES = int(os.environ.get("MAX_INLINE_IMAGE_BYTES", str(6 * 1024 * 1024)))
HERMES_URL = os.environ.get("HERMES_API_URL", "http://172.16.1.1:8642").rstrip("/")
HERMES_KEY = os.environ.get("HERMES_API_KEY", "")
HERMES_PROFILE = os.environ.get("HERMES_PROFILE", "default")
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

ACCOUNT_KINDS = {"customer", "email", "service", "domain"}
ACCOUNT_STATUSES = {"planned", "setup", "ready", "attention", "disabled"}
ACCOUNT_MODES = {"selfserve", "managed", "internal"}
ACCOUNT_ENVIRONMENTS = {"test", "live"}
AUTH_STATUSES = {"not_connected", "invited", "active", "suspended", "closed"}
BILLING_STATUSES = {"not_connected", "trial", "active", "past_due", "canceled"}
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
        "default_widgets": ["entity-overview", "application-status", "repository-activity", "repository-status", "project-files", "accounts-summary", "connection-attention", "analytics-summary"],
    },
    {
        "id": "merrypaws", "name": "Merrypaws", "root": "merrypaws",
        "blurb": "Merrypaws project workspace and storefront operations.",
        "capabilities": ["repository.activity", "repository.summary", "project.files", "accounts.directory", "connections.read", "analytics.setup"],
        "default_widgets": ["entity-overview", "repository-activity", "repository-status", "project-files", "accounts-summary", "connection-attention", "analytics-summary"],
    },
    {
        "id": "elfwonder", "name": "Elf & Wonder", "root": "elfandwonder",
        "blurb": "Elf & Wonder project workspace.",
        "capabilities": ["repository.activity", "repository.summary", "project.files", "connections.read", "analytics.setup"],
        "default_widgets": ["entity-overview", "repository-activity", "repository-status", "project-files", "connection-attention", "analytics-summary"],
    },
    {
        "id": "pavone", "name": "Pavone", "root": "pavone-demo",
        "blurb": "Pavone automotive project workspace.",
        "live": "https://pavoneauto.com", "health": "https://pavoneauto.com/api/health",
        "capabilities": ["application.health", "repository.activity", "repository.summary", "project.files", "accounts.directory", "connections.read", "analytics.setup"],
        "default_widgets": ["entity-overview", "application-status", "repository-activity", "repository-status", "project-files", "accounts-summary", "connection-attention", "analytics-summary"],
    },
]


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


def _public_hermes_session(session: dict) -> dict:
    preview = re.sub(r"\s+", " ", str(session.get("preview") or "")).strip()
    title = re.sub(r"\s+", " ", str(session.get("title") or "")).strip()
    if not title:
        title = (preview[:52] + ("…" if len(preview) > 52 else "")) or "New chat"
    return {
        "id": str(session.get("id") or ""),
        "title": title,
        "created_at": session.get("started_at") or 0,
        "updated_at": session.get("last_active") or session.get("ended_at") or session.get("started_at") or 0,
        "message_count": int(session.get("message_count") or 0),
        "preview": preview[:100],
        "model": str(session.get("model") or ""),
        "source": str(session.get("source") or ""),
    }


def _public_hermes_session_list(payload: dict) -> list[dict] | None:
    """Parse the production Hermes session-list shape used by chat and homes."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return None
    return [
        _public_hermes_session(item)
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


@app.get("/api/projects")
def projects():
    return jsonify({"projects": _project_items()})


def _project_items() -> list[dict]:
    # Keep the canonical profile source in this tracked module. Return copies
    # so API consumers and home providers cannot mutate the process registry.
    return [
        {
            **item,
            "capabilities": list(item.get("capabilities", [])),
            "default_widgets": list(item.get("default_widgets", [])),
        }
        for item in DEFAULT_PROJECTS
    ]


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
    sessions = _public_hermes_session_list(data) or []
    return jsonify({"sessions": sessions, "profile": HERMES_PROFILE})


@app.post("/api/chat/sessions")
def chat_sessions_create():
    body = request.get_json(silent=True) or {}
    title = re.sub(r"\s+", " ", str(body.get("title", "New chat"))).strip()[:80] or "New chat"
    model = str(body.get("model", "")).strip()
    provider = str(body.get("provider", "")).strip()
    payload = {"source": "api_server"}
    if title != "New chat":
        payload["title"] = title
    if model:
        payload.update({"model": model, "require_model_lock": True})
    if provider:
        payload["provider"] = provider
    try:
        data = hermes_request("/api/sessions", payload, method="POST")
    except Exception as err:
        return _hermes_error(err)
    session = data.get("session") or {}
    return jsonify({"ok": True, "session": _public_hermes_session(session)}), 201


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
    return jsonify({"ok": True, "session": _public_hermes_session(data.get("session") or {})})


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
    return jsonify({"messages": _public_hermes_messages(data.get("data") or []), "session_id": chat_id})


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
            "hermes_path": str(HERMES_UPLOAD_ROOT / Path(rel)),
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


def _hermes_input(text: str, attachments: list) -> str | list:
    if not attachments:
        return text
    listing = "\n".join(
        f"- {a['relative_path']} ({a['type']}, {a['size']} bytes) — available to your tools at {a['hermes_path']}"
        for a in attachments
    )
    prompt = (text or "Please inspect and respond to the attached material.").strip()
    prompt += "\n\nAttached files have already been uploaded and are readable at these exact local paths:\n" + listing
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
    url = hermes_base() + _session_path(chat_id, "/chat/stream")
    base_headers = {
        "Authorization": f"Bearer {HERMES_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    def generate():
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers=base_headers,
                method="POST",
            )
            # No client-side turn deadline. Hermes owns the run lifecycle and
            # emits SSE keepalives; the browser's Stop button closes this stream.
            with urllib.request.urlopen(req) as resp:
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

    return Response(stream_with_context(generate()), mimetype="text/event-stream", headers=_sse_headers())


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
)
app.register_blueprint(home_platform.api)


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

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
import urllib.request
import uuid
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory, stream_with_context

WEB = Path(os.environ.get("FRANK_WEB", "/web")).resolve()
CHAT_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
CHAT_FILE = CHAT_DIR / "chat.jsonl"
CHAT_INDEX = CHAT_DIR / "chats.json"
CHAT_SESSIONS_DIR = CHAT_DIR / "chats"
UPLOAD_DIR = CHAT_DIR / "uploads"
HERMES_UPLOAD_ROOT = Path(os.environ.get("HERMES_SHARED_UPLOAD_ROOT", "/frank/window/data/uploads"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(250 * 1024 * 1024)))
MAX_INLINE_IMAGE_BYTES = int(os.environ.get("MAX_INLINE_IMAGE_BYTES", str(6 * 1024 * 1024)))
HERMES_URL = os.environ.get("HERMES_API_URL", "http://172.16.1.1:8642").rstrip("/")
HERMES_KEY = os.environ.get("HERMES_API_KEY", "")
HERMES_PROFILE = os.environ.get("HERMES_PROFILE", "hub")
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
_chat_lock = threading.RLock()


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


def _new_hermes_conversation() -> str:
    return f"frank-hub-{uuid.uuid4()}"


def _write_chat_index(data: dict) -> None:
    CHAT_DIR.mkdir(parents=True, exist_ok=True)
    temp = CHAT_INDEX.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(CHAT_INDEX)


def _new_chat_record(title: str = "New chat") -> dict:
    now = int(time.time())
    return {
        "id": secrets.token_hex(8),
        "title": title[:80] or "New chat",
        "hermes_conversation": _new_hermes_conversation(),
        "file": "",
        "created_at": now,
        "updated_at": now,
        "message_count": 0,
        "preview": "",
    }


def _ensure_chat_index() -> dict:
    with _chat_lock:
        if CHAT_INDEX.exists():
            try:
                data = json.loads(CHAT_INDEX.read_text(encoding="utf-8"))
                if isinstance(data.get("sessions"), list):
                    return data
            except (OSError, json.JSONDecodeError, AttributeError):
                pass

        sessions = []
        if CHAT_FILE.exists() and CHAT_FILE.stat().st_size:
            lines = [line for line in CHAT_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
            preview = ""
            for line in reversed(lines):
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if item.get("role") == "user" and item.get("text"):
                    preview = str(item["text"]).replace("\n", " ")[:100]
                    break
            sessions.append({
                "id": "previous",
                "title": "Previous chat",
                "hermes_conversation": _new_hermes_conversation(),
                "file": "chat.jsonl",
                "created_at": int(CHAT_FILE.stat().st_ctime),
                "updated_at": int(CHAT_FILE.stat().st_mtime),
                "message_count": len(lines),
                "preview": preview,
            })

        # A clean chat is selected on the first reload. The imported transcript
        # remains available, but it never resumes the damaged Hermes chain.
        clean = _new_chat_record()
        if sessions:
            clean["updated_at"] = max(clean["updated_at"], max(int(item.get("updated_at", 0)) for item in sessions) + 1)
        sessions.append(clean)
        data = {"version": 1, "sessions": sessions}
        _write_chat_index(data)
        return data


def _chat_record(chat_id: str | None = None) -> dict | None:
    data = _ensure_chat_index()
    sessions = data["sessions"]
    if not sessions:
        return None
    if chat_id:
        return next((item for item in sessions if item.get("id") == chat_id), None)
    return max(sessions, key=lambda item: int(item.get("updated_at", 0)))


def _chat_path(record: dict) -> Path:
    filename = str(record.get("file") or f"{record['id']}.jsonl")
    if filename == "chat.jsonl":
        return CHAT_FILE
    CHAT_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    return CHAT_SESSIONS_DIR / Path(filename).name


def _public_chat(record: dict) -> dict:
    return {key: record.get(key) for key in (
        "id", "title", "created_at", "updated_at", "message_count", "preview"
    )}


def _title_from_message(msg: dict) -> str:
    text = re.sub(r"\s+", " ", str(msg.get("text", ""))).strip()
    if text:
        return text[:52] + ("…" if len(text) > 52 else "")
    attachments = msg.get("attachments") or []
    if attachments:
        first = attachments[0].get("relative_path") or attachments[0].get("name") or "attachment"
        return f"File: {first}"[:60]
    return "New chat"


def append_chat(msg: dict, chat_id: str | None = None) -> dict:
    with _chat_lock:
        data = _ensure_chat_index()
        sessions = data["sessions"]
        record = next((item for item in sessions if item.get("id") == chat_id), None) if chat_id else (
            max(sessions, key=lambda item: int(item.get("updated_at", 0))) if sessions else None
        )
        if record is None:
            raise KeyError("chat not found")
        path = _chat_path(record)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        previous_count = int(record.get("message_count", 0))
        record["message_count"] = previous_count + 1
        record["updated_at"] = int(time.time())
        if msg.get("role") == "user":
            record["preview"] = _title_from_message(msg)
            if record.get("title") == "New chat" and previous_count == 0:
                record["title"] = _title_from_message(msg)
        _write_chat_index(data)
    return msg


def _rotate_hermes_conversation(chat_id: str) -> str:
    with _chat_lock:
        data = _ensure_chat_index()
        record = next((item for item in data["sessions"] if item.get("id") == chat_id), None)
        if record is None:
            raise KeyError("chat not found")
        record["hermes_conversation"] = _new_hermes_conversation()
        _write_chat_index(data)
        return record["hermes_conversation"]


def hermes_base() -> str:
    url = HERMES_URL
    if url.endswith("/v1"):
        url = url[:-3]
    profile = HERMES_PROFILE.strip() or "hub"
    if profile in ("default", "hermes-agent"):
        return url
    return f"{url}/p/{profile}"


def hermes_request(path: str, payload: dict | None = None, timeout: float = 15):
    url = hermes_base() + path
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if HERMES_KEY:
        headers["Authorization"] = f"Bearer {HERMES_KEY}"
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="GET" if data is None else "POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        return json.loads(body.decode("utf-8") or "{}")


def hermes_reachable() -> dict:
    if not HERMES_KEY:
        return {"ok": False, "reason": "HERMES_API_KEY is not set"}
    try:
        urllib.request.urlopen(
            urllib.request.Request(
                f"{HERMES_URL.rstrip('/')}/v1/health",
                headers={"Authorization": f"Bearer {HERMES_KEY}"},
            ),
            timeout=3,
        )
        return {"ok": True}
    except urllib.error.HTTPError as err:
        if err.code in (200, 401, 403):
            return {"ok": True, "auth": err.code}
        return {"ok": False, "reason": f"HTTP {err.code}"}
    except Exception as err:
        return {"ok": False, "reason": str(err).split("\n")[0][:180]}


@app.get("/api/health")
def health():
    brain = hermes_reachable()
    return jsonify({"ok": True, "service": "frank-window", "hermes": brain})


@app.get("/api/projects")
def projects():
    p = WEB / "data" / "projects.json"
    if p.exists():
        return jsonify(json.loads(p.read_text(encoding="utf-8")))
    return jsonify({"projects": []})


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
    data = _ensure_chat_index()
    sessions = sorted(data["sessions"], key=lambda item: int(item.get("updated_at", 0)), reverse=True)
    return jsonify({"sessions": [_public_chat(item) for item in sessions]})


@app.post("/api/chat/sessions")
def chat_sessions_create():
    body = request.get_json(silent=True) or {}
    title = re.sub(r"\s+", " ", str(body.get("title", "New chat"))).strip()[:80] or "New chat"
    with _chat_lock:
        data = _ensure_chat_index()
        record = _new_chat_record(title)
        data["sessions"].append(record)
        _write_chat_index(data)
    return jsonify({"ok": True, "session": _public_chat(record)}), 201


@app.patch("/api/chat/sessions/<chat_id>")
def chat_sessions_rename(chat_id: str):
    body = request.get_json(silent=True) or {}
    title = re.sub(r"\s+", " ", str(body.get("title", ""))).strip()[:80]
    if not title:
        abort(400, "title required")
    with _chat_lock:
        data = _ensure_chat_index()
        record = next((item for item in data["sessions"] if item.get("id") == chat_id), None)
        if record is None:
            abort(404)
        record["title"] = title
        record["updated_at"] = int(time.time())
        _write_chat_index(data)
    return jsonify({"ok": True, "session": _public_chat(record)})


@app.get("/api/chat")
def chat_list():
    record = _chat_record(str(request.args.get("session_id", "")).strip() or None)
    if record is None:
        return jsonify({"messages": []})
    path = _chat_path(record)
    if not path.exists():
        return jsonify({"messages": [], "session": _public_chat(record)})
    msgs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            msgs.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return jsonify({"messages": msgs[-300:], "session": _public_chat(record)})


@app.post("/api/chat")
def chat_post():
    body = request.get_json(silent=True) or {}
    chat_id = str(body.get("chat_id", "")).strip() or None
    if _chat_record(chat_id) is None:
        abort(404, "chat not found")
    role = "user" if body.get("role") != "assistant" else "assistant"
    text = str(body.get("text", "")).strip()
    attachments = _clean_atts(body.get("attachments"))
    if not text and not attachments:
        abort(400, "empty message")
    msg = {
        "role": role,
        "text": text,
        "model": str(body.get("model", "")).strip() or None,
        "attachments": attachments,
        "ts": int(time.time()),
    }
    return jsonify({"ok": True, "message": append_chat(msg, chat_id)})


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
    return [{"role": "user", "content": content}]


@app.post("/api/chat/turn")
def chat_turn():
    """Forward one user turn to VPS Hermes. Frank does not think."""
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", "")).strip()
    attachments = _clean_atts(body.get("attachments"))
    model = str(body.get("model", "")).strip()
    provider = str(body.get("provider", "")).strip()
    chat_id = str(body.get("chat_id", "")).strip()
    chat_record = _chat_record(chat_id)
    if chat_record is None:
        abort(404, "chat not found")
    session_key = str(chat_record.get("hermes_conversation") or _rotate_hermes_conversation(chat_id))
    if not text and not attachments:
        abort(400, "empty message")

    user_msg = {
        "role": "user",
        "text": text,
        "model": model or None,
        "attachments": attachments,
        "ts": int(time.time()),
    }
    append_chat(user_msg, chat_id)

    brain = hermes_reachable()
    if not brain.get("ok"):
        note = brain.get("reason") or "Hermes is not on this box yet."
        sys_msg = {
            "role": "assistant",
            "text": f"Hub is not reachable. {note}",
            "model": None,
            "attachments": [],
            "ts": int(time.time()),
            "error": True,
        }
        append_chat(sys_msg, chat_id)

        def dead():
            yield f"event: error\ndata: {json.dumps({'type': 'error', 'content': sys_msg['text']})}\n\n"
            yield "event: done\ndata: {\"type\":\"done\"}\n\n"

        return Response(stream_with_context(dead()), mimetype="text/event-stream", headers=_sse_headers())

    payload = {
        "model": model or HERMES_PROFILE,
        "input": _hermes_input(text, attachments),
        "stream": True,
        "conversation": session_key,
    }
    if provider:
        payload["provider"] = provider
        payload["model"] = model or payload["model"]

    url = hermes_base() + "/v1/responses"
    base_headers = {
        "Authorization": f"Bearer {HERMES_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    def generate():
        collected = []
        active_session = session_key
        recovered = False
        terminal_error = False

        def sse_blocks(resp):
            block = []
            for raw_line in resp:
                if raw_line in (b"\n", b"\r\n"):
                    if block:
                        yield b"".join(block) + b"\n"
                        block = []
                else:
                    block.append(raw_line)
            if block:
                yield b"".join(block) + b"\n"

        def event_json(block: bytes) -> dict:
            chunks = []
            for line in block.decode("utf-8", errors="replace").splitlines():
                if line.startswith("data:"):
                    chunks.append(line[5:].strip())
            blob = "".join(chunks)
            if not blob or blob == "[DONE]":
                return {}
            try:
                value = json.loads(blob)
                return value if isinstance(value, dict) else {}
            except json.JSONDecodeError:
                return {}

        def is_poisoned(value) -> bool:
            raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            lowered = raw.lower()
            return "tool_calls" in lowered and "empty array" in lowered

        try:
            while True:
                attempt_payload = {**payload, "conversation": active_session}
                headers = {**base_headers, "X-Hermes-Session-Key": f"frank-hub:{chat_id}"}
                req = urllib.request.Request(url, data=json.dumps(attempt_payload).encode("utf-8"), headers=headers, method="POST")
                try:
                    poisoned_stream = False
                    pending_text_blocks = []
                    probe_text = ""
                    probing_error = True
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        for block in sse_blocks(resp):
                            ev = event_json(block)
                            if is_poisoned(ev) or is_poisoned(block.decode("utf-8", errors="replace")):
                                poisoned_stream = True
                                break
                            if ev.get("type") == "response.output_text.delta" and ev.get("delta"):
                                delta = str(ev["delta"])
                                if probing_error:
                                    probe_text += delta
                                    pending_text_blocks.append(block)
                                    if is_poisoned(probe_text):
                                        poisoned_stream = True
                                        break
                                    lower_probe = probe_text.lower().lstrip()
                                    suspicious = (
                                        lower_probe.startswith("http 400")
                                        or lower_probe.startswith("error code: 400")
                                        or lower_probe.startswith("invalid 'messages")
                                        or lower_probe.startswith("hermes returned http 400")
                                    )
                                    if len(probe_text) < 48 or suspicious:
                                        continue
                                    collected.append(probe_text)
                                    for pending in pending_text_blocks:
                                        yield pending
                                    pending_text_blocks = []
                                    probe_text = ""
                                    probing_error = False
                                    continue
                                collected.append(delta)
                            yield block
                    if probing_error and not poisoned_stream and pending_text_blocks:
                        if is_poisoned(probe_text):
                            poisoned_stream = True
                        else:
                            collected.append(probe_text)
                            for pending in pending_text_blocks:
                                yield pending
                    if poisoned_stream and not recovered and not collected:
                        active_session = _rotate_hermes_conversation(chat_id)
                        recovered = True
                        yield f"event: frank.session\ndata: {json.dumps({'type': 'frank.session', 'chat_id': chat_id, 'reason': 'history_recovered'})}\n\n".encode()
                        continue
                    break
                except urllib.error.HTTPError as err:
                    detail = err.read().decode("utf-8", errors="replace")[:800]
                    poisoned_history = err.code == 400 and is_poisoned(detail)
                    if poisoned_history and not recovered:
                        active_session = _rotate_hermes_conversation(chat_id)
                        recovered = True
                        yield f"event: frank.session\ndata: {json.dumps({'type': 'frank.session', 'chat_id': chat_id, 'reason': 'history_recovered'})}\n\n".encode()
                        continue
                    msg = f"Hermes returned HTTP {err.code}."
                    try:
                        parsed = json.loads(detail)
                        msg = parsed.get("error", {}).get("message") or parsed.get("message") or msg
                    except Exception:
                        if detail:
                            msg = detail[:180]
                    collected.clear()
                    collected.append(msg)
                    terminal_error = True
                    yield f"event: error\ndata: {json.dumps({'type': 'error', 'content': msg})}\n\n".encode()
                    break
        except Exception as err:
            msg = f"Could not reach Hermes: {str(err).split(chr(10))[0][:180]}"
            collected.append(msg)
            terminal_error = True
            yield f"event: error\ndata: {json.dumps({'type': 'error', 'content': msg})}\n\n".encode()
        finally:
            reply = "".join(collected).strip()
            if reply:
                append_chat(
                    {
                        "role": "assistant",
                        "text": reply,
                        "model": model or None,
                        "attachments": [],
                        "ts": int(time.time()),
                        "error": terminal_error,
                    },
                    chat_id,
                )
            yield b"event: done\ndata: {\"type\":\"done\"}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream", headers=_sse_headers())


def _sse_headers():
    return {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }


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

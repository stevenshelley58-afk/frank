"""Server-side Frank boundary for Blockwise customer-ops actions.

The browser never receives a Blockwise/Control Edge URL or credential. Frank
validates the operator request against its staged, read-only projection and
then signs the exact Blockwise action envelope with the private HMAC secret.
This module intentionally owns no provider calls and no customer mutation.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import threading
import time
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from flask import Blueprint, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from ops_projections import OpsProjectionStore, ProjectionError, _UUID


ACTION_SCHEMA = "blockwise.ops.action.v1"
RECEIPT_SCHEMA = "schema://frank.ops-action-receipt/v1"
CONTROL_MAX_BODY = 128 * 1024
REQUEST_MAX_BODY = 32 * 1024
REPLAY_WINDOW_SECONDS = 300
SUPPORTED = frozenset({
    "team_invite", "team_resend", "team_cancel", "session_revoke",
    "enquiry_assign", "billing_reconcile",
})
CAPABILITY = {
    "team_invite": "available", "team_resend": "available", "team_cancel": "available",
    "session_revoke": "available", "enquiry_assign": "available", "billing_reconcile": "available",
}
TARGET_TYPES = {
    "team_invite": "workspace", "team_resend": "invitation", "team_cancel": "invitation",
    "session_revoke": "session", "enquiry_assign": "enquiry", "billing_reconcile": "billing",
}
IDEMPOTENCY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._/-]{7,255}$")
CORRELATION = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
CONTROL_STATUSES = frozenset({"pending", "processing", "completed", "failed", "expired", "superseded", "rejected", "queued", "succeeded", "permanent_failed", "retryable", "unavailable", "accepted"})
STATUS_MAP = {
    "pending": "queued", "queued": "queued", "processing": "processing",
    "completed": "succeeded", "succeeded": "succeeded", "failed": "permanent_failed",
    "expired": "permanent_failed", "superseded": "permanent_failed", "rejected": "permanent_failed",
    "permanent_failed": "permanent_failed", "retryable": "retryable", "unavailable": "unavailable", "accepted": "accepted",
}
ROLE = frozenset({"owner", "support"})
JOURNAL_SCHEMA = "schema://frank.ops-action-intent-journal/v1"
JOURNAL_MAX_RECORDS = 512
JOURNAL_MAX_BYTES = 2 * 1024 * 1024
JOURNAL_RETENTION_SECONDS = 7 * 24 * 60 * 60
JOURNAL_TERMINAL = frozenset({"completed", "failed", "expired", "superseded", "succeeded", "permanent_failed", "rejected"})
try:
    import fcntl
except ImportError:  # pragma: no cover - Windows has no fcntl.
    fcntl = None


class CustomerOpsActionError(ValueError):
    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _origin(value: str) -> str:
    parsed = urllib.parse.urlsplit(value.strip().rstrip("/"))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise CustomerOpsActionError("customer operations control edge is unavailable")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _safe_file(path_text: str, *, name: str, max_bytes: int = 4096) -> str:
    """Read a regular, non-symlink secret with restrictive metadata."""
    if not path_text.strip():
        raise CustomerOpsActionError(f"{name} is not configured")
    path = Path(path_text).expanduser()
    if not path.is_absolute():
        raise CustomerOpsActionError(f"{name} path must be absolute")
    try:
        resolved = path.resolve(strict=True)
        if resolved != path or not path.is_file() or path.is_symlink():
            raise CustomerOpsActionError(f"{name} file is unavailable")
        _validate_secret_ancestors(path, name)
        info = path.stat()
        if info.st_size > max_bytes or stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise CustomerOpsActionError(f"{name} file is unavailable")
        if os.name != "nt":
            if info.st_mode & 0o077:
                raise CustomerOpsActionError(f"{name} file permissions are too broad")
            # The runtime process must own the mounted file. This avoids
            # accepting a mode-0600 file that another local account can swap
            # or control, while remaining portable to CI and root-run images.
            if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
                raise CustomerOpsActionError(f"{name} file owner is invalid")
        value = path.read_text(encoding="utf-8").strip()
    except CustomerOpsActionError:
        raise
    except (OSError, UnicodeError) as error:
        raise CustomerOpsActionError(f"{name} file is unavailable") from error
    if not value or any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise CustomerOpsActionError(f"{name} file is invalid")
    return value


def _validate_secret_ancestors(path: Path, name: str) -> None:
    """Validate every directory component, allowing root-owned 0755 roots."""
    current = Path(path.anchor)
    for part in path.parts[1:-1]:
        current /= part
        try:
            info = current.stat()
        except OSError as error:
            raise CustomerOpsActionError(f"{name} file is unavailable") from error
        if current.is_symlink() or not stat.S_ISDIR(info.st_mode):
            raise CustomerOpsActionError(f"{name} file is unavailable")
        if os.name == "nt":
            continue
        owner_ok = not hasattr(os, "geteuid") or info.st_uid in {0, os.geteuid()}
        # A root-owned sticky system directory such as /tmp is a valid
        # staging root; every non-sticky writable ancestor is rejected.
        writable = bool(info.st_mode & 0o022)
        sticky_root = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
        if not owner_ok or (writable and not sticky_root):
            raise CustomerOpsActionError(f"{name} ancestor metadata is unsafe")


class ActionIntentJournal:
    """Durable, bounded reservation store for ambiguous Control Edge writes.

    The journal is deliberately local to Frank and contains only the exact
    envelope needed to replay an uncertain write.  A process lock plus a
    POSIX advisory lock serializes multiple workers; replacement writes are
    fsynced before publication so a restart cannot produce a second action
    identity for the same operator intent.
    """

    def __init__(self, path: Path | None = None, *, clock=None):
        configured_text = os.environ.get("FRANK_OPS_ACTION_JOURNAL_FILE", "")
        if not configured_text:
            runtime_root = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
            if not runtime_root.is_absolute():
                runtime_root = Path(tempfile.gettempdir())
            configured_text = str(runtime_root / "ops-action-intents.json")
        configured = path or Path(configured_text)
        if not configured.is_absolute():
            raise CustomerOpsActionError("customer operations intent journal path must be absolute")
        self.path = configured
        self.lock_path = configured.with_name(configured.name + ".lock")
        self.clock = clock or time.time
        self.lock = threading.RLock()
        self._validate_paths()

    def _validate_paths(self):
        parent = self.path.parent
        try:
            parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if parent.is_symlink() or not parent.is_dir():
                raise CustomerOpsActionError("customer operations intent journal is unavailable")
            if os.name != "nt":
                parent_info = parent.stat()
                if parent_info.st_mode & 0o022 or (hasattr(os, "geteuid") and parent_info.st_uid not in {0, os.geteuid()}):
                    raise CustomerOpsActionError("customer operations intent journal permissions are unsafe")
            for candidate in (self.path, self.lock_path):
                if candidate.exists():
                    info = candidate.stat()
                    if candidate.is_symlink() or not stat.S_ISREG(info.st_mode):
                        raise CustomerOpsActionError("customer operations intent journal is unavailable")
                    if os.name != "nt":
                        if info.st_mode & 0o077 or (hasattr(os, "geteuid") and info.st_uid != os.geteuid()):
                            raise CustomerOpsActionError("customer operations intent journal permissions are unsafe")
        except CustomerOpsActionError:
            raise
        except OSError as error:
            raise CustomerOpsActionError("customer operations intent journal is unavailable") from error

    def _file_lock(self):
        class Guard:
            def __init__(guard_self, owner):
                guard_self.owner = owner
                guard_self.handle = None

            def __enter__(guard_self):
                guard_self.owner.lock.acquire()
                try:
                    guard_self.handle = guard_self.owner.lock_path.open("a+", encoding="utf-8")
                    if os.name != "nt":
                        os.chmod(guard_self.owner.lock_path, 0o600)
                    if fcntl is not None:
                        fcntl.flock(guard_self.handle.fileno(), fcntl.LOCK_EX)
                    return guard_self
                except Exception:
                    guard_self.owner.lock.release()
                    raise

            def __exit__(guard_self, exc_type, exc, tb):
                try:
                    if fcntl is not None and guard_self.handle is not None:
                        fcntl.flock(guard_self.handle.fileno(), fcntl.LOCK_UN)
                    if guard_self.handle is not None:
                        guard_self.handle.close()
                finally:
                    guard_self.owner.lock.release()

        return Guard(self)

    def _read(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            if self.path.stat().st_size > JOURNAL_MAX_BYTES:
                raise CustomerOpsActionError("customer operations intent journal is full")
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except CustomerOpsActionError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise CustomerOpsActionError("customer operations intent journal is corrupt") from error
        if not isinstance(data, Mapping) or set(data) != {"schema", "records"} or data.get("schema") != JOURNAL_SCHEMA or not isinstance(data.get("records"), list) or len(data["records"]) > JOURNAL_MAX_RECORDS:
            raise CustomerOpsActionError("customer operations intent journal is corrupt")
        records = []
        for item in data["records"]:
            if not isinstance(item, Mapping) or set(item) != {"schema", "operator_id", "fingerprint", "action_id", "idempotency_key", "envelope", "status", "correlation_id", "created_at", "updated_at", "terminal_at"}:
                raise CustomerOpsActionError("customer operations intent journal is corrupt")
            envelope = item.get("envelope")
            if item.get("schema") != JOURNAL_SCHEMA or not _UUID.fullmatch(str(item.get("operator_id"))) or not re.fullmatch(r"[0-9a-f]{64}", str(item.get("fingerprint"))) or not _UUID.fullmatch(str(item.get("action_id"))) or not IDEMPOTENCY.fullmatch(str(item.get("idempotency_key"))) or not isinstance(envelope, Mapping) or envelope.get("actionId") != item.get("action_id") or envelope.get("idempotencyKey") != item.get("idempotency_key") or item.get("status") not in CONTROL_STATUSES | JOURNAL_TERMINAL | {"reserved"} or not isinstance(item.get("created_at"), (int, float)) or not isinstance(item.get("updated_at"), (int, float)) or item.get("terminal_at") is not None and not isinstance(item.get("terminal_at"), (int, float)):
                raise CustomerOpsActionError("customer operations intent journal is corrupt")
            records.append(dict(item))
        return records

    def _write(self, records: list[dict[str, Any]]):
        payload = json.dumps({"schema": JOURNAL_SCHEMA, "records": records}, ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) > JOURNAL_MAX_BYTES:
            raise CustomerOpsActionError("customer operations intent journal is full")
        temporary = None
        try:
            fd, temporary = tempfile.mkstemp(prefix=".ops-action-intents-", dir=str(self.path.parent))
            os.fchmod(fd, 0o600) if hasattr(os, "fchmod") else os.chmod(temporary, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            temporary = None
            if os.name != "nt":
                os.chmod(self.path, 0o600)
            try:
                directory_fd = os.open(str(self.path.parent), os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            except OSError:
                pass
        except OSError as error:
            raise CustomerOpsActionError("customer operations intent journal is unavailable") from error
        finally:
            if temporary:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass

    def _prune(self, records: list[dict[str, Any]], now: float) -> list[dict[str, Any]]:
        return [item for item in records if now - float(item["updated_at"]) <= JOURNAL_RETENTION_SECONDS]

    def reserve(self, operator_id: str, fingerprint: str, envelope: Mapping[str, Any]) -> tuple[dict[str, Any], bool, bool]:
        now = float(self.clock())
        candidate_key = str(envelope["idempotencyKey"])
        candidate_action = str(envelope["actionId"])
        with self._file_lock():
            records = self._prune(self._read(), now)
            for item in records:
                if item["idempotency_key"] == candidate_key and (item["operator_id"] != operator_id or item["fingerprint"] != fingerprint):
                    raise CustomerOpsActionError("idempotency key conflicts with another intent", 409)
            matching = [item for item in records if item["operator_id"] == operator_id and item["fingerprint"] == fingerprint]
            active = next((item for item in reversed(matching) if item["status"] not in JOURNAL_TERMINAL), None)
            if active:
                return json.loads(json.dumps(active["envelope"])), True, False
            same_key = next((item for item in records if item["idempotency_key"] == candidate_key), None)
            if same_key:
                return json.loads(json.dumps(same_key["envelope"])), True, same_key["status"] in JOURNAL_TERMINAL
            if len(records) >= JOURNAL_MAX_RECORDS:
                raise CustomerOpsActionError("customer operations intent journal is full", 503)
            records.append({
                "schema": JOURNAL_SCHEMA, "operator_id": operator_id, "fingerprint": fingerprint,
                "action_id": candidate_action, "idempotency_key": candidate_key,
                "envelope": json.loads(json.dumps(envelope)), "status": "reserved", "correlation_id": None,
                "created_at": now, "updated_at": now, "terminal_at": None,
            })
            self._write(records)
            return json.loads(json.dumps(envelope)), False, False

    def mark(self, action_id: str, status: str, correlation_id: str | None = None):
        if status not in CONTROL_STATUSES | JOURNAL_TERMINAL:
            raise CustomerOpsActionError("invalid customer operations intent status")
        now = float(self.clock())
        with self._file_lock():
            records = self._prune(self._read(), now)
            found = False
            for item in records:
                if item["action_id"] == action_id:
                    item["status"] = status
                    item["correlation_id"] = correlation_id or item.get("correlation_id")
                    item["updated_at"] = now
                    item["terminal_at"] = now if status in JOURNAL_TERMINAL else None
                    found = True
                    break
            if not found:
                raise CustomerOpsActionError("customer operations intent journal is corrupt")
            self._write(records)


def _intent_fingerprint(envelope: Mapping[str, Any]) -> str:
    value = {
        "operatorId": envelope["actor"]["operatorId"], "action": envelope["action"],
        "workspaceId": envelope["workspaceId"], "customerId": envelope["customerId"],
        "target": envelope["target"], "expectedVersion": envelope["expectedVersion"],
        "reason": envelope["reason"], "payload": envelope["payload"],
    }
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def _secret() -> str:
    path = os.environ.get("FRANK_OPS_CONTROL_SECRET_FILE", "")
    value = _safe_file(path, name="customer operations control secret", max_bytes=4096)
    if len(value) < 32:
        raise CustomerOpsActionError("customer operations control secret is not strong enough")
    return value


def _operator() -> tuple[str, str]:
    operator_id = _safe_file(os.environ.get("FRANK_OPS_OPERATOR_ID_FILE", ""), name="Frank operator identity")
    if not _UUID.fullmatch(operator_id):
        raise CustomerOpsActionError("operator identity is invalid", 503)
    role = os.environ.get("FRANK_OPS_OPERATOR_ROLE", "").strip().lower()
    aal = os.environ.get("FRANK_OPS_OPERATOR_AAL", "").strip().lower()
    if role not in ROLE or aal != "aal2":
        raise CustomerOpsActionError("operator role or AAL2 verification is unavailable", 403)
    return operator_id.lower(), role


def _json_body(response: Any) -> Mapping[str, Any]:
    headers = getattr(response, "headers", None)
    if headers is not None:
        content_type = str(headers.get("Content-Type", "")).split(";", 1)[0].strip().lower()
        if content_type != "application/json" and not content_type.endswith("+json"):
            raise CustomerOpsActionError("control edge returned an invalid content type")
    raw = response.read(CONTROL_MAX_BODY + 1)
    if len(raw) > CONTROL_MAX_BODY:
        raise CustomerOpsActionError("control edge response exceeded its bound")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise CustomerOpsActionError("control edge returned invalid JSON") from error
    if not isinstance(body, Mapping):
        raise CustomerOpsActionError("control edge returned an invalid receipt")
    return body


class CustomerOpsControlClient:
    """HMAC/timestamp/replay client for the private Control Edge."""

    def __init__(self, *, opener=None, clock=None):
        self.opener = opener or urllib.request.build_opener(_NoRedirect()).open
        self.clock = clock or time.time

    def _request(self, method: str, path: str, body: str, scope: str, *, workspace_id: str | None = None) -> tuple[int, Mapping[str, Any]]:
        origin = _origin(os.environ.get("FRANK_OPS_CONTROL_URL", ""))
        if not path.startswith("/") or ".." in path or not re.fullmatch(r"/[A-Za-z0-9._~:/?-]+", path):
            raise CustomerOpsActionError("control edge path is invalid")
        secret = _secret()
        timestamp = str(int(self.clock()))
        nonce = secrets.token_urlsafe(24)
        canonical = "\n".join(("v1", timestamp, nonce, scope, method.upper(), path, hashlib.sha256(body.encode("utf-8")).hexdigest()))
        signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
        headers = {
            "Accept": "application/json", "Content-Type": "application/json",
            "X-Blockwise-Timestamp": timestamp, "X-Blockwise-Nonce": nonce,
            "X-Blockwise-Scope": scope, "X-Blockwise-Signature": signature,
        }
        if workspace_id:
            headers["X-Blockwise-Workspace-Id"] = workspace_id
        req = urllib.request.Request(origin + path, data=body.encode("utf-8") if method.upper() != "GET" else None, method=method.upper(), headers=headers)
        try:
            with self.opener(req, timeout=15) as response:
                try:
                    status = int(getattr(response, "status", 200))
                except (TypeError, ValueError) as status_error:
                    raise CustomerOpsActionError("control edge returned an invalid HTTP status") from status_error
                payload = _json_body(response)
                final_url = response.geturl() if hasattr(response, "geturl") else origin + path
            if not _final_url_is_same_origin(origin, path, final_url):
                raise CustomerOpsActionError("control edge redirect is invalid")
        except urllib.error.HTTPError as error:
            if not _final_url_is_same_origin(origin, path, error.geturl()):
                raise CustomerOpsActionError("control edge redirect is invalid")
            try:
                payload = _json_body(error)
            except (CustomerOpsActionError, OSError, urllib.error.URLError, TimeoutError) as body_error:
                raise CustomerOpsActionError("control edge returned an invalid error") from body_error
            return int(error.code), payload
        except CustomerOpsActionError:
            raise
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            raise CustomerOpsActionError("customer operations control edge is unavailable") from error
        return status, payload

    def enqueue(self, envelope: Mapping[str, Any]) -> Mapping[str, Any]:
        status, body = self._request("POST", "/v1/control/actions", json.dumps(envelope, separators=(",", ":"), ensure_ascii=False), "ops.write")
        if status == 501:
            raise CustomerOpsActionError("this action is unavailable", 501)
        if status != 202:
            raise CustomerOpsActionError("action was not accepted by the control edge", _error_status(status))
        if set(body) != {"schema", "actionId", "status", "capability", "correlationId"} or body.get("schema") != ACTION_SCHEMA:
            raise CustomerOpsActionError("control edge returned an invalid action receipt")
        action_id = body.get("actionId")
        if not isinstance(action_id, str) or not _UUID.fullmatch(action_id):
            raise CustomerOpsActionError("control edge returned an invalid action receipt")
        raw_status = body.get("status")
        if not isinstance(raw_status, str) or raw_status not in CONTROL_STATUSES:
            raise CustomerOpsActionError("control edge returned an invalid action status")
        if body.get("capability") != "available":
            raise CustomerOpsActionError("this action is unavailable", 501)
        correlation_id = _clean_correlation(body.get("correlationId"))
        if correlation_id is None:
            raise CustomerOpsActionError("control edge returned an invalid correlation")
        return {"schema": RECEIPT_SCHEMA, "action_id": action_id.lower(), "status": STATUS_MAP[raw_status], "correlation_id": correlation_id}

    def status(self, action_id: str, workspace_id: str) -> Mapping[str, Any]:
        path = f"/v1/control/actions/{action_id}"
        code, body = self._request("GET", path, "", "ops.read", workspace_id=workspace_id)
        if code == 404:
            raise CustomerOpsActionError("action receipt was not found", 404)
        if code != 200:
            raise CustomerOpsActionError("action receipt is unavailable", _error_status(code))
        expected_keys = {"actionId", "workspaceId", "status", "receiptIds", "latestReceipt", "correlationId"}
        if set(body) != expected_keys:
            raise CustomerOpsActionError("control edge returned an invalid action receipt")
        if _uuid(body.get("actionId"), "action_id") != action_id or _uuid(body.get("workspaceId"), "workspace_id") != workspace_id:
            raise CustomerOpsActionError("action receipt scope is invalid")
        raw_status = body.get("status")
        if not isinstance(raw_status, str) or raw_status not in CONTROL_STATUSES:
            raise CustomerOpsActionError("control edge returned an invalid action status")
        status = STATUS_MAP[raw_status]
        receipt_ids = body.get("receiptIds")
        if not isinstance(receipt_ids, list) or len(receipt_ids) > 50 or any(not isinstance(value, str) or not _UUID.fullmatch(value) for value in receipt_ids):
            raise CustomerOpsActionError("control edge returned invalid receipt ids")
        latest = body.get("latestReceipt")
        safe_latest = None
        if isinstance(latest, Mapping):
            # Receipt detail is provider-owned and may contain customer PII or
            # raw error payloads.  Frank only needs the bounded transition
            # metadata to render a truthful status and retry affordance.
            if set(latest) - {"receipt_id", "status", "transition_seq", "created_at", "safe_result", "safe_error"}:
                raise CustomerOpsActionError("control edge returned an invalid receipt")
            receipt_id = latest.get("receipt_id")
            receipt_status = latest.get("status")
            transition_seq = latest.get("transition_seq")
            created_at = latest.get("created_at")
            if not isinstance(receipt_id, str) or not _UUID.fullmatch(receipt_id) or not isinstance(receipt_status, str) or receipt_status not in CONTROL_STATUSES or isinstance(transition_seq, bool) or not isinstance(transition_seq, int) or transition_seq < 1 or transition_seq > 2**63 - 1 or not isinstance(created_at, str) or len(created_at) > 128:
                raise CustomerOpsActionError("control edge returned an invalid receipt")
            safe_latest = {"receipt_id": receipt_id, "status": STATUS_MAP[receipt_status], "transition_seq": transition_seq, "created_at": created_at}
        elif latest is not None:
            raise CustomerOpsActionError("control edge returned an invalid receipt")
        correlation_id = _clean_correlation(body.get("correlationId"))
        if correlation_id is None:
            raise CustomerOpsActionError("control edge returned an invalid correlation")
        return {"schema": RECEIPT_SCHEMA, "action_id": action_id, "workspace_id": workspace_id, "status": status, "receipt_ids": receipt_ids, "latest_receipt": safe_latest, "correlation_id": correlation_id}


def _clean_correlation(value: Any) -> str | None:
    return value if isinstance(value, str) and CORRELATION.fullmatch(value) else None


def _final_url_is_same_origin(origin: str, path: str, final_url: str) -> bool:
    if not isinstance(final_url, str):
        return False
    parsed = urllib.parse.urlsplit(final_url)
    expected = urllib.parse.urlsplit("https://control.invalid" + path)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")) == origin and parsed.path == expected.path and parsed.query == expected.query and not parsed.fragment


def _error_status(status: int) -> int:
    if status == 501:
        return 501
    if status == 409:
        return 409
    if status in {400, 401, 403, 404, 422}:
        return status
    return 503


def _uuid(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _UUID.fullmatch(value.strip()):
        raise CustomerOpsActionError(f"{label} is invalid", 422)
    return value.strip().lower()


def _version(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 2**63 - 1:
        raise CustomerOpsActionError("current projection version is required", 409)
    return value


def _payload(action: str, value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise CustomerOpsActionError("action payload is invalid", 422)
    allowed = {
        "team_invite": {"email", "role"}, "team_resend": set(), "team_cancel": set(),
        "session_revoke": set(), "enquiry_assign": {"assigneeProfileId"}, "billing_reconcile": set(),
    }[action]
    if set(value) - allowed:
        raise CustomerOpsActionError("action payload fields are not allowlisted", 422)
    if action == "team_invite":
        email, role = value.get("email"), value.get("role")
        if not isinstance(email, str) or len(email.strip()) > 320 or not re.fullmatch(r"\S+@\S+", email.strip()) or role not in {"admin", "member", "viewer"}:
            raise CustomerOpsActionError("invite email or role is invalid", 422)
        return {"email": email.strip().lower(), "role": role}
    if action == "enquiry_assign":
        assignee = value.get("assigneeProfileId")
        if assignee is not None:
            assignee = _uuid(assignee, "assigneeProfileId")
        return {"assigneeProfileId": assignee}
    if value:
        raise CustomerOpsActionError("action payload fields are not allowlisted", 422)
    return {}


def _make_envelope(body: Mapping[str, Any], *, operator_id: str, role: str, store: OpsProjectionStore) -> dict[str, Any]:
    action = body.get("action")
    if action not in SUPPORTED:
        raise CustomerOpsActionError("this customer-ops action is unavailable", 403)
    if action == "session_revoke" and role != "owner":
        raise CustomerOpsActionError("owner role is required for session revocation", 403)
    workspace_id = _uuid(body.get("workspace_id"), "workspace_id")
    customer_id = _uuid(body.get("customer_id"), "customer_id")
    if workspace_id != customer_id:
        raise CustomerOpsActionError("customer workspace scope is invalid", 422)
    target_id = _uuid(body.get("target_id"), "target_id")
    if body.get("target_type") != TARGET_TYPES[action]:
        raise CustomerOpsActionError("action target type is invalid", 422)
    if action == "team_invite" and target_id != workspace_id:
        raise CustomerOpsActionError("invite workspace target is invalid", 422)
    version = _version(body.get("expected_version"))
    reason = body.get("reason")
    if not isinstance(reason, str) or not 3 <= len(reason.strip()) <= 500:
        raise CustomerOpsActionError("a concise reason is required", 422)
    payload = _payload(action, body.get("payload", {}))
    snapshot = store.all()
    if any(item.status != "ready" for item in snapshot.values()):
        raise CustomerOpsActionError("customer operations are unavailable while projections are not ready", 409)
    customer = next((row for row in snapshot["customers"].items if row.get("id") == customer_id), None)
    if customer is None:
        raise CustomerOpsActionError("customer is not in the current projection", 404)
    if action == "team_invite" and customer.get("ops_version") != version:
        raise CustomerOpsActionError("customer workspace version is stale", 409)
    if action == "enquiry_assign":
        enquiry = next((row for row in snapshot["enquiries"].items if row.get("id") == target_id), None)
        if not enquiry or enquiry.get("workspace_id") is not None or enquiry.get("ops_version") != version:
            raise CustomerOpsActionError("only an exact unassigned enquiry can be associated", 409)
        if payload["assigneeProfileId"] is not None and not any(row.get("profile_id") == payload["assigneeProfileId"] and row.get("workspace_id") == workspace_id for row in snapshot["members"].items):
            raise CustomerOpsActionError("assignee is not a member of the selected workspace", 409)
    elif action == "billing_reconcile":
        if target_id != customer_id or not any(
            row.get("id") == customer_id
            and row.get("workspace_id") == customer_id
            and row.get("customer_id") == customer_id
            and row.get("ops_version") == version
            for row in snapshot["billing"].items
        ):
            raise CustomerOpsActionError("billing target is not the authoritative workspace state", 409)
    elif action in {"team_resend", "team_cancel"}:
        if not any(row.get("id") == target_id and row.get("customer_id") == customer_id and row.get("ops_version") == version and str(row.get("status", "")).lower() in {"invited", "pending"} for row in snapshot["members"].items):
            raise CustomerOpsActionError("invitation target is not pending in the current projection", 409)
    elif action == "session_revoke":
        # Blockwise's executor revokes sessions by profile id. Audit/activity
        # rows are evidence only and must never be treated as session targets.
        if not any(
            row.get("profile_id") == target_id
            and row.get("workspace_id") == workspace_id
            and row.get("customer_id") == customer_id
            and row.get("ops_version") == version
            and str(row.get("status", "active")).lower() not in {"revoked", "removed"}
            for row in snapshot["members"].items
        ):
            raise CustomerOpsActionError("session target is not an active workspace member", 409)
    envelope = {
        "schema": ACTION_SCHEMA, "actionId": str(uuid.uuid4()), "idempotencyKey": str(body.get("idempotency_key") or "ops:" + secrets.token_urlsafe(18)),
        "workspaceId": workspace_id, "customerId": customer_id,
        "actor": {"operatorId": operator_id, "role": role, "aal": "aal2"},
        "target": {"type": TARGET_TYPES[action], "id": target_id}, "action": action,
        "expectedVersion": version, "reason": reason.strip(),
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "payload": payload,
    }
    if not IDEMPOTENCY.fullmatch(envelope["idempotencyKey"]):
        raise CustomerOpsActionError("idempotency key is invalid", 422)
    return envelope


def create_blueprint(*, store: OpsProjectionStore | None = None, client_factory=None, journal_factory=None) -> Blueprint:
    projection_store = store or OpsProjectionStore()
    api = Blueprint("customer_ops_actions", __name__)
    intent_journal = journal_factory() if journal_factory else ActionIntentJournal()

    def client():
        return client_factory() if client_factory else CustomerOpsControlClient()

    @api.post("/api/ops/customer-actions")
    def enqueue_action():
        request._max_content_length = REQUEST_MAX_BODY
        try:
            raw = request.get_data(cache=True, as_text=False)
        except RequestEntityTooLarge:
            return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": "request_body_too_large"}), 413
        if len(raw) > REQUEST_MAX_BODY:
            return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": "request_body_too_large"}), 413
        if request.mimetype != "application/json":
            return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": "application_json_required"}), 415
        # The app is normally behind Caddy's authenticated operator route,
        # but this mutation endpoint also enforces same-origin semantics so a
        # cross-site browser can never turn an operator session into an action.
        if request.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
            return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": "same_origin_required"}), 403
        origin = request.headers.get("Origin")
        if origin:
            try:
                expected_origin = _origin(request.host_url)
                if _origin(origin) != expected_origin:
                    return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": "same_origin_required"}), 403
            except CustomerOpsActionError:
                return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": "same_origin_required"}), 403
        body = request.get_json(silent=True)
        if not isinstance(body, Mapping):
            return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": "typed_action_required"}), 422
        attempted_enqueue = False
        try:
            operator_id, role = _operator()
            envelope = _make_envelope(body, operator_id=operator_id, role=role, store=projection_store)
            fingerprint = _intent_fingerprint(envelope)
            envelope, _, terminal = intent_journal.reserve(operator_id, fingerprint, envelope)
            if terminal:
                raise CustomerOpsActionError("this intent has already settled; start a new intent", 409)
            attempted_enqueue = True
            result = client().enqueue(envelope)
            if result.get("action_id") != envelope["actionId"]:
                intent_journal.mark(envelope["actionId"], "rejected")
                raise CustomerOpsActionError("control edge returned a mismatched action identity")
            intent_journal.mark(envelope["actionId"], result.get("status", "queued"), result.get("correlation_id"))
            return jsonify(result), 202
        except CustomerOpsActionError as error:
            if attempted_enqueue and error.status in {400, 401, 403, 404, 409, 422, 501}:
                try:
                    intent_journal.mark(envelope["actionId"], "rejected")
                except CustomerOpsActionError:
                    pass
            return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": str(error)}), error.status

    @api.get("/api/ops/customer-actions/<action_id>")
    def action_status(action_id: str):
        try:
            action_id = _uuid(action_id, "action_id")
            workspace_id = _uuid(request.args.get("workspace_id"), "workspace_id")
            result = client().status(action_id, workspace_id)
            intent_journal.mark(result["action_id"], result["status"], result.get("correlation_id"))
            return jsonify(result)
        except CustomerOpsActionError as error:
            return jsonify({"schema": RECEIPT_SCHEMA, "status": "unavailable", "error": str(error)}), error.status

    return api


__all__ = ["ACTION_SCHEMA", "ActionIntentJournal", "CustomerOpsActionError", "CustomerOpsControlClient", "create_blueprint"]

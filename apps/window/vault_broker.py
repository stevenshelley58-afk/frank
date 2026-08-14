"""Write-only Infisical Community Edition broker for Frank.

Frank keeps opaque references and safe metadata. Secret values are accepted
only long enough to send them to the separately deployed Hermes vault broker
and are never returned, persisted, logged, or included in audit records.
Hermes/provider adapters receive a least-privilege binding to an opaque
reference, not the value.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import deque
from pathlib import Path
from typing import Callable

from flask import Blueprint, abort, jsonify, request
from werkzeug.exceptions import HTTPException

from home_platform import _reject_sensitive
from provider_adapters import get_adapter, public_catalog


api = Blueprint("vault_broker", __name__)

DATA_DIR = Path(os.environ.get("CHAT_STORE_DIR", "/data"))
VAULT_METADATA_FILE = Path(os.environ.get("VAULT_METADATA_FILE", str(DATA_DIR / "vault-metadata.json")))
DEFAULT_MAX_SECRET_BYTES = 64 * 1024
MAX_SECRET_BYTES = int(os.environ.get("FRANK_VAULT_MAX_SECRET_BYTES", str(DEFAULT_MAX_SECRET_BYTES)))
MAX_REQUEST_BYTES = int(os.environ.get("FRANK_VAULT_MAX_REQUEST_BYTES", str(MAX_SECRET_BYTES + 16 * 1024)))
RATE_LIMIT = int(os.environ.get("FRANK_VAULT_RATE_LIMIT", "30"))
RATE_WINDOW_SECONDS = int(os.environ.get("FRANK_VAULT_RATE_WINDOW_SECONDS", "60"))
REPLAY_TTL_SECONDS = int(os.environ.get("FRANK_VAULT_REPLAY_TTL_SECONDS", "600"))
DELETE_PLAN_TTL_SECONDS = int(os.environ.get("FRANK_VAULT_DELETE_PLAN_TTL_SECONDS", "300"))
HTTP_TIMEOUT_SECONDS = float(os.environ.get("FRANK_VAULT_HTTP_TIMEOUT_SECONDS", "8"))
HEALTH_CACHE_SECONDS = float(os.environ.get("FRANK_VAULT_HEALTH_CACHE_SECONDS", "10"))
HEALTH_STATUS_MAP = {
    "verified": "verified", "ready": "verified", "ok": "verified",
    "setup_needed": "setup_needed", "unavailable": "unavailable",
    "permission_denied": "permission_denied", "error": "error",
}

SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SAFE_REF_ID = re.compile(r"^[a-f0-9]{32}$")
SAFE_CAPABILITY = re.compile(r"^[a-z][a-z0-9_.-]{1,63}$")
SAFE_IDEMPOTENCY = re.compile(r"^[A-Za-z0-9._~-]{16,128}$")
SAFE_CONFIRMATION_TOKEN = re.compile(r"^[A-Za-z0-9_-]{32,256}$")
SAFE_RECEIPT_ID = re.compile(r"^[a-f0-9]{32}$")
SAFE_PROVIDER_PATH = re.compile(r"^/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]*$")
VAULT_REF_PREFIX = "vault://frank/"
ALLOWED_METHODS = {"POST", "PATCH", "DELETE"}
MUTATING_PATHS = ("/api/vault/secrets", "/api/provider-broker/bindings")
CREATE_FIELDS = {
    "project_id", "environment", "secret_path", "secret_name", "scope_kind", "scope_id",
    "provider", "consumer", "capabilities", "secret_value",
}
ROTATE_FIELDS = {"secret_value"}
BIND_FIELDS = {"vault_ref", "provider", "capabilities"}
DELETE_FIELDS = {"confirmation_token", "provider_receipt"}


class VaultError(Exception):
    """An error with a safe, user-facing message that contains no upstream data."""

    def __init__(self, code: str, message: str, status: int = 503):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class VaultUnavailable(VaultError):
    def __init__(self):
        super().__init__("vault_unavailable", "The secure vault is unavailable.", 503)


class VaultPermissionDenied(VaultError):
    def __init__(self):
        super().__init__("vault_permission_denied", "The secure vault denied this operation.", 403)


class VaultRemoteError(VaultError):
    def __init__(self):
        super().__init__("vault_error", "The secure vault returned an error.", 502)


class MetadataStoreError(VaultError):
    def __init__(self):
        super().__init__("metadata_store_error", "Secure-vault metadata is unavailable.", 503)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never replay a broker request, especially one carrying Authorization."""

    def redirect_request(self, request, file, code, message, headers, newurl):
        raise VaultRemoteError()


class HermesVaultAdapter:
    """Frank's only production vault client.

    The Hermes endpoint is intentionally narrow and must never be a generic
    Infisical proxy or expose a reveal operation. Secret values can be sent on
    create/rotate, but only safe metadata can cross back to Frank.
    """

    def __init__(self, *, base_url: str | None = None, key: str | None = None,
                 opener: Callable | None = None):
        configured_url = base_url if base_url is not None else os.environ.get("HERMES_VAULT_BROKER_URL", "").strip()
        self.base_url = configured_url.rstrip("/")
        self.key = key if key is not None else os.environ.get("HERMES_VAULT_BROKER_KEY", "").strip()
        self.opener = opener or urllib.request.build_opener(_NoRedirectHandler()).open
        self._health_lock = threading.RLock()
        self._health_cached_at = 0.0
        self._health_cached_status = "setup_needed"

    def status(self) -> str:
        if not self.base_url or not self.key:
            return "setup_needed"
        now = time.monotonic()
        with self._health_lock:
            if now - self._health_cached_at < HEALTH_CACHE_SECONDS:
                return self._health_cached_status
            try:
                response = self._request("GET", "health")
                status = str(response.get("status", "")).strip().lower()
                if status in HEALTH_STATUS_MAP:
                    self._health_cached_status = HEALTH_STATUS_MAP[status]
                elif response.get("ok") is True:
                    self._health_cached_status = "verified"
                else:
                    self._health_cached_status = "error"
            except VaultPermissionDenied:
                self._health_cached_status = "permission_denied"
            except VaultUnavailable:
                self._health_cached_status = "unavailable"
            except VaultError:
                self._health_cached_status = "error"
            self._health_cached_at = time.monotonic()
            return self._health_cached_status

    def _request(self, method: str, operation: str, body: dict | None = None) -> dict:
        if not self.base_url or not self.key:
            raise VaultUnavailable()
        raw_body = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            f"{self.base_url}/secrets/{operation}",
            data=raw_body,
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
            method=method,
        )
        try:
            with self.opener(req, timeout=HTTP_TIMEOUT_SECONDS) as response:
                raw = response.read(MAX_REQUEST_BYTES)
                if len(raw) >= MAX_REQUEST_BYTES:
                    raise VaultRemoteError()
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise VaultPermissionDenied() from None
            if error.code == 404:
                raise VaultError("vault_not_found", "The secure vault record was not found.", 404) from None
            raise VaultRemoteError() from None
        except VaultError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError):
            raise VaultUnavailable() from None
        except Exception:
            raise VaultRemoteError() from None
        try:
            decoded = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise VaultRemoteError() from None
        return decoded if isinstance(decoded, dict) else {}

    def create(self, **kwargs) -> dict:
        return _safe_remote_response(self._request("POST", "create", kwargs))

    def rotate(self, **kwargs) -> dict:
        return _safe_remote_response(self._request("POST", "rotate", kwargs))

    def delete(self, **kwargs) -> dict:
        return _safe_remote_response(self._request("POST", "delete", kwargs))

    def list_metadata(self, **kwargs) -> list[dict]:
        response = self._request("POST", "list-metadata", kwargs)
        items = response.get("secrets", [])
        return [_safe_remote_metadata(item) for item in items if isinstance(item, dict)]


def _safe_remote_metadata(item: dict) -> dict:
    """Allow-list metadata fields; never pass through provider JSON."""
    allowed = {
        "id", "_id", "environment", "version", "type", "secretKey",
        "secretPath", "createdAt", "updatedAt", "secretValueHidden",
    }
    return {key: item[key] for key in allowed if key in item and key != "secretValue"}


def _safe_remote_response(response: dict) -> dict:
    """Strip accidental values before a provider result reaches Broker."""
    secret = response.get("secret") if isinstance(response.get("secret"), dict) else None
    return {"secret": _safe_remote_metadata(secret)} if secret is not None else {}


def _validate_fields(payload: dict, allowed: set[str]) -> None:
    if set(payload) - allowed:
        raise VaultError("unsupported_fields", "The request contains unsupported fields.", 400)


def _scan_metadata(payload: dict, fields: set[str], *, secret_value: str = "") -> None:
    """Use Frank's shared sensitive-input scanner plus exact-value matching."""
    # The opaque vault ref is validated structurally by _vault_ref; scanning
    # its random token as payment data would create false positives.
    metadata = {key: payload[key] for key in fields if key in payload and key != "vault_ref"}
    try:
        _reject_sensitive(metadata)
    except HTTPException:
        raise VaultError("sensitive_metadata", "Metadata contains disallowed sensitive data.", 400) from None
    if secret_value and _contains_secret_scalar(metadata, secret_value):
        raise VaultError("sensitive_metadata", "Metadata must not contain the secret value.", 400)


def _contains_secret_scalar(value: object, secret_value: str) -> bool:
    if isinstance(value, str):
        return secret_value == value or secret_value in value
    if isinstance(value, dict):
        return any(_contains_secret_scalar(item, secret_value) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains_secret_scalar(item, secret_value) for item in value)
    return False


class MetadataStore:
    """Atomic JSON metadata store that has no field capable of holding values."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()

    def _read(self) -> dict:
        if not self.path.exists():
            return {"version": 1, "records": [], "bindings": [], "audit": [], "plans": []}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise MetadataStoreError() from None
        if not isinstance(data, dict) or data.get("version") != 1:
            raise MetadataStoreError()
        if not all(isinstance(data.get(key), list) for key in ("records", "bindings", "audit")):
            raise MetadataStoreError()
        plans = data.get("plans", [])
        if not isinstance(plans, list):
            raise MetadataStoreError()
        if any(not isinstance(item, dict) for key in ("records", "bindings", "audit") for item in data[key]) or any(not isinstance(item, dict) for item in plans):
            raise MetadataStoreError()
        return {
            "version": 1,
            "records": [self._safe_record(item) for item in data.get("records", []) if isinstance(item, dict)],
            "bindings": [self._safe_binding(item) for item in data.get("bindings", []) if isinstance(item, dict)],
            "audit": [self._safe_audit(item) for item in data.get("audit", []) if isinstance(item, dict)][-200:],
            "plans": [self._safe_plan(item) for item in plans if isinstance(item, dict)][-500:],
        }

    @staticmethod
    def _safe_record(item: dict) -> dict:
        fields = {
            "ref", "project_id", "environment", "secret_path", "secret_name",
            "scope_kind", "scope_id", "provider", "consumer", "capabilities",
            "status", "version", "created_at", "updated_at",
        }
        record = {key: item[key] for key in fields if key in item}
        record["capabilities"] = [str(value) for value in record.get("capabilities", []) if isinstance(value, str)]
        return record

    @staticmethod
    def _safe_binding(item: dict) -> dict:
        fields = {"binding_id", "ref", "provider", "consumer", "capabilities", "created_at", "updated_at"}
        binding = {key: item[key] for key in fields if key in item}
        binding["capabilities"] = [str(value) for value in binding.get("capabilities", []) if isinstance(value, str)]
        return binding

    @staticmethod
    def _safe_audit(item: dict) -> dict:
        fields = {"event_id", "operation", "ref", "provider", "consumer", "status", "at"}
        return {key: item[key] for key in fields if key in item}

    @staticmethod
    def _safe_plan(item: dict) -> dict:
        fields = {"plan_id", "ref", "receipt_id", "token_hash", "expires_at", "consumed", "created_at"}
        return {key: item[key] for key in fields if key in item}

    def write(self, data: dict) -> None:
        if self.path.exists():
            # A direct write must not be allowed to turn an unreadable store
            # into an apparently empty/healthy one.
            self._read()
        safe = {
            "version": 1,
            "records": [self._safe_record(item) for item in data.get("records", [])],
            "bindings": [self._safe_binding(item) for item in data.get("bindings", [])],
            "audit": [self._safe_audit(item) for item in data.get("audit", [])][-200:],
            "plans": [self._safe_plan(item) for item in data.get("plans", [])][-500:],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp.write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(self.path)
        except OSError:
            raise MetadataStoreError() from None

    def records(self) -> list[dict]:
        with self.lock:
            return self._read()["records"]

    def find(self, ref: str) -> dict | None:
        with self.lock:
            return next((item for item in self._read()["records"] if item.get("ref") == ref), None)

    def add(self, record: dict) -> None:
        with self.lock:
            data = self._read()
            data["records"] = [item for item in data["records"] if item.get("ref") != record["ref"]]
            data["records"].append(self._safe_record(record))
            self.write(data)

    def add_with_audit(self, record: dict, event: dict) -> None:
        """Persist a record and its audit event in one atomic JSON replace."""
        self.commit(record=record, audit_event=event)

    def commit(self, *, record: dict | None = None, remove_ref: str = "",
               binding: dict | None = None, plan: dict | None = None,
               consume_plan_id: str = "", audit_event: dict | None = None) -> None:
        """Commit the complete metadata projection with one atomic replace."""
        with self.lock:
            data = self._read()
            if remove_ref:
                data["records"] = [item for item in data["records"] if item.get("ref") != remove_ref]
                data["bindings"] = [item for item in data["bindings"] if item.get("ref") != remove_ref]
            if record is not None:
                data["records"] = [item for item in data["records"] if item.get("ref") != record["ref"]]
                data["records"].append(self._safe_record(record))
            if binding is not None:
                data["bindings"] = [
                    item for item in data["bindings"]
                    if not (item.get("ref") == binding["ref"] and item.get("provider") == binding["provider"])
                ]
                data["bindings"].append(self._safe_binding(binding))
            if plan is not None:
                data["plans"] = [item for item in data["plans"] if item.get("plan_id") != plan["plan_id"]]
                data["plans"].append(self._safe_plan(plan))
            if consume_plan_id:
                matched = False
                for item in data["plans"]:
                    if item.get("plan_id") == consume_plan_id:
                        item["consumed"] = True
                        matched = True
                        break
                if not matched:
                    raise VaultError("delete_confirmation_invalid", "The delete confirmation is invalid.", 409)
            if audit_event is not None:
                data["audit"].append(self._safe_audit(audit_event))
            self.write(data)

    def find_plan(self, receipt_id: str) -> dict | None:
        with self.lock:
            return next((item for item in self._read()["plans"] if item.get("plan_id") == receipt_id), None)

    def remove(self, ref: str) -> None:
        with self.lock:
            data = self._read()
            data["records"] = [item for item in data["records"] if item.get("ref") != ref]
            data["bindings"] = [item for item in data["bindings"] if item.get("ref") != ref]
            self.write(data)

    def bind(self, binding: dict) -> None:
        with self.lock:
            data = self._read()
            data["bindings"] = [
                item for item in data["bindings"]
                if not (item.get("ref") == binding["ref"] and item.get("provider") == binding["provider"])
            ]
            data["bindings"].append(self._safe_binding(binding))
            self.write(data)

    def bindings(self) -> list[dict]:
        with self.lock:
            return self._read()["bindings"]

    def audit(self, event: dict) -> None:
        with self.lock:
            data = self._read()
            data["audit"].append(self._safe_audit(event))
            self.write(data)


class Broker:
    def __init__(self, adapter: HermesVaultAdapter | None = None, store: MetadataStore | None = None):
        self.adapter = adapter or HermesVaultAdapter()
        self.store = store or MetadataStore(VAULT_METADATA_FILE)
        self.lock = threading.RLock()

    def _ref(self) -> str:
        return VAULT_REF_PREFIX + secrets.token_hex(16)

    def create(self, payload: dict) -> dict:
        _validate_fields(payload, CREATE_FIELDS)
        value = _secret_value(payload)
        _scan_metadata(payload, CREATE_FIELDS - {"secret_value"}, secret_value=value)
        location = _location(payload, self.adapter)
        binding = _binding(payload, required=False)
        if binding and binding["provider"] != "resend":
            try:
                adapter = get_adapter(binding["provider"])
            except ValueError:
                raise VaultError("provider_unavailable", "The provider adapter is not available.", 400) from None
            if adapter.setup_mode != "available":
                raise VaultError("provider_setup_needed", adapter.setup_note, 409)
        with self.lock:
            response = self.adapter.create(**_backend_location(location), secret_value=value)
            now = int(time.time())
            record = {
                "ref": self._ref(), **location,
                "provider": binding["provider"] if binding else "",
                "consumer": binding["consumer"] if binding else "",
                "capabilities": binding["capabilities"] if binding else [],
                "status": "stored", "version": _remote_version(response),
                "created_at": now, "updated_at": now,
            }
            try:
                self.store.add_with_audit(record, {"event_id": uuid.uuid4().hex, "operation": "create", "ref": record["ref"], "provider": record["provider"], "consumer": record["consumer"], "status": "stored", "at": now})
            except MetadataStoreError:
                try:
                    self.adapter.delete(**_backend_location(location))
                except Exception:
                    pass
                try:
                    self.store.remove(record["ref"])
                except Exception:
                    pass
                raise
            except Exception:
                # Best-effort cleanup avoids leaving an unmanaged secret. The
                # failure exposed to Frank remains a fixed safe message.
                try:
                    self.adapter.delete(**_backend_location(location))
                except Exception:
                    pass
                try:
                    self.store.remove(record["ref"])
                except Exception:
                    pass
                raise VaultRemoteError() from None
        return _public_record(record)

    def rotate(self, ref: str, payload: dict) -> dict:
        _validate_fields(payload, ROTATE_FIELDS)
        record = self._record(ref)
        value = _secret_value(payload)
        _scan_metadata(payload, ROTATE_FIELDS - {"secret_value"}, secret_value=value)
        with self.lock:
            response = self.adapter.rotate(
                project_id=record["project_id"], environment=record["environment"],
                secret_path=record["secret_path"], secret_name=record["secret_name"], secret_value=value,
            )
            record["version"] = _remote_version(response) or int(record.get("version") or 0) + 1
            record["updated_at"] = int(time.time())
            self.store.commit(
                record=record,
                audit_event={"event_id": uuid.uuid4().hex, "operation": "rotate", "ref": ref, "provider": record.get("provider", ""), "consumer": record.get("consumer", ""), "status": "stored", "at": record["updated_at"]},
            )
        return _public_record(record)

    def delete_plan(self, ref: str) -> dict:
        self._record(ref)
        now = int(time.time())
        token = secrets.token_urlsafe(32)
        receipt_id = secrets.token_hex(16)
        plan = {
            "plan_id": receipt_id,
            "ref": ref,
            "receipt_id": receipt_id,
            "token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
            "expires_at": now + max(1, DELETE_PLAN_TTL_SECONDS),
            "consumed": False,
            "created_at": now,
        }
        self.store.commit(
            plan=plan,
            audit_event={
                "event_id": uuid.uuid4().hex, "operation": "delete-plan", "ref": ref,
                "provider": "", "consumer": "", "status": "issued", "at": now,
            },
        )
        return {
            "confirmation_token": token,
            "receipt_id": receipt_id,
            "ref": ref,
            "expires_at": plan["expires_at"],
            "write_only": True,
        }

    def delete(self, ref: str, payload: dict) -> None:
        with self.lock:
            token, receipt_id = _delete_confirmation(self.store, ref, payload)
            record = self._record(ref)
            self.adapter.delete(
                project_id=record["project_id"], environment=record["environment"],
                secret_path=record["secret_path"], secret_name=record["secret_name"],
                confirmation_token=token,
                provider_receipt={"receipt_id": receipt_id},
            )
            self.store.commit(
                remove_ref=ref,
                consume_plan_id=receipt_id,
                audit_event={"event_id": uuid.uuid4().hex, "operation": "delete", "ref": ref, "provider": record.get("provider", ""), "consumer": record.get("consumer", ""), "status": "deleted", "at": int(time.time())},
            )

    def _record(self, ref: str) -> dict:
        if not SAFE_REF_ID.fullmatch(ref.removeprefix(VAULT_REF_PREFIX)):
            raise VaultError("invalid_vault_reference", "The vault reference is invalid.", 400)
        record = self.store.find(ref)
        if not record:
            raise VaultError("vault_reference_not_found", "The vault reference was not found.", 404)
        return record

    def bind(self, payload: dict) -> dict:
        _validate_fields(payload, BIND_FIELDS)
        _scan_metadata(payload, BIND_FIELDS)
        ref = _vault_ref(payload.get("vault_ref"))
        record = self._record(ref)
        try:
            adapter = get_adapter(str(payload.get("provider", "")))
        except ValueError:
            raise VaultError("provider_unavailable", "The provider adapter is not available.", 400) from None
        if adapter.setup_mode != "available":
            raise VaultError("provider_setup_needed", adapter.setup_note, 409)
        requested = _capabilities(payload.get("capabilities", adapter.capabilities), adapter.capabilities)
        if record.get("provider") and record["provider"] != adapter.provider:
            raise VaultError("provider_mismatch", "The vault reference is bound to another provider.", 409)
        now = int(time.time())
        binding = {
            "binding_id": uuid.uuid4().hex[:16], "ref": ref, "provider": adapter.provider,
            "consumer": adapter.consumer, "capabilities": requested,
            "created_at": now, "updated_at": now,
        }
        record.update({"provider": adapter.provider, "consumer": adapter.consumer, "capabilities": requested, "updated_at": now})
        with self.lock:
            self.store.commit(
                record=record,
                binding=binding,
                audit_event={"event_id": uuid.uuid4().hex, "operation": "bind", "ref": ref, "provider": adapter.provider, "consumer": adapter.consumer, "status": "bound", "at": now},
            )
        return {key: value for key, value in binding.items() if key != "binding_id" or value}


def _remote_version(response: dict) -> int:
    secret = response.get("secret") if isinstance(response.get("secret"), dict) else {}
    try:
        return int(secret.get("version") or 0)
    except (TypeError, ValueError):
        return 0


def _public_record(record: dict) -> dict:
    fields = {
        "ref", "project_id", "environment", "secret_path", "secret_name",
        "scope_kind", "scope_id", "provider", "consumer", "capabilities",
        "status", "version", "created_at", "updated_at",
    }
    return {key: record[key] for key in fields if key in record and key != "secret_value"}


def _secret_value(payload: dict) -> str:
    if "secret_value" not in payload or not isinstance(payload["secret_value"], str):
        raise VaultError("secret_value_required", "A secret value is required.", 400)
    value = payload["secret_value"]
    if not value or len(value.encode("utf-8")) > MAX_SECRET_BYTES:
        raise VaultError("secret_value_too_large", "The secret value is empty or too large.", 413)
    return value


def _segment(value: object, label: str, *, required: bool = True) -> str:
    text = str(value or "").strip()
    if not text and not required:
        return ""
    if not SAFE_SEGMENT.fullmatch(text):
        raise VaultError("invalid_scope", f"The {label} is invalid.", 400)
    return text


def _path(value: object) -> str:
    text = str(value or "/").strip()
    if len(text) > 256 or ".." in text or "\x00" in text or not SAFE_PROVIDER_PATH.fullmatch(text):
        raise VaultError("invalid_secret_path", "The secret path is invalid.", 400)
    return text or "/"


def _location(payload: dict, adapter: HermesVaultAdapter) -> dict:
    project_id = _segment(payload.get("project_id"), "project id")
    environment = _segment(payload.get("environment"), "environment")
    secret_path = _path(payload.get("secret_path", "/frank"))
    secret_name = _segment(payload.get("secret_name"), "secret name")
    scope_kind = str(payload.get("scope_kind", "global")).strip().lower()
    if scope_kind not in {"global", "project"}:
        raise VaultError("invalid_scope", "The scope must be global or project.", 400)
    scope_id = _segment(payload.get("scope_id"), "scope id") if scope_kind == "project" else ""
    return {
        "project_id": project_id, "environment": environment, "secret_path": secret_path,
        "secret_name": secret_name, "scope_kind": scope_kind, "scope_id": scope_id,
    }


def _backend_location(location: dict) -> dict:
    return {key: location[key] for key in ("project_id", "environment", "secret_path", "secret_name")}


def _capabilities(values: object, allowed: tuple[str, ...]) -> list[str]:
    if not isinstance(values, list) or not values or len(values) > len(allowed):
        raise VaultError("invalid_capabilities", "Requested capabilities are not allowed.", 400)
    result = sorted({str(value).strip() for value in values})
    if any(not SAFE_CAPABILITY.fullmatch(item) or item not in allowed for item in result):
        raise VaultError("invalid_capabilities", "Requested capabilities are not allowed.", 400)
    return result


def _binding(payload: dict, *, required: bool) -> dict | None:
    provider = str(payload.get("provider", "")).strip().lower()
    if not provider:
        if required:
            raise VaultError("provider_required", "A provider binding is required.", 400)
        return None
    try:
        adapter = get_adapter(provider)
    except ValueError:
        raise VaultError("provider_unavailable", "The provider adapter is not available.", 400) from None
    if adapter.setup_mode != "available":
        raise VaultError("provider_setup_needed", adapter.setup_note, 409)
    consumer = str(payload.get("consumer", adapter.consumer)).strip()
    if consumer != adapter.consumer:
        raise VaultError("invalid_consumer", "The consumer is not allowed for this provider.", 400)
    return {"provider": adapter.provider, "consumer": adapter.consumer, "capabilities": _capabilities(payload.get("capabilities", [adapter.capabilities[0]]), adapter.capabilities)}


def _vault_ref(value: object) -> str:
    text = str(value or "").strip()
    if not text.startswith(VAULT_REF_PREFIX) or not SAFE_REF_ID.fullmatch(text.removeprefix(VAULT_REF_PREFIX)):
        raise VaultError("invalid_vault_reference", "The vault reference is invalid.", 400)
    return text


def _delete_confirmation(store: MetadataStore, ref: str, payload: dict) -> tuple[str, str]:
    """Validate a durable delete plan without exposing its token or contents."""
    _validate_fields(payload, DELETE_FIELDS)
    token = payload.get("confirmation_token")
    receipt = payload.get("provider_receipt")
    if not isinstance(token, str) or not SAFE_CONFIRMATION_TOKEN.fullmatch(token):
        raise VaultError("delete_confirmation_invalid", "The delete confirmation is invalid.", 403)
    if not isinstance(receipt, dict) or set(receipt) != {"receipt_id"}:
        raise VaultError("delete_confirmation_invalid", "The delete confirmation is invalid.", 403)
    receipt_id = receipt.get("receipt_id")
    if not isinstance(receipt_id, str) or not SAFE_RECEIPT_ID.fullmatch(receipt_id):
        raise VaultError("delete_confirmation_invalid", "The delete confirmation is invalid.", 403)
    plan = store.find_plan(receipt_id)
    if not plan:
        raise VaultError("delete_confirmation_invalid", "The delete confirmation is invalid.", 409)
    if plan.get("ref") != ref:
        raise VaultError("delete_confirmation_ref_mismatch", "The delete confirmation does not match this reference.", 409)
    if plan.get("consumed"):
        raise VaultError("delete_confirmation_replayed", "The delete confirmation has already been used.", 409)
    try:
        expired = float(plan.get("expires_at", 0)) <= time.time()
    except (TypeError, ValueError):
        expired = True
    if expired:
        raise VaultError("delete_confirmation_expired", "The delete confirmation has expired.", 410)
    expected_hash = plan.get("token_hash", "")
    actual_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not isinstance(expected_hash, str) or not hmac.compare_digest(expected_hash, actual_hash):
        raise VaultError("delete_confirmation_invalid", "The delete confirmation is invalid.", 403)
    return token, receipt_id


def _origin_allowed() -> bool:
    origin = request.headers.get("Origin", "").strip().rstrip("/")
    if not origin:
        return False
    configured = {
        item.strip().rstrip("/") for item in os.environ.get(
            "FRANK_VAULT_ALLOWED_ORIGINS", "https://frank.fail,http://localhost:8080,http://127.0.0.1:8080"
        ).split(",") if item.strip()
    }
    return origin in configured


_rate_lock = threading.RLock()
_rate_events: dict[str, deque[float]] = {}
_replay_lock = threading.RLock()
_replays: dict[str, tuple[float, str, dict]] = {}


def _rate_allowed() -> bool:
    now = time.monotonic()
    client = request.remote_addr or "unknown"
    with _rate_lock:
        events = _rate_events.setdefault(client, deque())
        while events and events[0] <= now - RATE_WINDOW_SECONDS:
            events.popleft()
        if len(events) >= RATE_LIMIT:
            return False
        events.append(now)
        return True


def _idempotent(operation: str, body: dict) -> tuple[str, dict | None]:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not SAFE_IDEMPOTENCY.fullmatch(key):
        raise VaultError("idempotency_key_required", "A valid Idempotency-Key is required for secret writes.", 400)
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    body_hash = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    replay_key = f"{operation}:{digest}"
    now = time.monotonic()
    with _replay_lock:
        for candidate, (expires, _, _) in list(_replays.items()):
            if expires <= now:
                _replays.pop(candidate, None)
        prior = _replays.get(replay_key)
        if prior:
            if prior[1] != body_hash:
                raise VaultError("idempotency_key_reused", "The Idempotency-Key was reused with different data.", 409)
            if prior[2] is None:
                raise VaultError("request_in_progress", "An equivalent secure-vault request is already in progress.", 409)
            return replay_key, prior[2]
        # Reserve before the upstream call so two concurrent requests cannot
        # create or rotate twice with the same key.
        _replays[replay_key] = (now + REPLAY_TTL_SECONDS, body_hash, None)
    return replay_key, None


def _save_idempotent(key: str, body: dict, response: dict) -> None:
    body_hash = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    with _replay_lock:
        _replays[key] = (time.monotonic() + REPLAY_TTL_SECONDS, body_hash, response)


def _release_idempotent(key: str) -> None:
    with _replay_lock:
        _replays.pop(key, None)


@api.errorhandler(VaultError)
def _vault_error(error: VaultError):
    return jsonify({"error": {"code": error.code, "message": error.message}}), error.status


@api.errorhandler(HTTPException)
def _http_error(error: HTTPException):
    return jsonify({"error": {"code": "request_invalid", "message": error.description or "The request is invalid."}}), error.code


@api.before_request
def _guards():
    if request.method in ALLOWED_METHODS and request.path.startswith(MUTATING_PATHS):
        if not _origin_allowed():
            raise VaultError("origin_denied", "The request origin is not allowed.", 403)
        # Read and cache the body before JSON parsing so chunked requests and
        # missing Content-Length headers cannot bypass the limit.
        raw_body = request.get_data(cache=True)
        if len(raw_body) > MAX_REQUEST_BYTES:
            raise VaultError("request_too_large", "The request is too large.", 413)
        if not _rate_allowed():
            raise VaultError("rate_limited", "Too many secure-vault requests.", 429)


@api.after_request
def _no_store(response):
    if request.path.startswith("/api/vault/") or request.path.startswith("/api/provider-broker/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Vary"] = "Origin"
    return response


_broker = Broker()


def configure(*, adapter: HermesVaultAdapter | None = None, store: MetadataStore | None = None) -> None:
    global _broker
    _broker = Broker(adapter=adapter, store=store)


@api.get("/api/vault/status")
def vault_status():
    status = _broker.adapter.status()
    status_details = {
        "setup_needed": (False, "Secure vault broker setup is required."),
        "unavailable": (False, "Secure vault broker is unavailable."),
        "permission_denied": (False, "Secure vault broker permission was denied."),
        "error": (False, "Secure vault broker returned an error."),
        "verified": (True, "Secure vault broker is verified."),
    }
    configured, message = status_details.get(status, (False, "Secure vault broker state is unknown."))
    return jsonify({
        "schema": "schema://frank.vault-status/v1",
        "provider": "infisical-ce",
        "status": status,
        "configured": configured,
        "message": message,
        "enterprise_features": False,
    })


@api.get("/api/vault/secrets")
def vault_list():
    project_id = request.args.get("project_id", "").strip()
    environment = request.args.get("environment", "").strip()
    if project_id:
        project_id = _segment(project_id, "project id")
    if environment:
        environment = _segment(environment, "environment")
    records = [
        _public_record(item) for item in _broker.store.records()
        if (not project_id or item.get("project_id") == project_id)
        and (not environment or item.get("environment") == environment)
    ]
    return jsonify({"schema": "schema://frank.vault-metadata/v1", "secrets": records, "notice": "Secret values are write-only and are never returned."})


@api.post("/api/vault/secrets")
def vault_create():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise VaultError("request_invalid", "Request body must be an object.", 400)
    operation_key, prior = _idempotent("create", body)
    if prior is not None:
        return jsonify(prior), 200
    try:
        result = {"secret": _broker.create(body), "write_only": True}
    except Exception:
        _release_idempotent(operation_key)
        raise
    _save_idempotent(operation_key, body, result)
    return jsonify(result), 201


@api.post("/api/vault/secrets/<ref_id>/rotate")
def vault_rotate(ref_id: str):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise VaultError("request_invalid", "Request body must be an object.", 400)
    ref = f"{VAULT_REF_PREFIX}{ref_id}"
    operation_key, prior = _idempotent("rotate:" + ref_id, body)
    if prior is not None:
        return jsonify(prior), 200
    try:
        result = {"secret": _broker.rotate(ref, body), "write_only": True}
    except Exception:
        _release_idempotent(operation_key)
        raise
    _save_idempotent(operation_key, body, result)
    return jsonify(result), 200


@api.post("/api/vault/secrets/<ref_id>/delete-plan")
def vault_delete_plan(ref_id: str):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise VaultError("request_invalid", "Request body must be an object.", 400)
    _validate_fields(body, set())
    ref = f"{VAULT_REF_PREFIX}{ref_id}"
    operation_key, prior = _idempotent("delete-plan:" + ref_id, body)
    if prior is not None:
        return jsonify(prior), 200
    try:
        result = _broker.delete_plan(ref)
    except Exception:
        _release_idempotent(operation_key)
        raise
    _save_idempotent(operation_key, body, result)
    return jsonify(result), 201


@api.delete("/api/vault/secrets/<ref_id>")
def vault_delete(ref_id: str):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise VaultError("request_invalid", "Request body must be an object.", 400)
    ref = f"{VAULT_REF_PREFIX}{ref_id}"
    operation_key, prior = _idempotent("delete:" + ref_id, body)
    if prior is not None:
        return jsonify(prior), 200
    try:
        _broker.delete(ref, body)
    except Exception:
        _release_idempotent(operation_key)
        raise
    result = {"removed": ref, "write_only": True}
    _save_idempotent(operation_key, body, result)
    return jsonify(result)


@api.get("/api/vault/secrets/<ref_id>")
def vault_reveal_disabled(ref_id: str):
    # Deliberate contract: callers can list safe metadata, rotate, or delete
    # by opaque ref, but can never read a secret through Frank.
    raise VaultError("reveal_not_available", "Secret reveal is not available through Frank.", 404)


@api.get("/api/provider-broker/catalog")
def provider_catalog():
    return jsonify({"schema": "schema://frank.provider-broker/v1", "providers": public_catalog(_broker.adapter.status())})


@api.get("/api/provider-broker/bindings")
def provider_bindings():
    return jsonify({"schema": "schema://frank.provider-binding/v1", "bindings": _broker.store.bindings(), "notice": "Bindings contain opaque vault references only."})


@api.post("/api/provider-broker/bindings")
def provider_bind():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise VaultError("request_invalid", "Request body must be an object.", 400)
    operation_key, prior = _idempotent("bind", body)
    if prior is not None:
        return jsonify(prior), 200
    try:
        result = {"binding": _broker.bind(body), "write_only": True}
    except Exception:
        _release_idempotent(operation_key)
        raise
    _save_idempotent(operation_key, body, result)
    return jsonify(result), 201

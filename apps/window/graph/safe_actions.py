"""Governed, report-only Control actions for Step 6A.

The module intentionally has no shell or command-string escape hatch.  Hermes
is supplied as a small guarded client and adapters are typed Python objects.
This makes the Window integration seam explicit while keeping the action loop
usable in an isolated VPS preview.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Mapping, Protocol

from .control_plane import ControlContractError, canonical_bytes

_ID = re.compile(r"^(?:vps|project|repo|runtime|service|component|worker|store|route|capability|rule|skill|tool|plugin|cli|mcp|app|template|library|hook|gate|policy|runbook|eval|observer|source|release|projection|generation|receipt|proposal|finding|mapping|run|edge):[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")
_KEY = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
_REV = re.compile(r"^[A-Za-z0-9_.:/-]{1,256}$")
_SHA = re.compile(r"^sha256:[0-9a-f]{64}$")
_SAFE_ACTIONS = {"refresh_evidence", "regenerate_projection", "tool:refresh-evidence", "tool:regenerate-map"}


class ActionError(ControlContractError):
    """A safe, user-facing action rejection."""


class HermesActionClient(Protocol):
    def request(self, *, action_id: str, target_id: str, arguments: Mapping[str, Any], timeout_seconds: int) -> Mapping[str, Any]: ...


class ActionAdapter(Protocol):
    adapter_id: str
    adapter_version: str
    adapter_hash: str

    def execute(self, target_id: str, arguments: Mapping[str, Any], *, timeout_seconds: int) -> Mapping[str, Any]: ...


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def _stable(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ActionError(f"invalid {label}")
    return value


class ActionRegistry:
    """Validated action definitions loaded from the canonical YAML file."""

    def __init__(self, definitions: Mapping[str, Any] | list[Mapping[str, Any]], *, enabled: bool = False):
        raw = definitions.get("actions", []) if isinstance(definitions, Mapping) else definitions
        if not isinstance(raw, list):
            raise ActionError("actions registry must contain an array")
        self.actions: dict[str, dict[str, Any]] = {}
        for item in raw:
            if not isinstance(item, Mapping):
                raise ActionError("action definition must be an object")
            action = copy.deepcopy(dict(item))
            aid = action.get("id")
            _stable(aid, "action ID")
            if aid in self.actions:
                raise ActionError(f"duplicate action ID: {aid}")
            targets = action.get("target_allowlist")
            if not isinstance(targets, list) or not targets or len(set(targets)) != len(targets):
                raise ActionError(f"invalid target allowlist for {aid}")
            for target in targets:
                _stable(target, "target ID")
            args = action.get("arguments")
            if not isinstance(args, Mapping) or "idempotency_key" not in args:
                raise ActionError(f"idempotency key missing for {aid}")
            if any(str(name).lower() in {"command", "shell", "script", "code", "executable"} for name in args):
                raise ActionError(f"arbitrary command argument in {aid}")
            if action.get("confirmation_class") != "none" and aid in _SAFE_ACTIONS:
                raise ActionError(f"safe action requires no confirmation: {aid}")
            self.actions[aid] = action
        self.enabled = enabled

    @classmethod
    def from_yaml(cls, path: Path, *, enabled: bool = False) -> "ActionRegistry":
        import yaml
        if path.is_symlink() or not path.is_file():
            raise ActionError("actions configuration is unavailable")
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
        registry = cls(value, enabled=enabled)
        schema_path = path.parent / "schema" / "action.schema.json"
        if schema_path.is_file():
            try:
                from jsonschema import Draft202012Validator
                schema = json.loads(schema_path.read_text(encoding="utf-8"))
                validator = Draft202012Validator(schema)
                for action in registry.actions.values():
                    errors = list(validator.iter_errors(action))
                    if errors:
                        raise ActionError(f"invalid action definition {action['id']}: {errors[0].message}")
            except ActionError:
                raise
            except Exception as error:
                raise ActionError("action schema is unavailable or invalid") from error
        return registry

    def resolve(self, action_id: str) -> dict[str, Any]:
        normalized = {"refresh_evidence": "tool:refresh-evidence", "regenerate_projection": "tool:regenerate-map"}.get(action_id, action_id)
        if normalized not in _SAFE_ACTIONS or normalized not in self.actions:
            raise ActionError("unknown or unavailable action")
        action = self.actions[normalized]
        if not self.enabled and not action.get("enabled", False):
            raise ActionError("safe actions are disabled")
        return action


class ImmutableReceiptStore:
    """Atomic append-only receipt files with idempotency replay."""

    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._by_key: dict[str, tuple[str, str]] = {}
        # Rebuild the replay index after a process restart.  Keep this index
        # separate from receipts so the closed action-receipt schema remains
        # authoritative and no internal metadata leaks into API responses.
        self._index_path = self.root / ".idempotency-index.json"
        try:
            if self._index_path.is_file() and not self._index_path.is_symlink():
                index = json.loads(self._index_path.read_text(encoding="utf-8"))
                if isinstance(index, Mapping):
                    for key, item in index.items():
                        if (isinstance(key, str) and isinstance(item, list) and len(item) == 2
                                and isinstance(item[0], str) and isinstance(item[1], str)
                                and _KEY.fullmatch(key) and _SHA.fullmatch(item[1])):
                            self._by_key[key] = (item[0], item[1])
        except (OSError, ValueError, TypeError):
            self._by_key.clear()

    def _path(self, receipt_id: str) -> Path:
        return self.root / (receipt_id.replace(":", "_").replace("/", "_") + ".json")

    def find(self, key: str, fingerprint: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._by_key.get(key)
            if not item:
                return None
            if item[1] != fingerprint:
                raise ActionError("idempotency key was used for another request")
            if not isinstance(item[0], str) or not re.fullmatch(r"^receipt:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$", item[0]):
                raise ActionError("receipt index contains an invalid receipt ID")
            path = self._path(item[0])
            if path.parent != self.root or path.is_symlink() or not path.is_file():
                raise ActionError("receipt is unavailable")
            return json.loads(path.read_text(encoding="utf-8"))

    def write(self, receipt: Mapping[str, Any], *, key: str, fingerprint: str) -> dict[str, Any]:
        value = copy.deepcopy(dict(receipt))
        if not _KEY.fullmatch(key) or not isinstance(fingerprint, str) or not _SHA.fullmatch(fingerprint):
            raise ActionError("invalid receipt idempotency metadata")
        rid = value["id"]
        if not isinstance(rid, str) or not re.fullmatch(r"^receipt:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$", rid):
            raise ActionError("invalid receipt ID")
        path = self._path(rid)
        data = canonical_bytes(value)
        with self._lock:
            if path.exists():
                if path.read_bytes() != data:
                    raise ActionError("immutable receipt collision")
            else:
                fd, temporary = tempfile.mkstemp(prefix=".receipt-", dir=self.root)
                try:
                    with os.fdopen(fd, "wb") as stream:
                        stream.write(data); stream.flush(); os.fsync(stream.fileno())
                    os.chmod(temporary, 0o640); os.replace(temporary, path)
                finally:
                    if os.path.exists(temporary): os.unlink(temporary)
            self._by_key[key] = (rid, fingerprint)
            index_data = canonical_bytes({name: list(item) for name, item in sorted(self._by_key.items())})
            fd, temporary_index = tempfile.mkstemp(prefix=".idempotency-index-", dir=self.root)
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(index_data); stream.flush(); os.fsync(stream.fileno())
                os.chmod(temporary_index, 0o640); os.replace(temporary_index, self._index_path)
            finally:
                if os.path.exists(temporary_index): os.unlink(temporary_index)
        return value


class SafeActionService:
    """Plan/apply service for the two non-mutating Step 6A actions."""

    def __init__(self, registry: ActionRegistry, hermes: HermesActionClient, adapters: Mapping[str, ActionAdapter], receipts: ImmutableReceiptStore, *, authority_id: str = "runtime:hermes-default", now: Any = _now):
        self.registry, self.hermes, self.adapters, self.receipts = registry, hermes, dict(adapters), receipts
        self.authority_id, self.now = _stable(authority_id, "Hermes authority ID"), now
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _lock(self, key: str) -> threading.Lock:
        with self._locks_guard: return self._locks.setdefault(key, threading.Lock())

    def plan(self, *, action_id: str, target_id: str, target_revision: str, base_revision: str, idempotency_key: str, actor: str = "operator", mode: str = "full") -> dict[str, Any]:
        action = self.registry.resolve(action_id)
        target = _stable(target_id, "target ID")
        if target not in action["target_allowlist"]: raise ActionError("target is not allowlisted")
        if not _KEY.fullmatch(idempotency_key): raise ActionError("a valid idempotency key is required")
        if not _REV.fullmatch(target_revision) or not _REV.fullmatch(base_revision): raise ActionError("exact target and base revisions are required")
        if action["id"] == "tool:refresh-evidence" and mode not in {"fast", "full"}: raise ActionError("invalid evidence refresh mode")
        adapter = self.adapters.get(action["adapter_id"])
        if adapter is None: raise ActionError("action adapter is unavailable")
        if not _REV.fullmatch(str(getattr(adapter, "adapter_version", ""))): raise ActionError("invalid adapter version")
        if not _SHA.fullmatch(str(getattr(adapter, "adapter_hash", ""))): raise ActionError("invalid adapter hash")
        fingerprint = _digest({"action_id": action["id"], "target_id": target, "target_revision": target_revision, "base_revision": base_revision, "mode": mode})
        replay = self.receipts.find(idempotency_key, fingerprint)
        return {"plan_id": "plan:" + uuid.uuid4().hex, "action_id": action["id"], "target_id": target, "target_revision": target_revision, "base_revision": base_revision, "mode": mode, "idempotency_key": idempotency_key, "actor": actor, "adapter_id": action["adapter_id"], "adapter_version": adapter.adapter_version, "adapter_hash": adapter.adapter_hash, "fingerprint": fingerprint, "replayed": replay is not None, "receipt": replay}

    def confirm(self, plan: Mapping[str, Any]) -> dict[str, Any]:
        """Safe actions have an explicit, no-op confirmation phase."""
        if not isinstance(plan, Mapping) or plan.get("action_id") not in _SAFE_ACTIONS:
            raise ActionError("only safe actions may be confirmed without destructive confirmation")
        return {"plan": dict(plan), "confirmed": True}

    def apply(self, plan: Mapping[str, Any]) -> dict[str, Any]:
        required = ("action_id", "target_id", "target_revision", "base_revision", "idempotency_key", "fingerprint", "adapter_version", "adapter_hash")
        if not isinstance(plan, Mapping) or any(key not in plan for key in required): raise ActionError("malformed action plan")
        action = self.registry.resolve(str(plan["action_id"]))
        target = _stable(str(plan["target_id"]), "target ID")
        if target not in action["target_allowlist"]: raise ActionError("target is not allowlisted")
        if not _REV.fullmatch(str(plan["target_revision"])) or not _REV.fullmatch(str(plan["base_revision"])): raise ActionError("exact target and base revisions are required")
        mode = str(plan.get("mode", "full"))
        if action["id"] == "tool:refresh-evidence" and mode not in {"fast", "full"}: raise ActionError("invalid evidence refresh mode")
        if plan.get("fingerprint") != _digest({"action_id": action["id"], "target_id": target, "target_revision": plan["target_revision"], "base_revision": plan["base_revision"], "mode": mode}): raise ActionError("plan fingerprint mismatch")
        replay = self.receipts.find(str(plan["idempotency_key"]), str(plan["fingerprint"]))
        if replay: return {"receipt": replay, "replayed": True}
        adapter = self.adapters.get(action["adapter_id"])
        if adapter is None or plan["adapter_id"] != action["adapter_id"] or plan["adapter_version"] != adapter.adapter_version or plan["adapter_hash"] != adapter.adapter_hash:
            raise ActionError("adapter version or hash does not match the planned action")
        lock_key = str(action.get("lock_key", "control-plane"))
        lock = self._lock(lock_key)
        if not lock.acquire(blocking=False): raise ActionError("action lock is busy")
        started = self.now()
        before_id = "receipt:action-before/" + uuid.uuid4().hex
        try:
            args = {"mode": mode} if action["id"] == "tool:refresh-evidence" else {"projection_id": target}
            # Hermes receives structured arguments only; it owns authorization.
            response = self.hermes.request(action_id=action["id"], target_id=target, arguments=args, timeout_seconds=int(action.get("timeout_seconds", 300)))
            if not isinstance(response, Mapping) or response.get("authorized") is False: raise ActionError("Hermes authorization failed")
            if response.get("current_revision") not in (None, plan["base_revision"]): raise ActionError("stale base revision")
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(adapter.execute, plan["target_id"], args, timeout_seconds=int(action.get("timeout_seconds", 300)))
                try: result = future.result(timeout=int(action.get("timeout_seconds", 300)))
                except FutureTimeout as error: future.cancel(); raise ActionError("action timed out") from error
            if not isinstance(result, Mapping) or result.get("ok") is False: raise ActionError("action adapter failed")
            outcome, reason = "pass", None
            after_id = "receipt:action-after/" + uuid.uuid4().hex
        except Exception as error:
            outcome, reason, after_id = "fail", str(error)[:240], None
        finally: lock.release()
        completed = self.now()
        receipt = {"id": "receipt:action/" + uuid.uuid4().hex, "kind": "action", "subject_ids": [target], "producer": self.authority_id, "source_revision_set": {"base": str(plan["base_revision"])}, "deployed_revision_set": {"target": str(plan["target_revision"])}, "captured_at": _iso(completed), "fresh_until": _iso(completed + timedelta(minutes=15)), "outcome": outcome, "evidence_uris": [before_id] + ([after_id] if after_id else []), "redaction": "secret_filtered", "action_id": action["id"], "adapter_id": action["adapter_id"], "adapter_version": str(getattr(self.adapters.get(action["adapter_id"]), "adapter_version", "0.0.0")), "adapter_hash": str(getattr(self.adapters.get(action["adapter_id"]), "adapter_hash", "sha256:" + "0" * 64)), "target_id": target, "target_revision_before": plan["base_revision"], "target_revision_requested": plan["target_revision"], "idempotency_key": plan["idempotency_key"], "lock_key": lock_key, "started_at": _iso(started), "completed_at": _iso(completed), "before_state_receipt_id": before_id, "after_state_receipt_id": after_id, "preconditions": [{"name": "target_declared", "outcome": "pass"}], "postconditions": [{"name": "receipt_written", "outcome": "pass" if outcome == "pass" else "fail"}], "rollback_action_id": action.get("rollback_action_id"), "rollback_outcome": "not_needed", "error": reason}
        # ``error`` is deliberately omitted from persisted receipts to keep the
        # schema closed and prevent adapter/provider data leakage.
        receipt.pop("error", None)
        return {"receipt": self.receipts.write(receipt, key=str(plan["idempotency_key"]), fingerprint=str(plan["fingerprint"])), "replayed": False}


__all__ = ["ActionError", "ActionRegistry", "HermesActionClient", "ImmutableReceiptStore", "SafeActionService"]

"""Durable write-ahead operation ledger for non-idempotent Hermes mutations.

`prompt.submit`, cron triggers, and other mutations without native idempotency
are journaled here before any network write: the record is fsynced in
``prepared`` state, moved to ``sending`` while the write is on the wire, and
marked ``acknowledged`` on authoritative confirmation.  Any crash between
journal states leaves the operation ``uncertain``; uncertainty is resolved
only from authoritative evidence (native events, history, runs) — never by
blindly repeating the mutation.

Only hashes, identifiers, states, and timestamps are journaled.  Prompt text,
secret input, and payload bodies are rejected outright.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Iterator

STATES = ("prepared", "sending", "acknowledged", "uncertain", "resolved")

_FORBIDDEN_KEYS = re.compile(
    r"(?:prompt|message|text|content|body|secret|password|passwd|token|data_url|audio)",
    re.I,
)
_MAX_FIELD_BYTES = 512


class LedgerError(RuntimeError):
    """Raised for journal misuse or unsafe metadata."""


def payload_digest(payload: dict[str, Any]) -> str:
    """Stable digest of the exact payload that will be sent (rfc8785 when available)."""
    try:
        from rfc8785 import dumps as jcs

        canonical = jcs(payload)
    except ImportError:  # pragma: no cover - rfc8785 is a pinned requirement
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canonical).hexdigest()


def _safe_metadata(meta: dict[str, Any], path: str = "meta") -> dict[str, Any]:
    if not isinstance(meta, dict):
        raise LedgerError("metadata must be an object")
    clean: dict[str, Any] = {}
    for key, value in meta.items():
        if not isinstance(key, str) or _FORBIDDEN_KEYS.search(key):
            raise LedgerError(f"metadata key is not allowed at {path}.{key!r}")
        if isinstance(value, dict):
            clean[key] = _safe_metadata(value, f"{path}.{key}")
        elif isinstance(value, list):
            if len(value) > 64:
                raise LedgerError(f"metadata list too large at {path}.{key}")
            clean[key] = [_safe_metadata({"v": item})["v"] for item in value]
        elif isinstance(value, (str, int, float, bool)) or value is None:
            encoded = json.dumps(value).encode()
            if len(encoded) > _MAX_FIELD_BYTES:
                raise LedgerError(f"metadata field too large at {path}.{key}")
            clean[key] = value
        else:
            raise LedgerError(f"metadata type is not journaled at {path}.{key}")
    return clean


class OperationLedger:
    """Crash-safe per-operation journal with per-target serialization."""

    def __init__(self, root: Path, *, clock: Callable[[], float] = time.time):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._clock = clock
        self._lock = threading.Lock()
        self._target_locks_guard = threading.Lock()
        self._target_locks: dict[str, threading.Lock] = {}

    def target_lock(self, target: str) -> threading.Lock:
        """One writer at a time per Hermes target (session, job id, board id)."""
        with self._target_locks_guard:
            lock = self._target_locks.get(target)
            if lock is None:
                lock = threading.Lock()
                self._target_locks[target] = lock
            return lock

    # -- journal primitives -------------------------------------------------

    def _path(self, op_id: str) -> Path:
        return self.root / f"{op_id}.json"

    @staticmethod
    def _fsync_write(path: Path, record: dict[str, Any]) -> None:
        tmp = path.with_suffix(".tmp")
        encoded = json.dumps(record, indent=2, sort_keys=True).encode()
        with open(tmp, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)

    def _read(self, op_id: str) -> dict[str, Any] | None:
        path = self._path(op_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise LedgerError(f"operation journal is unreadable: {op_id}") from error

    @staticmethod
    def _transition(record: dict[str, Any], state: str) -> dict[str, Any]:
        if state not in STATES:
            raise LedgerError(f"unsupported ledger state: {state}")
        record["state"] = state
        record["updated_at"] = time.time()
        return record

    # -- lifecycle ----------------------------------------------------------

    def prepare(self, kind: str, target: str, payload: dict[str, Any], *, refs: dict[str, Any] | None = None) -> dict[str, Any]:
        if not isinstance(kind, str) or not re.fullmatch(r"[a-z][a-z0-9_.-]{0,63}", kind or ""):
            raise LedgerError("kind must be a safe identifier")
        if not isinstance(target, str) or not target:
            raise LedgerError("target is required")
        op_id = f"op-{uuid.uuid4()}"
        record = {
            "op_id": op_id,
            "kind": kind,
            "target": target,
            "payload_sha256": payload_digest(payload),
            "refs": _safe_metadata(refs or {}),
            "state": "prepared",
            "created_at": time.time(),
            "updated_at": time.time(),
            "history": [{"state": "prepared", "at": time.time()}],
        }
        self._fsync_write(self._path(op_id), record)
        return record

    def mark_sending(self, op_id: str) -> dict[str, Any]:
        return self._update(op_id, "sending")

    def mark_acknowledged(self, op_id: str, *, result_refs: dict[str, Any] | None = None) -> dict[str, Any]:
        record = self._update(op_id, "acknowledged")
        if result_refs is not None:
            record["result_refs"] = _safe_metadata(result_refs)
            self._fsync_write(self._path(op_id), record)
        return record

    def mark_uncertain(self, op_id: str, reason: str) -> dict[str, Any]:
        if not isinstance(reason, str) or not reason:
            raise LedgerError("uncertainty reason is required")
        record = self._update(op_id, "uncertain")
        record["uncertain_reason"] = reason[:512]
        self._fsync_write(self._path(op_id), record)
        return record

    def resolve(self, op_id: str, outcome: str, *, evidence: dict[str, Any] | None = None) -> dict[str, Any]:
        """Resolve an uncertain operation from authoritative evidence only."""
        if outcome not in ("acknowledged", "failed"):
            raise LedgerError("uncertain operations resolve to acknowledged or failed")
        record = self._read(op_id)
        if record is None:
            raise LedgerError(f"unknown operation: {op_id}")
        if record["state"] != "uncertain":
            raise LedgerError(f"operation {op_id} is not uncertain")
        record = self._transition(record, "resolved")
        record["resolved_outcome"] = outcome
        record["evidence"] = _safe_metadata(evidence or {})
        record["history"].append({"state": "resolved", "at": time.time(), "outcome": outcome})
        self._fsync_write(self._path(op_id), record)
        return record

    def _update(self, op_id: str, state: str) -> dict[str, Any]:
        record = self._read(op_id)
        if record is None:
            raise LedgerError(f"unknown operation: {op_id}")
        record = self._transition(record, state)
        record["history"].append({"state": state, "at": time.time()})
        self._fsync_write(self._path(op_id), record)
        return record

    # -- queries ------------------------------------------------------------

    def get(self, op_id: str) -> dict[str, Any] | None:
        return self._read(op_id)

    def outstanding(self, target: str | None = None) -> list[dict[str, Any]]:
        """Prepared/sending/uncertain records, optionally scoped to one target."""
        results: list[dict[str, Any]] = []
        for record in self._iter_records():
            if record["state"] in ("prepared", "sending", "uncertain"):
                if target is None or record["target"] == target:
                    results.append(record)
        return sorted(results, key=lambda item: item["created_at"])

    def _iter_records(self) -> Iterator[dict[str, Any]]:
        for path in sorted(self.root.glob("*.json")):
            try:
                yield json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue

    def recover(self) -> list[dict[str, Any]]:
        """Reconcile the journal after a crash: any non-terminal record is uncertain.

        This never retries or resends anything; it only records honest state so
        the reconciliation pass (events/history/runs) can resolve evidence.
        """
        recovered: list[dict[str, Any]] = []
        for record in self._iter_records():
            if record["state"] in ("prepared", "sending"):
                record = self._transition(record, "uncertain")
                record["uncertain_reason"] = "recovered after restart"
                record["history"].append({"state": "uncertain", "at": time.time()})
                self._fsync_write(self._path(record["op_id"]), record)
                recovered.append(record)
        return recovered

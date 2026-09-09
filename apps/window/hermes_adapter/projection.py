"""Append-only, rebuildable Hermes event projection under the Window data root.

This is a *view* over Hermes activity, never a second Hermes transcript.  The
projection enforces authenticated user/project scope, per-event and per-run
byte caps, a total quota, terminal-only compaction, and TTL pruning.  Every
drop or compaction leaves an explicit truncation receipt so lifecycle truth is
visible; activity gaps are marked, never invented.  Files are written with the
existing Window atomic tmp+replace pattern under a lock.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Iterator

from .redaction import redact_value

SCHEMA = "schema://frank.hermes-event/v1"

DEFAULT_EVENT_BYTE_CAP = 64 * 1024
DEFAULT_RUN_BYTE_CAP = 512 * 1024
DEFAULT_TOTAL_QUOTA_BYTES = 64 * 1024 * 1024
DEFAULT_TTL_SECONDS = 30 * 24 * 3600
_DEFAULTS = {
    "event_byte_cap": DEFAULT_EVENT_BYTE_CAP,
    "run_byte_cap": DEFAULT_RUN_BYTE_CAP,
    "total_quota_bytes": DEFAULT_TOTAL_QUOTA_BYTES,
    "ttl_seconds": DEFAULT_TTL_SECONDS,
}


class ProjectionError(RuntimeError):
    """Raised when projection state is invalid or a guard refuses the write."""


def _atomic_replace(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


class EventProjection:
    def __init__(self, root: Path, *, limits: dict[str, int] | None = None, clock: Any = time.time):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._limits = {**_DEFAULTS, **(limits or {})}
        self._clock = clock
        self._lock = threading.RLock()

    # -- scope ---------------------------------------------------------------

    @staticmethod
    def scope_key(user: str, project: str, durable_session: str) -> str:
        """Opaque, path-safe key binding one projection to user/project/session."""
        for value in (user, project, durable_session):
            if not isinstance(value, str) or not value or "/" in value or value.startswith("."):
                raise ProjectionError("scope components must be safe non-empty identifiers")
        return f"{user}::{project}::{durable_session}"

    def _scoped_root(self, key: str) -> Path:
        return self.root / key

    def _meta_path(self, key: str) -> Path:
        return self._scoped_root(key) / "meta.json"

    def _events_path(self, key: str) -> Path:
        return self._scoped_root(key) / "events.jsonl"

    def _read_meta(self, key: str) -> dict[str, Any]:
        path = self._meta_path(key)
        if path.exists():
            try:
                meta = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(meta, dict):
                    return meta
            except json.JSONDecodeError:
                pass
        return {"schema": SCHEMA, "run_bytes": {}, "total_bytes": 0, "terminal": None, "receipts": []}

    def _write_meta(self, key: str, meta: dict[str, Any]) -> None:
        self._scoped_root(key).mkdir(parents=True, exist_ok=True)
        _atomic_replace(self._meta_path(key), json.dumps(meta, indent=2, sort_keys=True).encode())

    # -- append ---------------------------------------------------------------

    def append(self, key: str, event: dict[str, Any], *, run_id: str = "") -> dict[str, Any]:
        """Redact and append one event; enforce caps/quota; receipt on any drop."""
        if not isinstance(event, dict):
            raise ProjectionError("event must be an object")
        redacted = redact_value(event)
        encoded = json.dumps(redacted, separators=(",", ":"), sort_keys=True).encode()
        if len(encoded) > self._limits["event_byte_cap"]:
            return self._record_drop(key, run_id, "event_byte_cap", len(encoded))
        with self._lock:
            meta = self._read_meta(key)
            if meta.get("terminal"):
                raise ProjectionError("session is terminal and compacted; no further events")
            if run_id:
                run_bytes = int(meta["run_bytes"].get(run_id, 0))
                if run_bytes + len(encoded) > self._limits["run_byte_cap"]:
                    return self._record_drop(key, run_id, "run_byte_cap", len(encoded))
                meta["run_bytes"][run_id] = run_bytes + len(encoded)
            if meta["total_bytes"] + len(encoded) > self._limits["total_quota_bytes"]:
                return self._record_drop(key, run_id, "total_quota", len(encoded))
            meta["total_bytes"] += len(encoded)
            self._scoped_root(key).mkdir(parents=True, exist_ok=True)
            with open(self._events_path(key), "ab") as handle:
                handle.write(encoded + b"\n")
                handle.flush()
                os.fsync(handle.fileno())
            self._write_meta(key, meta)
        return {"appended": True, "bytes": len(encoded)}

    def _record_drop(self, key: str, run_id: str, cap: str, size: int) -> dict[str, Any]:
        receipt = {
            "dropped_at": self._clock(),
            "cap": cap,
            "event_bytes": size,
            **({"run_id": run_id} if run_id else {}),
        }
        with self._lock:
            meta = self._read_meta(key)
            meta["receipts"].append(receipt)
            self._write_meta(key, meta)
        return {"appended": False, "dropped": cap, "receipt": receipt}

    # -- lifecycle ------------------------------------------------------------

    def mark_gap(self, key: str, gap: dict[str, Any]) -> None:
        """Record an explicit, visible activity gap (never invented events)."""
        marker = {"kind": "projection.gap", "at": self._clock(), **gap}
        with self._lock:
            meta = self._read_meta(key)
            if meta.get("terminal"):
                raise ProjectionError("session is terminal and compacted; gaps can no longer be marked")
            meta["receipts"].append({"kind": "gap", **marker})
            self._scoped_root(key).mkdir(parents=True, exist_ok=True)
            with open(self._events_path(key), "ab") as handle:
                handle.write(json.dumps(marker, separators=(",", ":"), sort_keys=True).encode() + b"\n")
                handle.flush()
                os.fsync(handle.fileno())
            self._write_meta(key, meta)

    def mark_terminal(self, key: str, *, reconciliation_receipt: dict[str, Any]) -> None:
        """Freeze the session after terminal state + verified reconciliation."""
        if not isinstance(reconciliation_receipt, dict) or not reconciliation_receipt:
            raise ProjectionError("terminal compaction requires a reconciliation receipt")
        with self._lock:
            meta = self._read_meta(key)
            meta["terminal"] = {"at": self._clock(), "receipt": reconciliation_receipt}
            self._write_meta(key, meta)

    def compact(self, key: str) -> dict[str, Any]:
        """Compact a terminal session to a receipt; refuses non-terminal sessions."""
        with self._lock:
            meta = self._read_meta(key)
            if not meta.get("terminal"):
                raise ProjectionError("compaction is only allowed after terminal state")
        events = list(self.iter_events(key))
        receipt = {
            "compacted_at": self._clock(),
            "event_count": len(events),
            "total_bytes": meta.get("total_bytes", 0),
            "terminal_receipt": meta["terminal"]["receipt"],
        }
        _atomic_replace(self._events_path(key), json.dumps({"receipt": receipt}).encode() + b"\n")
        with self._lock:
            meta = self._read_meta(key)
            meta["compacted"] = receipt
            self._write_meta(key, meta)
        return receipt

    def prune(self) -> int:
        """Remove sessions idle beyond TTL; returns the number pruned."""
        now = self._clock()
        pruned = 0
        for key in self.session_keys():
            meta = self._read_meta(key)
            last = meta.get("terminal", {}).get("at") if meta.get("terminal") else None
            if last is None:
                continue
            if now - float(last) > self._limits["ttl_seconds"]:
                events = self._events_path(key)
                if events.exists():
                    events.unlink()
                pruned += 1
        return pruned

    # -- reads ----------------------------------------------------------------

    def iter_events(self, key: str, *, after_frank_sequence: int = -1) -> Iterator[dict[str, Any]]:
        path = self._events_path(key)
        if not path.exists():
            return
        with open(path, "rb") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    item = {"kind": "projection.corrupt-line", "raw_redacted": True}
                if item.get("receipt") is not None:
                    yield item
                    continue
                sequence = item.get("sequence", item.get("frank_sequence"))
                if sequence is None or sequence > after_frank_sequence:
                    yield item

    def session_keys(self) -> list[str]:
        return sorted(item.name for item in self.root.iterdir() if item.is_dir() and "::" in item.name)

    def meta(self, key: str) -> dict[str, Any]:
        meta = self._read_meta(key)
        return json.loads(json.dumps(meta))

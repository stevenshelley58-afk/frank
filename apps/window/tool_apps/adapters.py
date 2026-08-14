"""Transport-neutral Hermes command and event envelopes.

These boundaries are intentionally boring: Frank forwards commands and
displays ordered events; Hermes remains responsible for policy and execution.
"""

from __future__ import annotations

import copy
import math
import time
import uuid
from typing import Any

from .contracts import COMMAND_SCHEMA, EVENT_SCHEMA, TRACE_SCHEMA, ContractError, _ID, _walk_safe, validate_scope

_EVENT_STATUSES = frozenset({"ok", "error", "running", "cancelled", "blocked"})


def command(tool_id: str, action: str, scope: Any, payload: dict[str, Any], *, request_id: str | None = None) -> dict[str, Any]:
    for field, value in (("tool_id", tool_id), ("action", action)):
        if not isinstance(value, str) or not _ID.fullmatch(value):
            raise ContractError(f"command {field} must be a safe identifier")
    _walk_safe(payload, "command.payload")
    return {"schema": COMMAND_SCHEMA, "request_id": request_id or uuid.uuid4().hex, "tool_id": tool_id, "action": action, "scope": validate_scope(scope), "payload": copy.deepcopy(payload)}


def event(request_id: str, sequence: int, kind: str, data: dict[str, Any], *, status: str = "ok", timestamp: float | None = None) -> dict[str, Any]:
    if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
        raise ContractError("event request_id must be a safe identifier")
    if not isinstance(sequence, int) or sequence < 0:
        raise ContractError("event sequence must be non-negative")
    if not isinstance(kind, str) or not _ID.fullmatch(kind):
        raise ContractError("event kind must be a safe identifier")
    if status not in _EVENT_STATUSES:
        raise ContractError("event status is unsupported")
    if timestamp is not None and (not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp)):
        raise ContractError("event timestamp must be finite")
    if not isinstance(data, dict):
        raise ContractError("event data must be an object")
    _walk_safe(data, "event.data")
    return {"schema": EVENT_SCHEMA, "request_id": request_id, "sequence": sequence, "kind": kind, "status": status, "timestamp": timestamp if timestamp is not None else time.time(), "data": copy.deepcopy(data)}


def trace(request_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
        raise ContractError("trace request_id must be a safe identifier")
    if not isinstance(events, list):
        raise ContractError("trace events must be a list")
    for item in events:
        if not isinstance(item, dict) or item.get("schema") != EVENT_SCHEMA:
            raise ContractError("trace contains a non-event envelope")
        event(item.get("request_id"), item.get("sequence"), item.get("kind"), item.get("data"), status=item.get("status"), timestamp=item.get("timestamp"))
    sequences = [item["sequence"] for item in events]
    if any(item["request_id"] != request_id for item in events):
        raise ContractError("trace events must share request_id")
    if sequences != list(range(len(events))):
        raise ContractError("trace event sequences must be ordered and contiguous")
    return {"schema": TRACE_SCHEMA, "request_id": request_id, "events": copy.deepcopy(events)}


class HermesAdapter:
    """Boundary object supplied with a forwarder and event sink by Frank."""

    def __init__(self, forward, on_event=None):
        self.forward = forward
        self.on_event = on_event or (lambda _event: None)

    def dispatch(self, request: dict[str, Any]) -> Any:
        if request.get("schema") != COMMAND_SCHEMA:
            raise ContractError("unsupported Hermes command schema")
        result = self.forward(copy.deepcopy(request))
        for item in result if isinstance(result, list) else []:
            if not isinstance(item, dict) or item.get("schema") != EVENT_SCHEMA:
                raise ContractError("Hermes returned a non-event envelope")
            self.on_event(copy.deepcopy(item))
        return result

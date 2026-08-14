"""Transport-neutral Hermes command and event envelopes.

These boundaries are intentionally boring: Frank forwards commands and
displays ordered events; Hermes remains responsible for policy and execution.
"""

from __future__ import annotations

import copy
import time
import uuid
from typing import Any

from .contracts import COMMAND_SCHEMA, EVENT_SCHEMA, TRACE_SCHEMA, ContractError, _walk_safe, validate_scope


def command(tool_id: str, action: str, scope: Any, payload: dict[str, Any], *, request_id: str | None = None) -> dict[str, Any]:
    if not isinstance(tool_id, str) or not tool_id or not isinstance(action, str) or not action:
        raise ContractError("command tool_id and action are required")
    _walk_safe(payload, "command.payload")
    return {"schema": COMMAND_SCHEMA, "request_id": request_id or uuid.uuid4().hex, "tool_id": tool_id, "action": action, "scope": validate_scope(scope), "payload": copy.deepcopy(payload)}


def event(request_id: str, sequence: int, kind: str, data: dict[str, Any], *, status: str = "ok", timestamp: float | None = None) -> dict[str, Any]:
    if not isinstance(sequence, int) or sequence < 0:
        raise ContractError("event sequence must be non-negative")
    if not isinstance(kind, str) or not kind:
        raise ContractError("event kind is required")
    _walk_safe(data, "event.data")
    return {"schema": EVENT_SCHEMA, "request_id": request_id, "sequence": sequence, "kind": kind, "status": status, "timestamp": timestamp if timestamp is not None else time.time(), "data": copy.deepcopy(data)}


def trace(request_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    if any(item.get("request_id") != request_id for item in events):
        raise ContractError("trace events must share request_id")
    sequences = [item.get("sequence") for item in events]
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

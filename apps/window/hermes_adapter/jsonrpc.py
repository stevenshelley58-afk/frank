"""Transport-independent JSON-RPC 2.0 client core for the Hermes adapter.

The core owns request identity, the in-flight map with deadlines, exactly-once
response matching, and error normalization.  It is deliberately not bound to a
socket: the transport supplies ``send_frame`` and feeds :meth:`handle_message`,
which lets the full request/response lifecycle be unit-tested without a real
WebSocket connection.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any, Callable

from .redaction import redact_value

DEFAULT_TIMEOUT = 30.0

_FRANK_ERROR_PREFIX = "hermes."


class JsonRpcError(RuntimeError):
    """A Hermes call failed; ``frank_code`` is stable, native detail is redacted."""

    def __init__(self, frank_code: str, message: str, *, native_code: Any = None, native_detail: Any = None):
        super().__init__(message)
        self.frank_code = frank_code
        self.native_code = native_code
        self.native_detail = redact_value(native_detail)

    def to_payload(self) -> dict[str, Any]:
        return {
            "error": self.frank_code,
            "message": str(self),
            "native_code": self.native_code,
        }


class MalformedResponseError(JsonRpcError):
    def __init__(self, message: str):
        super().__init__(_FRANK_ERROR_PREFIX + "invalid_response", message)


class UnknownResponseError(JsonRpcError):
    def __init__(self, request_id: Any):
        super().__init__(
            _FRANK_ERROR_PREFIX + "unknown_response",
            f"response id does not match any in-flight request: {request_id!r}",
        )


class DuplicateResponseError(JsonRpcError):
    def __init__(self, request_id: Any):
        super().__init__(
            _FRANK_ERROR_PREFIX + "duplicate_response",
            f"response id was already matched exactly once: {request_id!r}",
        )


class RequestTimeoutError(JsonRpcError):
    def __init__(self, request_id: str, method: str):
        super().__init__(
            _FRANK_ERROR_PREFIX + "timeout",
            f"request {request_id} for {method} exceeded its deadline",
        )


def _frank_code_for_native(native_code: Any) -> str:
    # Frozen, minimal mapping; native code is retained redacted for diagnosis.
    if isinstance(native_code, int):
        if native_code in (-32700, -32600):
            return _FRANK_ERROR_PREFIX + "invalid_response"
        if native_code == -32601:
            return _FRANK_ERROR_PREFIX + "unknown_method"
        if native_code == -32602:
            return _FRANK_ERROR_PREFIX + "invalid_params"
    return _FRANK_ERROR_PREFIX + "method_failed"


class JsonRpcCore:
    """Exactly-once JSON-RPC request/response lifecycle with deadlines."""

    def __init__(
        self,
        send_frame: Callable[[dict[str, Any]], None],
        *,
        timeout: float = DEFAULT_TIMEOUT,
        monotonic: Callable[[], float] = time.monotonic,
    ):
        if not callable(send_frame):
            raise TypeError("send_frame must be callable")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self._send_frame = send_frame
        self._timeout = timeout
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._inflight: dict[str, dict[str, Any]] = {}
        self._outcomes: dict[str, Any] = {}
        self._completed: set[str] = set()

    def next_request_id(self) -> str:
        return f"req-{uuid.uuid4()}"

    def begin_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        request_id: str | None = None,
        timeout: float | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """Register and send one request.  Returns ``(request_id, frame)``."""
        if not isinstance(method, str) or not method or "/" in method or method.startswith("."):
            raise ValueError("method must be a safe non-empty identifier")
        if params is not None and not isinstance(params, dict):
            raise ValueError("params must be an object")
        request_id = request_id or self.next_request_id()
        effective_timeout = self._timeout if timeout is None else timeout
        if effective_timeout <= 0:
            raise ValueError("timeout must be positive")
        frame = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        with self._lock:
            if request_id in self._inflight or request_id in self._completed:
                raise ValueError(f"request id already used: {request_id}")
            self._inflight[request_id] = {
                "method": method,
                "deadline": self._monotonic() + effective_timeout,
                "event": threading.Event(),
                "outcome": None,
            }
        self._send_frame(frame)
        return request_id, frame

    def wait(self, request_id: str) -> Any:
        """Block until the request settles; returns the result or raises."""
        with self._lock:
            entry = self._inflight.get(request_id)
            if entry is None:
                outcome = self._outcomes.get(request_id, "__unsettled__")
            else:
                outcome = None
        if entry is None:
            if outcome == "__unsettled__":
                raise UnknownResponseError(request_id)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        while True:
            remaining = entry["deadline"] - self._monotonic()
            if remaining <= 0:
                self._expire(request_id, entry)
                raise RequestTimeoutError(request_id, entry["method"])
            if entry["event"].wait(timeout=min(remaining, 0.5)):
                break
            with self._lock:
                if entry["outcome"] is not None:
                    break
        outcome = entry["outcome"]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def _expire(self, request_id: str, entry: dict[str, Any]) -> bool:
        with self._lock:
            if self._inflight.get(request_id) is not entry:
                return False
            del self._inflight[request_id]
            self._completed.add(request_id)
            if entry["outcome"] is None:
                entry["outcome"] = RequestTimeoutError(request_id, entry["method"])
            self._outcomes[request_id] = entry["outcome"]
            entry["event"].set()
        return True

    def expire_deadlines(self) -> list[str]:
        """Expire every in-flight request past its deadline (sweeper entry point)."""
        now = self._monotonic()
        expired: list[str] = []
        with self._lock:
            for request_id, entry in list(self._inflight.items()):
                if now >= entry["deadline"]:
                    expired.append(request_id)
        for request_id in expired:
            with self._lock:
                entry = self._inflight.get(request_id)
            if entry is not None:
                self._expire(request_id, entry)
        return expired

    def handle_message(self, raw: Any) -> str:
        """Match one inbound response frame exactly once.

        Stores the outcome (result or ``JsonRpcError``) on the in-flight entry
        and signals its waiter.  Raises ``JsonRpcError`` subclasses for
        malformed frames, unknown ids, and duplicate ids without disturbing
        unrelated in-flight requests.  Returns the matched request id.
        """
        if isinstance(raw, (str, bytes)):
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError as error:
                raise MalformedResponseError(f"frame is not valid JSON: {error}") from error
        else:
            frame = raw
        if not isinstance(frame, dict) or frame.get("jsonrpc") != "2.0" or "id" not in frame:
            raise MalformedResponseError("frame is not a JSON-RPC 2.0 response")
        request_id = frame["id"]
        if not isinstance(request_id, str):
            raise MalformedResponseError("response id must be a string")
        with self._lock:
            if request_id in self._completed:
                raise DuplicateResponseError(request_id)
            entry = self._inflight.pop(request_id, None)
            if entry is None:
                raise UnknownResponseError(request_id)
            self._completed.add(request_id)
            entry["settled_at"] = self._monotonic()
        if "error" in frame:
            error = frame["error"]
            if not isinstance(error, dict):
                raise MalformedResponseError("response error must be an object")
            outcome: Any = JsonRpcError(
                _frank_code_for_native(error.get("code")),
                str(error.get("message") or "Hermes returned an error"),
                native_code=error.get("code"),
                native_detail=error.get("data"),
            )
        elif "result" in frame:
            outcome = frame["result"]
        else:
            raise MalformedResponseError("response has neither result nor error")
        entry["outcome"] = outcome
        entry["event"].set()
        with self._lock:
            self._outcomes[request_id] = outcome
        return request_id

    @property
    def inflight_ids(self) -> list[str]:
        with self._lock:
            return sorted(self._inflight)

    def is_settled(self, request_id: str) -> bool:
        with self._lock:
            return request_id in self._completed

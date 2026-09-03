"""Typed REST client for the two contracted Hermes surfaces.

Surfaces are strictly separated:

- ``gateway``  — Hermes API Server (production 8642-class, canary 18643):
  Bearer ``API_SERVER_KEY``; ``/v1/runs`` (+SSE/approval/steer/stop),
  ``/v1/models``, ``/v1/model_options``, ``/v1/capabilities``, health.
- ``serve``    — rich ``hermes serve`` (9119-class, canary 19121):
  ``X-Hermes-Session-Token``; status gating and STT only, via the additive
  path-aware bridge.  Serve URLs are secrets and are never logged.

The Ad Studio gateway API Server Bearer key (``/v1/tool-runs`` contract) is a
different credential and is never cross-used here.  Every call uses an
allowlisted method+path template, a deadline, a response-size cap, and
redacted error reporting.  Secrets are read at runtime through injectable
resolvers, never stored on the instance.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any, Callable

from .redaction import redact_text

# Contract §2 timeouts.
SUBMIT_TIMEOUT = 20.0
STATUS_TIMEOUT = 5.0
SSE_IDLE_TIMEOUT = 120.0
STT_TIMEOUT = 90.0
DEFAULT_TIMEOUT = 10.0

MAX_RESPONSE_BYTES = 8 * 1024 * 1024

_PATH_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_PATH_PARAM = re.compile(r"\{([a-z_]+)\}")

# Allowlisted (surface, method, path template).  Anything else is refused.
ENDPOINTS: frozenset[tuple[str, str, str]] = frozenset({
    ("gateway", "GET", "/v1/health"),
    ("gateway", "POST", "/v1/runs"),
    ("gateway", "GET", "/v1/runs/{run_id}"),
    ("gateway", "GET", "/v1/runs/{run_id}/events"),
    ("gateway", "POST", "/v1/runs/{run_id}/approval"),
    ("gateway", "POST", "/v1/runs/{run_id}/steer"),
    ("gateway", "POST", "/v1/runs/{run_id}/stop"),
    ("gateway", "GET", "/v1/models"),
    ("gateway", "GET", "/v1/model_options"),
    ("gateway", "GET", "/v1/capabilities"),
    ("serve", "GET", "/api/status"),
    ("serve", "POST", "/api/audio/transcribe"),
})

_FRANK_CODES = {
    "timeout": "hermes.timeout",
    "unavailable": "hermes.unavailable",
    "http_status": "hermes.http_status",
    "invalid_response": "hermes.invalid_response",
    "forbidden_endpoint": "hermes.forbidden_endpoint",
}


class RestError(RuntimeError):
    """Stable Frank error with a redacted diagnostic detail."""

    def __init__(self, kind: str, message: str, *, status: int | None = None):
        super().__init__(message)
        self.kind = kind
        self.frank_code = _FRANK_CODES.get(kind, "hermes.method_failed")
        self.status = status

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"error": self.frank_code, "message": str(self)}
        if self.status is not None:
            payload["http_status"] = self.status
        return payload


def resolve_path(template: str, **params: str) -> str:
    """Substitute validated path parameters; refuse anything unsafe."""
    resolved = template
    for name in _PATH_PARAM.findall(template):
        value = params.get(name)
        if value is None:
            raise RestError("forbidden_endpoint", f"missing path parameter {name}")
        if not _PATH_ID.fullmatch(str(value)):
            raise RestError("forbidden_endpoint", f"unsafe path parameter {name}")
        resolved = resolved.replace("{" + name + "}", str(value))
    if "{" in resolved or "}" in resolved:
        raise RestError("forbidden_endpoint", "unresolved path parameter")
    return resolved


class RestSurface:
    """One authenticated upstream with an allowlisted endpoint set."""

    def __init__(
        self,
        name: str,
        base_url: str,
        auth_header: Callable[[], dict[str, str]],
        *,
        timeout: float = DEFAULT_TIMEOUT,
        urlopen: Callable[..., Any] | None = None,
    ):
        if name not in ("gateway", "serve"):
            raise ValueError("surface must be gateway or serve")
        if not base_url.startswith(("http://127.0.0.1", "http://localhost", "https://")):
            # Loopback/private bridge only; the browser never talks to Hermes directly.
            raise ValueError("base_url must be loopback or https")
        self.name = name
        self.base_url = base_url.rstrip("/")
        self._auth_header = auth_header
        self._timeout = timeout
        self._urlopen = urlopen or urllib.request.urlopen

    def request(self, method: str, template: str, *, path: dict[str, str] | None = None, body: dict[str, Any] | None = None, timeout: float | None = None, headers: dict[str, str] | None = None) -> tuple[int, Any]:
        if (self.name, method, template) not in ENDPOINTS:
            raise RestError("forbidden_endpoint", f"endpoint is not allowlisted: {method} {template}")
        resolved = resolve_path(template, **(path or {}))
        url = self.base_url + resolved
        data = None
        request_headers = dict(self._auth_header())
        request_headers.update(headers or {})
        if body is not None:
            data = json.dumps(body).encode()
            request_headers["Content-Type"] = "application/json"
        effective_timeout = self._timeout if timeout is None else timeout
        request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
        try:
            with self._urlopen(request, timeout=effective_timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                status = response.status
        except urllib.error.HTTPError as error:
            raise RestError("http_status", redact_text(str(error.reason)), status=error.code) from error
        except urllib.error.URLError as error:
            raise RestError("unavailable", redact_text(str(error.reason))) from error
        except TimeoutError as error:
            raise RestError("timeout", f"{self.name} request exceeded {effective_timeout}s") from error
        if len(raw) > MAX_RESPONSE_BYTES:
            raise RestError("invalid_response", "response exceeds the size cap")
        if not raw:
            return status, None
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw.decode(errors="replace")
            return status, parsed
        return status, parsed

    def sse_stream(self, template: str, *, path: dict[str, str] | None = None, last_event_id: str | None = None):
        """Yield SSE ``(event, data, last_event_id)`` frames with idle timeout.

        Response is consumed incrementally; the caller owns reconnects via the
        returned cursor.  Terminates on the contracted ``: stream closed``
        comment or idle timeout.
        """
        if (self.name, "GET", template) not in ENDPOINTS:
            raise RestError("forbidden_endpoint", f"endpoint is not allowlisted: GET {template}")
        resolved = resolve_path(template, **(path or {}))
        url = self.base_url + resolved
        request_headers = dict(self._auth_header())
        request_headers["Accept"] = "text/event-stream"
        if last_event_id:
            request_headers["Last-Event-ID"] = last_event_id
        request = urllib.request.Request(url, method="GET", headers=request_headers)
        response = self._urlopen(request, timeout=SSE_IDLE_TIMEOUT)
        return _SseIterator(response)


class _SseIterator:
    def __init__(self, response: Any):
        self._response = response

    def __iter__(self):
        event_name = ""
        data_lines: list[str] = []
        last_id = None
        try:
            for raw_line in self._response:
                line = raw_line.decode().rstrip("\r\n")
                if line.startswith(":"):
                    if "stream closed" in line:
                        break
                    continue
                if line.startswith("event:"):
                    event_name = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:"):].strip())
                elif line.startswith("id:"):
                    last_id = line[len("id:"):].strip()
                elif line == "":
                    if data_lines:
                        yield event_name or "message", "\n".join(data_lines), last_id
                    event_name = ""
                    data_lines = []
        finally:
            close = getattr(self._response, "close", None)
            if close:
                close()

"""Rich ``hermes serve`` surface: status gating and STT (via the additive bridge).

- Readiness gate (contract §1/§2): ``/api/status`` must report
  ``auth_required: false`` with ``dashboard.public_url`` null/gated mode
  disabled; anything else fails readiness.  Frank never impersonates
  ``HERMES_DESKTOP``.
- STT (contract §6): ``POST /api/audio/transcribe`` with
  ``{data_url, mime_type?}``; the 25 MiB cap applies **after base64
  decoding**; the HTTP body allowance covers the ≈4/3 expansion plus JSON
  overhead.  HTTP 200 with ``{ok: true, transcript: ""}`` is valid silence,
  not an error.  Language is server configuration;
  ``/api/audio/voice-config`` is never proxied.
"""
from __future__ import annotations

import base64
import binascii
import re
from typing import Any

from .http import RestError, RestSurface, STT_TIMEOUT

DECODED_STT_CAP_BYTES = 25 * 1024 * 1024
_DATA_URL = re.compile(r"^data:([A-Za-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$")


class ServeError(RuntimeError):
    def __init__(self, message: str, *, frank_code: str = "hermes.serve_unavailable"):
        super().__init__(message)
        self.frank_code = frank_code


def serve_status_gate(status_payload: Any) -> dict[str, Any]:
    """Validate the frozen serve gating; returns the redacted readiness view."""
    if not isinstance(status_payload, dict):
        raise ServeError("serve status payload is invalid", frank_code="hermes.invalid_response")
    if status_payload.get("auth_required") is not False:
        raise ServeError("serve dashboard auth is required; readiness fails closed")
    public_url = status_payload.get("dashboard.public_url", status_payload.get("dashboard_public_url"))
    if public_url not in (None, ""):
        raise ServeError("serve dashboard has a public URL; readiness fails closed")
    return {"gateway_ready": bool(status_payload.get("gateway_state") == "running"), "auth_required": False}


class ServeClient:
    def __init__(self, surface: RestSurface):
        self._surface = surface

    def status(self) -> dict[str, Any]:
        _, result = self._surface.request("GET", "/api/status")
        return serve_status_gate(result)

    def transcribe(self, data_url: str, *, mime_type: str | None = None) -> dict[str, Any]:
        """Transcribe one audio data URL; enforces the decoded 25 MiB cap."""
        if not isinstance(data_url, str):
            raise ServeError("data_url must be a string", frank_code="hermes.invalid_params")
        match = _DATA_URL.match(data_url)
        if not match:
            raise ServeError("data_url must be a base64 data URL", frank_code="hermes.invalid_params")
        declared_mime, encoded = match.group(1), match.group(2)
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ServeError("data_url payload is not valid base64", frank_code="hermes.invalid_params") from error
        if len(decoded) > DECODED_STT_CAP_BYTES:
            raise ServeError("decoded audio exceeds the 25 MiB cap", frank_code="hermes.payload_too_large")
        body: dict[str, Any] = {"data_url": data_url}
        if mime_type:
            body["mime_type"] = mime_type
        try:
            _, result = self._surface.request("POST", "/api/audio/transcribe", body=body, timeout=STT_TIMEOUT)
        except RestError as error:
            raise ServeError(str(error), frank_code=error.frank_code) from error
        if not isinstance(result, dict) or "ok" not in result or "transcript" not in result:
            raise ServeError("transcribe response is invalid", frank_code="hermes.invalid_response")
        # Silence is success: {"ok": true, "transcript": ""} (contract fixture).
        return {"ok": bool(result.get("ok")), "transcript": str(result.get("transcript") or ""), "provider": result.get("provider")}

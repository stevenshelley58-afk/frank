"""Redaction helpers applied before persistence and before fan-out.

Every Hermes native payload crossing the adapter is passed through
:func:`redact_value` (structured data) or :func:`redact_text` (free text)
so credentials, tokens, URL query secrets, private keys, and restricted
filesystem paths never reach the event projection, logs, fixtures, or the
browser.  Redaction is additive and idempotent: applying it twice yields
the same output as applying it once.
"""
from __future__ import annotations

import re
from typing import Any

REDACTED = "[REDACTED]"

_SECRET_KEY = re.compile(
    r"(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|"
    r"authorization|session[_-]?token|bearer|private[_-]?key|credential|token)",
    re.I,
)
_BEARER = re.compile(r"(?i)\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}")
_API_KEY = re.compile(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
_PEM = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S)
_ENV_LINE = re.compile(
    r"(?im)^([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|KEY)[A-Z0-9_]*)=(.+)$"
)
_URL_SECRET = re.compile(
    r"(?i)([?&](?:token|api_key|apikey|access_token|session_token|sig|signature)=)([^&\s'\"]+)"
)
_RESTRICTED_PATH = re.compile(
    r"(?<![\w./-])(?:/srv/frank/secrets|/srv/frank/data/window|"
    r"/home/(?:hermes|codex)/\.hermes|"
    r"/home/hermes/\.config|/root/\.codex)(?:/[\w.-]+)*"
)

_URL_QUERY_SECRET_KEYS = frozenset({"token", "api_key", "apikey", "access_token", "session_token"})


def _redact_match(match: re.Match) -> str:
    return REDACTED


def redact_url(url: Any) -> Any:
    """Redact secret query parameters (and any bearer fragment) from a URL.

    The complete URL of an authenticated endpoint is itself sensitive; callers
    that must never log it should drop it entirely.  This helper is for values
    that must remain diagnosable while losing their credential.
    """
    if not isinstance(url, str):
        return url
    redacted = _URL_SECRET.sub(lambda m: m.group(1) + REDACTED, url)
    redacted = _BEARER.sub(_redact_match, redacted)
    redacted = _JWT.sub(_redact_match, redacted)
    redacted = _API_KEY.sub(_redact_match, redacted)
    return redacted


def redact_text(text: Any) -> Any:
    """Redact credential-shaped substrings from free text."""
    if not isinstance(text, str):
        return text
    redacted = _PEM.sub(_redact_match, text)
    redacted = _BEARER.sub(_redact_match, redacted)
    redacted = _JWT.sub(_redact_match, redacted)
    redacted = _API_KEY.sub(_redact_match, redacted)
    redacted = _ENV_LINE.sub(lambda m: f"{m.group(1)}={REDACTED}", redacted)
    redacted = _URL_SECRET.sub(lambda m: m.group(1) + REDACTED, redacted)
    redacted = _RESTRICTED_PATH.sub(REDACTED, redacted)
    return redacted


def redact_value(value: Any, *, _key: str = "") -> Any:
    """Recursively redact a JSON-compatible structure.

    Secret-shaped dictionary keys are redacted wholesale; other strings are
    passed through :func:`redact_text`.  Non-string scalars and structural
    containers pass through unchanged so redaction never alters event
    ordering, counts, or shape.
    """
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for child_key, child_value in value.items():
            name = child_key if isinstance(child_key, str) else ""
            if _SECRET_KEY.search(name):
                redacted[child_key] = REDACTED
            else:
                redacted[child_key] = redact_value(child_value, _key=name)
        return redacted
    if isinstance(value, list):
        return [redact_value(item, _key=_key) for item in value]
    if isinstance(value, str):
        if _SECRET_KEY.search(_key):
            return REDACTED
        return redact_text(value)
    return value

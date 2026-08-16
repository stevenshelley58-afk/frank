"""RFC 8785 JSON canonicalization for cross-language integrity hashes."""

from __future__ import annotations

from collections.abc import Mapping
from hashlib import sha256
from typing import Any

import rfc8785


def _plain_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        if any(not isinstance(key, str) for key in value):
            raise TypeError("RFC 8785 objects require string keys")
        return {key: _plain_json(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain_json(child) for child in value]
    return value


def canonical_json(value: Any) -> bytes:
    """Return RFC 8785 JCS bytes for an already validated JSON value."""
    return rfc8785.dumps(_plain_json(value))


def canonical_sha256(value: Any) -> str:
    return sha256(canonical_json(value)).hexdigest()

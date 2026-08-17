"""Dependency-free request validation shared by the gateway and its tests."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


NAMESPACE = re.compile(r"^project/[a-z0-9][a-z0-9._-]{0,63}$")
REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


def validate_project_namespace(namespace: Any) -> str:
    """Return a canonical project namespace or raise ``ValueError``.

    Project namespaces are deliberately not derived from a Hermes workspace,
    profile, request body, or URL path.  Callers must provide this value
    explicitly and the gateway compares it against its exact allow-list.
    """

    if not isinstance(namespace, str) or NAMESPACE.fullmatch(namespace) is None:
        raise ValueError("namespace must be project/<id>")
    return namespace


def validate_request_id(request_id: Any) -> str:
    if not isinstance(request_id, str) or REQUEST_ID.fullmatch(request_id) is None:
        raise ValueError("request_id is required and bounded")
    return request_id


@dataclass(frozen=True)
class MemoryRequest:
    namespace: str
    request_id: str
    operation: str

    def validate(self, allowed_prefix: str = "project/") -> None:
        namespace = validate_project_namespace(self.namespace)
        if not namespace.startswith(allowed_prefix):
            raise ValueError("namespace is not allowed")
        validate_request_id(self.request_id)
        if self.operation not in {"episode", "search", "correction_episode"}:
            raise ValueError("unsupported memory operation")


class HermesMemoryProvider:
    """Transport-neutral boundary implemented by the Hermes deployment."""

    def healthz(self) -> bool:
        raise NotImplementedError

    def readyz(self) -> bool:
        raise NotImplementedError

    def submit(self, request: MemoryRequest, payload: dict) -> dict:
        raise NotImplementedError

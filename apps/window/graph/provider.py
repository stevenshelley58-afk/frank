"""Fail-closed read-only graph and trace provider boundary.

This module exposes a Flask blueprint factory but intentionally does not
register it with Frank's production app. The final assembly lane supplies
authorized reader callbacks after rebasing onto the accepted main runtime.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from copy import deepcopy

from flask import Blueprint, Response, abort, jsonify, request

from .contract import ENTITY_KINDS, GRAPH_SCHEMA, LENSES, TRACE_ID, TRACE_SCHEMA

_QUERY_KEYS = frozenset({"lens", "settings_revision_id", "trace_id"})
_OPAQUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_SENSITIVE_KEYS = frozenset({
    "prompt", "prompts", "instruction", "instructions", "content", "body",
    "argument", "arguments", "tool_arguments", "result", "results", "input",
    "inputs", "output", "outputs", "model_input", "model_output", "payload",
    "secret", "secrets", "token", "tokens", "password", "credential",
})


class ProviderUnavailable(RuntimeError):
    """The authorized boundary has no registered projection."""


def _entity_id(value: str) -> str:
    if not _OPAQUE.fullmatch(value):
        abort(404)
    return value


def _query() -> dict[str, str | None]:
    unknown = set(request.args) - _QUERY_KEYS
    if unknown:
        abort(400, "unsupported graph selector")
    lens = request.args.get("lens", "tool.pipeline")
    if lens not in LENSES:
        abort(400, "unsupported graph lens")
    result = {"lens": lens}
    for key in ("settings_revision_id", "trace_id"):
        value = request.args.get(key)
        if value is not None and not _OPAQUE.fullmatch(value):
            abort(400, "invalid opaque graph selector")
        result[key] = value
    return result


def _safe_graph(value: object) -> dict:
    if not isinstance(value, dict) or value.get("schema") != GRAPH_SCHEMA:
        raise ProviderUnavailable("authorized graph projection was invalid")
    if not isinstance(value.get("nodes"), list) or not isinstance(value.get("edges"), list):
        raise ProviderUnavailable("authorized graph projection was incomplete")
    if _contains_sensitive_key(value):
        raise ProviderUnavailable("authorized graph projection contained a sensitive field")
    return value


def _safe_trace(value: object, trace_id: str) -> dict:
    if not isinstance(value, dict) or value.get("schema") != TRACE_SCHEMA:
        raise ProviderUnavailable("authorized trace projection was invalid")
    supplied = value.get("trace_id")
    if not isinstance(supplied, str) or not TRACE_ID.fullmatch(supplied) or supplied != trace_id:
        raise ProviderUnavailable("authorized trace projection identity mismatch")
    return _redact_trace(value)


def _contains_sensitive_key(value: object) -> bool:
    if isinstance(value, dict):
        return any(str(key).lower() in _SENSITIVE_KEYS or _contains_sensitive_key(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_sensitive_key(item) for item in value)
    return False


def _redact_trace(value: dict) -> dict:
    def clean(item: object):
        if isinstance(item, dict):
            return {
                key: clean(child)
                for key, child in item.items()
                if str(key).lower() not in _SENSITIVE_KEYS
            }
        if isinstance(item, list):
            return [clean(child) for child in item]
        return item

    return clean(deepcopy(value))


class ReadOnlyProvider:
    """A dependency-injected boundary; it owns no store, collector, or cache."""

    def __init__(
        self,
        *,
        graph_reader: Callable[..., Mapping[str, object] | None] | None = None,
        trace_reader: Callable[..., Mapping[str, object] | None] | None = None,
    ) -> None:
        self.graph_reader = graph_reader
        self.trace_reader = trace_reader

    def graph(self, *, kind: str, entity_id: str, selectors: Mapping[str, str | None]) -> dict:
        if kind not in ENTITY_KINDS:
            raise ProviderUnavailable("entity kind is not allowlisted")
        if self.graph_reader is None:
            raise ProviderUnavailable("no graph provider is registered")
        try:
            value = self.graph_reader(kind=kind, entity_id=entity_id, selectors=dict(selectors))
        except Exception as error:
            raise ProviderUnavailable("graph provider is unavailable") from error
        if value is None:
            raise ProviderUnavailable("graph is unavailable")
        return _safe_graph(value)

    def trace(self, *, trace_id: str) -> dict:
        if self.trace_reader is None:
            raise ProviderUnavailable("no trace provider is registered")
        try:
            value = self.trace_reader(trace_id=trace_id)
        except Exception as error:
            raise ProviderUnavailable("trace provider is unavailable") from error
        if value is None:
            raise ProviderUnavailable("trace is unavailable")
        return _safe_trace(value, trace_id)


def _unavailable(error: ProviderUnavailable) -> tuple[Response, int]:
    return jsonify({"status": "unavailable", "error": str(error)}), 503


def create_blueprint(provider: ReadOnlyProvider) -> Blueprint:
    """Create the isolated endpoint set; callers must explicitly register it."""
    api = Blueprint("frank_graph_provider", __name__)

    @api.get("/api/graphs/<kind>/<entity_id>")
    def graph_read(kind: str, entity_id: str):
        if kind not in ENTITY_KINDS:
            abort(404)
        try:
            payload = provider.graph(kind=kind, entity_id=_entity_id(entity_id), selectors=_query())
        except ProviderUnavailable as error:
            return _unavailable(error)
        return jsonify(payload), 200, {"Cache-Control": "no-store"}

    @api.get("/api/traces/<trace_id>")
    def trace_read(trace_id: str):
        if not TRACE_ID.fullmatch(trace_id):
            abort(404)
        try:
            payload = provider.trace(trace_id=trace_id)
        except ProviderUnavailable as error:
            return _unavailable(error)
        return jsonify(payload), 200, {"Cache-Control": "no-store"}

    return api

"""Versioned JSON contracts for Frank tool mini-apps.

The validators intentionally use only the Python standard library.  They are
small JSON-Schema-inspired guards, not an execution engine.  A manifest may
describe what Hermes can do; it cannot contain executable code or credentials.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any, Iterable

MANIFEST_SCHEMA = "schema://frank.tool-app-manifest/v1"
SETTING_SCHEMA = "schema://frank.tool-app-settings/v1"
PIPELINE_SCHEMA = "schema://frank.tool-app-pipeline/v1"
TRACE_SCHEMA = "schema://frank.tool-app-trace/v1"
EVENT_SCHEMA = "schema://frank.tool-app-event/v1"
COMMAND_SCHEMA = "schema://frank.tool-app-command/v1"

SCOPE_KINDS = frozenset({"global", "profile", "project", "workspace", "session"})
_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_VERSION = re.compile(r"^\d+\.\d+\.\d+$")
_VAULT_REF = re.compile(r"^(?:openbao|vault|secret)://[A-Za-z0-9._/@-]+$")
_HTML = re.compile(r"<\/?[A-Za-z][^>]*>|javascript\s*:", re.I)
_SECRET = re.compile(
    r"(?:-----BEGIN [A-Z ]+-----|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|"
    r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",
    re.I,
)
_SECRET_KEYS = re.compile(r"(?:password|passwd|token|api[_-]?key|private[_-]?key|secret)$", re.I)


class ContractError(ValueError):
    """Raised when untrusted declarative data is outside the contract."""


def _require(value: Any, kind: type, path: str) -> None:
    if not isinstance(value, kind):
        raise ContractError(f"{path} must be {kind.__name__}")


def _walk_safe(value: Any, path: str = "payload", key: str = "") -> None:
    if isinstance(value, str):
        if _HTML.search(value) or _SECRET.search(value):
            raise ContractError(f"unsafe markup or secret-like value at {path}")
        if _SECRET_KEYS.search(key) and not _VAULT_REF.fullmatch(value):
            raise ContractError(f"secret fields must be strict vault refs at {path}")
    elif isinstance(value, dict):
        for child_key, child_value in value.items():
            _walk_safe(child_value, f"{path}.{child_key}", str(child_key))
    elif isinstance(value, list):
        for index, child_value in enumerate(value):
            _walk_safe(child_value, f"{path}[{index}]", key)


def validate_scope(scope: Any) -> dict[str, str]:
    if isinstance(scope, str):
        parts = scope.split(":", 1)
        scope = {"kind": parts[0], **({"id": parts[1]} if len(parts) == 2 else {})}
    _require(scope, dict, "scope")
    if set(scope) - {"kind", "id"}:
        raise ContractError("scope has unknown fields")
    kind = scope.get("kind")
    if kind not in SCOPE_KINDS:
        raise ContractError(f"unsupported scope kind: {kind}")
    expected_id = kind == "global"
    if expected_id and "id" in scope:
        raise ContractError("global scope cannot have an id")
    if not expected_id:
        if not isinstance(scope.get("id"), str) or not _ID.fullmatch(scope["id"]):
            raise ContractError(f"{kind} scope requires a safe id")
    return {"kind": kind, **({"id": scope["id"]} if "id" in scope else {})}


def validate_pipeline(pipeline: Any) -> dict[str, Any]:
    _require(pipeline, dict, "pipeline")
    if pipeline.get("schema") != PIPELINE_SCHEMA:
        raise ContractError("pipeline schema must be the supported version")
    nodes = pipeline.get("nodes")
    edges = pipeline.get("edges", [])
    _require(nodes, list, "pipeline.nodes")
    _require(edges, list, "pipeline.edges")
    node_ids: set[str] = set()
    for index, node in enumerate(nodes):
        _require(node, dict, f"pipeline.nodes[{index}]")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not _ID.fullmatch(node_id) or node_id in node_ids:
            raise ContractError(f"invalid or duplicate pipeline node id at {index}")
        if not isinstance(node.get("kind"), str) or not _ID.fullmatch(node["kind"]):
            raise ContractError(f"invalid pipeline node kind at {index}")
        node_ids.add(node_id)
    adjacency = {node_id: [] for node_id in node_ids}
    for index, edge in enumerate(edges):
        _require(edge, dict, f"pipeline.edges[{index}]")
        source, target = edge.get("from"), edge.get("to")
        if source not in node_ids or target not in node_ids or source == target:
            raise ContractError(f"pipeline edge references an invalid node at {index}")
        adjacency[source].append(target)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visiting:
            raise ContractError("pipeline graph must be acyclic")
        if node_id in visited:
            return
        visiting.add(node_id)
        for child in adjacency[node_id]:
            visit(child)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in node_ids:
        visit(node_id)
    return copy.deepcopy(pipeline)


def validate_manifest(manifest: Any) -> dict[str, Any]:
    _require(manifest, dict, "manifest")
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise ContractError("manifest schema must be the supported version")
    if not isinstance(manifest.get("id"), str) or not _ID.fullmatch(manifest["id"]):
        raise ContractError("manifest id must be a safe kebab-case identifier")
    if not isinstance(manifest.get("version"), str) or not _VERSION.fullmatch(manifest["version"]):
        raise ContractError("manifest version must be semver")
    for field in ("name", "description"):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            raise ContractError(f"manifest.{field} is required")
    scopes = manifest.get("scopes")
    if not isinstance(scopes, list) or not scopes or any(scope not in SCOPE_KINDS for scope in scopes):
        raise ContractError("manifest.scopes must list supported scope kinds")
    if len(set(scopes)) != len(scopes):
        raise ContractError("manifest.scopes cannot contain duplicates")
    settings = manifest.get("settings", {"schema": SETTING_SCHEMA, "properties": {}})
    _require(settings, dict, "manifest.settings")
    if settings.get("schema") != SETTING_SCHEMA or not isinstance(settings.get("properties"), dict):
        raise ContractError("manifest.settings must be a versioned object schema")
    pipelines = manifest.get("pipelines", [])
    if not isinstance(pipelines, list):
        raise ContractError("manifest.pipelines must be a list")
    for pipeline in pipelines:
        validate_pipeline(pipeline)
    for collection in ("capabilities", "connectors", "schedules", "thresholds", "approval_gates"):
        if collection in manifest and not isinstance(manifest[collection], list):
            raise ContractError(f"manifest.{collection} must be a list")
    _walk_safe(manifest)
    return copy.deepcopy(manifest)


def discover_tool_apps(tools_root: str | Path) -> list[dict[str, Any]]:
    """Load ``apps/window/tools/<id>/manifest.json`` without executing apps."""
    root = Path(tools_root)
    if not root.exists():
        return []
    if not root.is_dir():
        raise ContractError("tool discovery root must be a directory")
    found = []
    for directory in sorted(root.iterdir(), key=lambda item: item.name):
        if not directory.is_dir() or not _ID.fullmatch(directory.name):
            continue
        manifest_file = directory / "manifest.json"
        if not manifest_file.is_file():
            continue
        try:
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            manifest = validate_manifest(manifest)
        except (OSError, json.JSONDecodeError, ContractError) as exc:
            raise ContractError(f"invalid tool app {directory.name}: {exc}") from exc
        if manifest["id"] != directory.name:
            raise ContractError(f"tool app id does not match directory: {directory.name}")
        found.append(manifest)
    return found


class SettingRevisionStore:
    """Append-only, optimistic-concurrency settings revisions by scope."""

    def __init__(self, allowed_scopes: Iterable[str]):
        self.allowed_scopes = frozenset(allowed_scopes)
        self._revisions: dict[tuple[str, str | None], list[dict[str, Any]]] = {}

    def _key(self, scope: Any) -> tuple[str, str | None]:
        normalized = validate_scope(scope)
        if normalized["kind"] not in self.allowed_scopes:
            raise ContractError("settings scope is not allowed by this app")
        return normalized["kind"], normalized.get("id")

    def read(self, scope: Any) -> dict[str, Any]:
        key = self._key(scope)
        revisions = self._revisions.get(key, [])
        if not revisions:
            return {"schema": SETTING_SCHEMA, "scope": {"kind": key[0], **({"id": key[1]} if key[1] else {})}, "revision": 0, "settings": {}}
        return copy.deepcopy(revisions[-1])

    def update(self, scope: Any, settings: dict[str, Any], expected_revision: int) -> dict[str, Any]:
        key = self._key(scope)
        if not isinstance(expected_revision, int) or expected_revision < 0:
            raise ContractError("expected_revision must be a non-negative integer")
        current = self.read(scope)
        if current["revision"] != expected_revision:
            raise ContractError(f"stale settings revision: expected {expected_revision}, current {current['revision']}")
        _require(settings, dict, "settings")
        _walk_safe(settings, "settings")
        record = {"schema": SETTING_SCHEMA, "scope": current["scope"], "revision": expected_revision + 1, "settings": copy.deepcopy(settings)}
        self._revisions.setdefault(key, []).append(copy.deepcopy(record))
        return copy.deepcopy(record)

    def history(self, scope: Any) -> list[dict[str, Any]]:
        return copy.deepcopy(self._revisions.get(self._key(scope), []))

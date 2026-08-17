"""Pure, fail-closed normalization for the shared Frank graph contract."""

from __future__ import annotations

import hashlib
import math
import re
from copy import deepcopy
from datetime import datetime
from typing import Iterable, Mapping

import rfc8785

GRAPH_SCHEMA = "schema://frank.graph/v1"
MANIFEST_SCHEMA = "schema://frank.tool-app-manifest/v1"
PIPELINE_SCHEMA = "schema://frank.tool-app-pipeline/v1"
SETTINGS_SCHEMA = "schema://frank.tool-app-settings/v1"
TRACE_SCHEMA = "schema://frank.tool-app-trace/v1"
CAPABILITY = "frank.graph.v1"
ADAPTER_ID = "tool-manifest"
ADAPTER_VERSION = "1.0.0"

ENTITY_KINDS = frozenset({"project", "tool", "agent", "service"})
SCOPES = frozenset({"global", "profile", "project", "workspace", "session"})
LENSES = frozenset({"tool.pipeline"})
ADAPTER_LENSES = frozenset({"tool.pipeline"})
NODE_STATUSES = frozenset({"declared", "queued", "running", "succeeded", "failed", "blocked", "cancelled", "unavailable"})
EDGE_STATUSES = frozenset({"declared", "active", "succeeded", "failed", "unavailable"})
SAFE_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SAFE_CAPABILITY = re.compile(r"^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
TRACE_ID = re.compile(r"^[0-9a-f]{32}$")
SPAN_ID = re.compile(r"^[0-9a-f]{16}$")
SPAN_PREFIX = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_HTML = re.compile(r"<\/?[A-Za-z][^>]*>|javascript\s*:", re.I)
_SECRET = re.compile(
    r"(?:-----BEGIN [A-Z ]+-----|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|"
    r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",
    re.I,
)
_SECRET_KEYS = re.compile(r"(?:password|passwd|token|api[_-]?key|private[_-]?key|secret)$", re.I)
_EXECUTABLE_KEYS = frozenset({"callback", "handler", "code", "script", "executable"})
_FORBIDDEN_SETTING_KEYS = re.compile(
    r"(?:credential|vault|provider|secret|token|password|passwd|api[_-]?key|"
    r"connection[_-]?ref|connector[_-]?ref)",
    re.I,
)

_OTEL_OK = frozenset({"OK", "STATUS_CODE_OK", 1})
_OTEL_ERROR = frozenset({"ERROR", "STATUS_CODE_ERROR", 2})


class GraphContractError(ValueError):
    """Raised when a producer attempts to reinterpret an unsupported shape."""


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise GraphContractError(f"{label} must be an object")
    return value


def _text(value: object, label: str, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise GraphContractError(f"{label} must be a string")
    if required and not value:
        raise GraphContractError(f"{label} is required")
    if "\x00" in value or any(ord(char) < 32 for char in value if char not in "\t\n\r"):
        raise GraphContractError(f"{label} contains control characters")
    return value


def _id(value: object, label: str) -> str:
    value = _text(value, label)
    if not SAFE_ID.fullmatch(value):
        raise GraphContractError(f"{label} is not an allowed opaque ID")
    return value


def _version(value: object, label: str) -> str:
    value = _text(value, label)
    if not SEMVER.fullmatch(value):
        raise GraphContractError(f"{label} must be semantic version text")
    return value


def _walk_safe(value: object, path: str = "payload", key: str = "", active: set[int] | None = None) -> None:
    """Mirror the canonical Tool contract's finite, acyclic JSON guard."""
    active = set() if active is None else active
    if value is None or type(value) in (bool, int):
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise GraphContractError(f"non-finite number at {path}")
        return
    if type(value) is str:
        if _HTML.search(value) or _SECRET.search(value):
            raise GraphContractError(f"unsafe markup or secret-like value at {path}")
        if _SECRET_KEYS.search(key):
            raise GraphContractError(f"secret fields are not allowed at {path}")
        return
    if type(value) not in (dict, list):
        raise GraphContractError(f"value at {path} is not JSON-compatible")
    if id(value) in active:
        raise GraphContractError(f"cyclic value at {path}")
    active.add(id(value))
    try:
        if isinstance(value, dict):
            for child_key, child_value in value.items():
                if not isinstance(child_key, str):
                    raise GraphContractError(f"JSON object keys must be strings at {path}")
                if child_key.lower() in _EXECUTABLE_KEYS:
                    raise GraphContractError(f"executable key is not allowed at {path}.{child_key}")
                _walk_safe(child_value, f"{path}.{child_key}", child_key, active)
        else:
            for index, child_value in enumerate(value):
                _walk_safe(child_value, f"{path}[{index}]", key, active)
    finally:
        active.remove(id(value))


def _validate_setting_keys(value: object, path: str = "settings") -> None:
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            if _FORBIDDEN_SETTING_KEYS.search(child_key):
                raise GraphContractError(f"sensitive connection setting is not allowed at {path}.{child_key}")
            _validate_setting_keys(child_value, f"{path}.{child_key}")
    elif isinstance(value, list):
        for index, child_value in enumerate(value):
            _validate_setting_keys(child_value, f"{path}[{index}]")


def _canonical_bytes(value: object) -> bytes:
    """Return the RFC 8785 JSON Canonicalization Scheme representation."""
    try:
        return rfc8785.dumps(value)
    except (rfc8785.CanonicalizationError, TypeError, ValueError) as error:
        raise GraphContractError("value is not RFC 8785 canonicalizable JSON") from error


def canonical_manifest_sha256(manifest: Mapping[str, object]) -> str:
    return "sha256:" + hashlib.sha256(_canonical_bytes(manifest)).hexdigest()


def _timestamp(value: object | None, label: str) -> str:
    if value is None:
        raise GraphContractError(f"{label} is required; freshness cannot be fabricated")
    value = _text(value, label)
    candidate = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as error:
        raise GraphContractError(f"{label} must be RFC 3339") from error
    if parsed.tzinfo is None:
        raise GraphContractError(f"{label} must include a timezone")
    return value


def _scope(value: object | None, declared: list[str]) -> dict:
    if value is None:
        if "global" not in declared:
            raise GraphContractError("render_scope is required when the manifest does not declare global")
        return {"kind": "global"}
    source = _object(value, "render_scope")
    kind = _text(source.get("kind"), "render_scope.kind").lower()
    if kind == "global":
        if set(source) != {"kind"}:
            raise GraphContractError("global render_scope cannot contain an id or unknown fields")
        result = {"kind": kind}
    else:
        if set(source) != {"kind", "id"}:
            raise GraphContractError("scoped render_scope must contain exactly kind and id")
        result = {"kind": kind, "id": _id(source.get("id"), "render_scope.id")}
    if kind not in SCOPES or kind not in declared:
        raise GraphContractError("render_scope is not declared by the manifest")
    return result


def _trace_span_prefix(value: object | None) -> str | None:
    """Read only a usable current-v1 OTLP prefix; ignore other canonical trace data."""
    if not isinstance(value, dict) or value.get("schema") != TRACE_SCHEMA:
        return None
    span_prefix = value.get("span_prefix")
    if (
        not isinstance(span_prefix, str)
        or not span_prefix
        or len(span_prefix) > 160
        or not SPAN_PREFIX.fullmatch(span_prefix)
    ):
        return None
    return span_prefix


def _manifest(manifest: object) -> dict:
    value = _object(manifest, "manifest")
    _walk_safe(value, "manifest")
    if value.get("schema") != MANIFEST_SCHEMA:
        raise GraphContractError("manifest schema must be schema://frank.tool-app-manifest/v1")
    result = {
        "schema": MANIFEST_SCHEMA,
        "id": _id(value.get("id"), "manifest.id"),
        "version": _version(value.get("version"), "manifest.version"),
        "name": _text(value.get("name"), "manifest.name"),
        "description": _text(value.get("description"), "manifest.description"),
    }
    if not result["name"].strip() or not result["description"].strip():
        raise GraphContractError("manifest.name and manifest.description are required")
    scopes = value.get("scopes", [])
    if not isinstance(scopes, list) or not scopes or any(not isinstance(scope, str) or scope not in SCOPES for scope in scopes):
        raise GraphContractError("manifest.scopes must contain only declared scope names")
    if len(scopes) != len(set(scopes)):
        raise GraphContractError("manifest.scopes cannot contain duplicates")
    result["scopes"] = list(scopes)
    settings = value.get("settings", {"schema": SETTINGS_SCHEMA, "properties": {}})
    if not isinstance(settings, dict) or settings.get("schema") != SETTINGS_SCHEMA or not isinstance(settings.get("properties"), dict):
        raise GraphContractError("manifest.settings must be a versioned object schema")
    _validate_setting_keys(settings, "manifest.settings")
    pipelines = value.get("pipelines", [])
    if not isinstance(pipelines, list):
        raise GraphContractError("manifest.pipelines must be a list")
    normalized_pipelines = []
    for pipeline_index, pipeline in enumerate(pipelines):
        pipeline = _object(pipeline, f"pipelines[{pipeline_index}]")
        required_pipeline_fields = {"schema", "nodes", "edges"}
        if set(pipeline) - required_pipeline_fields - {"id", "version"} or required_pipeline_fields - set(pipeline):
            raise GraphContractError("pipeline fields are restricted")
        if pipeline.get("schema") != PIPELINE_SCHEMA:
            raise GraphContractError("pipeline schema must be schema://frank.tool-app-pipeline/v1")
        pipeline_id = _id(pipeline.get("id", f"pipeline-{pipeline_index}"), f"pipelines[{pipeline_index}].id")
        pipeline_version = _version(pipeline.get("version", result["version"]), f"pipelines[{pipeline_index}].version")
        nodes = pipeline.get("nodes", [])
        edges = pipeline.get("edges", [])
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise GraphContractError("pipeline nodes and edges must be lists")
        normalized_nodes = []
        node_ids: set[str] = set()
        for node_index, item in enumerate(nodes):
            item = _object(item, f"pipelines[{pipeline_index}].nodes[{node_index}]")
            if set(item) != {"id", "kind"}:
                raise GraphContractError("v1 pipeline nodes must contain exactly id and kind")
            node_id = _id(item["id"], "pipeline node id")
            if node_id in node_ids:
                raise GraphContractError("pipeline node IDs must be unique")
            node_ids.add(node_id)
            normalized_nodes.append({"id": node_id, "kind": _id(item["kind"], "pipeline node kind")})
        normalized_edges = []
        adjacency = {node_id: [] for node_id in node_ids}
        for edge_index, item in enumerate(edges):
            item = _object(item, f"pipelines[{pipeline_index}].edges[{edge_index}]")
            if set(item) != {"from", "to"}:
                raise GraphContractError("v1 pipeline edges must contain exactly from and to")
            source = _id(item["from"], "pipeline edge.from")
            target = _id(item["to"], "pipeline edge.to")
            if source not in node_ids or target not in node_ids or source == target:
                raise GraphContractError("pipeline edges must reference declared nodes")
            adjacency[source].append(target)
            normalized_edges.append({"from": source, "to": target})

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in visiting:
                raise GraphContractError("pipeline graph must be acyclic")
            if node_id in visited:
                return
            visiting.add(node_id)
            for child in adjacency[node_id]:
                visit(child)
            visiting.remove(node_id)
            visited.add(node_id)

        for node_id in node_ids:
            visit(node_id)
        normalized_pipelines.append({
            "id": pipeline_id,
            "index": pipeline_index,
            "version": pipeline_version,
            "nodes": normalized_nodes,
            "edges": normalized_edges,
        })
    pipeline_counts: dict[str, int] = {}
    for pipeline in normalized_pipelines:
        pipeline_counts[pipeline["id"]] = pipeline_counts.get(pipeline["id"], 0) + 1
    for pipeline in normalized_pipelines:
        pipeline["runtime_id"] = (
            pipeline["id"]
            if pipeline_counts[pipeline["id"]] == 1
            else f"{pipeline['id']}:{pipeline['index']}"
        )
    result["settings"] = settings
    result["pipelines"] = normalized_pipelines
    result["trace_span_prefix"] = _trace_span_prefix(value.get("trace"))
    for collection in ("capabilities", "connectors", "schedules", "thresholds", "approval_gates"):
        if collection in value and not isinstance(value[collection], list):
            raise GraphContractError(f"manifest.{collection} must be a list")
    return result


def _settings_revision(value: object | None, scope: dict) -> dict | None:
    if value is None:
        return None
    value = _object(value, "settings_revision")
    _walk_safe(value, "settings_revision")
    if set(value) != {"schema", "scope", "revision", "settings"}:
        raise GraphContractError("settings revision must contain exactly schema, scope, revision, and settings")
    if value.get("schema") != SETTINGS_SCHEMA:
        raise GraphContractError("settings revision has an unsupported schema")
    revision = value.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise GraphContractError("settings revision must be a non-negative integer")
    if not isinstance(value.get("settings"), dict):
        raise GraphContractError("settings revision settings must be an object")
    _validate_setting_keys(value["settings"], "settings_revision.settings")
    supplied_scope = _object(value.get("scope"), "settings_revision.scope")
    if supplied_scope != scope:
        raise GraphContractError("settings revision scope does not match render_scope")
    return {"schema": SETTINGS_SCHEMA, "scope": deepcopy(supplied_scope), "revision": revision}


def _trace_id(value: object, label: str = "trace_id") -> str:
    value = _text(value, label)
    if not TRACE_ID.fullmatch(value) or value == "0" * 32:
        raise GraphContractError(f"{label} must be a nonzero lowercase 32-hex W3C trace ID")
    return value


def _permissions(values: Iterable[str]) -> list[str]:
    if isinstance(values, (str, bytes)):
        raise GraphContractError("permissions must be an iterable of capability IDs, not text")
    result: list[str] = []
    for value in values:
        if not isinstance(value, str) or not SAFE_CAPABILITY.fullmatch(value):
            raise GraphContractError("permissions must contain only safe capability IDs")
        if value not in result:
            result.append(value)
    return result


def _otel_attributes(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return dict(value)
    if not isinstance(value, list):
        raise GraphContractError("OTLP span attributes must be an object or OTLP key/value list")
    result: dict[str, object] = {}
    for index, item in enumerate(value):
        item = _object(item, f"span.attributes[{index}]")
        if set(item) != {"key", "value"}:
            raise GraphContractError("OTLP span attributes must contain exactly key and value")
        key = _text(item.get("key"), f"span.attributes[{index}].key")
        if key in result:
            raise GraphContractError("OTLP span attributes must have unique keys")
        wrapped = _object(item.get("value"), f"span.attributes[{index}].value")
        scalar_keys = [name for name in ("stringValue", "intValue", "doubleValue", "boolValue") if name in wrapped]
        if len(scalar_keys) != 1 or set(wrapped) != set(scalar_keys):
            raise GraphContractError("OTLP correlation attributes must use one scalar value")
        result[key] = wrapped[scalar_keys[0]]
    return result


def _span_overlay(
    span: object,
    *,
    tool_id: str,
    scope: Mapping[str, str],
    span_prefix: str | None,
    pipeline_versions: Mapping[str, str],
    node_ids: Mapping[tuple[str, str], str],
    ambiguous_pipeline_ids: frozenset[str],
) -> tuple[str, str | None, str]:
    span = _object(span, "span")
    if "trace_id" in span or "span_id" in span:
        raise GraphContractError("OTLP spans must use exact traceId and spanId fields")
    supplied_trace_id = span.get("traceId")
    supplied_trace_id = _trace_id(supplied_trace_id, "span.trace_id")
    span_id = _text(span.get("spanId"), "span.span_id")
    if not SPAN_ID.fullmatch(span_id) or span_id == "0" * 16:
        raise GraphContractError("span.span_id must be a nonzero lowercase 16-hex W3C span ID")
    name = _text(span.get("name"), "span.name")
    if span_prefix and name != span_prefix and not name.startswith(span_prefix + "."):
        raise GraphContractError("OTLP span name is outside manifest.trace.span_prefix")
    attributes = _otel_attributes(span.get("attributes", {}))
    if attributes.get("frank.tool.id") != tool_id:
        raise GraphContractError("OTLP span tool identity does not match the manifest")
    pipeline_id = attributes.get("frank.pipeline.id")
    pipeline_revision = attributes.get("frank.pipeline.revision")
    graph_node_id = attributes.get("frank.graph.node.id")
    if not isinstance(pipeline_id, str) or not isinstance(graph_node_id, str):
        raise GraphContractError("OTLP span is missing pipeline/node correlation attributes")
    if pipeline_id in ambiguous_pipeline_ids:
        raise GraphContractError("OTLP span pipeline identity is ambiguous in the canonical manifest")
    source_node_id = graph_node_id.rsplit("/node:", 1)[-1]
    normalized_node_id = node_ids.get((pipeline_id, source_node_id))
    if normalized_node_id is None or graph_node_id != normalized_node_id:
        raise GraphContractError("OTLP span graph node identity is not declared by the manifest")
    if pipeline_versions.get(pipeline_id) != pipeline_revision:
        raise GraphContractError("OTLP span pipeline revision does not match the manifest")
    if scope["kind"] == "project" and attributes.get("frank.project.id") != scope["id"]:
        raise GraphContractError("OTLP span project identity does not match render_scope")
    if scope["kind"] == "global" and "frank.project.id" in attributes:
        raise GraphContractError("project-scoped OTLP span cannot overlay global Tool state")
    if scope["kind"] not in {"global", "project"}:
        raise GraphContractError("current OTLP correlation attributes cannot bind this render_scope")
    status_value = span.get("status")
    if isinstance(status_value, dict):
        status_value = status_value.get("code")
    if status_value is None:
        return normalized_node_id, None, supplied_trace_id
    if type(status_value) not in (str, int):
        raise GraphContractError("OTLP span status code must be a standard scalar")
    if status_value in _OTEL_OK:
        return normalized_node_id, "succeeded", supplied_trace_id
    if status_value in _OTEL_ERROR:
        return normalized_node_id, "failed", supplied_trace_id
    return normalized_node_id, None, supplied_trace_id


def _selection(value: Mapping[str, object] | None, graph: Mapping[str, object]) -> dict | None:
    if value is None:
        return None
    value = _object(value, "selection")
    allowed = {"node_id", "edge_id"}
    if not value or set(value) - allowed:
        raise GraphContractError("current-v1 selection supports only node_id and edge_id")
    result: dict[str, str] = {}
    node_ids = {node["id"] for node in graph["nodes"]}
    edge_ids = {edge["id"] for edge in graph["edges"]}
    if "node_id" in value:
        node_id = _text(value["node_id"], "selection.node_id")
        if node_id not in node_ids:
            raise GraphContractError("selection.node_id is not in the projected graph")
        result["node_id"] = node_id
    if "edge_id" in value:
        edge_id = _text(value["edge_id"], "selection.edge_id")
        if edge_id not in edge_ids:
            raise GraphContractError("selection.edge_id is not in the projected graph")
        result["edge_id"] = edge_id
    return result


def normalize_manifest(
    manifest: Mapping[str, object],
    *,
    render_scope: Mapping[str, object] | None = None,
    settings_revision: Mapping[str, object] | None = None,
    spans: Iterable[object] = (),
    permissions: Iterable[str] = (),
    selection: Mapping[str, object] | None = None,
    lens: str = "tool.pipeline",
    as_of: str | None = None,
    manifest_sha256: str | None = None,
) -> dict:
    """Project one canonical Tool manifest into a disposable graph envelope.

    Values are supplied only after authorization. This function performs no
    I/O, network access, mutation, scheduling, execution, or persistence.
    """
    if lens not in LENSES or lens not in ADAPTER_LENSES:
        raise GraphContractError("lens is not supported by tool-manifest")
    canonical = _object(manifest, "manifest")
    if isinstance(spans, (str, bytes, Mapping)):
        raise GraphContractError("spans must be an iterable of OTLP span objects")
    span_items = list(spans)
    normalized = _manifest(canonical)
    scope = _scope(render_scope, normalized["scopes"])
    revision = _settings_revision(settings_revision, scope)
    observed_at = _timestamp(as_of, "as_of")
    computed_sha256 = canonical_manifest_sha256(canonical)
    source_sha256 = manifest_sha256 or computed_sha256
    if not isinstance(source_sha256, str) or not SHA256.fullmatch(source_sha256):
        raise GraphContractError("manifest_sha256 must be sha256 followed by 64 lowercase hex characters")
    if source_sha256 != computed_sha256:
        raise GraphContractError("manifest_sha256 does not match the canonical manifest")
    graph_id = f"tool:{normalized['id']}" if scope["kind"] == "global" else f"{scope['kind']}:{scope['id']}/tool:{normalized['id']}"
    effective_permissions = _permissions(permissions)
    settings_ref = None if revision is None else deepcopy(revision)
    nodes: list[dict] = []
    edges: list[dict] = []
    correlated_nodes: dict[tuple[str, str], str] = {}
    pipeline_id_counts: dict[str, int] = {}
    for pipeline in normalized["pipelines"]:
        pipeline_id_counts[pipeline["id"]] = pipeline_id_counts.get(pipeline["id"], 0) + 1
    ambiguous_pipeline_ids = frozenset(
        pipeline_id for pipeline_id, count in pipeline_id_counts.items() if count > 1
    )
    pipeline_versions = {
        pipeline["id"]: pipeline["version"]
        for pipeline in normalized["pipelines"]
        if pipeline["id"] not in ambiguous_pipeline_ids
    }
    for pipeline in normalized["pipelines"]:
        runtime_pipeline_id = pipeline["runtime_id"]
        incoming = {item["to"] for item in pipeline["edges"]}
        for item in pipeline["nodes"]:
            node_id = f"{graph_id}/pipeline:{runtime_pipeline_id}/node:{item['id']}"
            if pipeline["id"] not in ambiguous_pipeline_ids:
                correlated_nodes[(pipeline["id"], item["id"])] = node_id
            node = {
                "id": node_id,
                "source_id": item["id"],
                "kind": item["kind"],
                "label": item["id"],
                "scope": deepcopy(scope),
                "authority": "manifest",
                "source": {
                    "manifest_id": normalized["id"],
                    "manifest_version": normalized["version"],
                    "pipeline_id": pipeline["id"],
                    "pipeline_version": pipeline["version"],
                    "sha256": source_sha256,
                },
                "classification": "unspecified",
                "freshness": {"observed_at": observed_at},
                "capabilities": [],
                "ports": [],
                "status": "declared",
                "presentation": ({"group_id": runtime_pipeline_id} if len(normalized["pipelines"]) > 1 else {}),
                "extensions": {"frank.graph.entry": item["id"] not in incoming},
            }
            if settings_ref is not None:
                node["settings_revision_ref"] = deepcopy(settings_ref)
            nodes.append(node)
        for edge_index, edge in enumerate(pipeline["edges"]):
            edges.append({
                "id": f"{graph_id}/pipeline:{runtime_pipeline_id}/edge:{edge_index}:{edge['from']}:{edge['to']}",
                "source_id": edge_index,
                "from": f"{graph_id}/pipeline:{runtime_pipeline_id}/node:{edge['from']}",
                "to": f"{graph_id}/pipeline:{runtime_pipeline_id}/node:{edge['to']}",
                "kind": "control",
                "authority": "manifest",
                "classification": "unspecified",
                "source": {
                    "manifest_id": normalized["id"],
                    "manifest_version": normalized["version"],
                    "pipeline_id": pipeline["id"],
                    "pipeline_version": pipeline["version"],
                    "sha256": source_sha256,
                },
                "freshness": {"observed_at": observed_at},
                "status": "declared",
                "presentation": {},
                "extensions": {},
            })
    overlay: dict[str, str] = {}
    overlay_trace_ids: set[str] = set()
    if span_items and not normalized["trace_span_prefix"]:
        raise GraphContractError("OTLP overlays require a declared manifest.trace.span_prefix")
    for span in span_items:
        node_id, status, span_trace_id = _span_overlay(
            span,
            tool_id=normalized["id"],
            scope=scope,
            span_prefix=normalized["trace_span_prefix"],
            pipeline_versions=pipeline_versions,
            node_ids=correlated_nodes,
            ambiguous_pipeline_ids=ambiguous_pipeline_ids,
        )
        overlay_trace_ids.add(span_trace_id)
        if status is not None:
            overlay[node_id] = status
    if len(overlay_trace_ids) > 1:
        raise GraphContractError("one graph projection cannot mix OTLP trace identities")
    for node in nodes:
        if node["id"] in overlay:
            node["status"] = overlay[node["id"]]
            node["authority"] = "otel"
    graph = {
        "schema": GRAPH_SCHEMA,
        "graph_id": graph_id,
        "graph_revision": "",
        "generated_at": observed_at,
        "provider": {"id": ADAPTER_ID, "version": ADAPTER_VERSION, "authority": "manifest"},
        "subject": {"kind": "tool", "id": normalized["id"]},
        "scope": deepcopy(scope),
        "lens": lens,
        "capabilities": effective_permissions,
        "nodes": nodes,
        "edges": edges,
        "groups": [
            {"id": pipeline["runtime_id"], "label": pipeline["id"], "order": index}
            for index, pipeline in enumerate(normalized["pipelines"])
            if len(normalized["pipelines"]) > 1
        ],
        "trace_ref": None,
        "extensions": {},
    }
    selected = _selection(selection, graph)
    if selected is not None:
        graph["extensions"]["frank.graph.selection"] = selected
    revision_material = deepcopy(graph)
    revision_material["graph_revision"] = None
    graph["graph_revision"] = "sha256:" + hashlib.sha256(_canonical_bytes(revision_material)).hexdigest()
    return graph

"""Pure, fail-closed normalization for the shared Frank graph contract."""

from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from datetime import datetime
from typing import Iterable, Mapping

GRAPH_SCHEMA = "schema://frank.graph/v1"
MANIFEST_SCHEMA = "schema://frank.tool-app-manifest/v1"
SETTINGS_SCHEMA = "schema://frank.tool-app-settings/v1"
TRACE_SCHEMA = "schema://frank.tool-app-trace/v1"
CAPABILITY = "frank.graph.v1"
ADAPTER_ID = "tool-manifest"
ADAPTER_VERSION = "1.0.0"

ENTITY_KINDS = frozenset({"project", "tool", "agent", "service"})
SCOPES = frozenset({"global", "profile", "project", "workspace", "session"})
LENSES = frozenset({
    "tool.pipeline",
    "tool.settings",
    "run.trace",
    "system.topology",
    "project.dependencies",
    "release.receipts",
})
ADAPTER_LENSES = frozenset({"tool.pipeline", "tool.settings", "run.trace"})
NODE_STATUSES = frozenset({"declared", "queued", "running", "succeeded", "failed", "blocked", "cancelled", "unavailable"})
EDGE_STATUSES = frozenset({"declared", "active", "succeeded", "failed", "unavailable"})
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
TRACE_ID = re.compile(r"^[0-9a-f]{32}$")
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$")


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
    match = SEMVER.fullmatch(value)
    if not match or int(match.group(1)) != 1:
        raise GraphContractError(f"{label} must be a supported major version")
    return value


def _canonical_bytes(value: object) -> bytes:
    """Canonical JSON for v1 manifests (the accepted v1 values are JSON scalars)."""
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise GraphContractError("manifest is not canonicalizable JSON") from error


def canonical_manifest_sha256(manifest: Mapping[str, object]) -> str:
    return "sha256:" + hashlib.sha256(_canonical_bytes(manifest)).hexdigest()


def _timestamp(value: object | None, label: str) -> str:
    if value is None:
        return "1970-01-01T00:00:00Z"
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
        result = {"kind": "global"}
    else:
        source = _object(value, "render_scope")
        kind = _text(source.get("kind"), "render_scope.kind").lower()
        if kind == "global":
            if set(source) - {"kind"}:
                raise GraphContractError("global render_scope cannot contain an id")
            result = {"kind": kind}
        else:
            result = {"kind": kind, "id": _id(source.get("id"), "render_scope.id")}
    if result["kind"] not in SCOPES or result["kind"] not in declared:
        raise GraphContractError("render_scope is not declared by the manifest")
    return result


def _manifest(manifest: object) -> dict:
    value = _object(manifest, "manifest")
    if value.get("schema") != MANIFEST_SCHEMA:
        raise GraphContractError("manifest schema must be schema://frank.tool-app-manifest/v1")
    result = {
        "schema": MANIFEST_SCHEMA,
        "id": _id(value.get("id"), "manifest.id"),
        "version": _version(value.get("version"), "manifest.version"),
        "name": _text(value.get("name"), "manifest.name"),
        "description": _text(value.get("description"), "manifest.description"),
    }
    scopes = value.get("scopes", [])
    if not isinstance(scopes, list) or not scopes or any(not isinstance(scope, str) or scope not in SCOPES for scope in scopes):
        raise GraphContractError("manifest.scopes must contain only declared scope names")
    result["scopes"] = list(dict.fromkeys(scopes))
    settings = value.get("settings", {})
    if not isinstance(settings, dict):
        raise GraphContractError("manifest.settings must be an object")
    pipelines = value.get("pipelines", [])
    if not isinstance(pipelines, list):
        raise GraphContractError("manifest.pipelines must be a list")
    normalized_pipelines = []
    for pipeline_index, pipeline in enumerate(pipelines):
        pipeline = _object(pipeline, f"pipelines[{pipeline_index}]")
        if pipeline.get("schema") != "schema://frank.tool-app-pipeline/v1":
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
            normalized_nodes.append({"id": node_id, "kind": _text(item["kind"], "pipeline node kind")})
        normalized_edges = []
        for edge_index, item in enumerate(edges):
            item = _object(item, f"pipelines[{pipeline_index}].edges[{edge_index}]")
            if set(item) != {"from", "to"}:
                raise GraphContractError("v1 pipeline edges must contain exactly from and to")
            source = _id(item["from"], "pipeline edge.from")
            target = _id(item["to"], "pipeline edge.to")
            if source not in node_ids or target not in node_ids:
                raise GraphContractError("pipeline edges must reference declared nodes")
            normalized_edges.append({"from": source, "to": target})
        normalized_pipelines.append({
            "id": pipeline_id,
            "version": pipeline_version,
            "nodes": normalized_nodes,
            "edges": normalized_edges,
        })
    result["settings"] = settings
    result["pipelines"] = normalized_pipelines
    return result


def _settings_revision(value: object | None, scope: dict) -> dict | None:
    if value is None:
        return None
    value = _object(value, "settings_revision")
    if value.get("schema") != SETTINGS_SCHEMA:
        raise GraphContractError("settings revision has an unsupported schema")
    revision = value.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise GraphContractError("settings revision must be a non-negative integer")
    supplied_scope = _object(value.get("scope"), "settings_revision.scope")
    if supplied_scope != scope:
        raise GraphContractError("settings revision scope does not match render_scope")
    if "settings" not in value:
        raise GraphContractError("settings revision.settings is required")
    return {
        "schema": SETTINGS_SCHEMA,
        "scope": deepcopy(supplied_scope),
        "revision": revision,
    }


def _trace_id(value: object, label: str = "trace_id") -> str:
    value = _text(value, label)
    if not TRACE_ID.fullmatch(value):
        raise GraphContractError(f"{label} must be a lowercase 32-hex W3C trace ID")
    return value


def _trace_ref(value: object | None) -> dict | None:
    if value is None:
        return None
    trace = _object(value, "trace")
    if trace.get("schema") != TRACE_SCHEMA:
        raise GraphContractError("trace has an unsupported schema")
    trace_id = _trace_id(trace.get("trace_id"))
    return {"trace_id": trace_id}


def _overlays(events: Iterable[object], spans: Iterable[object]) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in [*events, *spans]:
        if not isinstance(item, dict):
            continue
        node_id = item.get("node_id")
        status = str(item.get("status") or "").lower()
        if isinstance(node_id, str) and SAFE_ID.fullmatch(node_id) and status in NODE_STATUSES:
            result[node_id] = status
    return result


def normalize_manifest(
    manifest: Mapping[str, object],
    *,
    render_scope: Mapping[str, object] | None = None,
    settings_revision: Mapping[str, object] | None = None,
    events: Iterable[object] = (),
    trace: Mapping[str, object] | None = None,
    spans: Iterable[object] = (),
    permissions: Iterable[str] = (),
    selection: Mapping[str, object] | None = None,
    lens: str = "tool.pipeline",
    as_of: str | None = None,
    generated_at: str | None = None,
    manifest_sha256: str | None = None,
) -> dict:
    """Project one canonical Tool manifest into a disposable graph envelope.

    The function accepts already-authorized values only. It performs no I/O,
    network access, mutation, scheduling, or execution and never copies
    ignored domain fields into ``extensions``.
    """
    if lens not in LENSES or lens not in ADAPTER_LENSES:
        raise GraphContractError("lens is not supported by tool-manifest")
    canonical = _object(manifest, "manifest")
    normalized = _manifest(canonical)
    scope = _scope(render_scope, normalized["scopes"])
    revision = _settings_revision(settings_revision, scope)
    observed_at = _timestamp(generated_at or as_of, "generated_at")
    source_sha256 = manifest_sha256 or canonical_manifest_sha256(canonical)
    if not SHA256.fullmatch(source_sha256):
        raise GraphContractError("manifest_sha256 must be sha256 followed by 64 lowercase hex characters")
    graph_id = f"tool:{normalized['id']}" if scope["kind"] == "global" else f"{scope['kind']}:{scope['id']}/tool:{normalized['id']}"
    overlay = _overlays(events, spans)
    settings_ref = None if revision is None else deepcopy(revision)
    nodes: list[dict] = []
    edges: list[dict] = []
    for pipeline in normalized["pipelines"]:
        node_ids = {item["id"] for item in pipeline["nodes"]}
        incoming = {item["to"] for item in pipeline["edges"]}
        for item in pipeline["nodes"]:
            node_id = f"{graph_id}/pipeline:{pipeline['id']}/node:{item['id']}"
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
                "status": overlay.get(item["id"], "declared"),
                "presentation": {"group_id": pipeline["id"] if len(normalized["pipelines"]) > 1 else None},
                "extensions": {},
            }
            if node["presentation"]["group_id"] is None:
                node["presentation"] = {}
            if settings_ref is not None:
                node["settings_revision_ref"] = deepcopy(settings_ref)
            node["extensions"]["frank.graph.entry"] = item["id"] not in incoming
            nodes.append(node)
        for edge_index, edge in enumerate(pipeline["edges"]):
            edges.append({
                "id": f"{graph_id}/pipeline:{pipeline['id']}/edge:{edge_index}:{edge['from']}:{edge['to']}",
                "source_id": edge_index,
                "from": f"{graph_id}/pipeline:{pipeline['id']}/node:{edge['from']}",
                "to": f"{graph_id}/pipeline:{pipeline['id']}/node:{edge['to']}",
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
    trace_ref = _trace_ref(trace)
    graph = {
        "schema": GRAPH_SCHEMA,
        "graph_id": graph_id,
        "graph_revision": "",
        "generated_at": observed_at,
        "provider": {"id": ADAPTER_ID, "version": ADAPTER_VERSION, "authority": "manifest"},
        "subject": {"kind": "tool", "id": normalized["id"]},
        "scope": deepcopy(scope),
        "lens": lens,
        "capabilities": ["inspect"],
        "nodes": nodes,
        "edges": edges,
        "groups": [
            {"id": pipeline["id"], "label": pipeline["id"], "order": index}
            for index, pipeline in enumerate(normalized["pipelines"])
            if len(normalized["pipelines"]) > 1
        ],
        "trace_ref": trace_ref,
        "extensions": {},
    }
    revision_material = deepcopy(graph)
    revision_material["graph_revision"] = None
    graph["graph_revision"] = "sha256:" + hashlib.sha256(_canonical_bytes(revision_material)).hexdigest()
    return graph

"""Fail-closed read-only graph provider boundary.

Production assembly supplies an authorized startup manifest map; this module
owns no filesystem, state store, collector, cache, or execution loop.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping
from copy import deepcopy
from datetime import datetime
from datetime import timezone

from flask import Blueprint, Response, abort, jsonify, request

from .contract import (
    ADAPTER_LENSES,
    EDGE_STATUSES,
    GRAPH_SCHEMA,
    NODE_STATUSES,
    SCOPES,
    SHA256,
    SEMVER,
    normalize_manifest,
    GraphContractError,
)

_QUERY_KEYS = frozenset({"lens", "scope_kind", "scope_id"})
_OPAQUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
_GRAPH_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
_NAMESPACED = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$")
_HTML = re.compile(r"<\/?[A-Za-z][^>]*>|javascript\s*:", re.I)
_CLASSIFICATIONS = frozenset({"unspecified", "public", "internal", "private", "secret"})
_AUTHORITIES = frozenset({"manifest", "settings", "hermes", "otel", "provider"})
_SECRET_VALUE = re.compile(
    r"(?:-----BEGIN [A-Z ]+-----|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+|"
    r"\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",
    re.I,
)
_SAFE_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,639}$")
_HASH_SUFFIXES = ("_hash", ".hash")
_REFERENCE_SUFFIXES = ("_ref", ".ref", "_id", ".id")
_VERSION_SUFFIXES = ("_version", ".version")
_COUNT_SUFFIXES = ("_count", ".count", "_tokens", ".tokens")
_MAX_SAFE_INTEGER = (1 << 53) - 1

class ProviderUnavailable(RuntimeError):
    """The authorized boundary has no safe registered projection."""


def manifest_reader(manifests: Mapping[str, Mapping[str, object]]) -> Callable[..., Mapping[str, object] | None]:
    """Build a reader over an authorized immutable startup manifest map.

    Discovery and validation belong to ``tool_apps.discover_tool_apps``. This
    callback performs no filesystem access and cannot reinterpret arbitrary
    paths supplied by a request.
    """
    authorized = dict(manifests)

    def read(*, kind: str, entity_id: str, selectors: Mapping[str, str | None]) -> Mapping[str, object] | None:
        if kind != "tool" or not _OPAQUE.fullmatch(entity_id):
            return None
        manifest = authorized.get(entity_id)
        if not isinstance(manifest, Mapping):
            return None
        try:
            scope_kind = str(selectors.get("scope_kind") or "").strip()
            scope_id = str(selectors.get("scope_id") or "").strip()
            render_scope = None
            if scope_kind:
                render_scope = {"kind": scope_kind}
                if scope_kind != "global":
                    render_scope["id"] = scope_id
            return normalize_manifest(
                manifest,
                render_scope=render_scope,
                lens=str(selectors.get("lens") or "tool.pipeline"),
                as_of=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            )
        except (GraphContractError, TypeError, ValueError):
            return None

    return read


def _entity_id(value: str) -> str:
    if not _OPAQUE.fullmatch(value):
        abort(404)
    return value


def _query() -> dict[str, str | None]:
    unknown = set(request.args) - _QUERY_KEYS
    if unknown:
        abort(400, "unsupported graph selector")
    lens = request.args.get("lens", "tool.pipeline")
    if lens not in ADAPTER_LENSES:
        abort(400, "unsupported graph lens")
    scope_kind = request.args.get("scope_kind")
    scope_id = request.args.get("scope_id")
    if scope_kind is not None:
        if scope_kind not in SCOPES:
            abort(400, "unsupported graph scope")
        if scope_kind == "global":
            if scope_id is not None:
                abort(400, "global graph scope cannot include an id")
        elif not scope_id or not _OPAQUE.fullmatch(scope_id):
            abort(400, "scoped graph request requires a valid id")
    elif scope_id is not None:
        abort(400, "graph scope id requires a scope kind")
    return {"lens": lens, "scope_kind": scope_kind, "scope_id": scope_id}


def _timestamp(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ProviderUnavailable(f"{label} was missing")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProviderUnavailable(f"{label} was not RFC 3339") from error
    if parsed.tzinfo is None:
        raise ProviderUnavailable(f"{label} omitted its timezone")
    return value


def _exact(value: object, keys: set[str], label: str, *, optional: set[str] = frozenset()) -> dict:
    if not isinstance(value, dict) or set(value) - keys or keys - optional - set(value):
        raise ProviderUnavailable(f"{label} had an invalid field set")
    return value


def _scope(value: object) -> dict:
    if not isinstance(value, dict):
        raise ProviderUnavailable("graph scope was invalid")
    kind = value.get("kind")
    if kind not in SCOPES:
        raise ProviderUnavailable("graph scope kind was invalid")
    if kind == "global":
        if set(value) != {"kind"}:
            raise ProviderUnavailable("global graph scope was invalid")
    elif set(value) != {"kind", "id"} or not isinstance(value.get("id"), str) or not _OPAQUE.fullmatch(value["id"]):
        raise ProviderUnavailable("scoped graph identity was invalid")
    return value


def _freshness(value: object, label: str) -> None:
    value = _exact(value, {"observed_at", "expires_at"}, label, optional={"expires_at"})
    _timestamp(value.get("observed_at"), f"{label}.observed_at")
    if "expires_at" in value:
        _timestamp(value["expires_at"], f"{label}.expires_at")


def _path_parts(path: str) -> tuple[str, list[str]]:
    separated = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", path)
    lowered = separated.lower().replace("-", "_")
    return lowered, [part for part in re.split(r"[._\[\]]+", lowered) if part]


def _metadata_kind(path: str) -> str | None:
    lowered, parts = _path_parts(path)
    if lowered.endswith(_HASH_SUFFIXES):
        return "hash"
    if lowered.endswith(_REFERENCE_SUFFIXES):
        return "reference"
    if lowered.endswith(_VERSION_SUFFIXES):
        return "version"
    if lowered.endswith(_COUNT_SUFFIXES):
        return "count"
    if "usage" in parts and any(
        part in {"token", "tokens", "token_count", "tokencount"}
        or part.endswith("_tokens")
        for part in parts
    ):
        return "count"
    return None


def _sensitive_path(path: str) -> bool:
    lowered, parts = _path_parts(path)
    if lowered.startswith(("gen_ai.input", "gen_ai.output", "gen_ai.system", "gen_ai.user", "openinference.span.kind.input", "openinference.span.kind.output")) or any(
        marker in lowered
        for marker in (".gen_ai.input", ".gen_ai.output", ".gen_ai.system", ".gen_ai.user")
    ):
        return True
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    metadata_kind = _metadata_kind(path)
    if any(part in {"credential", "credentials", "secret", "secrets", "password", "passwords", "passwd"} for part in parts):
        return True
    if any(
        left in parts and right in parts
        for left, right in (("api", "key"), ("access", "token"), ("auth", "token"), ("refresh", "token"))
    ):
        return True
    if "token" in parts and metadata_kind != "count":
        return True
    if any(term in compact for term in (
        "systemprompt", "toolarguments", "toolresult", "modelinput", "modeloutput",
        "genaicompletion", "genaicompletions", "llmresponse", "genaitoolcallargs",
        "genaitoolcallarguments", "genaitoolcallresult", "llmcompletion", "llmprompt",
        "llminputmessage", "llmoutputmessage", "genaitooldefinitions", "genaitooldefinition",
        "llmtools", "llmtooldefinitions", "toolrequest", "toolresponse", "toolbody",
        "toolbodies", "toolargs", "toolresults", "functionrequest", "functionresponse",
        "functionarguments", "functionargs", "functionresult", "functionresults",
        "functionbody", "functionbodies", "functioninput", "functionoutput",
        "promptbody", "completionbody", "inputbody", "outputbody", "toolcalls",
        "toolparameters", "tooldescription", "tooldefinitions", "tooldefinition",
        "functionparameters", "functiondescription", "functiondefinitions", "functiondefinition",
        "modelresponse", "modelresponsetext", "responsetext", "responsebody", "apikey",
        "accesstoken", "authtoken", "refreshtoken",
    )):
        return True
    if parts and parts[-1] in {"request", "requests", "response", "responses", "tools", "functions"}:
        return True
    for index, part in enumerate(parts):
        if part not in {"tool", "tools", "function", "functions"}:
            continue
        if any(child in {
            "parameter", "parameters", "description", "descriptions", "definition", "definitions",
            "argument", "arguments", "args", "result", "results", "request", "requests",
            "response", "responses", "body", "bodies", "input", "inputs", "output", "outputs",
            "schema", "schemas",
        } for child in parts[index + 1:]):
            return True
    if any(part in {"model", "llm"} for part in parts) and any(part in {"response", "responses"} for part in parts):
        return True
    if metadata_kind is not None:
        return False
    if any(part in {"prompt", "prompts", "completion", "completions", "instruction", "instructions", "content", "contents", "body", "bodies", "messages", "message", "input", "inputs", "output", "outputs", "user", "arguments", "argument", "args", "result", "results", "credential", "credentials", "password", "secret", "secrets", "token"} for part in parts):
        return True
    return False


def _safe_metadata(value: object, path: str, kind: str) -> object:
    if kind == "hash":
        if not isinstance(value, str) or not SHA256.fullmatch(value):
            raise ProviderUnavailable(f"{path} must be an actual sha256 digest")
        return value
    if kind == "count":
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ProviderUnavailable(f"{path} must be a non-negative integer")
        return value
    if kind == "version":
        return _safe_text(value, path, pattern=_SAFE_REFERENCE, max_length=640)
    if kind == "reference":
        return _safe_text(value, path, pattern=_SAFE_REFERENCE, max_length=640)
    raise ProviderUnavailable(f"{path} had an unsupported metadata kind")


def _safe_json(value: object, path: str, active: set[int] | None = None) -> object:
    active = set() if active is None else active
    if value is None or type(value) in (bool, int):
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ProviderUnavailable(f"{path} contained a non-finite number")
        return value
    if isinstance(value, str):
        if len(value) > 2048 or any(ord(char) < 32 or ord(char) == 127 for char in value) or _SECRET_VALUE.search(value) or _HTML.search(value):
            raise ProviderUnavailable(f"{path} contained markup or secret-like data")
        return value
    if isinstance(value, (list, dict)):
        if id(value) in active:
            raise ProviderUnavailable(f"{path} contained a cycle")
        active.add(id(value))
        try:
            if isinstance(value, list):
                return [_safe_json(item, f"{path}[]", active) for item in value]
            result = {}
            for key, item in value.items():
                if not isinstance(key, str) or any(ord(char) < 32 or ord(char) == 127 for char in key) or _HTML.search(key):
                    raise ProviderUnavailable(f"{path} contained an invalid field")
                child_path = f"{path}.{key}"
                if _sensitive_path(child_path):
                    continue
                metadata_kind = _metadata_kind(child_path)
                result[key] = _safe_metadata(item, child_path, metadata_kind) if metadata_kind else _safe_json(item, child_path, active)
            return result
        finally:
            active.remove(id(value))
    raise ProviderUnavailable(f"{path} was not JSON-compatible")


def _contains_sensitive_key(value: object, path: str = "graph", active: set[int] | None = None) -> bool:
    active = set() if active is None else active
    if isinstance(value, (dict, list)):
        if id(value) in active:
            raise ProviderUnavailable(f"{path} contained a cycle")
        active.add(id(value))
        try:
            if isinstance(value, dict):
                return any(
                    not isinstance(key, str)
                    or bool(_HTML.search(key))
                    or _sensitive_path(f"{path}.{key}")
                    or _contains_sensitive_key(item, f"{path}.{key}", active)
                    for key, item in value.items()
                )
            return any(_contains_sensitive_key(item, f"{path}[]", active) for item in value)
        finally:
            active.remove(id(value))
    return isinstance(value, str) and bool(_SECRET_VALUE.search(value) or _HTML.search(value))


def _safe_text(value: object, label: str, *, pattern: re.Pattern | None = None, max_length: int | None = None) -> str:
    if not isinstance(value, str) or not value or (max_length is not None and len(value) > max_length) or any(ord(char) < 32 or ord(char) == 127 for char in value) or _HTML.search(value) or _SECRET_VALUE.search(value):
        raise ProviderUnavailable(f"{label} was not safe bounded text")
    if pattern is not None and not pattern.fullmatch(value):
        raise ProviderUnavailable(f"{label} had an invalid format")
    return value


def _source(value: object, label: str) -> dict:
    source = _exact(value, {"manifest_id", "manifest_version", "pipeline_id", "pipeline_version", "sha256"}, label)
    _safe_text(source.get("manifest_id"), f"{label}.manifest_id", pattern=_OPAQUE)
    _safe_text(source.get("pipeline_id"), f"{label}.pipeline_id", pattern=_OPAQUE)
    _safe_text(source.get("manifest_version"), f"{label}.manifest_version", pattern=SEMVER)
    _safe_text(source.get("pipeline_version"), f"{label}.pipeline_version", pattern=SEMVER)
    if not isinstance(source.get("sha256"), str) or not SHA256.fullmatch(source["sha256"]):
        raise ProviderUnavailable(f"{label}.sha256 was invalid")
    return source


def _extensions(value: object, label: str, *, allowed: set[str]) -> dict:
    if not isinstance(value, dict) or any(not isinstance(key, str) or not _NAMESPACED.fullmatch(key) for key in value):
        raise ProviderUnavailable(f"{label} must contain only namespaced fields")
    if set(value) - allowed:
        raise ProviderUnavailable(f"{label} contained an unsupported current-v1 field")
    _safe_json(value, label)
    return value


def _node_presentation(value: object, label: str, *, generic: bool = False) -> dict:
    presentation = _exact(value, {"group_id", "icon", "tone"}, label, optional={"group_id", "icon", "tone"})
    for key, item in presentation.items():
        _safe_text(item, f"{label}.{key}", pattern=_GRAPH_ID if generic and key == "group_id" else _OPAQUE)
    return presentation


def _edge_presentation(value: object, label: str) -> dict:
    presentation = _exact(value, {"tone", "dashed"}, label, optional={"tone", "dashed"})
    if "tone" in presentation:
        _safe_text(presentation["tone"], f"{label}.tone", pattern=_OPAQUE)
    if "dashed" in presentation and not isinstance(presentation["dashed"], bool):
        raise ProviderUnavailable(f"{label}.dashed must be boolean")
    return presentation


def _safe_graph(value: object, *, kind: str, entity_id: str, selectors: Mapping[str, str | None]) -> dict:
    required = {
        "schema", "graph_id", "graph_revision", "generated_at", "provider",
        "subject", "scope", "lens", "capabilities", "nodes", "edges",
        "groups", "trace_ref", "extensions",
    }
    value = _exact(value, required, "graph envelope")
    if value.get("schema") != GRAPH_SCHEMA:
        raise ProviderUnavailable("authorized graph projection had an unsupported schema")
    graph_id = value.get("graph_id")
    if not isinstance(graph_id, str) or not _GRAPH_ID.fullmatch(graph_id):
        raise ProviderUnavailable("graph identity was invalid")
    graph_revision = value.get("graph_revision")
    if not isinstance(graph_revision, str) or not SHA256.fullmatch(graph_revision):
        raise ProviderUnavailable("graph revision was invalid")
    _timestamp(value.get("generated_at"), "graph.generated_at")
    provider = _exact(value.get("provider"), {"id", "version", "authority"}, "graph.provider")
    if not isinstance(provider.get("id"), str) or not _OPAQUE.fullmatch(provider["id"]):
        raise ProviderUnavailable("graph provider identity was invalid")
    if not isinstance(provider.get("version"), str) or not SEMVER.fullmatch(provider["version"]) or provider.get("authority") not in _AUTHORITIES:
        raise ProviderUnavailable("graph provider provenance was invalid")
    subject = _exact(value.get("subject"), {"kind", "id"}, "graph.subject")
    if subject != {"kind": kind, "id": entity_id}:
        raise ProviderUnavailable("graph subject did not match the request")
    scope = _scope(value.get("scope"))
    requested_scope_kind = selectors.get("scope_kind")
    requested_scope_id = selectors.get("scope_id")
    if requested_scope_kind:
        requested_scope = {"kind": requested_scope_kind}
        if requested_scope_kind != "global":
            requested_scope["id"] = requested_scope_id
        if scope != requested_scope:
            raise ProviderUnavailable("graph scope did not match the request")
    subject_id = f"{kind}:{entity_id}"
    if scope["kind"] == "global" or (scope["kind"] == kind and scope.get("id") == entity_id):
        expected_graph_id = subject_id
    else:
        expected_graph_id = f"{scope['kind']}:{scope['id']}/{subject_id}"
    if graph_id != expected_graph_id:
        raise ProviderUnavailable("graph ID did not bind the requested subject and scope")
    if value.get("lens") != selectors.get("lens") or value["lens"] not in ADAPTER_LENSES:
        raise ProviderUnavailable("graph lens did not match the request")
    capabilities = value.get("capabilities")
    if not isinstance(capabilities, list) or any(not isinstance(item, str) or not _OPAQUE.fullmatch(item) for item in capabilities) or len(capabilities) != len(set(capabilities)):
        raise ProviderUnavailable("graph capabilities were invalid")
    nodes = value.get("nodes")
    edges = value.get("edges")
    groups = value.get("groups")
    if not isinstance(nodes, list) or not isinstance(edges, list) or not isinstance(groups, list):
        raise ProviderUnavailable("authorized graph projection was incomplete")
    node_ids: set[str] = set()
    node_sources: dict[str, dict] = {}
    node_source_ids: dict[str, str] = {}
    node_runtime_pipeline_ids: dict[str, str] = {}
    settings_revisions: set[str] = set()
    node_required = {
        "id", "source_id", "kind", "label", "scope", "authority", "source",
        "classification", "freshness", "capabilities", "ports", "status",
        "presentation", "extensions", "settings_revision_ref",
    }
    for index, node in enumerate(nodes):
        node = _exact(node, node_required, f"graph.nodes[{index}]", optional={"settings_revision_ref"})
        node_id = node.get("id")
        if not isinstance(node_id, str) or not _GRAPH_ID.fullmatch(node_id) or not node_id.startswith(graph_id + "/") or node_id in node_ids:
            raise ProviderUnavailable("graph node identity was invalid or duplicated")
        node_ids.add(node_id)
        _safe_text(node.get("source_id"), f"graph.nodes[{index}].source_id", pattern=_OPAQUE)
        _safe_text(node.get("kind"), f"graph.nodes[{index}].kind", pattern=_OPAQUE)
        _safe_text(node.get("label"), f"graph.nodes[{index}].label")
        if node.get("scope") != scope or node.get("authority") not in _AUTHORITIES or node.get("classification") not in _CLASSIFICATIONS:
            raise ProviderUnavailable("graph node provenance was invalid")
        _freshness(node.get("freshness"), f"graph.nodes[{index}].freshness")
        source = _source(node.get("source"), f"graph.nodes[{index}].source")
        if kind == "tool" and source["manifest_id"] != entity_id:
            raise ProviderUnavailable("graph node source did not match the Tool subject")
        node_prefix = f"{graph_id}/pipeline:"
        node_suffix = f"/node:{node['source_id']}"
        if not node_id.startswith(node_prefix) or not node_id.endswith(node_suffix):
            raise ProviderUnavailable("graph node ID did not match its canonical source")
        runtime_pipeline_id = node_id[len(node_prefix):-len(node_suffix)]
        _safe_text(runtime_pipeline_id, f"graph.nodes[{index}].runtime_pipeline_id", pattern=_OPAQUE)
        node_sources[node_id] = source
        node_source_ids[node_id] = node["source_id"]
        node_runtime_pipeline_ids[node_id] = runtime_pipeline_id
        if (
            not isinstance(node.get("capabilities"), list)
            or any(not isinstance(item, str) or not _OPAQUE.fullmatch(item) for item in node["capabilities"])
            or len(node["capabilities"]) != len(set(node["capabilities"]))
            or node.get("ports") != []
        ):
            raise ProviderUnavailable("graph node source or capabilities were invalid")
        if node.get("status") not in NODE_STATUSES:
            raise ProviderUnavailable("graph node state was invalid")
        _node_presentation(node.get("presentation"), f"graph.nodes[{index}].presentation")
        node_extensions = _extensions(node.get("extensions"), f"graph.nodes[{index}].extensions", allowed={"frank.graph.entry"})
        if "frank.graph.entry" in node_extensions and not isinstance(node_extensions["frank.graph.entry"], bool):
            raise ProviderUnavailable("graph node entry extension must be boolean")
        if "settings_revision_ref" in node:
            revision = _exact(node["settings_revision_ref"], {"schema", "scope", "revision"}, f"graph.nodes[{index}].settings_revision_ref")
            if (
                revision.get("schema") != SETTINGS_SCHEMA
                or revision.get("scope") != scope
                or not isinstance(revision.get("revision"), int)
                or isinstance(revision.get("revision"), bool)
                or not 0 <= revision["revision"] <= _MAX_SAFE_INTEGER
            ):
                raise ProviderUnavailable("graph settings revision was invalid")
            settings_revisions.add(str(revision["revision"]))
    edge_ids: set[str] = set()
    edge_source_ids: set[tuple[str, int]] = set()
    edge_required = {
        "id", "source_id", "from", "to", "kind", "authority",
        "classification", "source", "freshness", "status", "presentation",
        "extensions",
    }
    for index, edge in enumerate(edges):
        edge = _exact(edge, edge_required, f"graph.edges[{index}]")
        edge_id = edge.get("id")
        if not isinstance(edge_id, str) or not _GRAPH_ID.fullmatch(edge_id) or not edge_id.startswith(graph_id + "/") or edge_id in edge_ids:
            raise ProviderUnavailable("graph edge identity was invalid or duplicated")
        edge_ids.add(edge_id)
        if (
            not isinstance(edge.get("source_id"), int)
            or isinstance(edge.get("source_id"), bool)
            or not 0 <= edge["source_id"] <= _MAX_SAFE_INTEGER
            or edge.get("kind") != "control"
        ):
            raise ProviderUnavailable("graph edge declaration was invalid")
        if edge.get("from") not in node_ids or edge.get("to") not in node_ids:
            raise ProviderUnavailable("graph edge referenced an unknown node")
        if edge.get("authority") not in _AUTHORITIES or edge.get("classification") not in _CLASSIFICATIONS or edge.get("status") not in EDGE_STATUSES:
            raise ProviderUnavailable("graph edge provenance or state was invalid")
        _freshness(edge.get("freshness"), f"graph.edges[{index}].freshness")
        source = _source(edge.get("source"), f"graph.edges[{index}].source")
        from_runtime_pipeline_id = node_runtime_pipeline_ids[edge["from"]]
        to_runtime_pipeline_id = node_runtime_pipeline_ids[edge["to"]]
        if from_runtime_pipeline_id != to_runtime_pipeline_id:
            raise ProviderUnavailable("graph edge crossed runtime pipeline instances")
        source_identity = (from_runtime_pipeline_id, edge["source_id"])
        if source_identity in edge_source_ids:
            raise ProviderUnavailable("graph edge source identity was duplicated")
        edge_source_ids.add(source_identity)
        from_source = node_sources[edge["from"]]
        to_source = node_sources[edge["to"]]
        if source != from_source or source != to_source:
            raise ProviderUnavailable("graph edge source did not match its endpoint sources")
        expected_edge_id = f"{graph_id}/pipeline:{from_runtime_pipeline_id}/edge:{edge['source_id']}:{node_source_ids[edge['from']]}:{node_source_ids[edge['to']]}"
        if edge_id != expected_edge_id:
            raise ProviderUnavailable("graph edge ID did not match its canonical source")
        _edge_presentation(edge.get("presentation"), f"graph.edges[{index}].presentation")
        _extensions(edge.get("extensions"), f"graph.edges[{index}].extensions", allowed=set())
    group_ids: set[str] = set()
    for index, group in enumerate(groups):
        group = _exact(group, {"id", "label", "parent_id", "order"}, f"graph.groups[{index}]", optional={"parent_id", "order"})
        _safe_text(group.get("id"), f"graph.groups[{index}].id", pattern=_OPAQUE)
        if group["id"] in group_ids:
            raise ProviderUnavailable("graph group identity was duplicated")
        group_ids.add(group["id"])
        _safe_text(group.get("label"), f"graph.groups[{index}].label")
        if "parent_id" in group:
            _safe_text(group["parent_id"], f"graph.groups[{index}].parent_id", pattern=_OPAQUE)
        if "order" in group and (
            not isinstance(group["order"], int)
            or isinstance(group["order"], bool)
            or not 0 <= group["order"] <= _MAX_SAFE_INTEGER
        ):
            raise ProviderUnavailable("graph group order was invalid")
    for group in groups:
        if group.get("parent_id") is not None and group["parent_id"] not in group_ids:
            raise ProviderUnavailable("graph group parent was unknown")
    visiting: set[str] = set()
    visited: set[str] = set()
    group_parents = {group["id"]: group.get("parent_id") for group in groups}

    def visit_group(group_id: str) -> None:
        if group_id in visiting:
            raise ProviderUnavailable("graph groups must be acyclic")
        if group_id in visited:
            return
        visiting.add(group_id)
        parent_id = group_parents[group_id]
        if parent_id is not None:
            visit_group(parent_id)
        visiting.remove(group_id)
        visited.add(group_id)

    for group_id in group_ids:
        visit_group(group_id)
    for node in nodes:
        group_id = node["presentation"].get("group_id")
        if group_id is not None and group_id not in group_ids:
            raise ProviderUnavailable("graph node presentation referenced an unknown group")
    trace_ref = value.get("trace_ref")
    if trace_ref is not None:
        raise ProviderUnavailable("current-v1 Tool graphs cannot advertise an uncorrelated trace")
    graph_extensions = _extensions(value.get("extensions"), "graph.extensions", allowed={"frank.graph.selection"})
    if "frank.graph.selection" in graph_extensions:
        selected = _exact(graph_extensions["frank.graph.selection"], {"node_id", "edge_id"}, "graph.extensions.frank.graph.selection", optional={"node_id", "edge_id"})
        if not selected or ("node_id" in selected and selected["node_id"] not in node_ids) or ("edge_id" in selected and selected["edge_id"] not in edge_ids):
            raise ProviderUnavailable("graph selection extension was invalid")
    if _contains_sensitive_key(value):
        raise ProviderUnavailable("authorized graph projection contained unsafe fields")
    return deepcopy(value)


def redact_allowlisted_fields(value: object, allowed_fields: object) -> dict:
    """Project declared fields without assigning them event or trace meaning."""
    if not isinstance(value, dict) or not isinstance(allowed_fields, (list, tuple, set, frozenset)):
        raise ProviderUnavailable("allowlisted projection inputs were invalid")
    try:
        allowed = set(allowed_fields)
    except (TypeError, RecursionError) as error:
        raise ProviderUnavailable("allowlisted projection fields were invalid") from error
    if any(not isinstance(key, str) or not key for key in allowed):
        raise ProviderUnavailable("allowlisted projection fields were invalid")
    result = {}
    for key, item in value.items():
        if isinstance(key, str) and key in allowed and not _sensitive_path(key):
            path = f"allowlisted.{key}"
            metadata_kind = _metadata_kind(path)
            result[key] = _safe_metadata(item, path, metadata_kind) if metadata_kind else _safe_json(item, path)
    return result


class ReadOnlyProvider:
    """A dependency-injected boundary; it owns no store, collector, or cache."""

    def __init__(
        self,
        *,
        graph_reader: Callable[..., Mapping[str, object] | None] | None = None,
    ) -> None:
        self.graph_reader = graph_reader

    def graph(self, *, kind: str, entity_id: str, selectors: Mapping[str, str | None]) -> dict:
        if kind != "tool":
            raise ProviderUnavailable("entity kind is not allowlisted")
        if self.graph_reader is None:
            raise ProviderUnavailable("no graph provider is registered")
        try:
            value = self.graph_reader(kind=kind, entity_id=entity_id, selectors=dict(selectors))
            if value is None:
                raise ProviderUnavailable("graph is unavailable")
            return _safe_graph(value, kind=kind, entity_id=entity_id, selectors=selectors)
        except ProviderUnavailable:
            raise
        except Exception as error:
            raise ProviderUnavailable("graph provider projection was invalid") from error


def _unavailable(error: ProviderUnavailable) -> tuple[Response, int]:
    return jsonify({"status": "unavailable", "error": str(error)}), 503


def create_blueprint(provider: ReadOnlyProvider) -> Blueprint:
    """Create isolated endpoints; callers must explicitly register them."""
    api = Blueprint("frank_graph_provider", __name__)

    @api.get("/api/graphs/<kind>/<entity_id>")
    def graph_read(kind: str, entity_id: str):
        if kind != "tool":
            abort(404)
        try:
            payload = provider.graph(kind=kind, entity_id=_entity_id(entity_id), selectors=_query())
        except ProviderUnavailable as error:
            return _unavailable(error)
        return jsonify(payload), 200, {"Cache-Control": "no-store"}

    return api

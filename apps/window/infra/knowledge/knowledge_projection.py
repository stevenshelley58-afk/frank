"""Hermes-owned, content-free ``schema://frank.graph/v2`` projection."""
from __future__ import annotations

from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Mapping

SCHEMA = "schema://frank.graph/v2"
MAX_NODES = 5_000
MAX_EDGES = 10_000
MAX_TEXT = 240
MAX_REF = 512
PROJECT_RE = re.compile(r"^project/[a-z0-9][a-z0-9._-]{0,63}$")
RELATION_RE = re.compile(r"^[a-z][a-z0-9_.:-]{0,63}$")
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@$#-]{0,255}$")
OPAQUE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
ABSOLUTE_RE = re.compile(r"^(?:[A-Za-z]:[\\/]|/|\\\\)")
SHA_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SECRET_RE = re.compile(r"(?i)(?:api[ _-]?key|access[ _-]?key|secret|password|passwd|token|bearer|private[ _-]?key|authorization|credential|BEGIN [A-Z ]+ KEY|sk-[a-z0-9])")
MARKUP_RE = re.compile(r"(?:<[^>]{1,80}>|```|\[/?(?:[A-Za-z][^]]*)\]|\*\*|__)")


class ProjectionError(ValueError):
    pass


def validate_project(project: Any) -> str:
    if not isinstance(project, str) or PROJECT_RE.fullmatch(project) is None:
        raise ProjectionError("project must be project/<id>")
    return project


def _project_id(project: str) -> str:
    return validate_project(project).split("/", 1)[1]


def _text(value: Any, *, limit: int = MAX_TEXT) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    if not value or len(value) > limit or "\x00" in value or SECRET_RE.search(value) or MARKUP_RE.search(value):
        return None
    return value


def _temporal(value: Any) -> str | None:
    if isinstance(value, (date, datetime)):
        value = value.isoformat()
    return _text(value, limit=64)


def _identifier(value: Any, *, path: bool = False) -> str | None:
    if not isinstance(value, str) or not value or len(value) > MAX_REF:
        return None
    value = value.replace("\\", "/")
    if ABSOLUTE_RE.match(value) or "\x00" in value:
        return None
    parts = value.split("/")
    if path and any(part in {"", ".", ".."} for part in parts):
        return None
    if SECRET_RE.search(value) or SAFE_ID_RE.fullmatch(value) is None:
        return None
    return value


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")).hexdigest()


def _sha(value: Any) -> str:
    return "sha256:" + _digest(value)


def _opaque(prefix: str, *parts: Any) -> str:
    return prefix + _digest(parts)[:32]


def _source(provider_id: str, provider_version: str, source_type: str, source_ref: str, sha256: str) -> dict[str, str]:
    if not all(isinstance(value, str) and OPAQUE_RE.fullmatch(value) for value in (provider_id, provider_version, source_type)):
        raise ProjectionError("source provenance is not opaque")
    if not isinstance(source_ref, str) or not source_ref or len(source_ref) > 640 or ABSOLUTE_RE.match(source_ref):
        raise ProjectionError("source reference is invalid")
    if not isinstance(sha256, str) or SHA_RE.fullmatch(sha256) is None:
        raise ProjectionError("source digest is invalid")
    return {"provider_id": provider_id, "provider_version": provider_version, "source_type": source_type, "source_ref": source_ref, "sha256": sha256}


def _node(graph_id: str, scope: dict[str, str], key: str, kind: str, label: str, source: dict[str, str], observed_at: str, **metadata: Any) -> dict[str, Any]:
    source_id = _opaque("node_", key)
    safe_metadata = {key: value for key, value in metadata.items() if value is not None}
    return {"id": f"{graph_id}/node:{source_id}", "source_id": source_id, "kind": kind, "label": label, "scope": scope, "authority": "hermes", "source": source, "classification": "internal", "freshness": {"observed_at": observed_at}, "capabilities": [], "ports": [], "status": "declared", "presentation": {"group_id": f"{graph_id}/group:{kind}"}, "extensions": {}, "metadata": safe_metadata}


def _edge(graph_id: str, key: str, relation: str, start: str, end: str, source: dict[str, str], observed_at: str) -> dict[str, Any]:
    relation = relation if RELATION_RE.fullmatch(relation) else "related"
    source_id = _opaque("edge_", key)
    kind = relation if relation in {"relation", "association", "dependency", "reference", "control"} else "relation"
    return {"id": f"{graph_id}/edge:{source_id}", "source_id": source_id, "from": start, "to": end, "kind": kind, "authority": "hermes", "classification": "internal", "source": source, "freshness": {"observed_at": observed_at}, "status": "active", "presentation": {}, "extensions": {}, "metadata": {"relation_type": relation}}


def _add_record(records: list[dict[str, Any]], record: dict[str, Any]) -> None:
    if record not in records:
        records.append(record)


def adapt_graphiti_records(records: Any, project: str, *, observed_at: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Adapt identities and timestamps only; facts and episode bodies never enter."""
    project = validate_project(project); project_id = _project_id(project); graph_id = f"project:{project_id}"; scope = {"kind": "project", "id": project_id}; observed_at = observed_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if not isinstance(records, (list, tuple)):
        records = records.get("records", records.get("results", [])) if isinstance(records, Mapping) else []
    nodes: list[dict[str, Any]] = []; edges: list[dict[str, Any]] = []; known: dict[str, str] = {}
    for item in records:
        if not isinstance(item, Mapping) or item.get("group_id") != project:
            continue
        uuid = _identifier(item.get("uuid")); name = _text(item.get("name"))
        if not uuid or not name:
            continue
        material = {k: item.get(k) for k in ("uuid", "name", "valid_at", "invalid_at", "created_at", "expired_at")}
        src = _source("hermes-graphiti", "0.29.3", "graphiti.entity", f"{project}/{uuid}", _sha(material))
        node = _node(graph_id, scope, f"memory:{uuid}", "memory", name, src, observed_at, valid_at=_temporal(item.get("valid_at")), invalid_at=_temporal(item.get("invalid_at")), created_at=_temporal(item.get("created_at")), expired_at=_temporal(item.get("expired_at")))
        _add_record(nodes, node); known[uuid] = node["id"]
    for item in records:
        if not isinstance(item, Mapping) or item.get("group_id") != project:
            continue
        source_uuid = _identifier(item.get("source_node_uuid")); target_uuid = _identifier(item.get("target_node_uuid"))
        if not source_uuid or not target_uuid or source_uuid not in known or target_uuid not in known:
            continue
        material = {"source": source_uuid, "target": target_uuid, "valid_at": item.get("valid_at"), "invalid_at": item.get("invalid_at")}
        src = _source("hermes-graphiti", "0.29.3", "graphiti.relation", f"{project}/{source_uuid}/{target_uuid}", _sha(material))
        _add_record(edges, _edge(graph_id, f"memory:{source_uuid}:{target_uuid}:{src['sha256']}", "association", known[source_uuid], known[target_uuid], src, observed_at))
    return nodes, edges


def adapt_vault_projection(payload: Any, project: str, *, observed_at: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    project = validate_project(project); project_id = _project_id(project); graph_id = f"project:{project_id}"; scope = {"kind": "project", "id": project_id}; observed_at = observed_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if not isinstance(payload, Mapping) or payload.get("schema") != "frank.vault-projection.v1" or payload.get("content") is not False or not isinstance(payload.get("notes"), list):
        return [], []
    nodes: list[dict[str, Any]] = []; edges: list[dict[str, Any]] = []; known: dict[str, str] = {}
    for note in payload["notes"]:
        if not isinstance(note, Mapping):
            continue
        path = _identifier(note.get("path"), path=True); sha = note.get("sha256")
        if not path or not isinstance(sha, str) or re.fullmatch(r"[0-9a-f]{64}", sha) is None:
            continue
        src = _source("frank-vault", "1.0.0", "vault.note", f"{project}/{path}", "sha256:" + sha)
        labels: list[str] = []
        for key in ("tags", "wikilinks"):
            if isinstance(note.get(key, []), list):
                labels.extend(x for x in (_text(item, limit=80) for item in note[key]) if x)
        node = _node(graph_id, scope, f"vault:{path}", "vault", path.rsplit("/", 1)[-1], src, observed_at, tags=sorted(set(labels)))
        _add_record(nodes, node); known[path] = node["id"]
    for note in payload["notes"]:
        if not isinstance(note, Mapping):
            continue
        path = _identifier(note.get("path"), path=True); sha = note.get("sha256")
        if not path or not isinstance(sha, str) or re.fullmatch(r"[0-9a-f]{64}", sha) is None or path not in known or not isinstance(note.get("wikilinks", []), list):
            continue
        src = _source("frank-vault", "1.0.0", "vault.wikilink", f"{project}/{path}", "sha256:" + sha)
        for link in sorted(set(item for item in note["wikilinks"] if isinstance(item, str))):
            target = _text(link, limit=120); target_path = target if target and target.endswith(".md") else (target + ".md" if target else "")
            if not target_path or target_path not in known:
                continue
            _add_record(edges, _edge(graph_id, f"vault:{path}:{target_path}", "reference", known[path], known[target_path], src, observed_at))
    return nodes, edges


def adapt_graphify_export(payload: Any, project: str, *, observed_at: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    project = validate_project(project); project_id = _project_id(project); graph_id = f"project:{project_id}"; scope = {"kind": "project", "id": project_id}; observed_at = observed_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if not isinstance(payload, Mapping) or not isinstance(payload.get("nodes"), list) or not isinstance(payload.get("links"), list):
        return [], []
    nodes: list[dict[str, Any]] = []; edges: list[dict[str, Any]] = []; known: dict[str, str] = {}
    for item in payload["nodes"]:
        if not isinstance(item, Mapping):
            continue
        ident = _identifier(item.get("id")); label = _text(item.get("label"), limit=180); source_file = _identifier(item.get("source_file"), path=True)
        if not ident or not label or not source_file:
            continue
        material = {"id": ident, "label": label, "source_file": source_file, "source_location": _text(item.get("source_location"), limit=64)}
        src = _source("graphify", "0.9.45", "graphify.node", f"{project}/{source_file}", _sha(material))
        node = _node(graph_id, scope, f"code:{ident}", "code", label, src, observed_at, file=source_file, location=_text(item.get("source_location"), limit=64), file_type=_text(item.get("file_type"), limit=24))
        _add_record(nodes, node); known[ident] = node["id"]
    for item in payload["links"]:
        if not isinstance(item, Mapping):
            continue
        source = _identifier(item.get("source")); target = _identifier(item.get("target")); relation = item.get("relation")
        if not source or not target or source not in known or not isinstance(relation, str) or not RELATION_RE.fullmatch(relation):
            continue
        relation_kind = "dependency" if relation in {"imports", "imports_from", "calls", "inherits"} else "association"; source_file = _identifier(item.get("source_file"), path=True) or "graph.json"
        src = _source("graphify", "0.9.45", "graphify.edge", f"{project}/{source_file}", _sha({"source": source, "target": target, "relation": relation, "source_file": source_file}))
        target_id = known.get(target)
        if target_id is None:
            external = _node(graph_id, scope, f"external:{target}", "code", target, src, observed_at, external=True); target_id = external["id"]; known[target] = target_id; _add_record(nodes, external)
        _add_record(edges, _edge(graph_id, f"code:{source}:{target}:{relation}", relation_kind, known[source], target_id, src, observed_at))
    return nodes, edges


def _load_json(value: Any) -> Any:
    if value is None or isinstance(value, (Mapping, list)):
        return value
    try:
        path = Path(value)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 32 * 1024 * 1024:
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        return None


def build_combined_projection(project: str, *, graphiti: Any = None, vault: Any = None, graphify: Any = None, generated_at: str | None = None) -> dict[str, Any]:
    project = validate_project(project); project_id = _project_id(project); graph_id = f"project:{project_id}"; scope = {"kind": "project", "id": project_id}; timestamp = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    nodes_a, edges_a = adapt_graphiti_records(_load_json(graphiti), project, observed_at=timestamp); nodes_b, edges_b = adapt_vault_projection(_load_json(vault), project, observed_at=timestamp); nodes_c, edges_c = adapt_graphify_export(_load_json(graphify), project, observed_at=timestamp)
    nodes = sorted(nodes_a + nodes_b + nodes_c, key=lambda item: item["id"])[:MAX_NODES]; node_ids = {item["id"] for item in nodes}; edges = sorted(edges_a + edges_b + edges_c, key=lambda item: item["id"]); edges = [item for item in edges if item["from"] in node_ids and item["to"] in node_ids][:MAX_EDGES]
    groups = [{"id": f"{graph_id}/group:code", "label": "Code", "parent_id": None, "order": 0, "metadata": {}}, {"id": f"{graph_id}/group:vault", "label": "Vault", "parent_id": None, "order": 1, "metadata": {}}, {"id": f"{graph_id}/group:memory", "label": "Memory", "parent_id": None, "order": 2, "metadata": {}}]
    result: dict[str, Any] = {"schema": SCHEMA, "graph_id": graph_id, "graph_revision": "", "generated_at": timestamp, "provider": {"id": "hermes-knowledge", "version": "1.0.0", "authority": "hermes"}, "subject": scope, "scope": scope, "lens": "knowledge.combined", "capabilities": ["knowledge.read"], "nodes": nodes, "edges": edges, "groups": groups, "trace_ref": None, "extensions": {}}
    result["graph_revision"] = _sha({key: value for key, value in result.items() if key != "graph_revision"})
    return result


projection = build_combined_projection

"""Truthful Step 4A projections over the canonical control graph.

This is deliberately a small, pure mapping seam.  It does not discover files,
infer relationships from names, or make a Blockwise/Ad Template Builder
connection without two independent evidence classes.  The returned documents
are Archify inputs plus Frank-owned coverage/finding metadata; Archify remains
responsible for rendering and validation.
"""
from __future__ import annotations

from copy import deepcopy
import re
from typing import Any, Iterable, Mapping


PROJECTION_IDS = (
    "projection:blockwise/runtime",
    "projection:mini-frank/knowledge-flow",
    "projection:ad-template-builder/architecture",
    "projection:ad-template-builder/workflow",
    "projection:ad-template-builder/data-flow",
)

_ID = re.compile(r"^(?:vps|project|repo|runtime|service|component|worker|store|route|"
                 r"capability|rule|skill|tool|plugin|cli|mcp|app|template|library|"
                 r"hook|gate|policy|runbook|eval|observer|source|release|projection|"
                 r"generation|receipt|proposal|finding|mapping|run|edge):[a-z0-9]+"
                 r"(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")
_RECEIPT_ID = re.compile(r"^receipt:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")
_GRAPH_REVISION = re.compile(r"^g_[0-9a-f]{64}$")
_SOURCE_REVISION = re.compile(r"^[0-9a-f]{40,64}$")


class ProjectionError(ValueError):
    """Raised when a projection input is malformed or makes an unsafe claim."""


def _id(value: Any) -> str:
    if not isinstance(value, str) or _ID.fullmatch(value) is None or value != value.lower():
        raise ProjectionError("projection contains an invalid stable ID")
    return value


def _items(graph: Mapping[str, Any], key: str, alternate: str | None = None) -> list[Mapping[str, Any]]:
    value = graph.get(key, graph.get(alternate, ())) if alternate else graph.get(key, ())
    if not isinstance(value, list):
        raise ProjectionError(f"graph {key} must be a list")
    result: list[Mapping[str, Any]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise ProjectionError(f"graph {key} contains a non-object")
        result.append(item)
    return result


def _node_id(node: Mapping[str, Any]) -> str:
    return _id(node.get("id"))


def _edge_endpoints(edge: Mapping[str, Any]) -> tuple[str, str]:
    return _id(edge.get("from")), _id(edge.get("to"))


def _validate_unique_ids(items: Iterable[Mapping[str, Any]], label: str) -> None:
    seen: set[str] = set()
    for item in items:
        item_id = _id(item.get("id"))
        if item_id in seen:
            raise ProjectionError(f"graph {label} contains a duplicate stable ID")
        seen.add(item_id)


def _text(node: Mapping[str, Any]) -> str:
    return " ".join(str(node.get(key, "")) for key in ("id", "kind", "title", "name", "source_locator")).lower()


def _id_text(node: Mapping[str, Any]) -> str:
    return str(node.get("id", "")).lower()


def _copy_node(node: Mapping[str, Any]) -> dict[str, Any]:
    # Copy only JSON-like input and keep stable IDs/evidence intact.  A graph
    # node is already a closed contract; deepcopy prevents callers mutating the
    # canonical snapshot through a projection result.
    return deepcopy(dict(node))


def _copy_edge(edge: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(edge))


def _finding(slug: str, message: str, *, evidence: Iterable[str] = ()) -> dict[str, Any]:
    return {
        "id": f"finding:projection/{slug}",
        "severity": "info",
        "status": "open",
        "message": message,
        "evidence_receipt_ids": sorted(set(evidence)),
    }


def _coverage(required: Iterable[str], nodes: list[Mapping[str, Any]], edges: list[Mapping[str, Any]]) -> dict[str, Any]:
    values = [_text(node) for node in nodes]
    relationships = {str(edge.get("relationship", edge.get("type", ""))).lower() for edge in edges}
    present: set[str] = set()
    for label in required:
        if label == "product_app" and any("project:blockwise" in value or "product" in value for value in values):
            present.add(label)
        elif label == "runtime" and any(any(token in value for token in ("service:", "container:", "release:", "deployment:")) for value in values):
            present.add(label)
        elif label == "data" and any(any(token in value for token in ("store:", "volume:", "database")) for value in values):
            present.add(label)
        elif label == "release" and any(any(token in value for token in ("release:", "deployment:")) for value in values):
            present.add(label)
        elif label == "routes" and ("routes_to" in relationships or any("route:" in value for value in values)):
            present.add(label)
        elif label == "frank_window" and any("frank-window" in value or "project:frank" in value for value in values):
            present.add(label)
        elif label == "hermes_boundary" and any("hermes" in value for value in values):
            present.add(label)
        elif label == "seed_sources" and any(any(token in value for token in ("source:", "repo:", "project:mini-frank")) for value in values):
            present.add(label)
        elif label == "build" and any(any(token in value for token in ("build", "template", "artifact", "release")) for value in values):
            present.add(label)
        elif label == "outputs" and ("produces" in relationships or any("artifact:" in value for value in values)):
            present.add(label)
        elif label == "request" and any(any(token in value for token in ("request", "capability", "template")) for value in values):
            present.add(label)
        elif label == "validation" and "validates" in relationships:
            present.add(label)
    required_set = sorted(set(required))
    return {"required": required_set, "present": sorted(present), "missing": sorted(set(required_set) - present)}


def _mapping_evidence(mapping: Mapping[str, Any], evidence: Mapping[str, Any] | None) -> tuple[bool, list[str]]:
    """Require exact source-contract and active-runtime evidence for a consume edge."""
    if mapping.get("status") != "verified" or mapping.get("confidence") not in {"high", "medium"}:
        return False, []
    receipt = mapping.get("evidence_receipt_id")
    if not isinstance(receipt, str) or _RECEIPT_ID.fullmatch(receipt) is None:
        return False, []
    evidence = evidence if isinstance(evidence, Mapping) else {}
    source = evidence.get("source_contract")
    runtime = evidence.get("active_runtime") or evidence.get("active_deployed_runtime")
    def receipt_id(value: Any) -> str | None:
        if isinstance(value, str) and _RECEIPT_ID.fullmatch(value):
            return value
        if isinstance(value, Mapping) and isinstance(value.get("receipt_id"), str) and _RECEIPT_ID.fullmatch(value["receipt_id"]):
            return value["receipt_id"]
        return None
    source_receipt, runtime_receipt = receipt_id(source), receipt_id(runtime)
    if source_receipt is None or runtime_receipt is None:
        return False, []
    return True, sorted({receipt, source_receipt, runtime_receipt})


def _select(graph: Mapping[str, Any], projection_id: str) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
    nodes = _items(graph, "nodes")
    edges = _items(graph, "edges", "relationships")
    _validate_unique_ids(nodes, "nodes")
    _validate_unique_ids(edges, "edges")
    for edge in edges:
        _edge_endpoints(edge)
    if projection_id == "projection:blockwise/runtime":
        # Keep the product slice bounded.  A transitive closure is unsafe here:
        # the shared graph connects Blockwise to almost the entire estate.
        context_ids = {"vps:dedicated", "project:frank", "service:frank-window", "runtime:hermes-default"}
        useful_kinds = {"project", "release", "service", "route", "store", "data_store", "volume", "observer", "source", "host", "deployment"}
        selected = [node for node in nodes if ("blockwise" in _id_text(node) and str(node.get("kind", "")).lower() in useful_kinds) or _node_id(node) in context_ids]
    elif projection_id == "projection:mini-frank/knowledge-flow":
        useful_kinds = {"project", "repo", "checkout", "source", "observer", "component", "data_store", "store", "volume", "route", "capability", "rule", "skill", "tool", "template", "library", "hook"}
        forbidden = {"service", "runtime", "container", "systemd_unit", "worker"}
        if any(str(node.get("kind", "")).lower() in forbidden and "mini-frank" in _id_text(node) for node in nodes):
            raise ProjectionError("Mini Frank projection cannot contain runtime/service nodes")
        selected = []
        for node in nodes:
            kind, stable_id = str(node.get("kind", "")).lower(), _id_text(node)
            if kind not in useful_kinds:
                continue
            if kind not in {"template", "hook"} and ("mini-frank" in stable_id or "projectstore" in stable_id):
                selected.append(node)
            elif kind == "template" and "/project-seeds/mini-frank/knowledge/sources/manifests/" in stable_id:
                selected.append(node)
            elif kind == "hook" and "/infra/knowledge/" in stable_id and any(token in stable_id for token in ("generate", "deploy")):
                selected.append(node)
        # Join the workflow to Frank's declared project/window boundary, but
        # allow Frank Window itself while rejecting a separate Mini runtime.
        selected += [node for node in nodes if _node_id(node) in {"project:frank", "service:frank-window", "component:frank-window"}]
        if any(str(node.get("kind", "")).lower() in forbidden and "mini-frank" in _id_text(node) for node in selected):
            raise ProjectionError("Mini Frank projection cannot contain runtime/service nodes")
    elif projection_id.startswith("projection:ad-template-builder/"):
        ad_tokens = ("ad-template-builder", "ad_template_builder", "ad-template", "template-builder")
        if projection_id.endswith("/architecture"):
            kinds = {"project", "component", "app", "frontend", "template", "data_store", "store", "volume", "service", "runtime", "capability", "skill", "tool", "plugin", "cli", "mcp"}
            context_ids = {
                "project:frank", "runtime:hermes-default", "service:frank-window",
                "store:frank-window-data", "observer:agenttrail-hermes",
                "source:archify", "tool:archify",
            }
        else:
            kinds = {"capability", "rule", "skill", "tool", "plugin", "cli", "mcp", "route", "component", "template"}
            context_ids = {
                "project:frank", "runtime:hermes-default", "service:frank-window",
                "tool:archify",
            }
        selected = [node for node in nodes if str(node.get("kind", "")).lower() in kinds and any(token in _id_text(node) or token in _text(node) for token in ad_tokens)]
        # The architecture/workflow projections must show the authority boundary.
        selected += [node for node in nodes if _node_id(node) in context_ids]
    else:
        raise ProjectionError(f"unsupported Step 4A projection: {projection_id}")
    by_id = {_node_id(node): node for node in selected}
    selected = [by_id[key] for key in sorted(by_id)]
    selected_ids = set(by_id)
    selected_edges = []
    for edge in edges:
        source, target = _edge_endpoints(edge)
        if source in selected_ids and target in selected_ids:
            selected_edges.append(edge)
    selected_edges.sort(key=lambda edge: (str(edge.get("id", "")), str(edge.get("from", "")), str(edge.get("to", ""))))
    return [_copy_node(node) for node in selected], [_copy_edge(edge) for edge in selected_edges]


def build_projection(
    graph: Mapping[str, Any],
    projection_id: str,
    *,
    mappings: Iterable[Mapping[str, Any]] = (),
    evidence: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build one deterministic Step 4A projection.

    ``data-flow`` is intentionally returned as a typed ``not_generated``
    manifest until both source-contract and active-runtime evidence exist.
    """
    if not isinstance(graph, Mapping) or not isinstance(projection_id, str):
        raise ProjectionError("graph and projection ID are required")
    nodes, edges = _select(graph, projection_id)
    graph_revision = graph.get("graph_revision", graph.get("revision"))
    if not isinstance(graph_revision, str) or _GRAPH_REVISION.fullmatch(graph_revision) is None:
        raise ProjectionError("projection graph revision is unavailable")
    mapping_list: list[dict[str, Any]] = []
    for item in mappings:
        if not isinstance(item, Mapping):
            raise ProjectionError("projection mappings must be objects")
        mapping = deepcopy(dict(item))
        if "id" in mapping:
            _id(mapping["id"])
            if not str(mapping["id"]).startswith("mapping:"):
                raise ProjectionError("projection mapping has an invalid ID")
        if "canonical_id" in mapping:
            _id(mapping["canonical_id"])
        if "evidence_receipt_id" in mapping and (
            not isinstance(mapping["evidence_receipt_id"], str)
            or _RECEIPT_ID.fullmatch(mapping["evidence_receipt_id"]) is None
        ):
            raise ProjectionError("projection mapping has an invalid evidence receipt")
        if "source_revision" in mapping and (
            not isinstance(mapping["source_revision"], str)
            or _SOURCE_REVISION.fullmatch(mapping["source_revision"]) is None
        ):
            raise ProjectionError("projection mapping has an invalid source revision")
        destination = mapping.get("destination_id_or_path")
        if destination is not None and (
            not isinstance(destination, str) or not destination or "%" in destination
            or "\\" in destination or any(part == ".." for part in destination.split("/"))
        ):
            raise ProjectionError("projection mapping has an unsafe destination")
        mapping_list.append(mapping)
    mapping_proof: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    if projection_id.startswith("projection:ad-template-builder/"):
        for mapping in mapping_list:
            proven, receipt_ids = _mapping_evidence(mapping, evidence)
            destination = str(mapping.get("destination_id_or_path", "")).lower()
            canonical = str(mapping.get("canonical_id", "")).lower()
            if not proven or "blockwise" not in destination or "ad-template" not in canonical:
                continue
            mapping_proof.append({"id": mapping.get("id"), "canonical_id": mapping.get("canonical_id"), "destination_id_or_path": mapping.get("destination_id_or_path"), "evidence_receipt_ids": receipt_ids, "source_revision": mapping.get("source_revision")})
        # A verified mapping is itself permission to show the two endpoint
        # identities in this projection.  Re-join them from the canonical
        # graph; a mapping never creates a node that the graph does not own.
        if mapping_proof:
            all_nodes = _items(graph, "nodes")
            selected_ids = {_node_id(node) for node in nodes}
            for proof in mapping_proof:
                for candidate in (proof.get("canonical_id"), proof.get("destination_id_or_path")):
                    if candidate in selected_ids or not isinstance(candidate, str):
                        continue
                    match = next((node for node in all_nodes if node.get("id") == candidate), None)
                    if match is not None:
                        nodes.append(_copy_node(match))
                        selected_ids.add(candidate)
            nodes.sort(key=lambda node: str(node["id"]))
            all_edges = _items(graph, "edges", "relationships")
            edges = [_copy_edge(edge) for edge in all_edges if _edge_endpoints(edge)[0] in selected_ids and _edge_endpoints(edge)[1] in selected_ids]
            edges.sort(key=lambda edge: (str(edge.get("id", "")), str(edge.get("from", "")), str(edge.get("to", ""))))
        # Drop every unproven consumes edge, including one supplied by a stale
        # graph snapshot.  A finding makes the absence visible to operators.
        safe_edges: list[dict[str, Any]] = []
        for edge in edges:
            relationship = edge.get("relationship", edge.get("type"))
            if relationship == "consumes" and ("blockwise" in str(edge.get("to", "")).lower() or "blockwise" in str(edge.get("from", "")).lower()):
                source, target = str(edge.get("from", "")).lower(), str(edge.get("to", "")).lower()
                matching_mapping = any(
                    str(item.get("canonical_id", "")).lower() == source
                    and str(item.get("destination_id_or_path", "")).lower() == target
                    for item in mapping_proof
                )
                if not matching_mapping:
                    continue
            safe_edges.append(edge)
        edges = safe_edges
        if not mapping_proof:
            findings.append(_finding("ad-template-builder/no-verified-blockwise-connection", "No verified Blockwise connection", evidence=()))
    required = {
        "projection:blockwise/runtime": ("product_app", "runtime", "data", "release", "routes"),
        "projection:mini-frank/knowledge-flow": ("seed_sources", "build", "frank_window"),
        "projection:ad-template-builder/architecture": ("request", "hermes_boundary", "outputs", "validation"),
        "projection:ad-template-builder/workflow": ("request", "build", "validation", "outputs"),
        "projection:ad-template-builder/data-flow": ("request", "outputs", "data"),
    }[projection_id]
    coverage = _coverage(required, nodes, edges)
    common = {
        "projection_id": projection_id,
        "graph_revision": graph_revision,
        "nodes": nodes,
        "relationships": edges,
        "coverage": coverage,
        "exclusions": ["private_inputs", "secrets", "hindsight_raw_state"],
        "findings": findings,
        "mappings": mapping_proof,
        "cross_links": {str(node["id"]): str(node["id"]) for node in nodes},
    }
    if projection_id == "projection:ad-template-builder/data-flow" and (
        not mapping_proof or coverage["missing"]
    ):
        missing = ["active_deployed_runtime_consumption_receipt", "verified_source_contract_mapping"] if not mapping_proof else []
        missing.extend(f"verified_{label}" for label in coverage["missing"])
        common.update({"status": "not_generated", "missing_evidence": sorted(set(missing)), "relationships": []})
    else:
        common["status"] = "generated"
    return common


def build_estate_projections(graph: Mapping[str, Any], *, mappings: Iterable[Mapping[str, Any]] = (), evidence: Mapping[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """Build all Step 4A projections in stable order."""
    return {projection_id: build_projection(graph, projection_id, mappings=mappings, evidence=evidence) for projection_id in PROJECTION_IDS}


# Explicit aliases keep call sites readable while the adapter contract evolves.
project_estate = build_estate_projections


__all__ = ["PROJECTION_IDS", "ProjectionError", "build_projection", "build_estate_projections", "project_estate"]

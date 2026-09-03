"""Truthful Step 4A projections over the canonical control graph.

This is deliberately a small, pure mapping seam.  It does not discover files,
infer relationships from names, or make a Blockwise/Ad Template Builder
connection without two independent evidence classes.  The returned documents
are Archify inputs plus Frank-owned coverage/finding metadata; Archify remains
responsible for rendering and validation.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re
from typing import Any, Iterable, Mapping

import yaml


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

# These are canonical identities, not search terms.  Keeping this small is
# intentional: an estate projection is a bounded view, while the canonical
# graph remains the authority for the existence of every identity and edge.
_AD_IDENTITIES = frozenset({
    "project:frank",
    "capability:frank/ad-template-builder",
    "project:ad-template-builder",  # legacy owner identity in early snapshots
    "runtime:hermes-default",
    "tool:archify",
    "source:archify",
    "template:frank/ad-template-process",
    "gate:frank/ad-template-validation",
    "component:frank/ad-studio",
    "route:hermes-tool-runs",
    "tool:ad-template-generator",
    "component:frank/ad-template-builder/source",
    "component:frank/ad-template-builder/build",
    "component:frank/ad-template-builder/render",
    "component:frank/ad-template-builder/compare",
    "component:frank/ad-template-builder/final-check",
    "component:frank/ad-template-builder/live",
    "gate:frank/ad-template-final-review",
    "component:frank/ad-template-feed",
    "component:frank/ad-template-story",
})
_AD_WORKFLOW_IDENTITIES = frozenset({"release:frank"})
_AD_EDGE_RELATIONSHIPS = frozenset({
    "contains", "owns", "uses", "executes", "produces", "validates",
    "deploys", "depends_on", "consumes", "routes_to", "replaces",
})
_AD_SECONDARY_KINDS = frozenset({
    "artifact", "capability", "cli", "component", "gate", "library",
    "mcp", "plugin", "release", "runtime", "skill", "template", "tool",
})


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


def _id_text(node: Mapping[str, Any]) -> str:
    return str(node.get("id", "")).lower()


def _connected_selection(nodes: list[Mapping[str, Any]], edges: list[Mapping[str, Any]], anchors: set[str]) -> list[Mapping[str, Any]]:
    """Select stable-ID anchors and identities joined by typed graph edges."""
    selected = set(anchors)
    changed = True
    while changed:
        changed = False
        for edge in edges:
            source, target = _edge_endpoints(edge)
            if source in selected or target in selected:
                before = len(selected)
                selected.update((source, target))
                changed = changed or len(selected) != before
    return [node for node in nodes if _node_id(node) in selected]


def _repository_root() -> Path:
    module = Path(__file__).resolve()
    for parent in module.parents:
        if (parent / "governance" / "control-plane" / "projections.yaml").is_file():
            return parent
    return module.parents[2]


def _governance_declaration(
    graph: Mapping[str, Any], projection_id: str,
    governance: Mapping[str, Any] | Iterable[Mapping[str, Any]] | None = None,
) -> Mapping[str, Any]:
    """Return the declaration that governs this projection's coverage.

    Runtime graph snapshots deliberately do not duplicate governance.  The
    checked-in declaration is therefore the default, while accepting an
    explicit document keeps this pure seam usable by tests and importers.
    """
    source: Any = governance
    if source is None:
        source = graph.get("projection_declarations") or graph.get("governance")
    if source is None:
        try:
            source = yaml.safe_load(
                (_repository_root() / "governance" / "control-plane" / "projections.yaml").read_text(encoding="utf-8")
            )
        except (OSError, yaml.YAMLError) as error:
            raise ProjectionError("projection governance is unavailable") from error
    if isinstance(source, Mapping):
        if source.get("id") == projection_id:
            return source
        entries = source.get("projections", source)
        if isinstance(entries, Mapping):
            candidate = entries.get(projection_id)
            if isinstance(candidate, Mapping):
                return candidate
            entries = entries.values()
    else:
        entries = source
    if isinstance(entries, Iterable) and not isinstance(entries, (str, bytes, Mapping)):
        for candidate in entries:
            if isinstance(candidate, Mapping) and candidate.get("id") == projection_id:
                return candidate
    raise ProjectionError(f"projection governance is missing {projection_id}")


def _must_show(
    graph: Mapping[str, Any], projection_id: str,
    governance: Mapping[str, Any] | Iterable[Mapping[str, Any]] | None = None,
) -> tuple[str, ...]:
    declaration = _governance_declaration(graph, projection_id, governance)
    required = declaration.get("must_show")
    if not isinstance(required, list) or not required or not all(isinstance(item, str) and item for item in required):
        raise ProjectionError(f"projection governance has invalid must_show for {projection_id}")
    return tuple(dict.fromkeys(required))


def _ad_selection(
    nodes: list[Mapping[str, Any]], edges: list[Mapping[str, Any]], *, workflow: bool = False,
) -> list[Mapping[str, Any]]:
    """Select the bounded Ad Builder neighborhood from canonical identities.

    Only exact, governed identities seed the view.  A single typed edge hop is
    retained for evidence-bearing artifacts/components, which keeps authored
    topology (for example, a produced template) without pulling all of Frank's
    runtime into the Ad Builder map.
    """
    by_id = {_node_id(node): node for node in nodes}
    seeds = _AD_IDENTITIES | (_AD_WORKFLOW_IDENTITIES if workflow else frozenset())
    selected = {item_id for item_id in seeds if item_id in by_id}
    # Owner/container identities have broad neighborhoods; expansion starts at
    # the capability and process identities to keep this projection bounded.
    seeds = set(selected) - {"project:frank", "project:ad-template-builder"}
    for edge in edges:
        source, target = _edge_endpoints(edge)
        relationship = str(edge.get("relationship", edge.get("type", ""))).casefold()
        if relationship not in _AD_EDGE_RELATIONSHIPS or not ({source, target} & seeds):
            continue
        other = target if source in selected else source
        other_node = by_id.get(other)
        # ``project:frank`` has many unrelated children.  Those are bounded
        # out by kind; the direct, evidence-bearing Ad topology is retained.
        if other_node is not None and str(other_node.get("kind", "")).casefold() in _AD_SECONDARY_KINDS:
            selected.add(other)
    return [by_id[item_id] for item_id in sorted(selected)]


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


def _coverage(
    required: Iterable[str], nodes: list[Mapping[str, Any]], edges: list[Mapping[str, Any]],
    *, mappings: Iterable[Mapping[str, Any]] = (), projection_id: str = "",
) -> dict[str, Any]:
    """Evaluate governance labels from typed identities and relationships.

    Coverage must never be inferred from a title or arbitrary text.  Labels are
    predicates over canonical IDs, node kinds, and typed edges instead.
    """
    ids = {_id_text(node) for node in nodes}
    kinds = {str(node.get("kind", "")).casefold() for node in nodes}
    relationships = {
        str(edge.get("relationship", edge.get("type", ""))).casefold()
        for edge in edges
    }
    mapping_list = list(mappings)
    has = lambda *values: any(value.casefold() in ids for value in values)
    has_edge = lambda relation: relation in relationships
    present: set[str] = set()
    for label in required:
        value = label.casefold()
        if value == "owner":
            if has("project:frank"):
                present.add(label)
        elif value == "frank_window":
            if has("service:frank-window", "component:frank-window"):
                present.add(label)
        elif value == "source_components":
            if has("capability:frank/ad-template-builder"):
                present.add(label)
        elif value in {"hermes_boundary", "research_boundary"}:
            if has("runtime:hermes-default") if value == "hermes_boundary" else has("store:blockwise-research-db"):
                present.add(label)
        elif value in {"tools", "capability_resolution"}:
            if "tool" in kinds or "cli" in kinds or has_edge("uses"):
                present.add(label)
        elif value in {"artifacts", "generated_assets", "outputs"}:
            if {"template", "artifact"} & kinds or has_edge("produces"):
                present.add(label)
        elif value in {"validation", "checks"}:
            if "gate" in kinds or has_edge("validates"):
                present.add(label)
        elif value in {"consumers", "verified_consumers"}:
            if mapping_list:
                present.add(label)
        elif value in {"request"}:
            if has("capability:frank/ad-template-builder"):
                present.add(label)
        elif value == "build":
            if has_edge("produces") or ("capability" in kinds and {"template", "artifact"} & kinds):
                present.add(label)
        elif value == "preview_review":
            if has("template:frank/ad-template-process") or {"template", "artifact"} & kinds:
                present.add(label)
        elif value == "product_app":
            if has("project:blockwise", "service:blockwise-app") or "app" in kinds:
                present.add(label)
        elif value == "auth":
            if has("service:blockwise-auth") or "auth" in kinds:
                present.add(label)
        elif value in {"database", "data", "stores"}:
            if {"data_store", "store", "database", "volume"} & kinds:
                present.add(label)
        elif value == "storage":
            if has("store:blockwise-storage") or "volume" in kinds:
                present.add(label)
        elif value == "workers":
            if "worker" in kinds:
                present.add(label)
        elif value == "frank_links":
            if has("project:frank", "service:frank-window", "component:frank-window"):
                present.add(label)
        elif value == "active_release":
            if {"release", "deployment"} & kinds:
                present.add(label)
        elif value == "routes":
            if "route" in kinds or has_edge("routes_to"):
                present.add(label)
        elif value == "seed_sources":
            if {"source", "repo", "checkout"} & kinds:
                present.add(label)
        elif value == "frank_window_knowledge":
            if has("component:frank-window", "service:frank-window"):
                present.add(label)
        elif value == "inputs":
            if has_edge("consumes") or {"source", "repo", "checkout"} & kinds:
                present.add(label)
        elif value == "retention":
            if {"store", "data_store", "volume"} & kinds:
                present.add(label)
        elif value == "runtime":
            if {"service", "container", "systemd_unit", "worker", "runtime"} & kinds:
                present.add(label)
        elif value == "release":
            if {"release", "deployment"} & kinds:
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
        selected = _ad_selection(nodes, edges, workflow=projection_id.endswith("/workflow"))
    else:
        raise ProjectionError(f"unsupported Step 4A projection: {projection_id}")
    by_id = {_node_id(node): node for node in selected}
    selected = [by_id[key] for key in sorted(by_id)]
    selected_ids = set(by_id)
    selected_edges = []
    workflow_relationships = frozenset({
        "contains", "owns", "uses", "executes", "produces", "validates",
        "deploys", "consumes", "routes_to", "replaces",
    })
    for edge in edges:
        source, target = _edge_endpoints(edge)
        if source in selected_ids and target in selected_ids:
            if projection_id == "projection:ad-template-builder/workflow" and str(edge.get("relationship", edge.get("type", ""))).casefold() not in workflow_relationships:
                continue
            selected_edges.append(edge)
    selected_edges.sort(key=lambda edge: (str(edge.get("id", "")), str(edge.get("from", "")), str(edge.get("to", ""))))
    return [_copy_node(node) for node in selected], [_copy_edge(edge) for edge in selected_edges]


def build_projection(
    graph: Mapping[str, Any],
    projection_id: str,
    *,
    mappings: Iterable[Mapping[str, Any]] = (),
    evidence: Mapping[str, Any] | None = None,
    governance: Mapping[str, Any] | Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build one deterministic Step 4A projection.

    ``data-flow`` is intentionally returned as a typed ``not_generated``
    manifest until both source-contract and active-runtime evidence exist.
    """
    if not isinstance(graph, Mapping) or not isinstance(projection_id, str):
        raise ProjectionError("graph and projection ID are required")
    required = _must_show(graph, projection_id, governance)
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
            if not proven or destination not in {"project:blockwise", "service:blockwise-app"} or canonical not in _AD_IDENTITIES:
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
            source, target = str(edge.get("from", "")).lower(), str(edge.get("to", "")).lower()
            blockwise_endpoints = {"project:blockwise", "service:blockwise-app"}
            if relationship == "consumes" and ({source, target} & blockwise_endpoints):
                matching_mapping = any(
                    str(item.get("canonical_id", "")).lower()
                    == "capability:frank/ad-template-builder"
                    and str(item.get("destination_id_or_path", "")).lower() == target
                    for item in mapping_proof
                ) and source == "component:frank/ad-template-builder/live"
                if not matching_mapping:
                    continue
            safe_edges.append(edge)
        edges = safe_edges
        if not mapping_proof:
            findings.append(_finding("ad-template-builder/no-verified-blockwise-connection", "No verified Blockwise connection", evidence=()))
    coverage = _coverage(required, nodes, edges, mappings=mapping_proof, projection_id=projection_id)
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
        # ``verified_data`` was emitted by the pre-governance manifest and is
        # retained as a migration hint; authoritative coverage remains the
        # declaration's ``stores`` label.
        if "stores" in coverage["missing"]:
            missing.append("verified_data")
        common.update({"status": "not_generated", "missing_evidence": sorted(set(missing)), "relationships": []})
    else:
        common["status"] = "generated"
    return common


def build_estate_projections(
    graph: Mapping[str, Any], *, mappings: Iterable[Mapping[str, Any]] = (),
    evidence: Mapping[str, Any] | None = None,
    governance: Mapping[str, Any] | Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Build all Step 4A projections in stable order."""
    return {
        projection_id: build_projection(
            graph, projection_id, mappings=mappings, evidence=evidence,
            governance=governance,
        )
        for projection_id in PROJECTION_IDS
    }


# Explicit aliases keep call sites readable while the adapter contract evolves.
project_estate = build_estate_projections


__all__ = ["PROJECTION_IDS", "ProjectionError", "build_projection", "build_estate_projections", "project_estate"]

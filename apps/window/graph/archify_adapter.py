"""Deterministic, typed projections from the canonical Frank graph to Archify.

Archify remains the renderer and viewer authority.  This module owns only the
small translation seam: stable Frank identities are encoded into Archify-safe
IDs, while the returned metadata keeps the original IDs and evidence joins.
No runtime health is copied into a map; observation freshness belongs to the
reconciliation/provider surfaces.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Iterable, Mapping

from .control_plane import ControlContractError, canonical_bytes
from .estate_projections import PROJECTION_IDS as ESTATE_PROJECTION_IDS, build_projection as build_estate_projection

def _resolve_window_root(module_path: Path, configured: str | None = None) -> Path:
    """Resolve both the full checkout and the shallow ``/app`` image layout."""
    candidates: list[Path] = []
    if configured:
        base = Path(configured).resolve()
        candidates.extend((base / "apps" / "window", base))
    module = module_path.resolve()
    candidates.extend((module.parents[1], *(parent / "apps" / "window" for parent in module.parents)))
    for candidate in candidates:
        if (candidate / "vendor" / "archify" / "archify" / "bin" / "archify.mjs").is_file():
            return candidate
    # The executable resolution remains fail-closed at invocation time, while
    # importing this module stays safe during an uninitialized checkout.
    return Path(configured).resolve() if configured else module.parents[1]


WINDOW_ROOT = _resolve_window_root(Path(__file__), os.environ.get("FRANK_REPOSITORY_ROOT"))
ARCHIFY_EXECUTABLE = WINDOW_ROOT / "vendor" / "archify" / "archify" / "bin" / "archify.mjs"
ARCHIFY_VERSION = "v2.15.0-39-gb36d79f"
ARCHIFY_SHA256 = "86aa44dd70ddcfb81def18bea9ae5e44a6cd04293d80f92792ed1b165a113b67"
SHOWCASE_CHECKS = (
    "single_svg", "finite_svg", "orthogonal_arrows", "label_route_clearance",
    "relationship_crossings", "relationship_corridors", "container_border_runs",
    "route_rhythm", "legend_clearance",
)
PROJECTION_TYPES = frozenset({"architecture", "workflow", "workflow_data_flow", "data_flow"})


def _cli_projection_type(value: str) -> str:
    return {"workflow_data_flow": "workflow", "data_flow": "dataflow"}.get(value, value)


def _safe_archify_id(stable_id: str) -> str:
    """Encode a canonical ID without making identity claims in Archify."""
    return "n_" + hashlib.sha256(stable_id.encode("utf-8")).hexdigest()[:16]


def _node_type(kind: Any) -> str:
    kind = str(kind or "").casefold()
    if kind in {"route", "edge"}:
        return "security"
    if kind in {"host", "deployment", "release", "cloud"}:
        return "cloud"
    if kind in {"data_store", "volume", "store", "database"}:
        return "database"
    if kind in {"component", "app", "frontend", "template"}:
        return "frontend"
    if kind in {"capability", "rule", "skill", "tool", "plugin", "cli", "mcp", "library"}:
        return "external"
    if kind in {"observer", "source"}:
        return "external"
    if kind in {"service", "container", "systemd_unit", "worker", "runtime", "checkout", "repo", "project"}:
        return "backend"
    return "external"


def _title(node: Mapping[str, Any], stable_id: str) -> str:
    for key in ("title", "label", "name"):
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:160]
    # Some canonical nodes intentionally carry no title/name.  Make their
    # stable ID readable as a fallback; identity itself remains in metadata.
    raw = stable_id.rsplit(":", 1)[-1]
    # File-backed identities often encode the extension and content hash in
    # the basename (``home-json-7de40ad489db``). Select trailing path tokens
    # rather than flattening the whole path, otherwise every card truncates to
    # the shared ``frank frank app`` prefix.
    parts = [part for part in re.split(r"[/\\]+", raw) if part]
    cleaned: list[str] = []
    for part in parts:
        part = re.sub(r"(?:[-_.](?:json|yaml|yml|toml|md|py|js|ts|html|sh))?(?:[-_.][0-9a-f]{8,})$", "", part, flags=re.I)
        part = re.sub(r"[-_.](?:json|yaml|yml|toml|md|py|js|ts|html|sh)$", "", part, flags=re.I)
        words = re.sub(r"[-_.]+", " ", part).strip()
        if words:
            cleaned.append(words)
    generic_leaf = {"home", "manifest", "deploy", "generate", "check", "install", "skill", "plugin", "package"}
    if cleaned and cleaned[-1].casefold() in generic_leaf and len(cleaned) > 1:
        selected = cleaned[-2:]
    else:
        selected = cleaned[-1:] or [raw]
    # Drop adjacent duplicate path tokens while retaining distinctive names.
    deduped: list[str] = []
    for token in selected:
        if not deduped or token.casefold() != deduped[-1].casefold():
            deduped.append(token)
    fallback = " ".join(deduped)
    return fallback.title() or stable_id


def _display_label(node: Mapping[str, Any], stable_id: str, index: int) -> tuple[str, str]:
    """Return bounded human labels; the full ID remains in Frank metadata."""
    title = _title(node, stable_id)
    title = re.sub(r"\s+", " ", title).strip()
    if len(title) > 28:
        title = title[:27].rstrip() + "…"
    kind = re.sub(r"[^a-z0-9-]+", "-", str(node.get("kind", "node")).casefold()).strip("-") or "node"
    return title or kind, f"{kind} #{index + 1:03d}"[:24]


def _assertion_index(graph: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Index hydrated graph assertions without making them part of Archify.

    Materialized control graphs intentionally keep presentation text in the
    assertion bundle.  Accepting that bundle here means the adapter can show a
    hydrated title/description while still treating the graph as read-only.
    """
    result: dict[str, dict[str, Any]] = {}
    assertions = graph.get("assertions", ())
    if not isinstance(assertions, Iterable) or isinstance(assertions, (str, bytes, Mapping)):
        return result
    for item in assertions:
        if not isinstance(item, Mapping):
            continue
        subject = item.get("subject_id")
        predicate = item.get("predicate")
        if isinstance(subject, str) and isinstance(predicate, str) and "value" in item:
            result.setdefault(subject, {})[predicate] = item.get("value")
    return result


def _node_title(node: Mapping[str, Any], stable_id: str, assertions: Mapping[str, Mapping[str, Any]]) -> str:
    direct = _title(node, "")
    if direct:
        return direct
    values = assertions.get(stable_id, {})
    for key in ("title", "label", "name"):
        value = values.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return _title({}, stable_id)


def _node_sublabel(node: Mapping[str, Any], stable_id: str, assertions: Mapping[str, Mapping[str, Any]]) -> str:
    values = assertions.get(stable_id, {})
    for key in ("sublabel", "description", "summary", "role", "responsibility", "source_locator"):
        value = node.get(key, values.get(key))
        if isinstance(value, str) and value.strip():
            return value.strip()
    kind = str(node.get("kind", values.get("kind", "node"))).strip() or "node"
    layer = str(node.get("layer", values.get("layer", ""))).strip()
    return f"{kind}{' · ' + layer if layer else ''}"


def _edge_records(graph: Mapping[str, Any], stable_ids: set[str]) -> list[Mapping[str, Any]]:
    raw_edges = graph.get("edges")
    if not isinstance(raw_edges, list):
        raw_edges = graph.get("relationships", ())
    result: list[Mapping[str, Any]] = []
    for edge in raw_edges if isinstance(raw_edges, Iterable) and not isinstance(raw_edges, (str, bytes, Mapping)) else ():
        if not isinstance(edge, Mapping):
            continue
        source, target = edge.get("from"), edge.get("to")
        if source in stable_ids and target in stable_ids:
            result.append(edge)
    return sorted(result, key=lambda item: (
        str(item.get("id", "")), str(item.get("from", "")), str(item.get("to", "")),
        str(item.get("relationship", item.get("type", "depends_on"))),
    ))


_PATH_RELATIONSHIP_RANK = {
    "routes_to": 0, "exposes": 1, "runs": 2, "executes": 3, "uses": 4,
    "produces": 5, "validates": 6, "reads": 7, "writes": 8, "consumes": 9,
    "depends_on": 10, "owns": 11, "contains": 12, "observes": 13, "declares": 14,
}


def _primary_path(node_ids: Iterable[str], edges: Iterable[Mapping[str, Any]]) -> list[str]:
    """Choose a stable, truthful path from existing edges for presentation."""
    ids = sorted(set(node_ids))
    adjacency: dict[str, list[tuple[str, Mapping[str, Any]]]] = {item: [] for item in ids}
    indegree = {item: 0 for item in ids}
    for edge in edges:
        source, target = str(edge.get("from")), str(edge.get("to"))
        if source not in adjacency or target not in adjacency or source == target:
            continue
        adjacency[source].append((target, edge))
        indegree[target] += 1
    for source in adjacency:
        adjacency[source].sort(key=lambda pair: (
            _PATH_RELATIONSHIP_RANK.get(str(pair[1].get("relationship", pair[1].get("type", "depends_on"))), 99),
            pair[0], str(pair[1].get("id", "")),
        ))

    best: list[str] = []
    best_score: tuple[int, int, tuple[str, ...]] = (-1, 0, ())
    visit_budget = [0]

    def walk(current: str, path: list[str], score: int) -> None:
        nonlocal best, best_score
        visit_budget[0] += 1
        if visit_budget[0] > 10000:
            return
        rank = len(path)
        candidate_score = (rank, -score, tuple(path))
        if candidate_score[0] > best_score[0] or (candidate_score[0] == best_score[0] and candidate_score[2] < best_score[2]):
            best, best_score = list(path), candidate_score
        for target, edge in adjacency[current]:
            if target not in path:
                relationship = str(edge.get("relationship", edge.get("type", "depends_on")))
                walk(target, path + [target], score + _PATH_RELATIONSHIP_RANK.get(relationship, 99))

    starts = sorted((item for item in ids if indegree[item] == 0)) or ids
    for start in starts:
        walk(start, [start], 0)
    if len(best) < 2:
        for edge in sorted(edges, key=lambda item: (str(item.get("from")), str(item.get("to")), str(item.get("id", "")))):
            source, target = str(edge.get("from")), str(edge.get("to"))
            if source in adjacency and target in adjacency and source != target:
                return [source, target]
    return best


def _connection_id(edge: Mapping[str, Any], ordinal: int) -> str:
    value = edge.get("id")
    if isinstance(value, str) and value:
        return _safe_archify_id(value)
    digest = hashlib.sha256(canonical_bytes(dict(edge))).hexdigest()[:16]
    return _safe_archify_id(f"edge:{digest}:{ordinal}")


def _label_width(label: str, minimum: float = 92, maximum: float = 280) -> float:
    """Give Archify enough authored width for a truthful, untruncated label."""
    return min(maximum, max(minimum, len(label) * 7 + 36))


def _projection_nodes(graph: Mapping[str, Any], projection_id: str) -> list[Mapping[str, Any]]:
    nodes = [item for item in graph.get("nodes", ()) if isinstance(item, Mapping) and isinstance(item.get("id"), str)]
    # File inventory and reconciliation findings remain fully available in
    # Control, but they are not systems in an architecture map.  Keep all
    # declared identities plus any observed runtime/topology identities.
    topology_kinds = {
        "host", "project", "repo", "checkout", "release", "deployment",
        "runtime", "service", "container", "systemd_unit", "worker",
        "component", "route", "data_store", "store", "volume",
        "capability", "observer", "source", "tool",
    }
    high_level = [
        item for item in nodes
        if str(item.get("layer", "declared")).casefold() != "observed"
        or str(item.get("kind", "")).casefold() in topology_kinds
    ]
    if projection_id == "projection:vps/world":
        return high_level
    if projection_id == "projection:frank/architecture":
        selected: list[Mapping[str, Any]] = []
        for node in high_level:
            stable_id = str(node["id"])
            low = stable_id.casefold()
            if str(node.get("kind", "")).casefold() == "project" or stable_id == "vps:dedicated" or any(
                token in low for token in ("frank", "hermes", "hindsight", "infisical", "agenttrail", "archify")
            ):
                selected.append(node)
        return selected
    if projection_id in ESTATE_PROJECTION_IDS:
        # Step 4A has already performed typed selection.  Do not re-select by
        # names here: doing so would silently drop evidence-bearing nodes.
        return nodes
    raise ControlContractError(f"unsupported Step 3 projection: {projection_id}")


def _coverage(nodes: Iterable[Mapping[str, Any]], edges: Iterable[Mapping[str, Any]], required: Iterable[str]) -> dict[str, Any]:
    node_list = list(nodes)
    edge_list = list(edges)
    kinds = {str(item.get("kind", "")).casefold() for item in node_list}
    ids = [str(item.get("id", "")).casefold() for item in node_list]
    present: set[str] = set()
    for name in required:
        if name == "workloads" and kinds & {"service", "container", "worker", "systemd_unit"}:
            present.add(name)
        elif name in {"routes", "listeners"} and ("route" in kinds or any("route" in value for value in ids)):
            present.add(name)
        elif name in {"repositories", "checkouts", "projects"} and kinds & {"repo", "checkout", "project"}:
            present.add(name)
        elif name in {"stores", "data"} and kinds & {"data_store", "volume", "store"}:
            present.add(name)
        elif name == "capabilities" and kinds & {"capability", "rule", "skill", "tool", "plugin", "cli", "mcp"}:
            present.add(name)
        elif name == "evidence_producers" and ("evidence_receipt" in kinds or any(item.get("evidence_receipt_ids") for item in node_list)):
            present.add(name)
        elif name == "window" and any("frank-window" in value for value in ids):
            present.add(name)
        elif name == "hermes_boundary" and any("hermes" in value for value in ids):
            present.add(name)
        elif name == "hindsight_boundary" and any("hindsight" in value for value in ids):
            present.add(name)
        elif name == "tools" and kinds & {"tool", "cli", "mcp"}:
            present.add(name)
        elif name in {"product_app", "auth", "database", "storage", "workers", "research_boundary", "frank_links", "active_release"}:
            # These are semantic declaration labels.  Only claim them when a
            # corresponding canonical identity is actually present.
            terms = {"product_app": ("app", "product"), "auth": ("auth",), "database": ("db", "database"), "storage": ("storage",), "workers": ("worker",), "research_boundary": ("research",), "frank_links": ("frank",), "active_release": ("release", "deployment")}[name]
            if any(any(term in value for term in terms) for value in ids) or any(any(term in kind for term in terms) for kind in kinds):
                present.add(name)
    missing = sorted(set(required) - present)
    return {"required": sorted(set(required)), "present": sorted(present), "missing": missing}


def _overview_graph_to_archify(graph: Mapping[str, Any], projection_id: str, *, required_coverage: Iterable[str] = ()) -> tuple[dict[str, Any], dict[str, Any]]:
    """Convert one canonical graph into an Archify architecture document.

    The second return value is the Frank-owned cross-link/coverage envelope;
    it is intentionally not inserted into the closed Archify JSON schema.
    """
    if not isinstance(graph, Mapping):
        raise ControlContractError("graph must be an object")
    if not isinstance(projection_id, str) or not projection_id.startswith("projection:"):
        raise ControlContractError("projection_id is invalid")
    nodes = sorted(_projection_nodes(graph, projection_id), key=lambda item: str(item["id"]))
    stable_ids = {str(item["id"]) for item in nodes}
    id_map = {stable_id: _safe_archify_id(stable_id) for stable_id in sorted(stable_ids)}
    edges: list[Mapping[str, Any]] = []
    for edge in graph.get("edges", graph.get("relationships", ())):
        if not isinstance(edge, Mapping):
            continue
        source = edge.get("from")
        target = edge.get("to")
        if source not in stable_ids or target not in stable_ids or source == target:
            continue
        edges.append(edge)

    overview_only = len(nodes) > 48
    relationship_orders = {
        "projection:mini-frank/knowledge-flow": ("owns", "exposes", "contains", "writes", "uses", "reads"),
        "projection:blockwise/runtime": ("observes", "writes", "reads", "uses", "owns", "exposes", "contains"),
        "projection:ad-template-builder/architecture": ("validates", "observes", "writes", "uses", "produces", "contains", "declares"),
        "projection:ad-template-builder/workflow": ("validates", "uses", "produces", "contains", "writes", "observes"),
    }
    relationship_order = relationship_orders.get(
        projection_id,
        ("observes", "writes", "reads", "exposes", "uses", "owns", "declares", "produces", "validates", "contains"),
    )
    relationship_rank = {name: index for index, name in enumerate(relationship_order)}
    rendered_edges: list[Mapping[str, Any]] = []
    used_endpoints: set[str] = set()
    compact_medium = 6 < len(nodes) <= 48
    if not overview_only:
        for edge in sorted(
            edges,
            key=lambda item: (
                relationship_rank.get(str(item.get("relationship", item.get("type", "depends_on"))), len(relationship_rank)),
                str(item.get("id", "")), str(item.get("from", "")), str(item.get("to", "")),
            ),
        ):
            source, target = str(edge["from"]), str(edge["to"])
            if source in used_endpoints or target in used_endpoints:
                continue
            rendered_edges.append(edge)
            used_endpoints.update((source, target))
            if len(rendered_edges) >= (9 if compact_medium else 12):
                break

    # Pack independent horizontal pairs into clear rows.  This deliberately
    # shows a truthful, representative matching instead of drawing an
    # unreadable hairball; the manifest reports the exact shown/total counts.
    node_by_id = {str(node["id"]): node for node in nodes}
    ordered_ids = [stable_id for edge in rendered_edges for stable_id in (str(edge["from"]), str(edge["to"]))]
    ordered_ids.extend(stable_id for stable_id in sorted(stable_ids) if stable_id not in used_endpoints)
    nodes = [node_by_id[stable_id] for stable_id in ordered_ids]
    components: list[dict[str, Any]] = []
    display_labels: dict[str, dict[str, str]] = {}
    # Archify's showcase renderer cannot safely route a large graph in one
    # SVG: a single-column projection over twelve cards exceeds the first-screen
    # contract, while relationship-dense projections can overflow its diagnostic
    # channel.  Keep those projections in a compact twelve-column index and leave
    # relationships in the canonical Control graph.  Full stable identities
    # remain attached to every visible card, so the overview never invents or
    # drops systems and the operator can deep-link to the complete topology.
    # Medium graphs still need their verified topology.  Reserve the
    # relationship-free index only for genuinely huge graphs where rendering
    # every edge would make the Archify SVG unusable.
    unmatched_count = max(0, len(nodes) - len(rendered_edges) * 2)
    unmatched_cols = min(8, max(1, math.ceil(math.sqrt(max(1, unmatched_count)))))
    cols = 12 if overview_only else (8 if compact_medium else max(2 if rendered_edges else 1, unmatched_cols))
    origin = (40, 44) if overview_only else (20, 50) if compact_medium else (80, 90)
    step = (108, 34) if overview_only else (165, 64) if compact_medium else (230, 110)
    component_size = (98, 26) if overview_only else (155, 44) if compact_medium else (190, 64)
    for index, node in enumerate(nodes):
        stable_id = str(node["id"])
        label, sublabel = _display_label(node, stable_id, index)
        if overview_only:
            # Keep the authored title in the overview.  The former compact
            # index (for example, ``cap 001``/``hoo 002``) threw away the only
            # human-readable system name and made all large projections look
            # like an inventory of opaque IDs.  The stable ID remains in the
            # Frank metadata; the card should still communicate what the node
            # is to a reader.  Bounded labels preserve the first-screen
            # geometry, while the kind/index sublabel disambiguates repeated
            # titles and keeps the overview searchable by meaning.
            label = label[:15].rstrip() + ("…" if len(label) > 15 else "")
            sublabel = sublabel[:24]
        elif compact_medium:
            label = label[:19].rstrip() + ("…" if len(label) > 19 else "")
            sublabel = sublabel[:24]
        display_labels[stable_id] = {"label": label, "sublabel": sublabel, "archify_id": id_map[stable_id]}
        paired_count = len(rendered_edges) * 2
        if compact_medium and index < paired_count:
            pair_index = index // 2
            column, row = pair_index % 3, pair_index // 3
            x = origin[0] + column * 420 + (index % 2) * 250
            y = origin[1] + row * step[1]
        elif not overview_only and index < paired_count:
            column, row = index % 2, index // 2
            x, y = origin[0] + column * 350, origin[1] + row * step[1]
        else:
            remaining_index = index if overview_only else index - paired_count
            column = remaining_index % cols
            base_row = 0 if overview_only else (4 if compact_medium else len(rendered_edges) + 1)
            row = remaining_index // cols + base_row
            x, y = origin[0] + column * step[0], origin[1] + row * step[1]
        component: dict[str, Any] = {
            "id": id_map[stable_id],
            "type": _node_type(node.get("kind")),
            "label": label,
            "sublabel": sublabel,
            "pos": [x, y],
            "size": list(component_size),
        }
        if not overview_only:
            component["tag"] = str(node.get("layer", "declared"))[:48]
        components.append(component)
    connections: list[dict[str, Any]] = []
    for edge in rendered_edges:
        relationship = edge.get("relationship", edge.get("type", "depends_on"))
        relationship = str(relationship)[:80]
        connection: dict[str, Any] = {
            "id": _safe_archify_id(str(edge.get("id", f"{edge.get('from')}->{edge.get('to')}"))),
            "from": id_map[str(edge["from"])],
            "to": id_map[str(edge["to"])],
            "label": relationship,
            "route": "orthogonal-h",
            "fromSide": "right",
            "toSide": "left",
        }
        connections.append(connection)
    titles = {
        "projection:vps/world": "VPS World",
        "projection:frank/architecture": "Frank Architecture",
        "projection:blockwise/runtime": "Blockwise Runtime",
        "projection:mini-frank/knowledge-flow": "Mini Frank Knowledge Flow",
        "projection:ad-template-builder/architecture": "Ad Template Builder Architecture",
        "projection:ad-template-builder/workflow": "Ad Template Builder Workflow",
    }
    title = titles.get(projection_id, projection_id)
    diagram = {
        "schema_version": 1,
        "diagram_type": "architecture",
        "meta": {"title": title, "quality_profile": "showcase"},
        "layout": {
            "mode": "grid", "origin": list(origin), "cols": cols,
            "gapX": step[0] - component_size[0], "gapY": step[1] - component_size[1],
            "cellW": component_size[0], "cellH": component_size[1],
        },
        "components": components or [{"id": "n_empty", "type": "external", "label": "No verified graph components", "pos": [80, 90], "size": [210, 76]}],
        "connections": connections,
    }
    coverage = _coverage(nodes, edges, required_coverage)
    metadata = {
        "projection_id": projection_id,
        "graph_revision": graph.get("graph_revision"),
        "stable_id_map": id_map,
        "display_labels": display_labels,
        "coverage": coverage,
        "exclusions": ["additional_relationships_in_control"] if len(rendered_edges) < len(edges) else [],
        "relationship_count": len(edges),
        "rendered_relationship_count": len(connections),
        "runtime_health_claims": False,
        "showcase_checks": list(SHOWCASE_CHECKS),
    }
    return diagram, metadata


def _workflow_lane(node: Mapping[str, Any]) -> str:
    kind = str(node.get("kind", "")).casefold()
    if kind in {"route", "source", "repo", "checkout", "project"}:
        return "intake"
    if kind in {"gate", "rule", "policy", "observer", "eval"}:
        return "checks"
    if kind in {"template", "artifact", "release", "data_store", "volume", "store"}:
        return "outputs"
    if kind in {"capability", "tool", "plugin", "cli", "mcp", "library"}:
        return "build"
    return "execution"


def _workflow_diagram(title: str, nodes: list[Mapping[str, Any]], edges: list[Mapping[str, Any]], id_map: Mapping[str, str], assertions: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """Build the pinned vendor's workflow IR, retaining every selected edge."""
    path = _primary_path((str(node["id"]) for node in nodes), edges)
    if len(path) < 2:
        for edge in edges:
            source, target = str(edge.get("from")), str(edge.get("to"))
            if source != target and source in id_map and target in id_map:
                path = [source, target]
                break
    lane_ids = ["intake", "build", "execution", "checks", "outputs"]
    lane_labels = {"intake": "Request + sources", "build": "Build process", "execution": "Generation stages", "checks": "Validation + review", "outputs": "Artifacts + release"}
    lane_nodes: dict[str, list[str]] = {lane: [] for lane in lane_ids}
    for node in nodes:
        lane_nodes[_workflow_lane(node)].append(str(node["id"]))
    lane_nodes = {lane: values for lane, values in lane_nodes.items() if values}
    if not lane_nodes:
        lane_nodes = {"intake": ["n_empty"]}
    path_position = {node_id: index for index, node_id in enumerate(path)}
    node_columns: dict[str, int] = {}
    for node_id in path:
        node_columns[node_id] = round(path_position[node_id] * 5 / max(len(path) - 1, 1))
    for index, node in enumerate(nodes):
        node_id = str(node["id"])
        node_columns.setdefault(node_id, min(5, round(index * 5 / max(len(nodes) - 1, 1))))
    for node in nodes:
        node_id = str(node["id"])
        label_width = _label_width(_node_title(node, node_id, assertions), maximum=260)
        if label_width > 180 and node_columns[node_id] == 0:
            node_columns[node_id] = 1
        elif label_width > 180 and node_columns[node_id] == 5:
            node_columns[node_id] = 4
    lane_order: dict[str, list[str]] = {}
    for node in nodes:
        node_id = str(node["id"])
        lane_order.setdefault(_workflow_lane(node), []).append(node_id)
    lane_offsets = {node_id: index * 72 for values in lane_order.values() for index, node_id in enumerate(values)}
    workflow_nodes: list[dict[str, Any]] = []
    for node in nodes:
        node_id = str(node["id"])
        label = _node_title(node, node_id, assertions)
        workflow_nodes.append({"id": id_map[node_id], "lane": _workflow_lane(node), "col": node_columns[node_id], "type": _node_type(node.get("kind")), "label": label, "sublabel": _node_sublabel(node, node_id, assertions), "tag": str(node.get("layer", assertions.get(node_id, {}).get("layer", "declared"))), "width": _label_width(label, maximum=220), "yOffset": lane_offsets[node_id]})
    workflow_edges: list[dict[str, Any]] = []
    main_pairs = set(zip(path, path[1:]))
    for ordinal, edge in enumerate(edges):
        source, target = str(edge["from"]), str(edge["to"])
        relationship = edge.get("label") or edge.get("relationship") or edge.get("type") or "depends_on"
        item: dict[str, Any] = {"id": _connection_id(edge, ordinal), "from": id_map[source], "to": id_map[target], "label": str(relationship), "role": "main" if (source, target) in main_pairs else "branch"}
        if str(relationship) in {"validates", "observes"}:
            item["variant"] = "security" if str(relationship) == "validates" else "dashed"
        workflow_edges.append(item)
    phases = [{"id": "intake", "label": "Intake", "fromCol": 0, "toCol": 1}, {"id": "build", "label": "Build", "fromCol": 2, "toCol": 3, "variant": "emphasis"}, {"id": "release", "label": "Check + release", "fromCol": 4, "toCol": 5, "variant": "dashed"}]
    groups = []
    for lane, values in lane_nodes.items():
        if len(values) > 1:
            columns = [node_columns[value] for value in values]
            groups.append({"id": f"group_{lane}", "label": lane_labels[lane], "lane": lane, "fromCol": min(columns), "toCol": max(columns), "variant": "emphasis" if lane == "build" else "dashed"})
    focus_all = [id_map[str(node["id"])] for node in nodes]
    views = []
    if path:
        views.append({"id": "main-path", "label": "Request to release", "focus": [id_map[node_id] for node_id in path], "note": "Follow the recorded connection path through the workflow."})
    if focus_all:
        views.append({"id": "checks-and-outputs", "label": "Checks and outputs", "focus": focus_all, "note": "Inspect validation, review, and output nodes alongside the main path."})
    result = {"schema_version": 1, "diagram_type": "workflow", "meta": {"title": title, "quality_profile": "showcase", "views": views[:5]}, "lanes": [{"id": lane, "label": lane_labels[lane]} for lane in lane_ids if lane in lane_nodes], "phases": phases, "groups": groups, "mainPath": [id_map[node_id] for node_id in path], "nodes": workflow_nodes or [{"id": "n_empty", "lane": next(iter(lane_nodes), "intake"), "col": 0, "type": "external", "label": "No verified workflow nodes", "width": 180}], "edges": workflow_edges, "cards": [{"dot": "cyan", "title": "Workflow coverage", "items": [f"{len(nodes)} selected workflow nodes", f"{len(edges)} selected workflow connections"]}, {"dot": "rose", "title": "Checks remain visible", "items": ["Validation and review edges are preserved as recorded.", "The primary path is a presentation aid, not a new assertion."]}]}
    if not path:
        result.pop("mainPath")
    return result


_AD_PATH_IDS = (
    "component:frank/ad-studio",
    "route:hermes-tool-runs",
    "runtime:hermes-default",
    "tool:ad-template-generator",
    "component:frank/ad-template-builder/source",
    "component:frank/ad-template-builder/build",
    "component:frank/ad-template-builder/render",
    "component:frank/ad-template-builder/compare",
    "component:frank/ad-template-builder/final-check",
    "component:frank/ad-template-builder/live",
)
_AD_CONSUMER_ID = "project:blockwise"
_AD_GATE_ID = "gate:frank/ad-template-final-review"
_AD_PATH_EDGE_IDS = (
    "edge:ad-studio/routes-tool-runs",
    "edge:hermes-tool-runs/routes-hermes",
    "edge:hermes/executes-ad-template-tool",
    "edge:ad-template-generator/executes-source",
    "edge:ad-template-builder/source-to-build",
    "edge:ad-template-builder/build-to-render",
    "edge:ad-template-builder/render-to-compare",
    "edge:ad-template-builder/compare-to-final-check",
    "edge:ad-template-builder/final-check-to-live",
)
_AD_GATE_EDGE_ID = "edge:ad-template-builder/final-review-gate"
_AD_REVISION_EDGE_ID = "edge:ad-template-builder/compare-revises-render"
_AD_CONSUMER_EDGE_ID = "edge:ad-template-builder/live-consumes-blockwise"
_AD_PRESENTATION = {
    "component:frank/ad-studio": ("Ad Studio", "request + run monitor", "frontend", "FRANK"),
    "route:hermes-tool-runs": ("Tool-run API", "typed command + events", "security", "BOUNDARY"),
    "runtime:hermes-default": ("Hermes", "production authority", "backend", "HERMES"),
    "tool:ad-template-generator": ("Generator", "ad-template-generator", "backend", "TOOL"),
    "component:frank/ad-template-builder/source": ("Source", "verify image + brief", "external", "STAGE 1"),
    "component:frank/ad-template-builder/build": ("Layered Build", "analyze + compose", "backend", "STAGE 2"),
    "component:frank/ad-template-builder/render": ("Feed + Story", "editable layouts", "frontend", "STAGE 3"),
    "component:frank/ad-template-builder/compare": ("Compare", "score + revise", "security", "STAGE 4"),
    "component:frank/ad-template-builder/final-check": ("Release Checks", "deterministic + human", "security", "STAGE 5"),
    "component:frank/ad-template-builder/live": ("Live + Import", "completed live stage", "messagebus", "STAGE 6"),
    "gate:frank/ad-template-final-review": ("Final Review", "accepted before import", "security", "GATE"),
    "project:blockwise": ("Blockwise", "verified consumer", "backend", "CONSUMER"),
}


def _ad_core_model(
    nodes: list[Mapping[str, Any]], edges: list[Mapping[str, Any]],
) -> tuple[list[str], list[str], dict[str, Mapping[str, Any]], dict[str, Mapping[str, Any]]] | None:
    """Return the evidence-backed product path, leaving governance detail off-canvas."""
    nodes_by_id = {str(node["id"]): node for node in nodes}
    edges_by_id = {str(edge.get("id")): edge for edge in edges if edge.get("id")}
    if any(stable_id not in nodes_by_id for stable_id in _AD_PATH_IDS):
        return None
    path_ids = list(_AD_PATH_IDS)
    path_edge_ids = list(_AD_PATH_EDGE_IDS)
    if _AD_CONSUMER_ID in nodes_by_id and _AD_CONSUMER_EDGE_ID in edges_by_id:
        path_ids.append(_AD_CONSUMER_ID)
        path_edge_ids.append(_AD_CONSUMER_EDGE_ID)
    if any(edge_id not in edges_by_id for edge_id in path_edge_ids):
        return None
    core_ids = list(path_ids)
    if _AD_GATE_ID in nodes_by_id and _AD_GATE_EDGE_ID in edges_by_id:
        core_ids.append(_AD_GATE_ID)
    return core_ids, path_edge_ids, nodes_by_id, edges_by_id


def _ad_component(stable_id: str, id_map: Mapping[str, str], pos: tuple[float, float]) -> dict[str, Any]:
    label, sublabel, component_type, tag = _AD_PRESENTATION[stable_id]
    return {
        "id": id_map[stable_id],
        "type": component_type,
        "label": label,
        "sublabel": sublabel,
        "tag": tag,
        "pos": [pos[0], pos[1]],
        "size": [178, 64],
    }


def _ad_architecture_diagram(
    title: str, core_ids: list[str], path_edge_ids: list[str],
    edges_by_id: Mapping[str, Mapping[str, Any]], id_map: Mapping[str, str],
) -> tuple[dict[str, Any], list[str]]:
    path_ids = [stable_id for stable_id in _AD_PATH_IDS if stable_id in core_ids]
    if _AD_CONSUMER_ID in core_ids:
        path_ids.append(_AD_CONSUMER_ID)
    top_ids = path_ids[:6]
    bottom_ids = path_ids[6:]
    x_by_id = {stable_id: 38 + index * 206 for index, stable_id in enumerate(top_ids)}
    for index, stable_id in enumerate(bottom_ids):
        x_by_id[stable_id] = 38 if stable_id == _AD_CONSUMER_ID else x_by_id[top_ids[-1]] - index * 206
    components = [
        _ad_component(stable_id, id_map, (x_by_id[stable_id], 170 if stable_id in top_ids else 350))
        for stable_id in path_ids
    ]
    if _AD_GATE_ID in core_ids:
        components.append(_ad_component(_AD_GATE_ID, id_map, (x_by_id["component:frank/ad-template-builder/final-check"], 510)))

    connections: list[dict[str, Any]] = []
    rendered_edge_ids: list[str] = []
    for edge_id in path_edge_ids:
        edge = edges_by_id[edge_id]
        connection: dict[str, Any] = {
            "id": _safe_archify_id(edge_id),
            "from": id_map[str(edge["from"])],
            "to": id_map[str(edge["to"])],
            "route": "straight",
        }
        if edge_id in {"edge:ad-studio/routes-tool-runs", "edge:hermes/executes-ad-template-tool", _AD_CONSUMER_EDGE_ID}:
            connection["variant"] = "emphasis"
        connections.append(connection)
        rendered_edge_ids.append(edge_id)
    if _AD_GATE_ID in core_ids:
        gate_edge = edges_by_id[_AD_GATE_EDGE_ID]
        connections.append({
            "id": _safe_archify_id(_AD_GATE_EDGE_ID),
            "from": id_map[str(gate_edge["from"])],
            "to": id_map[str(gate_edge["to"])],
            "variant": "security",
            "fromSide": "top",
            "toSide": "bottom",
            "route": "straight",
        })
        rendered_edge_ids.append(_AD_GATE_EDGE_ID)

    hermes_ids = [stable_id for stable_id in path_ids[2:] if stable_id != _AD_CONSUMER_ID]
    if _AD_GATE_ID in core_ids:
        hermes_ids.append(_AD_GATE_ID)
    views = [
        {"id": "request-authority", "label": "Request + authority", "focus": [id_map[value] for value in path_ids[:4]], "note": "Frank submits one typed tool run; Hermes owns execution."},
        {"id": "build-review", "label": "Build + review loop", "focus": [id_map[value] for value in path_ids[4:9]] + ([id_map[_AD_GATE_ID]] if _AD_GATE_ID in core_ids else []), "note": "Follow source analysis, layered build, previews, comparison, revision, and release checks."},
        {"id": "release-consumer", "label": "Release + consumer", "focus": [id_map[value] for value in path_ids[-3:]], "note": "Accepted review reaches the verified Blockwise import."},
    ]
    diagram = {
        "schema_version": 1,
        "diagram_type": "architecture",
        "meta": {
            "title": title,
            "subtitle": "Evidence-backed Frank → Hermes → Blockwise template path",
            "quality_profile": "showcase",
            "views": views,
        },
        "components": components,
        "boundaries": [{"kind": "security-group", "label": "Hermes production execution boundary", "wraps": [id_map[value] for value in hermes_ids], "pad": 20}],
        "connections": connections,
        "cards": [
            {"dot": "cyan", "title": "Runtime Contract", "items": ["Ad Studio submits a typed Hermes tool-run command", "Hermes is the production execution authority", "ad-template-generator owns the build stages"]},
            {"dot": "amber", "title": "Iterative Production", "items": ["Source is analyzed into a layered composition", "Feed and Story render as separate editable layouts", "Comparison can return the design for revision"]},
            {"dot": "emerald", "title": "Release Evidence", "items": ["Final review must be accepted", "Deterministic checks protect subject invariance", "A completed live run was imported by Blockwise"]},
        ],
    }
    return diagram, rendered_edge_ids


def _ad_workflow_diagram(
    title: str, core_ids: list[str], path_edge_ids: list[str],
    edges_by_id: Mapping[str, Mapping[str, Any]], id_map: Mapping[str, str],
) -> tuple[dict[str, Any], list[str]]:
    path_ids = [stable_id for stable_id in _AD_PATH_IDS if stable_id in core_ids]
    if _AD_CONSUMER_ID in core_ids:
        path_ids.append(_AD_CONSUMER_ID)
    placement = {
        "component:frank/ad-studio": ("surfaces", 0, 92),
        "project:blockwise": ("surfaces", 5, 72),
        "route:hermes-tool-runs": ("hermes", 0, 88),
        "runtime:hermes-default": ("hermes", 1, 64),
        "tool:ad-template-generator": ("hermes", 2, 72),
        "component:frank/ad-template-builder/source": ("builder", 2, 56),
        "component:frank/ad-template-builder/build": ("builder", 3, 40),
        "component:frank/ad-template-builder/render": ("builder", 4, 40),
        "component:frank/ad-template-builder/live": ("builder", 5, 48),
        "gate:frank/ad-template-final-review": ("review", 2, 96),
        "component:frank/ad-template-builder/compare": ("review", 4, 64),
        "component:frank/ad-template-builder/final-check": ("review", 5, 56),
    }
    workflow_copy = {
        "component:frank/ad-studio": ("Ad Studio", "frontend"),
        "project:blockwise": ("Blockwise", "backend"),
        "route:hermes-tool-runs": ("Tool-run API", "security"),
        "runtime:hermes-default": ("Hermes", "backend"),
        "tool:ad-template-generator": ("Generator", "backend"),
        "component:frank/ad-template-builder/source": ("Source", "external"),
        "component:frank/ad-template-builder/build": ("Build", "backend"),
        "component:frank/ad-template-builder/render": ("Render", "frontend"),
        "component:frank/ad-template-builder/live": ("Live", "messagebus"),
        "gate:frank/ad-template-final-review": ("Final Review", "security"),
        "component:frank/ad-template-builder/compare": ("Compare", "security"),
        "component:frank/ad-template-builder/final-check": ("Checks", "security"),
    }
    workflow_nodes: list[dict[str, Any]] = []
    visible_ids = list(path_ids)
    if _AD_GATE_ID in core_ids:
        visible_ids.append(_AD_GATE_ID)
    for stable_id in visible_ids:
        lane, col, width = placement[stable_id]
        label, component_type = workflow_copy[stable_id]
        workflow_nodes.append({
            "id": id_map[stable_id],
            "lane": lane,
            "col": col,
            "type": component_type,
            "label": label,
            "width": width,
        })

    edge_options: dict[str, dict[str, Any]] = {
        "edge:ad-studio/routes-tool-runs": {
            "label": "submit", "route": "drop", "fromSide": "bottom",
            "toSide": "top", "variant": "emphasis",
        },
        "edge:hermes/executes-ad-template-tool": {
            "route": "bottom-channel", "fromSide": "bottom", "toSide": "bottom",
        },
        "edge:ad-template-generator/executes-source": {
            "route": "drop", "fromSide": "bottom", "toSide": "top",
        },
        "edge:ad-template-builder/render-to-compare": {
            "route": "drop", "fromSide": "bottom", "toSide": "top",
        },
        "edge:ad-template-builder/final-check-to-live": {
            "route": "straight", "fromSide": "top", "toSide": "bottom",
            "variant": "security",
        },
        _AD_CONSUMER_EDGE_ID: {
            "label": "import", "route": "straight", "fromSide": "top",
            "toSide": "bottom", "variant": "emphasis",
        },
        _AD_GATE_EDGE_ID: {
            "label": "accepted", "route": "bottom-channel", "fromSide": "bottom",
            "toSide": "bottom", "variant": "security",
        },
        _AD_REVISION_EDGE_ID: {
            "route": "straight", "fromSide": "top", "toSide": "bottom",
            "variant": "dashed",
        },
    }
    visual_edges = [(edge_id, "main") for edge_id in path_edge_ids]
    if _AD_GATE_ID in core_ids:
        visual_edges.append((_AD_GATE_EDGE_ID, "branch"))
    if _AD_REVISION_EDGE_ID in edges_by_id:
        visual_edges.append((_AD_REVISION_EDGE_ID, "branch"))
    workflow_edges = []
    rendered_edge_ids = []
    for edge_id, role in visual_edges:
        edge = edges_by_id[edge_id]
        workflow_edges.append({
            "id": _safe_archify_id(edge_id),
            "from": id_map[str(edge["from"])],
            "to": id_map[str(edge["to"])],
            "role": role,
            **edge_options.get(edge_id, {}),
        })
        rendered_edge_ids.append(edge_id)

    diagram = {
        "schema_version": 1,
        "diagram_type": "workflow",
        "meta": {
            "title": title,
            "subtitle": (
                "Evidence-backed request to verified Blockwise import"
                if _AD_CONSUMER_ID in core_ids
                else "Evidence-backed request, review, and live-stage flow"
            ),
            "quality_profile": "showcase",
            "viewBox": [950, 610],
        },
        "lanes": [
            {"id": "surfaces", "label": "Product Surfaces"},
            {"id": "hermes", "label": "Hermes Authority"},
            {"id": "builder", "label": "Template Builder"},
            {"id": "review", "label": "Review + Delivery"},
        ],
        "phases": [
            {"id": "request", "label": "Request + authority", "fromCol": 0, "toCol": 1},
            {"id": "production", "label": "Build + compare", "fromCol": 2, "toCol": 3, "variant": "emphasis"},
            {"id": "release", "label": "Approve + import", "fromCol": 4, "toCol": 5, "variant": "dashed"},
        ],
        "groups": [],
        "mainPath": [id_map[value] for value in path_ids],
        "nodes": workflow_nodes,
        "edges": workflow_edges,
        "cards": [],
    }
    return diagram, rendered_edge_ids


def _ad_authored_projection(
    graph: Mapping[str, Any], projection_id: str, nodes: list[Mapping[str, Any]],
    edges: list[Mapping[str, Any]], *, required_coverage: Iterable[str], title: str,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    model = _ad_core_model(nodes, edges)
    if model is None:
        return None
    core_ids, path_edge_ids, _nodes_by_id, edges_by_id = model
    if projection_id.endswith("/workflow"):
        visible_core_ids = core_ids
        id_map = {stable_id: _safe_archify_id(stable_id) for stable_id in sorted(visible_core_ids)}
        diagram, rendered_edge_ids = _ad_workflow_diagram(title, visible_core_ids, path_edge_ids, edges_by_id, id_map)
    else:
        visible_core_ids = core_ids
        id_map = {stable_id: _safe_archify_id(stable_id) for stable_id in sorted(visible_core_ids)}
        diagram, rendered_edge_ids = _ad_architecture_diagram(title, visible_core_ids, path_edge_ids, edges_by_id, id_map)
    all_ids = {str(node["id"]) for node in nodes}
    supporting_ids = sorted(all_ids - set(visible_core_ids))
    diagram_nodes = diagram.get("components", diagram.get("nodes", ()))
    diagram_relationships = diagram.get("connections", diagram.get("edges", ()))
    diagram_labels = {
        str(node.get("id")): (str(node.get("label", "")), str(node.get("sublabel", "")))
        for node in diagram_nodes if isinstance(node, Mapping)
    }
    display_labels = {}
    for stable_id in visible_core_ids:
        label, sublabel = diagram_labels.get(
            id_map[stable_id],
            (_AD_PRESENTATION[stable_id][0], _AD_PRESENTATION[stable_id][1]),
        )
        display_labels[stable_id] = {"label": label, "sublabel": sublabel, "archify_id": id_map[stable_id]}
    metadata = {
        "projection_id": projection_id,
        "graph_revision": graph.get("graph_revision"),
        "stable_id_map": id_map,
        "supporting_stable_id_map": {stable_id: _safe_archify_id(stable_id) for stable_id in supporting_ids},
        "display_labels": display_labels,
        "coverage": _coverage(nodes, edges, required_coverage),
        "relationship_count": len(edges),
        "rendered_relationship_count": len(diagram_relationships),
        "supporting_identity_count": len(supporting_ids),
        "supporting_relationship_count": max(0, len(edges) - len(rendered_edge_ids)),
        "rendered_relationship_ids": [
            str(item["id"])
            for item in diagram_relationships
            if isinstance(item, Mapping) and isinstance(item.get("id"), str)
        ],
        "represented_relationship_ids": rendered_edge_ids,
        "coverage_scope": "projection_with_supporting_evidence",
        "exclusions": ["supporting_topology_in_control"] if supporting_ids or len(edges) > len(rendered_edge_ids) else [],
        "runtime_health_claims": False,
        "showcase_checks": list(SHOWCASE_CHECKS),
    }
    return diagram, metadata


def graph_to_archify(graph: Mapping[str, Any], projection_id: str, *, required_coverage: Iterable[str] = ()) -> tuple[dict[str, Any], dict[str, Any]]:
    """Convert a selected canonical graph to faithful Archify presentation IR."""
    if projection_id not in {
        "projection:ad-template-builder/architecture",
        "projection:ad-template-builder/workflow",
    }:
        return _overview_graph_to_archify(
            graph,
            projection_id,
            required_coverage=required_coverage,
        )
    if not isinstance(graph, Mapping):
        raise ControlContractError("graph must be an object")
    if not isinstance(projection_id, str) or not projection_id.startswith("projection:"):
        raise ControlContractError("projection_id is invalid")
    nodes = sorted(_projection_nodes(graph, projection_id), key=lambda item: str(item["id"]))
    stable_ids = {str(item["id"]) for item in nodes}
    id_map = {stable_id: _safe_archify_id(stable_id) for stable_id in sorted(stable_ids)}
    assertions = _assertion_index(graph)
    edges = _edge_records(graph, stable_ids)
    titles = {"projection:vps/world": "VPS World", "projection:frank/architecture": "Frank Architecture", "projection:blockwise/runtime": "Blockwise Runtime", "projection:mini-frank/knowledge-flow": "Mini Frank Knowledge Flow", "projection:ad-template-builder/architecture": "Ad Template Builder Architecture", "projection:ad-template-builder/workflow": "Ad Template Builder Workflow"}
    title = titles.get(projection_id, projection_id)
    authored = _ad_authored_projection(
        graph, projection_id, nodes, edges,
        required_coverage=required_coverage, title=title,
    )
    if authored is not None:
        return authored
    path = _primary_path(stable_ids, edges)
    path_index = {value: index for index, value in enumerate(path)}
    anchors: dict[str, int] = {}
    for edge in edges:
        source, target = str(edge["from"]), str(edge["to"])
        if source in path_index:
            anchors.setdefault(target, path_index[source])
        if target in path_index:
            anchors.setdefault(source, path_index[target])
    for index, node in enumerate(nodes):
        anchors.setdefault(str(node["id"]), index)
    positions: dict[str, tuple[float, float]] = {}
    side_rows: dict[int, int] = {}
    side_row_cursor = 0
    widths: dict[str, float] = {str(node["id"]): _label_width(_node_title(node, str(node["id"]), assertions), 180) for node in nodes}
    path_x: dict[str, float] = {}
    cursor_x = 80.0
    for node_id in path:
        path_x[node_id] = cursor_x
        label = _node_title(next(node for node in nodes if str(node["id"]) == node_id), node_id, assertions)
        cursor_x += _label_width(label, 180) + 50
    components: list[dict[str, Any]] = []
    for index, node in enumerate(nodes):
        node_id = str(node["id"])
        if node_id in path_index:
            column, y = path_index[node_id], 280
        else:
            column = min(anchors[node_id], max(len(path) - 1, 0)) if path else index
            row = side_rows.get(column, 0); side_rows[column] = row + 1
            row = side_row_cursor; side_row_cursor += 1
            y = 90 + row * 100
        x = path_x.get(node_id, 80 + column * 230); positions[node_id] = (x, y)
        label = _node_title(node, node_id, assertions)
        components.append({"id": id_map[node_id], "type": _node_type(node.get("kind")), "label": label, "sublabel": _node_sublabel(node, node_id, assertions), "tag": str(node.get("layer", assertions.get(node_id, {}).get("layer", "declared"))), "pos": [x, y], "size": [widths[node_id], 64]})
    connections = []
    for ordinal, edge in enumerate(edges):
        source, target = str(edge["from"]), str(edge["to"])
        relationship = edge.get("label") or edge.get("relationship") or edge.get("type") or "depends_on"
        connection = {"id": _connection_id(edge, ordinal), "from": id_map[source], "to": id_map[target], "label": str(relationship)}
        if source != target:
            sx, sy = positions[source]; tx, ty = positions[target]
            dx = (tx + widths[target] / 2) - (sx + widths[source] / 2)
            dy = (ty + 32) - (sy + 32)
            if abs(dx) >= abs(dy):
                connection.update({"fromSide": "right", "toSide": "left"} if dx > 0 else {"fromSide": "left", "toSide": "right"})
            else:
                connection.update({"fromSide": "bottom", "toSide": "top"} if dy > 0 else {"fromSide": "top", "toSide": "bottom"})
        connections.append(connection)
    boundaries = []
    for node in nodes:
        parent = str(node["id"])
        if str(node.get("kind", "")).casefold() not in {"host", "project"}:
            continue
        wrapped = sorted({str(edge["to"]) for edge in edges if str(edge.get("from")) == parent and str(edge.get("relationship", edge.get("type", ""))) == "contains" and str(edge.get("to")) in id_map})
        if wrapped:
            boundaries.append({"kind": "region", "label": _node_title(node, parent, assertions), "wraps": [id_map[value] for value in wrapped], "pad": 18})
    focus_all = [id_map[value] for value in sorted(stable_ids)]
    views = []
    if path:
        views.append({"id": "primary-path", "label": "Primary connection path", "focus": [id_map[value] for value in path], "note": "Follow the deterministic path selected from recorded connections."})
    if boundaries and focus_all:
        views.append({"id": "boundaries", "label": "Declared boundaries", "focus": focus_all, "note": "Inspect selected nodes within their declared containment boundaries."})
    if len(views) < 2 and focus_all:
        views.append({"id": "all-connections", "label": "All selected connections", "focus": focus_all, "note": "Explore every selected node and recorded connection."})
    diagram = {"schema_version": 1, "diagram_type": "architecture", "meta": {"title": title, "quality_profile": "showcase", "views": views[:5]}, "layout": {"mode": "grid", "origin": [80, 90], "cols": max(1, min(12, len(path) or len(nodes))), "gapX": 50, "gapY": 36, "cellW": 180, "cellH": 64}, "components": components or [{"id": "n_empty", "type": "external", "label": "No verified graph components", "pos": [80, 90], "size": [180, 64]}], "boundaries": boundaries, "connections": connections, "cards": [{"dot": "cyan", "title": "Selected topology", "items": [f"{len(nodes)} selected components", f"{len(edges)} selected connections"]}, {"dot": "emerald", "title": "Reading guide", "items": ["The primary path is a presentation aid derived from recorded connections.", "Full stable identities remain in Frank metadata."]}]}
    if projection_id.endswith("/workflow"):
        diagram = _workflow_diagram(title, nodes, edges, id_map, assertions)
    coverage = _coverage(nodes, edges, required_coverage)
    metadata = {"projection_id": projection_id, "graph_revision": graph.get("graph_revision"), "stable_id_map": id_map, "display_labels": {str(node["id"]): {"label": _node_title(node, str(node["id"]), assertions), "sublabel": _node_sublabel(node, str(node["id"]), assertions), "archify_id": id_map[str(node["id"])]} for node in nodes}, "coverage": coverage, "relationship_count": len(edges), "rendered_relationship_count": len(edges), "exclusions": [], "runtime_health_claims": False, "showcase_checks": list(SHOWCASE_CHECKS)}
    return diagram, metadata


def showcase_check_results(receipt: Mapping[str, Any]) -> dict[str, bool]:
    """Normalize Archify's JSON receipt to the nine named acceptance checks."""
    checks = receipt.get("checks", ()) if isinstance(receipt, Mapping) else ()
    by_name = {item.get("name"): bool(item.get("ok")) for item in checks if isinstance(item, Mapping)}
    return {name: by_name.get(name, False) for name in SHOWCASE_CHECKS}


def run_archify(command: str, projection_type: str, input_path: Path | str, *, output_path: Path | str | None = None, timeout: float = 120.0) -> dict[str, Any]:
    """Run only the exact reviewed Archify executable using argv (never shell)."""
    if command not in {"validate", "deliver", "visual-check"}:
        raise ControlContractError("unsupported Archify command")
    if projection_type not in PROJECTION_TYPES and command != "visual-check":
        raise ControlContractError("unsupported Archify projection type")
    executable = ARCHIFY_EXECUTABLE.resolve(strict=True)
    digest = hashlib.sha256(executable.read_bytes()).hexdigest()
    if digest != ARCHIFY_SHA256:
        raise ControlContractError("pinned Archify executable hash mismatch")
    source = Path(input_path).resolve(strict=True)
    argv = ["node", str(executable), command]
    if command == "visual-check":
        argv.extend([str(source), "--json"])
    else:
        argv.extend([_cli_projection_type(projection_type), str(source)])
        if command == "deliver" and output_path is not None:
            argv.append(str(Path(output_path).resolve()))
        argv.extend(["--quality", "showcase", "--json"])
    completed = subprocess.run(argv, cwd=str(executable.parent.parent), shell=False, capture_output=True, text=True, timeout=timeout, check=False)
    try:
        receipt = json.loads(completed.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ControlContractError("Archify returned no JSON receipt") from exc
    if completed.returncode != 0:
        raise ControlContractError("Archify command failed")
    return receipt


def build_projection(graph: Mapping[str, Any], projection_id: str, *, source_revisions: Mapping[str, str], deployed_revisions: Mapping[str, str], required_coverage: Iterable[str] = (), exclusions: Iterable[str] = ()) -> dict[str, Any]:
    """Return the Archify input plus immutable Frank projection metadata."""
    diagram, metadata = graph_to_archify(graph, projection_id, required_coverage=required_coverage)
    metadata["source_revisions"] = dict(sorted(source_revisions.items()))
    metadata["deployed_revisions"] = dict(sorted(deployed_revisions.items()))
    metadata["exclusions"] = sorted(set(metadata.get("exclusions", ())) | set(exclusions))
    metadata["input_hash"] = "sha256:" + hashlib.sha256(canonical_bytes(diagram)).hexdigest()
    metadata["archify_version"] = ARCHIFY_VERSION
    metadata["archify_hash"] = "sha256:" + ARCHIFY_SHA256
    return {"diagram": diagram, "metadata": metadata}


class ArchifyAdapter:
    """Runtime seam separating Archify input from Frank metadata."""

    def project(self, graph: Mapping[str, Any], *, projection_id: str) -> dict[str, Any]:
        estate_metadata: Mapping[str, Any] | None = None
        if projection_id in ESTATE_PROJECTION_IDS:
            estate = build_estate_projection(
                graph,
                projection_id,
                mappings=graph.get("projection_mappings", ()),
                evidence=graph.get("projection_evidence"),
            )
            # Convert only the typed, evidence-preserving projection.  The
            # estate seam remains authoritative for findings/exclusions and
            # conditional-flow decisions.
            graph = dict(graph, nodes=estate["nodes"], edges=estate["relationships"], relationships=estate["relationships"])
            estate_metadata = estate
        required = ("workloads", "routes", "repositories", "stores", "capabilities") if projection_id == "projection:vps/world" else ("window", "hermes_boundary", "hindsight_boundary")
        if projection_id in ESTATE_PROJECTION_IDS:
            required = tuple(estate_metadata["coverage"]["required"]) if estate_metadata else ()
        built = build_projection(graph, projection_id, source_revisions=graph.get("source_revisions", {}), deployed_revisions=graph.get("deployed_revisions", {}), required_coverage=required, exclusions=graph.get("exclusions", ()))
        if estate_metadata is not None:
            built["metadata"]["estate_status"] = estate_metadata.get("status")
            built["metadata"]["findings"] = estate_metadata.get("findings", [])
            built["metadata"]["mappings"] = estate_metadata.get("mappings", [])
            built["metadata"]["cross_links"] = estate_metadata.get("cross_links", {})
            built["metadata"]["exclusions"] = sorted(
                set(built["metadata"].get("exclusions", ()))
                | set(estate_metadata.get("exclusions", ()))
            )
            built["metadata"]["estate_coverage"] = estate_metadata.get("coverage", {})
            if estate_metadata.get("status") != "generated":
                raise ControlContractError(f"projection {projection_id} is not generated")
        coverage = estate_metadata.get("coverage", {}) if estate_metadata is not None else built["metadata"]["coverage"]
        return {"projection_id": projection_id, "diagram": built["diagram"], "coverage": coverage, "exclusions": built["metadata"]["exclusions"], "metadata": built["metadata"], "findings": built["metadata"].get("findings", [])}

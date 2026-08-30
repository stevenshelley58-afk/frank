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
    return stable_id


def _display_label(node: Mapping[str, Any], stable_id: str, index: int) -> tuple[str, str]:
    """Return bounded human labels; the full ID remains in Frank metadata."""
    title = _title(node, stable_id)
    title = re.sub(r"\s+", " ", title).strip()
    if len(title) > 28:
        title = title[:27].rstrip() + "…"
    kind = re.sub(r"[^a-z0-9-]+", "-", str(node.get("kind", "node")).casefold()).strip("-") or "node"
    return title or kind, f"{kind} #{index + 1:03d}"[:24]


def _projection_nodes(graph: Mapping[str, Any], projection_id: str) -> list[Mapping[str, Any]]:
    nodes = [item for item in graph.get("nodes", ()) if isinstance(item, Mapping) and isinstance(item.get("id"), str)]
    if projection_id == "projection:vps/world":
        return nodes
    if projection_id == "projection:frank/architecture":
        selected: list[Mapping[str, Any]] = []
        for node in nodes:
            stable_id = str(node["id"])
            low = stable_id.casefold()
            if any(token in low for token in ("frank", "hermes", "hindsight")):
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


def graph_to_archify(graph: Mapping[str, Any], projection_id: str, *, required_coverage: Iterable[str] = ()) -> tuple[dict[str, Any], dict[str, Any]]:
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
    components: list[dict[str, Any]] = []
    display_labels: dict[str, dict[str, str]] = {}
    # Archify's showcase renderer cannot safely route a large graph in one
    # SVG: a single-column projection over twelve cards exceeds the first-screen
    # contract, while relationship-dense projections can overflow its diagnostic
    # channel.  Keep those projections in a compact twelve-column index and leave
    # relationships in the canonical Control graph.  Full stable identities
    # remain attached to every visible card, so the overview never invents or
    # drops systems and the operator can deep-link to the complete topology.
    overview_only = len(nodes) > 12
    cols = 12 if overview_only else 1
    origin = (40, 44) if overview_only else (80, 90)
    step = (108, 34) if overview_only else (260, 130)
    component_size = (98, 26) if overview_only else (210, 76)
    positions: dict[str, tuple[int, int]] = {}
    for index, node in enumerate(nodes):
        stable_id = str(node["id"])
        label, sublabel = _display_label(node, stable_id, index)
        if overview_only:
            label = f"{stable_id.split(':', 1)[0][:3]} {index + 1:03d}"
            sublabel = ""
        display_labels[stable_id] = {"label": label, "sublabel": sublabel, "archify_id": id_map[stable_id]}
        column, row = index % cols, index // cols
        x, y = origin[0] + column * step[0], origin[1] + row * step[1]
        positions[stable_id] = (x, y)
        component: dict[str, Any] = {
            "id": id_map[stable_id],
            "type": _node_type(node.get("kind")),
            "label": label,
            "pos": [x, y],
            "size": list(component_size),
        }
        if not overview_only:
            component["sublabel"] = sublabel
            component["tag"] = str(node.get("layer", "declared"))[:48]
        components.append(component)
    edges: list[Mapping[str, Any]] = []
    for edge in graph.get("edges", graph.get("relationships", ())):
        if not isinstance(edge, Mapping):
            continue
        source = edge.get("from")
        target = edge.get("to")
        if source not in stable_ids or target not in stable_ids or source == target:
            continue
        edges.append(edge)
    connections: list[dict[str, Any]] = []
    rendered_edges = () if overview_only else edges
    for edge in sorted(rendered_edges, key=lambda item: (str(item.get("from")), str(item.get("to")), str(item.get("id", "")))):
        relationship = edge.get("relationship", edge.get("type", "depends_on"))
        relationship = str(relationship)[:80]
        from_x, from_y = positions[str(edge["from"])]
        to_x, to_y = positions[str(edge["to"])]
        connection: dict[str, Any] = {
            "id": _safe_archify_id(str(edge.get("id", f"{edge.get('from')}->{edge.get('to')}"))),
            "from": id_map[str(edge["from"])],
            "to": id_map[str(edge["to"])],
            "label": relationship,
            "route": "orthogonal-h",
            "fromSide": "right",
            "toSide": "right",
            "via": [[from_x + 250, from_y + 38], [to_x + 250, to_y + 38]],
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
        "exclusions": ["relationships_render_in_control_graph"] if overview_only and edges else [],
        "relationship_count": len(edges),
        "rendered_relationship_count": len(connections),
        "runtime_health_claims": False,
        "showcase_checks": list(SHOWCASE_CHECKS),
    }
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
            estate = build_estate_projection(graph, projection_id)
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
            built["metadata"]["exclusions"] = estate_metadata.get("exclusions", [])
            built["metadata"]["estate_coverage"] = estate_metadata.get("coverage", {})
            if estate_metadata.get("status") != "generated":
                raise ControlContractError(f"projection {projection_id} is not generated")
        coverage = estate_metadata.get("coverage", {}) if estate_metadata is not None else built["metadata"]["coverage"]
        return {"projection_id": projection_id, "diagram": built["diagram"], "coverage": coverage, "exclusions": built["metadata"]["exclusions"], "metadata": built["metadata"], "findings": built["metadata"].get("findings", [])}

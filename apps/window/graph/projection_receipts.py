"""Truthful map receipts: provenance envelopes, approved-root discovery,
and deletion verification on top of the existing graph pipeline.

Reuses ``schema://frank.graph/v1`` and the existing provider/pipeline; adds
no new diagram UI or graph store. Every projection must carry source
revisions, captured/generated time, validation and an explicit stale/error
state; discovery reads only approved roots; deletion of a source must make
its nodes and edges disappear rather than becoming ghosts. Maps never
contain prompts, hidden reasoning, secrets or raw retained memory.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Mapping, Sequence

GRAPH_SCHEMA = "schema://frank.graph/v1"
MOUNTPOINT_SEGMENTS = frozenset({".frank-attachments", "uploads"})
DEFAULT_MAX_AGE = timedelta(days=7)


class ReceiptError(ValueError):
    """Projection envelope or deletion evidence is untruthful."""


def _parse_timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ReceiptError(f"{label} is missing or invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ReceiptError(f"{label} is not ISO-8601") from error
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def projection_envelope(graph: Mapping[str, object], *, now: datetime | None = None, max_age: timedelta = DEFAULT_MAX_AGE) -> dict:
    """Extract the truthfulness envelope every projection must carry."""
    if graph.get("schema") != GRAPH_SCHEMA:
        raise ReceiptError("projection does not use schema://frank.graph/v1")
    revision = graph.get("graph_revision")
    generated_at = _parse_timestamp(graph.get("generated_at"), "generated_at")
    reference = now or datetime.now(timezone.utc)
    age = reference - generated_at
    state = "ready" if age <= max_age else "stale"
    validation = graph.get("validation") if isinstance(graph.get("validation"), dict) else None
    if validation is not None and validation.get("status") not in {None, "ok", "validated", "passed"}:
        state = "error"
    sources = graph.get("sources") if isinstance(graph.get("sources"), list) else []
    source_revisions = {}
    for source in sources:
        if isinstance(source, dict) and source.get("path") and source.get("revision"):
            source_revisions[str(source["path"])] = str(source["revision"])
    return {
        "graph_revision": str(revision or ""),
        "generated_at": graph.get("generated_at"),
        "age_seconds": int(age.total_seconds()),
        "state": state,
        "source_revisions": source_revisions,
        "validation": validation,
    }


def filter_approved_roots(candidates: Sequence[Mapping[str, object]], approved_roots: Sequence[str]) -> list[dict]:
    """Discovery may read approved roots and committed sources only.

    Rejects anything outside the approved roots and always excludes the
    `.frank-attachments` mountpoint from scans, maps and knowledge.
    """
    approved = [Path(root).resolve() for root in approved_roots]
    accepted = []
    for candidate in candidates:
        raw = str(candidate.get("path") or "")
        if not raw:
            continue
        path = Path(raw)
        try:
            resolved = path.resolve(strict=False)
        except OSError:
            continue
        if any(part in MOUNTPOINT_SEGMENTS for part in resolved.parts):
            continue
        if not any(resolved == root or root in resolved.parents for root in approved):
            continue
        accepted.append(dict(candidate))
    return accepted


def verify_deletion(before: Mapping[str, object], after: Mapping[str, object], *, entity_key: str) -> dict:
    """Prove a deleted source's nodes/edges are gone rather than ghosted."""
    def _nodes(graph: Mapping[str, object]) -> list[dict]:
        return [node for node in (graph.get("nodes") or []) if isinstance(node, dict)]

    def _edges(graph: Mapping[str, object]) -> list[dict]:
        return [edge for edge in (graph.get("edges") or []) if isinstance(edge, dict)]

    before_nodes = _nodes(before)
    removed_node_ids = {
        _node_id(node) for node in before_nodes if entity_key in json_text(node)
    } - {_node_id(node) for node in _nodes(after)}
    removed_edge_ids = {
        _edge_id(edge)
        for edge in _edges(before)
        if entity_key in json_text(edge) or edge.get("source") in removed_node_ids or edge.get("target") in removed_node_ids
    }
    ghost_nodes = {_node_id(node) for node in _nodes(after) if entity_key in json_text(node)}
    ghost_edges = {
        _edge_id(edge)
        for edge in _edges(after)
        if edge.get("source") in removed_node_ids or edge.get("target") in removed_node_ids
    }
    ghosts = ghost_nodes | ghost_edges
    if ghosts:
        raise ReceiptError(f"deletion left ghost nodes/edges: {sorted(ghosts)[:5]}")
    return {"removed": sorted(removed_edge_ids | removed_node_ids), "ghosts": []}


def _node_id(node: Mapping[str, object]) -> str:
    return str(node.get("id") or node.get("node_id") or "")


def _edge_id(edge: Mapping[str, object]) -> str:
    return str(edge.get("id") or f"{edge.get('source')}->{edge.get('target')}")


def json_text(value: object) -> str:
    import json

    return json.dumps(value, default=str)

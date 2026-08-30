"""Schema-bound deterministic control-graph materialization.

Host access belongs to ``control_reconcile.py``. This module only compares
already-redacted evidence and emits immutable JSON data.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping

from jsonschema import Draft202012Validator

from .control_plane import (
    ControlContractError,
    canonical_bytes,
    canonical_sha256,
    require_canonical_stable_id,
)

RECONCILIATION_RESULTS = frozenset({
    "match", "missing_runtime", "undeclared_runtime", "revision_mismatch",
    "config_hash_mismatch", "route_mismatch", "unit_mismatch", "unparseable",
    "inaccessible", "stale",
})
RELATIONSHIPS = frozenset({
    "contains", "owns", "runs", "exposes", "routes_to", "reads", "writes",
    "depends_on", "uses", "executes", "declares", "produces", "consumes",
    "validates", "deploys", "observes", "replaces",
})
NODE_KINDS = frozenset({
    "host", "edge", "route", "service", "container", "systemd_unit", "repo",
    "checkout", "project", "component", "capability", "rule", "skill", "tool",
    "plugin", "cli", "mcp", "app", "library", "template", "worker",
    "data_store", "volume", "artifact", "deployment", "release", "observer",
    "source", "evidence_receipt", "cleanup_finding", "change_proposal",
    "observed-only/unclassified",
})
DEFAULT_STATE = {
    "lifecycle": "approved", "trust": "reviewed", "installation": "installed",
    "enablement": "disabled", "production_authority": "read_only",
}
STRUCTURAL_FIELDS = frozenset({
    "id", "kind", "state_axes", "evidence_receipt_ids", "observed_required_fields",
})
RUNTIME_PREDICATE = re.compile(
    r"(?:^presence$|status|health|revision|commit|sha|hash|image|route|url|"
    r"endpoint|unit|listener|active|enabled|fresh|backup|queue|worker|error)",
    re.I,
)
SAFE_SCOPE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_REPOSITORY_ROOT = Path(
    os.environ.get("FRANK_REPOSITORY_ROOT", str(Path(__file__).resolve().parents[3]))
).resolve()
_GRAPH_SCHEMA = _REPOSITORY_ROOT / "governance" / "control-plane" / "schema" / "graph.schema.json"
_CATALOG_SCHEMA = _REPOSITORY_ROOT / "governance" / "control-plane" / "schema" / "catalog.schema.json"
_SENSITIVE_FIELD = re.compile(
    r"(?:^|_)(?:authorization|bearer|cookie|credential|instruction|password|passwd|prompt|"
    r"private[_-]?key|secret|token|full[_-]?text|body|content)(?:$|_)", re.I,
)
_SECRET_VALUE = re.compile(
    r"(?i)(authorization\s*:\s*bearer|bearer|password|passwd|token|secret|api[_-]?key|"
    r"private[_-]?key|credential|cookie)\s*[:=]\s*[^\s,;]+"
)


def _sensitive_field(key: str) -> bool:
    return key != "content_hash" and bool(_SENSITIVE_FIELD.search(key))


def _normalized_source_bytes(path: Path) -> bytes:
    return path.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def _unique(values: Iterable[Any], label: str) -> None:
    seen: set[Any] = set()
    duplicates: set[Any] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    if duplicates:
        raise ControlContractError(f"duplicate {label} IDs: {sorted(duplicates)}")


def _stable(value: Any) -> str:
    return require_canonical_stable_id(value)


def _safe_assertion_value(value: Any, *, key: str | None = None) -> Any:
    """Copy only metadata-safe values into persisted assertion evidence.

    Catalog nodes are allowed to carry rich source metadata, but assertion
    values are durable and must never become a side channel for source bodies
    or credentials.  Hash fields are explicitly retained; body-like fields are
    dropped recursively and scalar metadata is bounded/redacted.
    """
    if key and _sensitive_field(key):
        return None
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for child_key, child_value in value.items():
            if not isinstance(child_key, str):
                continue
            safe = _safe_assertion_value(child_value, key=child_key)
            if safe is not None:
                result[child_key] = safe
        return result
    if isinstance(value, list):
        return [_safe_assertion_value(item) for item in value]
    if isinstance(value, str):
        cleaned = _SECRET_VALUE.sub(r"\1=[REDACTED]", value)
        cleaned = re.sub(r"[\x00-\x1f\x7f]", " ", cleaned).strip()
        return cleaned[:4096]
    return copy.deepcopy(value)


def ensure_persisted_metadata_safe(value: Any) -> None:
    """Reject sensitive field names at the immutable storage boundary."""
    if isinstance(value, Mapping):
        for key, child in value.items():
            if isinstance(key, str) and _sensitive_field(key):
                raise ControlContractError("sensitive or instruction body cannot be persisted")
            ensure_persisted_metadata_safe(child)
    elif isinstance(value, list):
        for child in value:
            ensure_persisted_metadata_safe(child)


def _receipt_ids(values: Iterable[str], *, fallback: Iterable[str] = ()) -> list[str]:
    result = list(values) or list(fallback)
    if not result:
        raise ControlContractError("evidence receipt IDs must not be empty")
    for value in result:
        if not isinstance(value, str) or not value.startswith("receipt:"):
            raise ControlContractError("invalid evidence receipt ID")
        _stable(value)
    if len(set(result)) != len(result):
        raise ControlContractError("evidence receipt IDs must be unique")
    return sorted(result)


_SHA256 = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")


def _validated_hash_map(value: Mapping[str, Any] | None, *, allowed_ids: Iterable[str], label: str) -> dict[str, str]:
    """Validate a receipt/evidence hash map before it enters durable provenance.

    The collector may use bare hex digests for filesystem pointers while the
    control schemas use ``sha256:`` digests.  Accept both forms but preserve
    the exact supplied representation: the manifest is an audit record, not a
    lossy normalization layer.  Reject keys that are not actually part of
    this materialization so unrelated evidence cannot be smuggled in.
    """
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise ControlContractError(f"{label} must be an object")
    allowed = set(allowed_ids)
    result: dict[str, str] = {}
    for key, digest in value.items():
        if not isinstance(key, str) or key not in allowed:
            raise ControlContractError(f"{label} contains an unknown receipt ID")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise ControlContractError(f"{label} contains an invalid SHA-256 digest")
        result[key] = digest
    return dict(sorted(result.items()))


def _observation_metadata(receipt: Mapping[str, Any] | None) -> dict[str, Any]:
    """Copy only the frozen observation freshness envelope.

    Freshness is evidence metadata, not a health assertion.  We retain an
    explicitly supplied value and never infer freshness from wall-clock time
    during graph generation (which would make equal inputs nondeterministic).
    """
    if not isinstance(receipt, Mapping):
        return {}
    result: dict[str, Any] = {}
    captured = receipt.get("captured_at", receipt.get("observed_at"))
    if isinstance(captured, str) and captured:
        try:
            datetime.fromisoformat(captured.replace("Z", "+00:00"))
        except ValueError as error:
            raise ControlContractError("observation captured_at is not date-time") from error
        result["captured_at"] = captured
    if "fresh_until" in receipt:
        fresh_until = receipt.get("fresh_until")
        if fresh_until is None or (isinstance(fresh_until, str) and fresh_until):
            if isinstance(fresh_until, str):
                try:
                    datetime.fromisoformat(fresh_until.replace("Z", "+00:00"))
                except ValueError as error:
                    raise ControlContractError("observation fresh_until is not date-time") from error
            result["fresh_until"] = fresh_until
    for key, allowed in (
        ("freshness", {"fresh", "stale", "unavailable", "unknown"}),
        ("confidence", {"high", "medium", "low", "none"}),
    ):
        value = receipt.get(key)
        if value in allowed:
            result[key] = value
    return result


def _observed_id(record: Mapping[str, Any]) -> str:
    identity = {
        key: record[key]
        for key in sorted(record)
        if key in {"kind", "name", "path", "unit", "identity"}
    }
    if not identity:
        identity = {"record_hash": canonical_sha256(record)}
    return "finding:observed-only/" + hashlib.sha256(canonical_bytes(identity)).hexdigest()[:24]


def _status(predicate: str, declared: Any, observed: Any) -> str:
    if isinstance(observed, Mapping):
        explicit = observed.get("status")
        if explicit in {"inaccessible", "unavailable", "error", "timeout"}:
            return "inaccessible"
        if explicit in {"stale", "revision_mismatch", "unparseable"}:
            return str(explicit)
    if declared is None and observed is not None:
        return "undeclared_runtime"
    if observed is None:
        return "missing_runtime"
    if declared == observed:
        return "match"
    name = predicate.lower()
    if "revision" in name or "commit" in name or name.endswith("sha"):
        return "revision_mismatch"
    if "config" in name or "hash" in name or "image" in name:
        return "config_hash_mismatch"
    if "route" in name or "url" in name or "endpoint" in name:
        return "route_mismatch"
    if "unit" in name or "active" in name or "enabled" in name:
        return "unit_mismatch"
    return "unparseable"


def _records(
    source: Mapping[str, Any] | None, *, observed: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if source is None:
        return [], []
    if not isinstance(source, Mapping):
        raise ControlContractError("graph input must be an object")
    raw_nodes = source.get("nodes", [])
    raw_edges = source.get("relationships", source.get("edges", []))
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise ControlContractError("graph nodes and edges must be arrays")
    nodes: list[dict[str, Any]] = []
    for raw in raw_nodes:
        if not isinstance(raw, Mapping):
            raise ControlContractError("graph node must be an object")
        node = copy.deepcopy(dict(raw))
        if observed and "id" not in node:
            node["id"] = _observed_id(node)
        if "id" not in node:
            raise ControlContractError("graph node ID is required")
        node["id"] = _stable(node["id"])
        nodes.append(node)
    edges: list[dict[str, Any]] = []
    for raw in raw_edges:
        if not isinstance(raw, Mapping):
            raise ControlContractError("graph edge must be an object")
        edge = copy.deepcopy(dict(raw))
        if "id" not in edge:
            edge["id"] = "edge:observed/" + hashlib.sha256(canonical_bytes(edge)).hexdigest()[:24]
        edge["id"] = _stable(edge["id"])
        if "from" not in edge or "to" not in edge:
            raise ControlContractError("graph edge endpoints are required")
        edge["from"] = _stable(edge["from"])
        edge["to"] = _stable(edge["to"])
        edge["relationship"] = edge.get("relationship", edge.pop("type", "depends_on"))
        if edge["relationship"] not in RELATIONSHIPS:
            raise ControlContractError("relationship type is not closed")
        edges.append(edge)
    _unique((node["id"] for node in nodes), "node")
    _unique((edge["id"] for edge in edges), "edge")
    return nodes, edges


def _node_receipts(node: Mapping[str, Any], defaults: Iterable[str]) -> list[str]:
    return _receipt_ids(node.get("evidence_receipt_ids", ()), fallback=defaults)


def _assertions(
    nodes: Iterable[Mapping[str, Any]], layer: str, defaults: Iterable[str],
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for node in nodes:
        receipts = _node_receipts(node, defaults)
        output.append({
            "subject_id": node["id"], "predicate": "presence", "scope_id": node["id"],
            "layer": layer, "value": True, "evidence_receipt_ids": receipts,
        })
        for predicate, value in sorted(node.items()):
            if predicate in STRUCTURAL_FIELDS or predicate.startswith("_"):
                continue
            if not isinstance(predicate, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", predicate):
                raise ControlContractError("invalid assertion predicate")
            if _sensitive_field(predicate):
                continue
            output.append({
                "subject_id": node["id"], "predicate": predicate, "scope_id": node["id"],
                "layer": layer, "value": _safe_assertion_value(value),
                "evidence_receipt_ids": receipts,
            })
    return output


def _validate_graph(graph: Mapping[str, Any]) -> None:
    try:
        schema = json.loads(_GRAPH_SCHEMA.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ControlContractError("control graph schema is unavailable") from error
    errors = sorted(Draft202012Validator(schema).iter_errors(graph), key=lambda item: list(item.path))
    if errors:
        location = "/".join(str(part) for part in errors[0].path) or "<root>"
        raise ControlContractError(f"graph schema validation failed at {location}: {errors[0].message}")


def _validate_catalog(catalog: Mapping[str, Any]) -> None:
    """Validate the persisted collector catalog, including identity uniqueness."""
    try:
        schema = json.loads(_CATALOG_SCHEMA.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ControlContractError("control catalog schema is unavailable") from error
    errors = sorted(Draft202012Validator(schema).iter_errors(catalog), key=lambda item: list(item.path))
    if errors:
        location = "/".join(str(part) for part in errors[0].path) or "<root>"
        raise ControlContractError(f"catalog schema validation failed at {location}: {errors[0].message}")
    _unique((node["id"] for node in catalog["nodes"]), "catalog node")
    _unique((edge["id"] for edge in catalog["relationships"]), "catalog relationship")


def materialize_control_graph(
    declared: Mapping[str, Any], observed: Mapping[str, Any] | None = None, *,
    receipt_ids: Iterable[str] = (), observation_receipt_ids: Iterable[str] = (),
    evidence_receipt_ids: Iterable[str] = (),
    receipt_hashes: Mapping[str, str] | None = None,
    declared_receipt_hashes: Mapping[str, str] | None = None,
    observation_receipt_hashes: Mapping[str, str] | None = None,
    evidence_receipt_hashes: Mapping[str, str] | None = None,
    evidence_hashes: Mapping[str, str] | None = None,
    declared_evidence_hashes: Mapping[str, str] | None = None,
    source_revision_set: Mapping[str, str] | None = None,
    deployed_revision_set: Mapping[str, str] | None = None,
    schema_version: int = 1, schema_hash: str | None = None,
    generator_version: str = "1", generator_hash: str | None = None,
    aliases: Mapping[str, str] | None = None,
    observation_metadata: Mapping[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Return deterministic ``(graph, assertion_bundle, manifest)`` values."""
    if schema_version != 1:
        raise ControlContractError("unsupported control graph schema version")
    declared_input = tuple(receipt_ids)
    observed_input = tuple(observation_receipt_ids)
    evidence_input = tuple(evidence_receipt_ids)
    for values in (declared_input, observed_input, evidence_input):
        if len(set(values)) != len(values):
            raise ControlContractError("receipt arrays must be unique")
        for receipt in values:
            _receipt_ids((receipt,))

    declared_nodes, declared_edges = _records(declared)
    observed_nodes, observed_edges = _records(observed, observed=True)
    declared_ids = {node["id"] for node in declared_nodes}
    initial_observed_ids = {node["id"] for node in observed_nodes}
    all_input_ids = declared_ids | initial_observed_ids
    alias_map = dict(aliases or {})
    for alias, canonical in alias_map.items():
        _stable(alias)
        _stable(canonical)
        if alias == canonical or canonical not in all_input_ids or alias_map.get(canonical):
            raise ControlContractError("invalid or chained identity alias")
    for node in observed_nodes:
        node["id"] = alias_map.get(node["id"], node["id"])
    for edge in observed_edges:
        edge["from"] = alias_map.get(edge["from"], edge["from"])
        edge["to"] = alias_map.get(edge["to"], edge["to"])
    _unique((node["id"] for node in observed_nodes), "observed node after alias resolution")
    observed_ids = {node["id"] for node in observed_nodes}
    all_input_ids = declared_ids | observed_ids
    if any(node.get("identity_conflict") for node in observed_nodes if node["id"] in declared_ids):
        raise ControlContractError("declared/observed identity conflict")
    hermes_ids: set[str] = set()
    for node in declared_nodes + observed_nodes:
        is_authority = node["id"].startswith("runtime:hermes") or node.get("authority") in {
            "hermes", "runtime:hermes-default",
        }
        if is_authority:
            hermes_ids.add(alias_map.get(node["id"], node["id"]))
    if len(hermes_ids) > 1:
        raise ControlContractError("more than one Hermes runtime/authority")

    catalog_receipts = {
        receipt
        for item in declared_nodes + declared_edges
        for receipt in item.get("evidence_receipt_ids", ())
    }
    declared_defaults = _receipt_ids(
        sorted(set(declared_input) | catalog_receipts),
        fallback=("receipt:control/declared",),
    )
    observed_defaults = _receipt_ids(observed_input, fallback=("receipt:control/observed",))

    # Hashes are part of the graph identity.  Validate them after defaults
    # have been resolved so catalog-declared receipt references are accepted,
    # while unrelated evidence cannot be smuggled into the manifest.
    all_receipt_ids = set(declared_defaults) | set(observed_defaults) | set(evidence_input)
    general_hashes = _validated_hash_map(receipt_hashes, allowed_ids=all_receipt_ids, label="receipt_hashes")
    declared_hash_map = _validated_hash_map(
        declared_receipt_hashes, allowed_ids=set(declared_defaults), label="declared_receipt_hashes",
    )
    observation_hash_map = _validated_hash_map(
        observation_receipt_hashes, allowed_ids=set(observed_defaults), label="observation_receipt_hashes",
    )
    evidence_hash_map: dict[str, str] = {}
    for label, candidate in (
        ("evidence_receipt_hashes", evidence_receipt_hashes),
        ("evidence_hashes", evidence_hashes),
        ("declared_evidence_hashes", declared_evidence_hashes),
    ):
        for key, value in _validated_hash_map(
            candidate, allowed_ids=set(evidence_input) | set(declared_defaults), label=label,
        ).items():
            if key in evidence_hash_map and evidence_hash_map[key] != value:
                raise ControlContractError("evidence hash maps disagree")
            evidence_hash_map[key] = value
    evidence_hash_map = dict(sorted(evidence_hash_map.items()))
    for key, value in (*declared_hash_map.items(), *observation_hash_map.items(), *evidence_hash_map.items()):
        prior = general_hashes.get(key)
        if prior is not None and prior != value:
            raise ControlContractError("receipt hash maps disagree")
        general_hashes[key] = value
    metadata = _observation_metadata(observation_metadata)

    nodes: list[dict[str, Any]] = []
    for node in sorted(declared_nodes, key=lambda item: item["id"]):
        kind = node.get("kind", "component")
        if kind not in NODE_KINDS:
            raise ControlContractError(f"unsupported node kind: {kind}")
        state = copy.deepcopy(DEFAULT_STATE)
        state.update(copy.deepcopy(node.get("state_axes", {})))
        nodes.append({
            "id": node["id"], "kind": kind, "state_axes": state, "layer": "declared",
            "evidence_receipt_ids": _node_receipts(node, declared_defaults),
        })
    for node in sorted(observed_nodes, key=lambda item: item["id"]):
        if node["id"] in declared_ids:
            continue
        state = copy.deepcopy(DEFAULT_STATE)
        accepted_classification = node.get("_accepted_classification") is True
        if accepted_classification:
            state.update(copy.deepcopy(node.get("state_axes", {})))
        else:
            state.update({"lifecycle": "review", "trust": "unreviewed", "production_authority": "none"})
        for key in ("freshness", "confidence"):
            if key in metadata:
                state[key] = metadata[key]
        nodes.append({
            "id": node["id"],
            "kind": node.get("kind", "observed-only/unclassified") if accepted_classification else "observed-only/unclassified",
            "state_axes": state,
            "layer": "observed", "evidence_receipt_ids": _node_receipts(node, observed_defaults),
        })

    edges: list[dict[str, Any]] = []
    declared_edge_ids = {edge["id"] for edge in declared_edges}
    edge_sources = [(edge, declared_defaults) for edge in declared_edges]
    edge_sources += [
        (edge, observed_defaults) for edge in observed_edges if edge["id"] not in declared_edge_ids
    ]
    for edge, defaults in edge_sources:
        if edge["from"] not in all_input_ids or edge["to"] not in all_input_ids:
            raise ControlContractError(f"edge has undeclared endpoint: {edge['id']}")
        edges.append({
            "id": edge["id"], "from": edge["from"], "to": edge["to"],
            "relationship": edge["relationship"],
            "evidence_receipt_ids": _receipt_ids(edge.get("evidence_receipt_ids", ()), fallback=defaults),
        })
    edges.sort(key=lambda edge: edge["id"])
    _unique((edge["id"] for edge in edges), "edge")

    assertions = _assertions(declared_nodes, "declared", declared_defaults)
    assertions.extend(_assertions(observed_nodes, "observed", observed_defaults))
    _unique(((item["subject_id"], item["predicate"], item["scope_id"], item["layer"])
             for item in assertions), "assertion")
    declared_map = {
        (item["subject_id"], item["predicate"], item["scope_id"]): item
        for item in assertions if item["layer"] == "declared"
    }
    observed_map = {
        (item["subject_id"], item["predicate"], item["scope_id"]): item
        for item in assertions if item["layer"] == "observed"
    }
    declared_by_id = {item["id"]: item for item in declared_nodes}
    comparison_keys: set[tuple[str, str, str]] = set()
    for key in set(declared_map) | set(observed_map):
        predicate = key[1]
        if predicate == "presence" or (key in declared_map and key in observed_map):
            comparison_keys.add(key)
            continue
        required = declared_by_id.get(key[0], {}).get("observed_required_fields", ())
        if key in declared_map and (predicate in required or RUNTIME_PREDICATE.search(predicate)):
            comparison_keys.add(key)
            continue
        observed_value = observed_map.get(key, {}).get("value")
        if isinstance(observed_value, Mapping) and observed_value.get("status") in {
            "inaccessible", "unavailable", "error", "timeout", "stale", "unparseable",
        }:
            comparison_keys.add(key)

    findings: list[dict[str, Any]] = []
    grouped_results: dict[tuple[str, str], list[dict[str, str]]] = {}
    grouped_receipts: dict[tuple[str, str], set[str]] = {}
    for key in sorted(comparison_keys):
        declared_assertion = declared_map.get(key)
        observed_assertion = observed_map.get(key)
        declared_value = declared_assertion.get("value") if declared_assertion else None
        observed_value = observed_assertion.get("value") if observed_assertion else None
        status = _status(key[1], declared_value, observed_value)
        group = (key[0], key[2])
        grouped_results.setdefault(group, []).append({"predicate": key[1], "status": status})
        receipts = grouped_receipts.setdefault(group, set())
        receipts.update((declared_assertion or {}).get("evidence_receipt_ids", ()))
        receipts.update((observed_assertion or {}).get("evidence_receipt_ids", ()))
        if status != "match":
            findings.append({
                "subject_id": key[0], "predicate": key[1], "scope_id": key[2],
                "reconciliation_result": status, "declared": copy.deepcopy(declared_value),
                "observed": copy.deepcopy(observed_value),
                "evidence_receipt_ids": sorted(receipts),
            })
    for (subject_id, scope_id), results in sorted(grouped_results.items()):
        assertions.append({
            "subject_id": subject_id, "predicate": "reconciliation_result",
            "scope_id": scope_id, "layer": "evidence", "value": results,
            "evidence_receipt_ids": _receipt_ids(grouped_receipts[(subject_id, scope_id)]),
        })

    assertions.sort(key=lambda item: (
        item["subject_id"], item["predicate"], item["scope_id"], item["layer"],
    ))
    findings.sort(key=lambda item: (item["subject_id"], item["predicate"], item["scope_id"]))
    _unique(((item["subject_id"], item["predicate"], item["scope_id"], item["layer"])
             for item in assertions), "assertion")
    if any(item["reconciliation_result"] not in RECONCILIATION_RESULTS for item in findings):
        raise ControlContractError("unknown reconciliation result")

    schema_digest = "sha256:" + hashlib.sha256(_normalized_source_bytes(_GRAPH_SCHEMA)).hexdigest()
    generator_digest = "sha256:" + hashlib.sha256(_normalized_source_bytes(Path(__file__))).hexdigest()
    manifest_inputs = {
        "schema_version": schema_version,
        "schema_hash": schema_hash or schema_digest,
        "generator_version": generator_version,
        "generator_hash": generator_hash or generator_digest,
        "declared_receipt_ids": declared_defaults,
        "source_revision_set": dict(sorted((source_revision_set or {}).items())),
        "deployed_revision_set": dict(sorted((deployed_revision_set or {}).items())),
        "observation_receipt_ids": sorted(observed_input),
        "evidence_receipt_ids": sorted(evidence_input),
        "receipt_hashes": general_hashes,
        "declared_receipt_hashes": declared_hash_map,
        "observation_receipt_hashes": observation_hash_map,
        "evidence_receipt_hashes": evidence_hash_map,
        "evidence_hashes": evidence_hash_map,
        "declared_evidence_hashes": evidence_hash_map,
        "observation_metadata": metadata,
    }
    revision_payload = {
        "manifest_inputs": manifest_inputs, "nodes": nodes, "edges": edges,
        "assertions": assertions,
    }
    revision = "g_" + hashlib.sha256(canonical_bytes(revision_payload)).hexdigest()
    graph = {
        "schema_version": schema_version, "graph_revision": revision,
        "nodes": nodes, "edges": edges, "assertions": assertions,
    }
    _validate_graph(graph)
    assertion_bundle = {"assertions": assertions, "findings": findings}
    manifest = {
        **manifest_inputs, "graph_revision": revision,
        "graph_hash": canonical_sha256(graph),
        "assertions_hash": canonical_sha256(assertion_bundle),
        "findings_hash": canonical_sha256(findings),
    }
    return graph, assertion_bundle, manifest


def reconcile_assertions(
    declared: Iterable[Mapping[str, Any]], observed: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    left = {(item["subject_id"], item["predicate"], item["scope_id"]): item for item in declared}
    right = {(item["subject_id"], item["predicate"], item["scope_id"]): item for item in observed}
    output: list[dict[str, Any]] = []
    for key in sorted(set(left) | set(right)):
        declared_value = left[key].get("value") if key in left else None
        observed_value = right[key].get("value") if key in right else None
        output.append({
            "subject_id": key[0], "predicate": key[1], "scope_id": key[2],
            "declared": declared_value, "observed": observed_value,
            "reconciliation_result": _status(key[1], declared_value, observed_value),
        })
    return output


def canonical_graph_hash(graph: Mapping[str, Any]) -> str:
    return canonical_sha256(graph)


_MANIFEST_INPUT_KEYS = (
    "schema_version", "schema_hash", "generator_version", "generator_hash",
    "declared_receipt_ids", "source_revision_set", "deployed_revision_set",
    "observation_receipt_ids", "evidence_receipt_ids", "receipt_hashes",
    "declared_receipt_hashes", "observation_receipt_hashes", "evidence_receipt_hashes",
    "evidence_hashes", "declared_evidence_hashes", "observation_metadata",
)


def derive_graph_revision(graph: Mapping[str, Any], manifest: Mapping[str, Any]) -> str:
    """Derive the immutable graph revision from exactly its manifest inputs."""
    if not isinstance(graph, Mapping) or not isinstance(manifest, Mapping):
        raise ControlContractError("graph and manifest must be objects")
    missing = [key for key in _MANIFEST_INPUT_KEYS if key not in manifest]
    if missing:
        raise ControlContractError(f"manifest is missing revision inputs: {', '.join(missing)}")
    manifest_inputs = {key: copy.deepcopy(manifest[key]) for key in _MANIFEST_INPUT_KEYS}
    payload = {
        "manifest_inputs": manifest_inputs,
        "nodes": graph.get("nodes"),
        "edges": graph.get("edges"),
        "assertions": graph.get("assertions"),
    }
    return "g_" + hashlib.sha256(canonical_bytes(payload)).hexdigest()


def _command_output(record: Any) -> Any:
    if not isinstance(record, Mapping):
        return record
    if record.get("status") != "ready":
        return {"status": record.get("status", "inaccessible")}
    return record.get("output", record.get("value", record.get("http_status", "ready")))


def _docker_fields(record: Any) -> dict[str, Any]:
    value = _command_output(record)
    if isinstance(value, Mapping):
        return {"runtime_status": value}
    if not isinstance(value, str):
        return {"runtime_status": "unparseable"}
    parts = value.strip().split("|")
    if len(parts) not in {5, 6}:
        return {"runtime_status": "unparseable"}
    fields = {
        "runtime_status": parts[1] or "unknown",
        "health_status": parts[2] or "unknown",
        "image_hash": parts[3] or parts[4] or "unknown",
    }
    if len(parts) == 6:
        mounts = [name for name in parts[5].split(",") if name]
        if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", name) for name in mounts):
            return {"runtime_status": "unparseable"}
        fields["mounts"] = [{"type": "volume", "name": name} for name in mounts]
    return fields


def _systemd_fields(record: Any) -> Any:
    value = _command_output(record)
    if isinstance(value, Mapping):
        return value
    if not isinstance(value, str):
        return "unparseable"
    parsed: dict[str, str] = {}
    for line in value.splitlines():
        if "=" in line:
            key, item = line.split("=", 1)
            if key in {"LoadState", "ActiveState", "SubState", "UnitFileState", "FragmentPath"}:
                parsed[key] = item
    return parsed or "unparseable"


def _runtime_name(value: Any) -> str:
    """Normalize a Docker identity for fixed, exact-name matching only."""
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


# These are the only fixed-discovery identities that prove the canonical
# Hermes runtime.  A name merely containing ``hermes`` remains an observed
# unknown unless the collector explicitly marks it as an authority.
_HERMES_CANONICAL_UNITS = frozenset({
    "hermes-broker.service", "hermes-gateway.service", "hermes-serve.service",
})
_HERMES_CANONICAL_CONTAINERS = frozenset({"hermes", "hermes-runtime", "hermes-default"})


def _explicit_hermes_identity(kind: str, name: Any, record: Any) -> str | None:
    normalized = _runtime_name(name)
    if kind == "systemd_unit" and isinstance(name, str) and name.casefold() in _HERMES_CANONICAL_UNITS:
        return "runtime:hermes-default"
    if kind == "container" and normalized in _HERMES_CANONICAL_CONTAINERS:
        return "runtime:hermes-default"
    if not isinstance(record, Mapping):
        return None
    # Explicit collector classification is authoritative; arbitrary labels,
    # image names, and substring matches are intentionally not.
    authority = record.get("authority")
    marked = record.get("hermes_authority") is True or authority in {
        "hermes", "runtime:hermes-default",
    }
    if not marked:
        return None
    if normalized in {"hermes", "hermes-runtime", "hermes-default", "hermes-broker", "hermes-gateway", "hermes-serve"}:
        return "runtime:hermes-default"
    suffix = normalized.removesuffix("-service") or "unknown"
    return f"runtime:hermes-{suffix}"


_DECLARED_VOLUME_ALIASES = {
    # These are the repository's explicit Compose names.  Prefix matching is
    # deliberately not used: an unrelated volume must stay observed-only.
    "frank-window-data": "store:frank-window-data",
    "frank_window_data": "store:frank-window-data",
    "mini-frank-projects": "store:mini-frank-projects",
    "mini_frank_projects": "store:mini-frank-projects",
    "blockwise-db": "store:blockwise-db",
    "blockwise_db": "store:blockwise-db",
    "blockwise-product-db-data": "store:blockwise-db",
    "blockwise-storage": "store:blockwise-storage",
    "blockwise_storage": "store:blockwise-storage",
    "blockwise-product-storage-data": "store:blockwise-storage",
    "blockwise-research-db": "store:blockwise-research-db",
    "blockwise_research_db": "store:blockwise-research-db",
    "coolify_research-db-data": "store:blockwise-research-db",
    "infisical-pg-data": "store:infisical-db",
    "infisical_pg_data": "store:infisical-db",
    "infisical-redis-data": "store:infisical-redis",
    "infisical_redis_data": "store:infisical-redis",
}


def _declared_volume_id(
    name: Any, record: Mapping[str, Any], declared_ids: set[str],
) -> str | None:
    """Resolve only explicit catalog stores; never infer an undeclared store."""
    candidates: list[Any] = [
        record.get(key)
        for key in (
            "canonical_id", "store_id", "application_store_id", "application_store", "target_id",
        )
    ]
    candidates.append(name)
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        if candidate in declared_ids and candidate.startswith("store:"):
            return candidate
        alias = _DECLARED_VOLUME_ALIASES.get(candidate.casefold())
        if alias in declared_ids:
            return alias
        normalized = _runtime_name(candidate)
        alias = _DECLARED_VOLUME_ALIASES.get(normalized)
        if alias in declared_ids:
            return alias
    return None


def _observed_from_facts(
    facts: Mapping[str, Any], receipt_id: str, *, declared_ids: Iterable[str] = (),
) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    relationships: list[dict[str, Any]] = []
    relationship_keys: set[tuple[str, str, str]] = set()
    declared_id_set = set(declared_ids)

    def put(stable_id: str, **values: Any) -> None:
        node = nodes.setdefault(stable_id, {"id": stable_id, "evidence_receipt_ids": [receipt_id]})
        node.update(values)

    def put_discovered(kind: str, name: Any, record: Any, *, canonical_id: str | None = None) -> None:
        """Preserve bounded discovery identities, even when undeclared."""
        if not isinstance(name, str) or not name or len(name) > 128:
            return
        payload = copy.deepcopy(dict(record)) if isinstance(record, Mapping) else {"status": record}
        payload.update({"kind": kind, "name": name})
        stable_id = canonical_id or _observed_id(payload)
        put(stable_id, **payload)

    put("vps:dedicated")
    revision = facts.get("revision", {}) if isinstance(facts.get("revision"), Mapping) else {}
    put(
        "repo:frank-production-checkout",
        source_revision=_command_output(revision.get("checkout")),
        deployed_revision=_command_output(revision.get("approved")),
    )
    containers = (
        facts.get("compose", {}).get("containers", {})
        if isinstance(facts.get("compose"), Mapping) else {}
    )
    container_map = {
        "frank-window": "service:frank-window",
        "frank-agenttrail": "observer:agenttrail-frank",
        "frank-caddy": "service:frank-caddy",
        "blockwise-product-product-app-1": "service:blockwise-app",
        "blockwise-product-product-caddy-1": "service:blockwise-caddy",
        "blockwise-product-product-auth-1": "service:blockwise-auth",
        "blockwise-product-product-rest-1": "service:blockwise-rest",
        "blockwise-product-product-db-1": "store:blockwise-db",
        "blockwise-product-product-storage-1": "store:blockwise-storage",
        "blockwise-research-db": "store:blockwise-research-db",
        "infisical-backend": "service:infisical",
        "infisical-db": "store:infisical-db",
        "infisical-redis": "store:infisical-redis",
    }
    container_ids: dict[str, str] = {}
    if isinstance(containers, Mapping):
        for name, record in sorted(containers.items()):
            stable_id = container_map.get(name)
            fields = _docker_fields(record)
            hermes_id = _explicit_hermes_identity("container", name, record)
            if hermes_id and not stable_id:
                stable_id = hermes_id
            if stable_id:
                put(stable_id, **fields)
            else:
                # Keep unknown discovery metadata bounded.  In particular,
                # never copy an inspect object (which may contain host paths
                # or environment-shaped data) into durable assertions.
                put_discovered("container", name, fields)
                stable_id = _observed_id({**fields, "kind": "container", "name": name})
            container_ids[name] = stable_id
    volumes = facts.get("compose", {}).get("volumes", {}) if isinstance(facts.get("compose"), Mapping) else {}
    volume_ids: dict[str, str] = {}
    if isinstance(volumes, Mapping):
        for name, record in sorted(volumes.items()):
            if name in {"status", "reason", "output"}:
                continue
            volume_record = record if isinstance(record, Mapping) else {}
            stable_id = _declared_volume_id(name, volume_record, declared_id_set)
            if stable_id:
                put(stable_id, volume_name=name, volume_status=_command_output(record))
            else:
                put_discovered("volume", name, record)
                payload = copy.deepcopy(dict(record)) if isinstance(record, Mapping) else {"status": record}
                payload.update({"kind": "volume", "name": name})
                stable_id = _observed_id(payload)
            volume_ids[name] = stable_id

    def add_uses(source: Any, target: str, *, volume_name: str, destination: Any = None) -> None:
        if not isinstance(source, str):
            return
        source_id = container_ids.get(source, source if source in declared_id_set else None)
        if source_id is None or (target not in nodes and target not in declared_id_set):
            return
        key = (source_id, target, "uses")
        if key in relationship_keys:
            return
        relationship_keys.add(key)
        suffix = hashlib.sha256(canonical_bytes({
            "from": source_id, "to": target, "relationship": "uses",
            "volume": volume_name, "destination": destination,
        })).hexdigest()[:24]
        relationships.append({
            "id": f"edge:runtime/mount-{suffix}", "from": source_id, "to": target,
            "relationship": "uses", "evidence_receipt_ids": [receipt_id],
        })

    def mount_name(mount: Mapping[str, Any]) -> str | None:
        for key in ("name", "Name", "volume", "Volume", "source", "Source"):
            value = mount.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    # Docker inspect receipts may include a bounded mounts list on a fixed
    # container record.  Only the named volume identity and destination are
    # consumed; host source paths and configuration are never persisted.
    if isinstance(containers, Mapping):
        for container_name, record in sorted(containers.items()):
            if not isinstance(record, Mapping):
                continue
            parsed = _docker_fields(record)
            mounts = record.get("mounts", record.get("Mounts", parsed.get("mounts", ())))
            if not isinstance(mounts, list):
                continue
            for mount in mounts:
                if not isinstance(mount, Mapping):
                    continue
                if str(mount.get("type", mount.get("Type", "volume"))).casefold() != "volume":
                    continue
                name = mount_name(mount)
                if name is None:
                    continue
                target = volume_ids.get(name)
                if target is None:
                    # An inspect record can name a volume omitted from the
                    # top-level discovery map; preserve it as observed-only.
                    put_discovered("volume", name, {"status": "inaccessible", "reason": "volume not in discovery"})
                    payload = {"kind": "volume", "name": name, "status": "inaccessible", "reason": "volume not in discovery"}
                    target = _observed_id(payload)
                    volume_ids[name] = target
                add_uses(container_name, target, volume_name=name, destination=mount.get("destination", mount.get("Destination")))

    # A redacted volume record may carry relationship identities directly.
    # This supports fixed receipts without requiring a Docker socket.
    if isinstance(volumes, Mapping):
        for name, record in sorted(volumes.items()):
            if name in {"status", "reason", "output"} or not isinstance(record, Mapping):
                continue
            target = volume_ids.get(name)
            if target is None:
                continue
            for field in ("mounted_by", "mountedBy", "used_by", "usedBy"):
                users = record.get(field, ())
                if isinstance(users, str):
                    users = [users]
                if not isinstance(users, list):
                    continue
                for user in users:
                    add_uses(user, target, volume_name=name)
    units = facts.get("systemd", {}) if isinstance(facts.get("systemd"), Mapping) else {}
    unit_map = {
        "agenttrail-only-process-frank.service": "observer:agenttrail-frank",
        "agenttrail-only-process-hermes.service": "observer:agenttrail-hermes",
        "agenttrail-only-process-blockwise.service": "observer:agenttrail-blockwise",
        "hermes-gateway.service": "runtime:hermes-default",
        "hermes-serve.service": "runtime:hermes-default",
        "hindsight-frank-proxy.service": "service:hindsight",
        "hindsight-frank-proxy.socket": "service:hindsight",
        "frank-control-reconcile-fast.service": "run:reconciliation",
        "frank-control-reconcile-full.service": "run:reconciliation",
    }
    if isinstance(units, Mapping):
        for unit, record in sorted(units.items()):
            if unit in {"status", "reason", "output", "unit_discovery"}:
                continue
            stable_id = unit_map.get(unit)
            hermes_id = _explicit_hermes_identity("systemd_unit", unit, record)
            if hermes_id and unit not in unit_map:
                stable_id = hermes_id
            if stable_id:
                key = f"unit_{hashlib.sha256(unit.encode()).hexdigest()[:8]}"
                put(stable_id, **{key: _systemd_fields(record)})
            else:
                put_discovered("systemd_unit", unit, {"runtime_status": _systemd_fields(record)})
    endpoint_map = {
        "http://127.0.0.1:18080/api/health": "route:frank-loopback",
        "https://frank.fail/frank/": "route:frank-public",
        "https://blockwise.sale/api/health": "route:blockwise-health",
    }
    health = facts.get("health", {}) if isinstance(facts.get("health"), Mapping) else {}
    if isinstance(health, Mapping):
        for endpoint, record in sorted(health.items()):
            stable_id = endpoint_map.get(endpoint)
            if stable_id:
                put(stable_id, route_url=endpoint, route_status=_command_output(record))
    identity = facts.get("identity", {}) if isinstance(facts.get("identity"), Mapping) else {}
    project_checkouts = identity.get("project_checkouts", {}) if isinstance(identity, Mapping) else {}
    known_projects = {"frank", "mini-frank", "blockwise"}
    if isinstance(project_checkouts, Mapping):
        for name, record in sorted(project_checkouts.items()):
            if name in {"status", "reason", "output"}:
                continue
            canonical_id = f"project:{name.casefold()}" if name.casefold() in known_projects else None
            put_discovered("project", name, record, canonical_id=canonical_id)
    capabilities = facts.get("capabilities", {})
    inventory = capabilities.get("inventory", {}) if isinstance(capabilities, Mapping) else {}
    # The complete inventory retains candidates for audit, but only explicitly
    # accepted records may become graph capability nodes.
    records = inventory.get("accepted_records", []) if isinstance(inventory, Mapping) else []
    if isinstance(records, list):
        for record in records:
            if not isinstance(record, Mapping) or not isinstance(record.get("id"), str):
                continue
            copied = {
                key: copy.deepcopy(value)
                for key, value in record.items()
                if key != "evidence_receipt_ids"
            }
            copied["_accepted_classification"] = True
            copied["evidence_receipt_ids"] = sorted(
                set(record.get("evidence_receipt_ids", ())) | {receipt_id}
            )
            nodes[copied["id"]] = copied
    explicit_unknown = facts.get("observed_only", [])
    if isinstance(explicit_unknown, list):
        for item in explicit_unknown:
            if isinstance(item, Mapping):
                copied = copy.deepcopy(dict(item))
                copied.setdefault("evidence_receipt_ids", [receipt_id])
                copied.setdefault("id", _observed_id(copied))
                nodes[copied["id"]] = copied
    relationships.sort(key=lambda edge: edge["id"])
    return {"nodes": sorted(nodes.values(), key=lambda item: item["id"]), "relationships": relationships}


def graph_from_collector_receipt(
    declared_catalog: Mapping[str, Any], receipt: Mapping[str, Any], **kwargs: Any,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Materialize a graph from the collector's persisted success shape."""
    if not isinstance(declared_catalog, Mapping):
        raise ControlContractError("collector catalog is not an object")
    _validate_catalog(declared_catalog)
    if not isinstance(receipt, Mapping) or receipt.get("status") != "success":
        raise ControlContractError("collector receipt is not successful")
    facts = receipt.get("facts")
    if not isinstance(facts, Mapping):
        raise ControlContractError("collector receipt lacks facts")
    scope = str(receipt.get("scope", ""))
    if not SAFE_SCOPE.fullmatch(scope):
        raise ControlContractError("collector receipt has an invalid scope")
    receipt_id = receipt.get("receipt_id")
    if not isinstance(receipt_id, str):
        fingerprint = hashlib.sha256(canonical_bytes({
            "scope": scope, "run_id": receipt.get("run_id"),
            "input_fingerprint": receipt.get("input_fingerprint"),
        })).hexdigest()[:32]
        receipt_id = f"receipt:reconciliation/{scope}/{fingerprint}"
    _receipt_ids((receipt_id,))
    # A receipt passed from the immutable pipeline is itself evidence.  Bind
    # its canonical digest by default; callers loading the on-disk envelope
    # may provide the exact file digest through ``receipt_hashes``.
    receipt_hash_map = dict(kwargs.pop("receipt_hashes", {}) or {})
    receipt_hash_map.setdefault(receipt_id, canonical_sha256(receipt))
    observed = _observed_from_facts(
        facts, receipt_id,
        declared_ids=(node["id"] for node in declared_catalog.get("nodes", ()) if isinstance(node, Mapping)),
    )
    observation_metadata = _observation_metadata(receipt)
    if observation_metadata:
        # Graph nodes are intentionally frozen to identity/state/evidence
        # fields.  Preserve the observation envelope as ordinary observed
        # assertions on the host identity, while the manifest carries the
        # same envelope as revision provenance.
        for node in observed.get("nodes", []):
            if isinstance(node, dict) and node.get("id") == "vps:dedicated":
                node.update(observation_metadata)
                break
    revision = facts.get("revision", {}) if isinstance(facts.get("revision"), Mapping) else {}
    source_revisions = dict(kwargs.pop("source_revision_set", {}) or {})
    deployed_revisions = dict(kwargs.pop("deployed_revision_set", {}) or {})
    checkout = _command_output(revision.get("checkout"))
    approved = _command_output(revision.get("approved"))
    if isinstance(checkout, str):
        source_revisions.setdefault("repo:frank-production-checkout", checkout)
    if isinstance(approved, str):
        deployed_revisions.setdefault("release:frank", approved)
    declared_receipts = tuple(kwargs.pop("receipt_ids", ()))
    observation_receipts = tuple(kwargs.pop("observation_receipt_ids", ()))
    return materialize_control_graph(
        declared_catalog, observed, receipt_ids=declared_receipts,
        observation_receipt_ids=tuple(sorted(set(observation_receipts) | {receipt_id})),
        source_revision_set=source_revisions, deployed_revision_set=deployed_revisions,
        receipt_hashes=receipt_hash_map,
        observation_metadata=kwargs.pop("observation_metadata", receipt),
        **kwargs,
    )

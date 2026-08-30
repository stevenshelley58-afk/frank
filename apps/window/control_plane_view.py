"""Read-only Step 5 Window integration for Live, Map, and Control.

The control plane is a projection at the Window boundary.  This module wires
the frozen graph/map/runtime providers together, but owns no collector, action
adapter, or durable source data.  Every response is deliberately metadata-only
and feature flags remain disabled unless an explicit preview/release setting
enables a surface.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

import yaml
from flask import Blueprint, Response, abort, jsonify, request
from werkzeug.exceptions import HTTPException

from graph.control_plane import ControlContractError, id_key, stable_id_from_key
from graph.control_provider import ControlProvider
from graph.control_store import ControlGraphStore
from graph.map_artifacts import MapArtifactProvider, MapArtifactStore
from runtime_evidence import BeszelProvider, HealthProvider, RuntimeEvidenceAdapter, RuntimeEvidenceError, RuntimeProvider
from action_dispatcher import HermesDispatcher, DispatchError


api = Blueprint("control_plane_view", __name__)

def _repository_root() -> Path:
    configured = os.environ.get("FRANK_REPOSITORY_ROOT", "").strip()
    if configured:
        return Path(configured)
    here = Path(__file__).resolve()
    for candidate in (here.parent, *here.parents):
        if (candidate / "governance" / "control-plane").is_dir():
            return candidate
    # Container images place this module directly under /app.
    return here.parent

REPOSITORY_ROOT = _repository_root()
CONTROL_ROOT = REPOSITORY_ROOT / "governance" / "control-plane"
FLAGS_PATH = CONTROL_ROOT / "feature-flags.yaml"
PROJECTIONS_PATH = CONTROL_ROOT / "projections.yaml"
ALIASES_PATH = CONTROL_ROOT / "aliases.yaml"
SENSITIVE = re.compile(r"(?i)(?:password|passphrase|secret|token|api[_-]?key|private[_-]?key|credential|authorization|cookie|prompt|full[_-]?text|body|content)")
SYSTEMS = frozenset({"host", "edge", "route", "service", "container", "systemd_unit", "repo", "checkout", "project", "component", "worker", "data_store", "volume", "artifact", "deployment", "release", "observer", "source"})
CAPABILITIES = frozenset({"capability", "rule", "skill", "tool", "plugin", "cli", "mcp", "app", "library", "template", "agent", "bundle", "eval", "runtime_policy"})
PROJECTION_ORDER = ("projection:vps/world", "projection:frank/architecture", "projection:blockwise/runtime", "projection:mini-frank/knowledge-flow", "projection:ad-template-builder/architecture", "projection:ad-template-builder/workflow", "projection:ad-template-builder/data-flow")


@api.errorhandler(HTTPException)
def _api_error(error: HTTPException):
    return jsonify({"error": error.description}), error.code


class _UnavailableRuntime(RuntimeProvider):
    name = "unavailable"

    def observe(self, system_id: str) -> Mapping[str, Any]:
        # A missing provider is an unavailable observation, not a malformed
        # request.  The frozen adapter turns transport failures into its
        # explicit unavailable summary while still rejecting bad system IDs.
        raise OSError("runtime provider is unavailable")


def _configured_path(name: str, fallback: Path) -> Path:
    value = os.environ.get(name, "").strip()
    return Path(value) if value else fallback


def _load_yaml(path: Path, fallback: Any) -> Any:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
        return value if value is not None else fallback
    except (OSError, UnicodeError, yaml.YAMLError):
        return fallback


def _flag_defaults() -> dict[str, bool]:
    value = _load_yaml(FLAGS_PATH, {})
    defaults = value.get("defaults", {}) if isinstance(value, Mapping) else {}
    return {str(key): bool(item) for key, item in defaults.items() if isinstance(key, str)}


def feature_flags() -> dict[str, bool]:
    """Resolve flags without allowing arbitrary environment keys.

    ``FRANK_PREVIEW=1`` is the controlled preview promotion switch.  Explicit
    per-flag variables are useful for release receipts and independently
    reversible rollback; neither changes the declared defaults on disk.
    """
    defaults = _flag_defaults()
    preview = os.environ.get("FRANK_PREVIEW", "").strip().lower() in {"1", "true", "yes"}
    for name, default in defaults.items():
        enabled = default
        if preview and name in {"live_view", "map_view", "control_read", "reconciliation_schedules"}:
            enabled = True
        if preview and name == "runtime_monitoring" and _runtime_provider_ready():
            enabled = True
        raw = os.environ.get(f"FRANK_FEATURE_FLAG_{name.upper()}")
        if raw is not None:
            enabled = raw.strip().lower() in {"1", "true", "yes", "on"}
        defaults[name] = enabled
    return defaults


def _runtime_provider_ready() -> bool:
    """Apply the runtime promotion gate without making a network request."""
    if os.environ.get("RUNTIME_PROVIDER_MODE", "").strip().lower() == "health":
        try: HealthProvider({"frank": os.environ.get("RUNTIME_HEALTH_FRANK_URL", ""), "blockwise": os.environ.get("RUNTIME_HEALTH_BLOCKWISE_URL", "")}, _fetch_runtime)
        except RuntimeEvidenceError: return False
        return True
    base = os.environ.get("RUNTIME_PROVIDER_URL", "").strip()
    if not base:
        return False
    try:
        BeszelProvider(base, _fetch_runtime)
    except RuntimeEvidenceError:
        return False
    return True


def _enabled(name: str) -> bool:
    return bool(feature_flags().get(name, False))


def _control_provider() -> ControlProvider:
    root = _configured_path("CONTROL_GRAPH_ROOT", Path(os.environ.get("CHAT_STORE_DIR", "/data")) / "control-graph")
    return ControlProvider(ControlGraphStore(root))


def _preview_key() -> str:
    return os.environ.get("MAP_PREVIEW_RUN_KEY", "run:step5-preview").strip() or "run:step5-preview"


def _map_provider() -> MapArtifactProvider:
    root = _configured_path("MAP_ARTIFACT_ROOT", Path(os.environ.get("CHAT_STORE_DIR", "/data")) / "maps")
    return MapArtifactProvider(MapArtifactStore(root), _preview_key())


def _fetch_runtime(url: str) -> Mapping[str, Any]:
    """Fetch one already-validated Beszel URL with a bounded response."""
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=3) as response:
        if response.geturl() != url: raise OSError("runtime provider redirect rejected")
        if getattr(response, "status", 200) != 200: raise OSError("runtime provider returned non-success")
        if "json" not in response.headers.get("Content-Type", "application/json").lower(): raise OSError("runtime provider returned non-json")
        result = json.loads(response.read(256 * 1024 + 1).decode("utf-8"))
    if not isinstance(result, Mapping):
        raise OSError("runtime provider response is not an object")
    return result


def _runtime_adapter() -> RuntimeEvidenceAdapter:
    base = os.environ.get("RUNTIME_PROVIDER_URL", "").strip()
    if base:
        try:
            provider: RuntimeProvider = BeszelProvider(base, _fetch_runtime)
        except RuntimeEvidenceError:
            # Invalid or public endpoints never become a promoted provider.
            provider = _UnavailableRuntime()
    else:
        provider = _UnavailableRuntime()
    revisions = {}
    for system in ("frank", "blockwise"):
        value = os.environ.get(f"RUNTIME_{system.upper()}_REVISION", "").strip()
        if value:
            revisions[system] = value
    if os.environ.get("RUNTIME_PROVIDER_MODE", "").strip().lower() == "health":
        try: provider = HealthProvider({"frank": os.environ.get("RUNTIME_HEALTH_FRANK_URL", ""), "blockwise": os.environ.get("RUNTIME_HEALTH_BLOCKWISE_URL", "")}, _fetch_runtime, revisions)
        except RuntimeEvidenceError: provider = _UnavailableRuntime()
        return RuntimeEvidenceAdapter(provider, release_revisions=revisions, evidence_base_url=os.environ.get("RUNTIME_EVIDENCE_URL", "").strip() or None)
    return RuntimeEvidenceAdapter(
        provider,
        release_revisions=revisions,
        evidence_base_url=os.environ.get("RUNTIME_EVIDENCE_URL", "").strip() or None,
    )


def _safe_value(value: Any, *, depth: int = 0) -> Any:
    """Bound recursive metadata and remove body-like fields."""
    if depth > 4:
        return None
    if isinstance(value, Mapping):
        return {str(key): _safe_value(item, depth=depth + 1) for key, item in value.items() if isinstance(key, str) and not SENSITIVE.search(key)}
    if isinstance(value, list):
        return [_safe_value(item, depth=depth + 1) for item in value[:128]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:1000]
    return None


def _source_url(locator: Any) -> str | None:
    """Turn a declared repo locator into the existing read-only file view."""
    if not isinstance(locator, str) or not locator.strip():
        return None
    value = locator.strip()
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith(("/", "\\")) or ".." in Path(value).parts:
        return None
    encoded = urllib.parse.quote(value.replace("\\", "/"), safe="/")
    return f"/api/file?root=vps&path=projects/frank/{encoded}&raw=1"


def _snapshot() -> dict[str, Any]:
    try:
        result = _control_provider().get()
    except (ControlContractError, OSError):
        return {"status": "unavailable", "manifest": None, "graph": None, "assertions": None, "findings": None, "error": "control graph is unavailable"}
    return _safe_value(result)


def _projection_declarations() -> list[dict[str, Any]]:
    value = _load_yaml(PROJECTIONS_PATH, {})
    projections = value.get("projections", []) if isinstance(value, Mapping) else []
    return [dict(item) for item in projections if isinstance(item, Mapping) and isinstance(item.get("id"), str)]


def _map_rows() -> list[dict[str, Any]]:
    declarations = {item["id"]: item for item in _projection_declarations()}
    rows: dict[str, dict[str, Any]] = {}
    try:
        for item in _map_provider().list_projections():
            projection_id = str(item.get("projection_id") or "")
            manifest = item.get("manifest") if isinstance(item.get("manifest"), Mapping) else {}
            if projection_id:
                rows[projection_id] = {
                    "projection_id": projection_id,
                    "manifest": _safe_value(manifest),
                    "available": manifest.get("status", "generated") == "generated",
                    "freshness": manifest.get("freshness", "unknown"),
                    "validation_state": "current" if manifest.get("status", "generated") == "generated" else "not_current",
                }
    except (ControlContractError, OSError, ValueError):
        pass
    for projection_id, declaration in declarations.items():
        row = rows.setdefault(projection_id, {"projection_id": projection_id, "manifest": None, "available": False})
        row["title"] = projection_id.split(":", 1)[-1].replace("/", " · ").replace("-", " ").title()
        row["mandatory"] = bool(declaration.get("mandatory"))
        row["declared_status"] = declaration.get("status", "declared")
        if not row.get("available"):
            row["freshness"] = "unknown"
            row["validation_state"] = "not_current"
    order = {value: index for index, value in enumerate(PROJECTION_ORDER)}
    return [rows[key] for key in sorted(rows, key=lambda value: (order.get(value, len(order)), value))]


def _node_records(snapshot: Mapping[str, Any]) -> list[dict[str, Any]]:
    graph = snapshot.get("graph") if isinstance(snapshot.get("graph"), Mapping) else {}
    nodes = graph.get("nodes", []) if isinstance(graph, Mapping) else []
    records: list[dict[str, Any]] = []
    for node in nodes if isinstance(nodes, list) else []:
        if not isinstance(node, Mapping) or not isinstance(node.get("id"), str):
            continue
        item = dict(_safe_value(node))
        item.setdefault("title", item.get("label") or item["id"])
        item["category"] = "systems" if item.get("kind") in SYSTEMS else "capabilities" if item.get("kind") in CAPABILITIES else "changes" if item.get("kind") in {"change_proposal", "finding"} else "cleanup" if item.get("kind") == "cleanup_finding" else "capabilities"
        records.append(item)
    # Capability manifests carry the human explanation and source provenance
    # that is intentionally absent from the compact graph node.
    manifest_root = CONTROL_ROOT / "capabilities"
    manifest_by_id: dict[str, Mapping[str, Any]] = {}
    try:
        for path in sorted(manifest_root.glob("*.yaml")):
            if path.is_symlink() or not path.is_file():
                continue
            value = _load_yaml(path, {})
            if isinstance(value, Mapping) and isinstance(value.get("id"), str):
                manifest_by_id[value["id"]] = value
    except OSError:
        pass
    for record in records:
        source = manifest_by_id.get(record["id"])
        if source:
            record.update({key: _safe_value(value) for key, value in source.items() if key not in {"id", "kind", "title"}})
        try:
            record["record_url"] = f"/api/control/records/{id_key(record['id'])}"
        except ControlContractError:
            record.pop("record_url", None)
        source_url = _source_url(record.get("source_locator"))
        if source_url:
            record["source_url"] = source_url
    return records


def _resolve_alias(value: str) -> str:
    aliases = _load_yaml(ALIASES_PATH, {})
    entries = aliases.get("aliases", []) if isinstance(aliases, Mapping) else []
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, Mapping) and str(entry.get("alias", "")).lower() == value.lower():
            target = entry.get("canonical_id") or entry.get("target")
            if isinstance(target, str):
                return target
    return value


def _records(category: str, query: str, scope: str) -> list[dict[str, Any]]:
    snapshot = _snapshot()
    records = _node_records(snapshot)
    if category in {"sources", "source"}:
        records = [item for item in records if item.get("kind") in {"source", "rule", "skill"} or item.get("source_locator")]
    elif category in {"systems", "capabilities", "cleanup", "changes"}:
        records = [item for item in records if item.get("category") == category]
    needle = _resolve_alias(query).lower().strip()
    if needle:
        records = [item for item in records if needle in json.dumps(item, ensure_ascii=False).lower()]
    if scope:
        records = [item for item in records if scope in json.dumps(item, ensure_ascii=False)]
    return sorted(records, key=lambda item: (str(item.get("title", "")), str(item.get("id", ""))))


def _require_flag(name: str) -> None:
    if not _enabled(name):
        abort(404, description=f"{name} is disabled")


@api.get("/api/control/overview")
def overview():
    flags = feature_flags()
    return jsonify({"schema": "schema://frank.control-plane/v1", "feature_flags": flags, "control": _snapshot() if flags.get("control_read") else {"status": "disabled"}, "projections": _map_rows() if flags.get("map_view") else [], "live": {"enabled": bool(flags.get("live_view")), "board_url": "/agenttrail/" if flags.get("live_view") else None}, "runtime": {"enabled": bool(flags.get("runtime_monitoring")), "provider": os.environ.get("RUNTIME_PROVIDER_NAME", "beszel") if flags.get("runtime_monitoring") else None}})


@api.get("/api/control/graph")
def graph():
    _require_flag("control_read")
    return jsonify(_snapshot())


@api.get("/api/control/projections")
def projections():
    _require_flag("map_view")
    return jsonify({"schema": "schema://frank.control-projections/v1", "projections": _map_rows()})


@api.get("/api/control/projections/<key>")
def projection(key: str):
    _require_flag("map_view")
    try:
        projection_id = stable_id_from_key(key)
    except ControlContractError:
        abort(404, description="unknown projection")
    match = next((item for item in _map_rows() if item.get("projection_id") == projection_id), None)
    if match is None:
        abort(404, description="unknown projection")
    if match.get("available"):
        match["artifact_url"] = f"/api/control/maps/artifact?projection_id={urllib.parse.quote(projection_id)}"
    return jsonify({"schema": "schema://frank.control-projection/v1", "projection": match})


def _artifact_response(projection_id: str) -> Response:
    _require_flag("map_view")
    projection_id = _resolve_alias(projection_id.strip())
    if not projection_id:
        abort(404, description="projection has no generated artifact")
    try:
        resolved = _map_provider().resolve_current(projection_id)
    except (ControlContractError, FileNotFoundError, OSError, ValueError):
        abort(404, description="validated map artifact is unavailable")
    artifact = resolved.get("artifact")
    if not isinstance(artifact, bytes):
        abort(404, description="projection has no generated artifact")
    return Response(artifact, mimetype="text/html", headers={"Cache-Control": "no-store"})


@api.get("/api/control/maps/artifact")
def map_artifact():
    return _artifact_response(str(request.args.get("projection_id", "")))


@api.get("/api/control/projections/<key>/artifact")
def projection_artifact(key: str):
    try:
        projection_id = stable_id_from_key(key)
    except ControlContractError:
        abort(404, description="unknown projection")
    return _artifact_response(projection_id)


@api.get("/api/control/records")
def records():
    _require_flag("control_read")
    category = str(request.args.get("category", "")).strip().lower()
    return jsonify({"schema": "schema://frank.control-records/v1", "records": _records(category, str(request.args.get("q", "")), str(request.args.get("scope", "")).strip())})


@api.get("/api/control/records/<key>")
def record(key: str):
    _require_flag("control_read")
    try:
        stable_id = stable_id_from_key(key)
    except ControlContractError:
        abort(404, description="unknown control identity")
    matches = [item for item in _records("", stable_id, "") if item.get("id") == stable_id]
    if not matches:
        abort(404, description="unknown control identity")
    return jsonify({"schema": "schema://frank.control-record/v1", "record": matches[0]})


@api.get("/api/control/runtime/<system_id>")
def runtime(system_id: str):
    _require_flag("runtime_monitoring")
    if system_id not in {"frank", "blockwise"}:
        abort(404, description="unsupported runtime system")
    try:
        summary = _runtime_adapter().summary(system_id)
    except RuntimeEvidenceError:
        abort(503, description="runtime provider returned invalid evidence")
    return jsonify({"schema": "schema://frank.runtime-evidence/v1", "summary": summary.to_dict()})


@api.get("/api/control/export")
def export_records():
    _require_flag("control_read")
    result = _records(str(request.args.get("category", "")), str(request.args.get("q", "")), str(request.args.get("scope", "")))
    if str(request.args.get("format", "json")).lower() != "csv":
        return jsonify({"schema": "schema://frank.control-export/v1", "records": result})
    output = io.StringIO()
    fields = ["id", "kind", "title", "category", "source_locator", "source_revision", "status"]
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(result)
    return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=frank-control-export.csv", "Cache-Control": "no-store"})


@api.post("/api/control/import/preview")
def import_preview():
    _require_flag("control_read")
    if request.content_length and request.content_length > 128 * 1024:
        abort(413, description="import preview exceeds the metadata bound")
    body = request.get_json(silent=True)
    if not isinstance(body, Mapping):
        abort(400, description="import preview requires one JSON object")
    safe = _safe_value(body)
    return jsonify({"schema": "schema://frank.control-import-preview/v1", "status": "preview", "applies": False, "provenance_valid": bool(body.get("schema") or body.get("source_revision")), "preview": safe, "message": "Preview only; no canonical source or control state was changed."})

@api.post("/api/control/actions")
def dispatch_action():
    """Forward a bounded, typed request to Hermes; never execute locally."""
    flag = {"tool:refresh-evidence":"safe_actions", "tool:regenerate-map":"safe_actions"}.get(str((request.get_json(silent=True) or {}).get("action_id", "")), "operational_actions")
    _require_flag(flag)
    body = request.get_json(silent=True)
    if not isinstance(body, Mapping) or not isinstance(body.get("action_id"), str) or not isinstance(body.get("target_id"), str) or not isinstance(body.get("arguments"), Mapping): abort(400, description="typed action request required")
    try:
        attestation = request.headers.get("X-Frank-Operator-Attestation") or request.headers.get("X-Operator-Attestation", "")
        result = HermesDispatcher(CONTROL_ROOT / "actions.yaml").dispatch(action_id=body["action_id"], target_id=body["target_id"], arguments=body["arguments"], attestation=attestation)
    except DispatchError as error:
        return jsonify({"status":"preview", "applies":False, "error":str(error)}), 503
    return jsonify({"schema":"schema://frank.action-receipt/v1", **result})


__all__ = ["api", "feature_flags"]

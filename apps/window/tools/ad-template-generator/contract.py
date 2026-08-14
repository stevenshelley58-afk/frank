"""Stable Frank/Hermes boundary for the Ad Template Generator.

The functions here validate and describe work; they never call a provider or
generate pixels. Keeping this boundary small prevents Frank from becoming a
second Hermes runtime or a competing copy of the canonical generator.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Mapping


MANIFEST = json.loads((Path(__file__).resolve().parent / "manifest.json").read_text(encoding="utf-8"))
PIPELINE_ENTRY = MANIFEST["pipelines"][0]
PIPELINE_GRAPH_NODES = tuple(node["id"] for node in PIPELINE_ENTRY["nodes"])
PIPELINE_GRAPH_EDGES = tuple((edge["from"], edge["to"]) for edge in PIPELINE_ENTRY["edges"])
PIPELINE_GRAPH = {"nodes": PIPELINE_GRAPH_NODES, "edges": PIPELINE_GRAPH_EDGES}
PIPELINE_STAGES = PIPELINE_GRAPH_NODES

ADJUSTABLE_KEYS = frozenset(
    {
        "prompt_ref",
        "prompt_version",
        "style_pack_ref",
        "project_pack_ref",
        "model_policy",
        "qa_thresholds",
        "retry_budget",
        "placements",
        "export_targets",
        "approval_policy",
    }
)

HERMES_COMMANDS = tuple(MANIFEST["hermes"]["actions"])
HERMES_EVENTS = tuple(MANIFEST["hermes"]["event_kinds"])

SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$")
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
SECRET = re.compile(r"(?:secret|token|password|api[_-]?key|private[_-]?key|-----BEGIN)", re.I)
QA_THRESHOLD_KEYS = frozenset({"identity_leakage", "copy_mismatch", "visual_defects", "asset_replacement"})
RELEASE_FORBIDDEN_PARTS = (
    "private", "prompt", "provider", "model", "reviewer", "token", "secret",
    "password", "api_key", "pii", "email", "phone", "address",
)
RELEASE_FORBIDDEN_EXACT = frozenset(
    {"source", "source_ref", "source_hash", "source_bytes", "source_image", "private_input", "private_inputs"}
)


def _missing(value: Any, fields: tuple[str, ...]) -> list[str]:
    return [field for field in fields if not isinstance(value, Mapping) or not value.get(field)]


def _safe_ref(value: Any, label: str) -> list[str]:
    if not isinstance(value, str) or not SAFE_REF.fullmatch(value) or SECRET.search(value):
        return [f"{label} must be a safe non-secret reference"]
    return []


def _threshold_errors(thresholds: Any) -> list[str]:
    if not isinstance(thresholds, Mapping):
        return ["qa_thresholds must be an object"]
    errors: list[str] = []
    unknown = set(thresholds) - QA_THRESHOLD_KEYS
    errors.extend(f"qa_thresholds.{key} is not supported" for key in sorted(unknown))
    for key, value in thresholds.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
            errors.append(f"qa_thresholds.{key} must be bounded between 0 and 1")
    return errors


def build_request(
    *,
    project_pack_ref: str,
    source_ref: str,
    source_hash: str,
    prompt_ref: str,
    prompt_version: str,
    model_policy: str,
    placements: list[str],
    export_targets: list[str],
    approval_policy: str = "human_native_pixel",
    retry_budget: int = 1,
    qa_thresholds: dict[str, Any] | None = None,
    style_pack_ref: str = "style/default-v1",
) -> dict[str, Any]:
    """Create a provider-neutral request packet for Hermes.

    The source reference is provenance only. It must never appear in a
    source-free release packet.
    """
    if retry_budget < 0 or retry_budget > 1:
        raise ValueError("retry_budget must be between 0 and 1")
    if not placements or not export_targets:
        raise ValueError("placements and export_targets are required")
    package = {
        "contract_version": "frank.ad-template-generator.v1",
        "project_pack_ref": project_pack_ref,
        "source": {"ref": source_ref, "source_hash": source_hash},
        "prompt": {"ref": prompt_ref, "version": prompt_version},
        "style_pack_ref": style_pack_ref,
        "model_policy": model_policy,
        "qa_thresholds": deepcopy(qa_thresholds or {"identity_leakage": 0, "copy_mismatch": 0, "visual_defects": 0}),
        "retry_budget": retry_budget,
        "placements": list(placements),
        "export_targets": list(export_targets),
        "approval_policy": approval_policy,
        "pipeline": list(PIPELINE_STAGES),
    }
    errors = validate_package(package)
    if errors:
        raise ValueError("; ".join(errors))
    return package


def validate_package(package: dict[str, Any]) -> list[str]:
    """Return contract violations without reaching into provider state."""
    errors: list[str] = []
    errors.extend(f"missing package.{field}" for field in _missing(package, ("contract_version", "project_pack_ref", "pipeline", "approval_policy", "style_pack_ref", "model_policy", "qa_thresholds")))
    if package.get("pipeline") != list(PIPELINE_STAGES):
        errors.append("pipeline must preserve source-to-release stage order")
    source = package.get("source") or {}
    errors.extend(f"missing source.{field}" for field in _missing(source, ("ref", "source_hash")))
    errors.extend(_safe_ref(source.get("ref"), "source.ref"))
    if not isinstance(source.get("source_hash"), str) or not SHA256.fullmatch(source.get("source_hash", "")):
        errors.append("source.source_hash must be exactly 64 hexadecimal characters")
    prompt = package.get("prompt") or {}
    errors.extend(f"missing prompt.{field}" for field in _missing(prompt, ("ref", "version")))
    errors.extend(_safe_ref(prompt.get("ref"), "prompt.ref"))
    errors.extend(_safe_ref(prompt.get("version"), "prompt.version"))
    errors.extend(_safe_ref(package.get("project_pack_ref"), "project_pack_ref"))
    errors.extend(_safe_ref(package.get("style_pack_ref"), "style_pack_ref"))
    errors.extend(_safe_ref(package.get("model_policy"), "model_policy"))
    errors.extend(_threshold_errors(package.get("qa_thresholds")))
    if package.get("retry_budget", -1) not in (0, 1):
        errors.append("retry_budget must be bounded to 0 or 1")
    for field in ("placements", "export_targets"):
        values = package.get(field)
        if not isinstance(values, list) or not values or any(_safe_ref(value, f"{field}[]") for value in values):
            errors.append(f"{field} must contain only safe non-secret references")
    if not package.get("placements") or not package.get("export_targets"):
        errors.append("placements and export_targets are required")
    return errors


def validate_trace(trace: dict[str, Any]) -> list[str]:
    """Validate the observable run record used by Trace and Releases."""
    errors: list[str] = []
    required = ("run_id", "status", "stages", "provider_attempts", "hashes", "evidence", "receipts")
    errors.extend(f"missing trace.{field}" for field in _missing(trace, required))
    if trace.get("stages") and trace["stages"] != list(PIPELINE_STAGES):
        errors.append("trace stages must preserve the canonical pipeline")
    if trace.get("provider_attempts") is not None and not isinstance(trace["provider_attempts"], list):
        errors.append("provider_attempts must be a list")
    if trace.get("cost_usd") is not None and (not isinstance(trace["cost_usd"], (int, float)) or trace["cost_usd"] < 0):
        errors.append("cost_usd must be a non-negative number")
    return errors


def _forbidden_release_paths(value: Any, path: str = "release") -> list[str]:
    errors: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized in RELEASE_FORBIDDEN_EXACT or any(part in normalized for part in RELEASE_FORBIDDEN_PARTS) or ("source" in normalized and normalized != "source_free"):
                errors.append(f"{path}.{key} is forbidden in a source-free release")
            errors.extend(_forbidden_release_paths(child, f"{path}.{key}"))
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            errors.extend(_forbidden_release_paths(child, f"{path}[{index}]"))
    return errors


def _receipt_errors(receipt: Any, label: str, fields: tuple[str, ...]) -> list[str]:
    if not isinstance(receipt, Mapping):
        return [f"{label} must be an object"]
    errors = [f"missing {label}.{field}" for field in _missing(receipt, fields)]
    for field in ("ref", "receipt_id", "reviewer_ref", "provider", "model", "policy"):
        if field in receipt:
            errors.extend(_safe_ref(receipt[field], f"{label}.{field}"))
    return errors


@dataclass(frozen=True)
class ImmutableRelease:
    """Typed, source-free release record accepted by Frank Releases."""

    producer_schema: str
    tool_id: str
    scope: Mapping[str, str]
    release_version: str
    release_id: str
    status: str
    settings_revision: str
    settings_ref: str
    pipeline_id: str
    pipeline_version: str
    consumer_compatibility: Mapping[str, str]
    artifact_refs: tuple[str, ...]
    artifact_provenance: tuple[Mapping[str, Any], ...]
    output_checksums: Mapping[str, str]
    receipt_refs: tuple[str, ...]
    trace_ref: str
    qa_decision: Mapping[str, Any]
    approval_decision: Mapping[str, Any]
    sanitization_receipt: Mapping[str, Any]
    release_hash: str
    immutable: bool = True
    source_free: bool = True

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _canonical_release_hash(value: Mapping[str, Any]) -> str:
    payload = {key: item for key, item in value.items() if key != "release_hash"}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=list).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_release(release: Mapping[str, Any] | ImmutableRelease) -> list[str]:
    """Validate an immutable release and reject attempted source leakage."""
    value = release.as_dict() if isinstance(release, ImmutableRelease) else dict(release)
    errors = _forbidden_release_paths(value)
    required = ("producer_schema", "tool_id", "scope", "release_version", "release_id", "status", "settings_revision", "settings_ref", "pipeline_id", "pipeline_version", "consumer_compatibility", "artifact_refs", "artifact_provenance", "output_checksums", "receipt_refs", "trace_ref", "qa_decision", "approval_decision", "sanitization_receipt", "release_hash")
    errors.extend(f"missing release.{field}" for field in _missing(value, required))
    for field in ("producer_schema", "tool_id", "release_version", "release_id", "settings_revision", "settings_ref", "pipeline_id", "pipeline_version", "trace_ref"):
        errors.extend(_safe_ref(value.get(field), f"release.{field}"))
    if value.get("producer_schema") != "schema://frank.tool-app-release/v1":
        errors.append("release.producer_schema is unsupported")
    scope = value.get("scope")
    if not isinstance(scope, Mapping) or scope.get("kind") not in {"project", "workspace"}:
        errors.append("release.scope.kind must be project or workspace")
    elif not isinstance(scope.get("id"), str):
        errors.append("release.scope.id is required")
    else:
        errors.extend(_safe_ref(scope["id"], "release.scope.id"))
    compatibility = value.get("consumer_compatibility")
    if not isinstance(compatibility, Mapping) or not compatibility:
        errors.append("release.consumer_compatibility must be non-empty")
    else:
        for key, item in compatibility.items():
            errors.extend(_safe_ref(key, "release.consumer_compatibility.key"))
            errors.extend(_safe_ref(item, f"release.consumer_compatibility.{key}"))
    if value.get("status") != "released":
        errors.append("release.status must be released")
    if value.get("immutable") is not True or value.get("source_free") is not True:
        errors.append("release must be immutable and source_free")
    if not isinstance(value.get("release_hash"), str) or not SHA256.fullmatch(value.get("release_hash", "")):
        errors.append("release.release_hash must be 64 hexadecimal characters")
    elif _canonical_release_hash(value) != value["release_hash"]:
        errors.append("release.release_hash is not the canonical release hash")
    if value.get("pipeline_id") != PIPELINE_ENTRY["id"]:
        errors.append("release.pipeline_id is unsupported")
    if value.get("pipeline_version") != PIPELINE_ENTRY["schema"]:
        errors.append("release.pipeline_version is unsupported")
    artifact_refs = value.get("artifact_refs")
    if not isinstance(artifact_refs, (list, tuple)) or not artifact_refs:
        errors.append("artifact_refs must be non-empty")
    else:
        for ref in artifact_refs:
            errors.extend(_safe_ref(ref, "artifact_refs[]"))
    provenance = value.get("artifact_provenance")
    if not isinstance(provenance, (list, tuple)) or not provenance:
        errors.append("artifact_provenance must be non-empty")
    else:
        for item in provenance:
            if not isinstance(item, Mapping):
                errors.append("artifact_provenance entries must be objects")
                continue
            errors.extend(f"missing artifact_provenance.{field}" for field in _missing(item, ("artifact_ref", "kind", "created_at", "receipt_ref")))
            errors.extend(_safe_ref(item.get("artifact_ref"), "artifact_provenance.artifact_ref"))
            errors.extend(_safe_ref(item.get("kind"), "artifact_provenance.kind"))
            errors.extend(_safe_ref(item.get("receipt_ref"), "artifact_provenance.receipt_ref"))
            if not _valid_timestamp(item.get("created_at")):
                errors.append("artifact_provenance.created_at must be an ISO-8601 timestamp with timezone")
    checksums = value.get("output_checksums")
    if not isinstance(checksums, Mapping) or not checksums:
        errors.append("output_checksums must be non-empty")
    else:
        for ref, checksum in checksums.items():
            errors.extend(_safe_ref(ref, "output_checksums[]"))
            if not isinstance(checksum, str) or not SHA256.fullmatch(checksum):
                errors.append(f"output_checksums.{ref} must be 64 hexadecimal characters")
    if isinstance(artifact_refs, (list, tuple)) and isinstance(provenance, (list, tuple)) and isinstance(checksums, Mapping):
        artifact_set = set(artifact_refs)
        provenance_set = {item.get("artifact_ref") for item in provenance if isinstance(item, Mapping)}
        checksum_set = set(checksums)
        if artifact_set != provenance_set or artifact_set != checksum_set or len(artifact_set) != len(artifact_refs):
            errors.append("artifact_refs, artifact_provenance refs, and output_checksums keys must be exactly equal")
    receipt_refs = value.get("receipt_refs")
    if not isinstance(receipt_refs, (list, tuple)) or not receipt_refs:
        errors.append("receipt_refs must be non-empty")
    else:
        for ref in receipt_refs:
            errors.extend(_safe_ref(ref, "receipt_refs[]"))
    errors.extend(_safe_ref(value.get("trace_ref"), "trace_ref"))
    errors.extend(_safe_ref(value.get("settings_ref"), "settings_ref"))
    qa = value.get("qa_decision")
    if not isinstance(qa, Mapping) or qa.get("decision") != "pass":
        errors.append("qa_decision.decision must be pass")
    elif not isinstance(qa.get("receipt_ref"), str):
        errors.append("qa_decision.receipt_ref is required")
    approval = value.get("approval_decision")
    if not isinstance(approval, Mapping) or approval.get("decision") != "approved" or approval.get("gate") != "native-pixel-human-approval":
        errors.append("approval_decision must record approved native-pixel human approval")
    elif not isinstance(approval.get("receipt_ref"), str):
        errors.append("approval_decision.receipt_ref is required")
    sanitization = value.get("sanitization_receipt")
    if not isinstance(sanitization, Mapping) or sanitization.get("decision") != "pass" or not isinstance(sanitization.get("ref"), str):
        errors.append("sanitization_receipt must record a passing opaque receipt ref")
    for label, decision in (("qa_decision", qa), ("approval_decision", approval)):
        if isinstance(decision, Mapping):
            errors.extend(_safe_ref(decision.get("receipt_ref"), f"{label}.receipt_ref"))
    if isinstance(sanitization, Mapping):
        errors.extend(_safe_ref(sanitization.get("ref"), "sanitization_receipt.ref"))
    return errors


def build_immutable_release(
    *,
    tool_id: str,
    scope: Mapping[str, str],
    release_version: str,
    release_id: str,
    settings_revision: str,
    settings_ref: str,
    pipeline_id: str,
    pipeline_version: str,
    consumer_compatibility: Mapping[str, str],
    artifact_refs: list[str],
    artifact_provenance: list[Mapping[str, Any]],
    output_checksums: Mapping[str, str],
    receipt_refs: list[str],
    trace_ref: str,
    qa_decision: Mapping[str, Any],
    approval_decision: Mapping[str, Any],
    sanitization_receipt: Mapping[str, Any],
) -> ImmutableRelease:
    """Build a release only after all source-free receipts are present."""
    release = ImmutableRelease(
        producer_schema="schema://frank.tool-app-release/v1",
        tool_id=tool_id,
        scope=dict(scope),
        release_version=release_version,
        release_id=release_id,
        status="released",
        settings_revision=settings_revision,
        settings_ref=settings_ref,
        pipeline_id=pipeline_id,
        pipeline_version=pipeline_version,
        consumer_compatibility=dict(consumer_compatibility),
        artifact_refs=tuple(artifact_refs),
        artifact_provenance=tuple(artifact_provenance),
        output_checksums=dict(output_checksums),
        receipt_refs=tuple(receipt_refs),
        trace_ref=trace_ref,
        qa_decision=dict(qa_decision),
        approval_decision=dict(approval_decision),
        sanitization_receipt=dict(sanitization_receipt),
        release_hash="0" * 64,
    )
    release = ImmutableRelease(**{**release.as_dict(), "release_hash": _canonical_release_hash(release.as_dict())})
    errors = validate_release(release)
    if errors:
        raise ValueError("; ".join(errors))
    return release

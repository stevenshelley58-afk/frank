"""Stable Frank/Hermes boundary for Ad Studio.

The functions here validate and describe work; they never call a provider or
generate pixels. Keeping this boundary small prevents Frank from becoming a
second Hermes runtime or a competing copy of the canonical generator.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime
import json
from pathlib import Path
import re
from types import MappingProxyType
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlsplit

from tool_apps.canonical import canonical_sha256


MANIFEST = json.loads((Path(__file__).resolve().parent / "manifest.json").read_text(encoding="utf-8"))
HOME_PROFILE = MappingProxyType({
    "id": "ad-template-generator",
    "name": "Ad Studio",
    "kind": "tool",
    "blurb": "Portable editable TemplatePacks with live VPS evidence, Studio QA and signed releases.",
    "capabilities": (
        "inspect-source-provenance",
        "extract-customer-input-contract",
        "build-layered-source-safe-template",
        "review-quality-evidence",
        "approve-at-100-percent-zoom",
        "issue-signed-template-pack",
    ),
    "default_widget_ids": (),
    "connection_capabilities": ("image.generate",),
})


def home_profile() -> dict[str, Any]:
    """Return a mutable JSON-shaped copy of the frozen package profile."""
    return {
        key: list(value) if isinstance(value, tuple) else value
        for key, value in HOME_PROFILE.items()
    }
# Keep the v1 release validator available for already-issued packs while the
# operator UI and new releases use the provider-neutral TemplatePack v2 path.
PIPELINE_ENTRY = {
    "id": "reference-clone-release",
    "version": "1.0.0",
    "nodes": [
        {"id": "source"}, {"id": "extract"}, {"id": "clone"}, {"id": "qa"},
        {"id": "native-pixel-human-approval"}, {"id": "immutable-source-free-release"},
    ],
    "edges": [
        {"from": "source", "to": "extract"}, {"from": "extract", "to": "clone"},
        {"from": "clone", "to": "qa"}, {"from": "qa", "to": "native-pixel-human-approval"},
        {"from": "native-pixel-human-approval", "to": "immutable-source-free-release"},
    ],
}
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
RELEASE_SCHEMA = "schema://frank.ad-template-generator-release/v1"
TEMPLATE_PACK_SCHEMA = "blockwise.template-pack/v1"
CONSUMER_COMPATIBILITY = ("blockwise-template-pack-v1",)

SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$")
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
SECRET = re.compile(r"(?:secret|token|password|api[_-]?key|private[_-]?key|-----BEGIN)", re.I)
HTML_OR_CODE = re.compile(r"</?[a-z][^>]*>|javascript\s*:|-----BEGIN ", re.I)
PII_VALUE = re.compile(r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d)")
SIGNATURE = re.compile(r"^[A-Za-z0-9+/=_-]{16,512}$")
QA_THRESHOLD_KEYS = frozenset({"identity_leakage", "copy_mismatch", "visual_defects", "asset_replacement"})
RELEASE_FORBIDDEN_PARTS = (
    "private", "prompt", "provider", "model", "reviewer", "token", "secret",
    "password", "api_key", "pii", "email", "phone", "address",
)
RELEASE_FORBIDDEN_EXACT = frozenset(
    {"source", "source_ref", "source_hash", "source_bytes", "source_image", "private_input", "private_inputs"}
)
_TOKEN_QUERY_KEYS = frozenset({"token", "access_token", "refresh_token", "api_key", "apikey", "key", "secret", "signature", "sig", "auth", "authorization"})


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


def _valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _exact_keys(value: Any, fields: set[str], label: str) -> list[str]:
    if not isinstance(value, Mapping):
        return [f"{label} must be an object"]
    if set(value) != fields:
        return [f"{label} must contain exactly: {', '.join(sorted(fields))}"]
    return []


def _release_tree_errors(value: Any, path: str = "release", key: str = "") -> list[str]:
    errors: list[str] = []
    if isinstance(value, Mapping):
        for child_key, child in value.items():
            if not isinstance(child_key, str):
                errors.append(f"{path} contains a non-string key")
                continue
            normalized = child_key.lower().replace("-", "_")
            if normalized in RELEASE_FORBIDDEN_EXACT or any(part in normalized for part in RELEASE_FORBIDDEN_PARTS) or ("source" in normalized and normalized != "source_free"):
                errors.append(f"{path}.{child_key} is forbidden in a source-free release")
            errors.extend(_release_tree_errors(child, f"{path}.{child_key}", child_key))
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            errors.extend(_release_tree_errors(child, f"{path}[{index}]", key))
    elif isinstance(value, str):
        pii_exempt_key = key in {"checked_at", "decided_at", "released_at", "sha256", "signature", "release_hash"}
        if HTML_OR_CODE.search(value) or SECRET.search(value) or (not pii_exempt_key and PII_VALUE.search(value)):
            errors.append(f"{path} contains private, executable, or PII-like text")
        if key in {"artifact_ref"} and value.lower().startswith(("file:", "openbao:", "vault:", "secret:")):
            errors.append(f"{path} cannot use a private reference scheme")
    elif value is not None and not isinstance(value, (bool, int, float)):
        errors.append(f"{path} contains a non-JSON value")
    return errors


def _public_https_url(value: Any, label: str) -> list[str]:
    if not isinstance(value, str):
        return [f"{label} must be a public HTTPS URL"]
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return [f"{label} must be a public HTTPS URL"]
    if any(key.casefold() in _TOKEN_QUERY_KEYS for key, _ in parse_qsl(parsed.query, keep_blank_values=True)):
        return [f"{label} must not contain credential-like query parameters"]
    return []


@dataclass(frozen=True)
class ImmutableRelease:
    """Exact immutable release identifying one signed public TemplatePack."""

    schema: str
    tool_id: str
    scope: Mapping[str, str]
    release_version: str
    release_id: str
    status: str
    settings_revision: int
    settings_ref: str
    pipeline_id: str
    pipeline_version: str
    consumer_compatibility: tuple[str, ...]
    template_pack: Mapping[str, Any]
    provenance: Mapping[str, str]
    trace_ref: str
    qa_receipt: Mapping[str, str]
    approval_receipt: Mapping[str, str]
    sanitization_receipt: Mapping[str, str]
    released_at: str
    release_hash: str
    immutable: bool = True
    source_free: bool = True

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["consumer_compatibility"] = list(self.consumer_compatibility)
        return result


def _canonical_release_hash(value: Mapping[str, Any]) -> str:
    payload = {key: item for key, item in value.items() if key != "release_hash"}
    return canonical_sha256(payload)


def validate_release(release: Mapping[str, Any] | ImmutableRelease) -> list[str]:
    """Validate the exact source-free TemplatePack release envelope."""
    value = release.as_dict() if isinstance(release, ImmutableRelease) else dict(release)
    fields = {
        "schema", "tool_id", "scope", "release_version", "release_id", "status",
        "settings_revision", "settings_ref", "pipeline_id", "pipeline_version",
        "consumer_compatibility", "template_pack", "provenance", "trace_ref",
        "qa_receipt", "approval_receipt", "sanitization_receipt", "released_at",
        "release_hash", "immutable", "source_free",
    }
    errors = _exact_keys(value, fields, "release")
    errors.extend(_release_tree_errors(value))
    for field in ("schema", "tool_id", "release_version", "release_id", "settings_ref", "pipeline_id", "pipeline_version", "trace_ref"):
        errors.extend(_safe_ref(value.get(field), f"release.{field}"))
    if value.get("schema") != RELEASE_SCHEMA or value.get("tool_id") != MANIFEST["id"]:
        errors.append("release schema or tool identity is unsupported")
    scope = value.get("scope")
    errors.extend(_exact_keys(scope, {"kind", "id"}, "release.scope"))
    if isinstance(scope, Mapping):
        if scope.get("kind") not in {"project", "workspace"}:
            errors.append("release.scope.kind must be project or workspace")
        errors.extend(_safe_ref(scope.get("id"), "release.scope.id"))
    if value.get("release_version") != "1.0.0" or value.get("status") != "released":
        errors.append("release version or status is unsupported")
    if type(value.get("settings_revision")) is not int or value["settings_revision"] < 0:
        errors.append("release.settings_revision must be a non-negative integer")
    if value.get("pipeline_id") != PIPELINE_ENTRY["id"] or value.get("pipeline_version") != PIPELINE_ENTRY["version"]:
        errors.append("release pipeline identity or version is unsupported")
    if tuple(value.get("consumer_compatibility", ())) != CONSUMER_COMPATIBILITY:
        errors.append("release.consumer_compatibility is unsupported")
    if value.get("immutable") is not True or value.get("source_free") is not True:
        errors.append("release must be immutable and source_free")

    pack = value.get("template_pack")
    errors.extend(_exact_keys(pack, {"schema", "pack_id", "artifact_ref", "sha256", "signature_algorithm", "signature"}, "release.template_pack"))
    if isinstance(pack, Mapping):
        if pack.get("schema") != TEMPLATE_PACK_SCHEMA:
            errors.append("release.template_pack.schema is unsupported")
        errors.extend(_safe_ref(pack.get("pack_id"), "release.template_pack.pack_id"))
        errors.extend(_public_https_url(pack.get("artifact_ref"), "release.template_pack.artifact_ref"))
        if not isinstance(pack.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", pack["sha256"]):
            errors.append("release.template_pack.sha256 must be lowercase SHA-256")
        if pack.get("signature_algorithm") != "ed25519" or not isinstance(pack.get("signature"), str) or not SIGNATURE.fullmatch(pack["signature"]):
            errors.append("release.template_pack must contain an Ed25519 signature")

    provenance = value.get("provenance")
    errors.extend(_exact_keys(provenance, {"artifact_ref", "artifact_receipt_ref"}, "release.provenance"))
    if isinstance(provenance, Mapping):
        errors.extend(_safe_ref(provenance.get("artifact_receipt_ref"), "release.provenance.artifact_receipt_ref"))
        if isinstance(pack, Mapping) and provenance.get("artifact_ref") != pack.get("artifact_ref"):
            errors.append("release.provenance.artifact_ref must match template_pack.artifact_ref")

    receipt_specs = (
        ("qa_receipt", {"decision", "receipt_ref", "checked_at"}, "pass", "checked_at"),
        ("approval_receipt", {"decision", "gate", "receipt_ref", "decided_at"}, "approved", "decided_at"),
        ("sanitization_receipt", {"decision", "receipt_ref", "checked_at"}, "pass", "checked_at"),
    )
    for field, receipt_fields, decision, timestamp_field in receipt_specs:
        receipt = value.get(field)
        errors.extend(_exact_keys(receipt, receipt_fields, f"release.{field}"))
        if isinstance(receipt, Mapping):
            if receipt.get("decision") != decision:
                errors.append(f"release.{field}.decision is unsupported")
            if field == "approval_receipt" and receipt.get("gate") != "native-pixel-human-approval":
                errors.append("release.approval_receipt.gate is unsupported")
            errors.extend(_safe_ref(receipt.get("receipt_ref"), f"release.{field}.receipt_ref"))
            if not _valid_timestamp(receipt.get(timestamp_field)):
                errors.append(f"release.{field}.{timestamp_field} must be an ISO-8601 timestamp with timezone")
    if not _valid_timestamp(value.get("released_at")):
        errors.append("release.released_at must be an ISO-8601 timestamp with timezone")
    if not isinstance(value.get("release_hash"), str) or not re.fullmatch(r"[0-9a-f]{64}", value.get("release_hash", "")):
        errors.append("release.release_hash must be lowercase SHA-256")
    elif _canonical_release_hash(value) != value["release_hash"]:
        errors.append("release.release_hash is not the canonical release hash")
    return sorted(set(errors))


def build_immutable_release(
    *,
    tool_id: str,
    scope: Mapping[str, str],
    release_version: str,
    release_id: str,
    settings_revision: int,
    settings_ref: str,
    pipeline_id: str,
    pipeline_version: str,
    consumer_compatibility: tuple[str, ...],
    template_pack: Mapping[str, Any],
    provenance: Mapping[str, str],
    trace_ref: str,
    qa_receipt: Mapping[str, str],
    approval_receipt: Mapping[str, str],
    sanitization_receipt: Mapping[str, str],
    released_at: str,
) -> ImmutableRelease:
    """Build a release only after one signed source-free TemplatePack is ready."""
    release = ImmutableRelease(
        schema=RELEASE_SCHEMA,
        tool_id=tool_id,
        scope=dict(scope),
        release_version=release_version,
        release_id=release_id,
        status="released",
        settings_revision=settings_revision,
        settings_ref=settings_ref,
        pipeline_id=pipeline_id,
        pipeline_version=pipeline_version,
        consumer_compatibility=tuple(consumer_compatibility),
        template_pack=dict(template_pack),
        provenance=dict(provenance),
        trace_ref=trace_ref,
        qa_receipt=dict(qa_receipt),
        approval_receipt=dict(approval_receipt),
        sanitization_receipt=dict(sanitization_receipt),
        released_at=released_at,
        release_hash="0" * 64,
    )
    release = ImmutableRelease(**{**release.as_dict(), "release_hash": _canonical_release_hash(release.as_dict())})
    errors = validate_release(release)
    if errors:
        raise ValueError("; ".join(errors))
    return release

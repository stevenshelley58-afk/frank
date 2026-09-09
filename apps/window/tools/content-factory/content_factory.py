"""Pure Blog Studio contracts under tool ID ``content-factory``.

Frank validates and forwards closed requests; Hermes remains the execution
engine and sole owner of reasoning and capability selection.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import json
import re
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlsplit

from tool_apps.canonical import canonical_sha256


PIPELINE_SCHEMA = "schema://frank.tool-app-pipeline/v1"
MANIFEST_SCHEMA = "schema://frank.tool-app-manifest/v1"
_DOMAIN_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_CORRELATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_ACTION_ID = re.compile(r"^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$")
_EVENT_ID = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
_SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_HTML_OR_SECRET = re.compile(r"</?[a-z][^>]*>|javascript\s*:|-----BEGIN |\bBearer\s+\S+", re.IGNORECASE)
_PUBLIC_FORBIDDEN_FRAGMENTS = ("prompt", "raw", "private", "internal", "secret", "model", "email", "phone", "address", "dob", "dateofbirth", "ssn", "tax", "passport", "ip", "customer", "person", "reviewer")
_SANITIZATION_KEYS = frozenset({"piiscan", "secretscan", "status", "receiptid", "scannedat"})
_ALLOWED_REF_SCHEMES = frozenset({"https", "http", "artifact", "asset", "content", "media"})
_TOKEN_QUERY_KEYS = frozenset({"token", "access_token", "refresh_token", "api_key", "apikey", "key", "secret", "signature", "sig", "auth", "authorization"})

_PACKAGE_MANIFEST_PATH = Path(__file__).with_name("manifest.json")
with _PACKAGE_MANIFEST_PATH.open(encoding="utf-8") as _manifest_file:
    _PACKAGE_MANIFEST = json.load(_manifest_file)
PIPELINE_SCHEMA = _PACKAGE_MANIFEST["pipelines"][0]["schema"]
MANIFEST_SCHEMA = _PACKAGE_MANIFEST["schema"]
PROCESS_GRAPH = deepcopy(next(pipeline for pipeline in _PACKAGE_MANIFEST["pipelines"] if pipeline["id"] == "blog-studio-v2"))
CONTENT_FACTORY_MANIFEST = deepcopy(_PACKAGE_MANIFEST)
HOME_PROFILE = MappingProxyType({
    "id": "content-factory",
    "name": "Blog Studio",
    "kind": "tool",
    "blurb": "Turn source material into an evidence-backed blog package, review it, and release it safely through Hermes.",
    "capabilities": (
        "source-led-writing",
        "evidence-backed-research",
        "guided-editing",
        "qa-gate",
        "human-approval",
        "resume-rerun",
        "immutable-release",
        "withdrawal-tombstones",
    ),
    "default_widget_ids": (),
    "connection_capabilities": (),
})


def home_profile() -> dict[str, Any]:
    """Return a mutable JSON-shaped copy of the frozen package profile."""
    return {
        key: list(value) if isinstance(value, tuple) else value
        for key, value in HOME_PROFILE.items()
    }
RELEASE_SCHEMA = _PACKAGE_MANIFEST["release_schema"]
TOOL_ID = _PACKAGE_MANIFEST["id"]

# Taxonomy is intentionally separate from the process graph.
RELEASE_CHANNELS = ("web", "email", "social")
# Backwards-compatible export for release consumers; run requests use outputs.
CHANNELS = RELEASE_CHANNELS
OUTPUT_KINDS = (
    "article",
    "research-report",
    "seo-package",
    "media-briefs",
    "email-companion",
    "social-companion",
)
ARTIFACT_TAXONOMY = {
    "source": ("source_manifest",),
    "research": ("research_dossier", "evidence_ledger", "claim_register"),
    "brief": ("editorial_brief", "article_outline"),
    "draft": ("article_draft",),
    "edit": ("article_revision", "edit_report"),
    "package": ("article_package", "seo_package", "media_briefs", "companion_drafts"),
    "qa": ("qa_report", "claim_audit", "sanitization_receipts"),
    "human-approval": ("approval_receipt",),
    "immutable-release": ("article_release", "release_manifest"),
}

RUN_REQUEST_REQUIRED = frozenset({"project_id", "content_id", "source_bundle", "direction", "outputs"})
RUN_REQUEST_OPTIONAL = frozenset({"job_name", "topic", "project_context"})
_SOURCE_BUNDLE_KEYS = frozenset({"pasted_text", "text", "text_length", "urls", "attachments"})
_SOURCE_ATTACHMENT_KEYS = frozenset({"path", "name", "media_type", "sha256", "size", "origin"})
_DIRECTION_KEYS = frozenset({"audience", "outcome", "cta", "locale", "must_include", "must_avoid", "slug"})
_OUTPUT_KEYS = frozenset({"length", "research_mode", "media", "companions", "publication_target_id"})
_HERMES_ORCHESTRATION_KEYS = frozenset({
    "provider", "providerref", "temperature", "topp", "messages", "tools",
    "skills", "systeminstruction", "systemmessage",
})

COMMAND_ACTIONS = frozenset(_PACKAGE_MANIFEST["hermes"]["actions"])
EVENT_KINDS = frozenset(_PACKAGE_MANIFEST["hermes"]["event_kinds"])


def _require_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _DOMAIN_ID.fullmatch(value):
        raise ValueError(f"{label} must be a safe identifier")
    return value


def _require_scope_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _CORRELATION_ID.fullmatch(value):
        raise ValueError(f"{label} must be a safe opaque scope identifier")
    return value


def _require_timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be an ISO-8601 timestamp with timezone")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO-8601 timestamp with timezone") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must be an ISO-8601 timestamp with timezone")
    return value


def _normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.casefold())


def _forbidden_public_key(normalized_key: str) -> bool:
    return any(
        (normalized_key.startswith("ip") or normalized_key.endswith("ip")) if fragment == "ip" else fragment in normalized_key
        for fragment in _PUBLIC_FORBIDDEN_FRAGMENTS
    )


def _safe_resource_ref(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or _HTML_OR_SECRET.search(value):
        raise ValueError(f"{label} must be a safe URL or opaque reference")
    parsed = urlsplit(value)
    if not parsed.scheme or parsed.scheme.casefold() not in _ALLOWED_REF_SCHEMES:
        raise ValueError(f"{label} uses an unsupported reference scheme")
    if parsed.username or parsed.password:
        raise ValueError(f"{label} must not contain credentials")
    if any(key.casefold() in _TOKEN_QUERY_KEYS or any(token in key.casefold() for token in ("token", "secret", "signature", "apikey")) for key, _ in parse_qsl(parsed.query, keep_blank_values=True)):
        raise ValueError(f"{label} must not contain token-like query parameters")
    if parsed.scheme.casefold() in {"http", "https"} and not parsed.hostname:
        raise ValueError(f"{label} must contain a host")
    return value


def _walk_safe(value: Any, path: str = "payload", key: str = "") -> None:
    if isinstance(value, str):
        if _HTML_OR_SECRET.search(value):
            raise ValueError(f"unsafe markup or secret-like value at {path}")
    elif isinstance(value, Mapping):
        for child_key, child_value in value.items():
            if not isinstance(child_key, str):
                raise ValueError(f"non-string key at {path}")
            _walk_safe(child_value, f"{path}.{child_key}", child_key)
    elif isinstance(value, list):
        for index, child_value in enumerate(value):
            _walk_safe(child_value, f"{path}[{index}]", key)
    elif value is not None and not isinstance(value, (bool, int, float)):
        raise ValueError(f"unsupported payload value at {path}")


def _hermes_owned_fields(value: Any, path: str = "request") -> list[str]:
    """Return Frank-side orchestration controls that belong only to Hermes."""
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            if not isinstance(key, str):
                continue
            normalized = _normalize_key(key)
            if normalized.startswith("prompt") or normalized.startswith("model") or normalized in _HERMES_ORCHESTRATION_KEYS:
                found.append(f"{path}.{key}")
            found.extend(_hermes_owned_fields(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(_hermes_owned_fields(child, f"{path}[{index}]"))
    return found


def _has_meaningful_value(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, Mapping):
        return any(_has_meaningful_value(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_meaningful_value(item) for item in value)
    return value is not None and value is not False


def _source_bundle_has_material(value: Any) -> bool:
    return isinstance(value, Mapping) and any(
        _has_meaningful_value(value.get(key))
        for key in ("pasted_text", "text", "urls", "attachments")
    )


def _validate_source_bundle(source_bundle: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(source_bundle, Mapping):
        return ["source_bundle:must-be-object"]
    unknown = set(source_bundle) - _SOURCE_BUNDLE_KEYS
    errors.extend(f"source_bundle:unsupported:{key}" for key in sorted(unknown))

    for text_key in ("pasted_text", "text"):
        value = source_bundle.get(text_key)
        if value is not None and not isinstance(value, str) and not (
            isinstance(value, list) and all(isinstance(item, str) for item in value)
        ):
            errors.append(f"source_bundle:{text_key}-must-be-text-or-text-list")
    if "text_length" in source_bundle and (
        type(source_bundle["text_length"]) is not int or source_bundle["text_length"] < 0
    ):
        errors.append("source_bundle:text_length-must-be-non-negative-integer")

    urls = source_bundle.get("urls")
    if urls is not None:
        url_items = urls if isinstance(urls, list) else [urls]
        for index, item in enumerate(url_items):
            candidate = item.get("url") if isinstance(item, Mapping) else item
            if not isinstance(candidate, str):
                errors.append(f"source_bundle:urls[{index}]-must-have-url")
                continue
            try:
                parsed = urlsplit(_safe_resource_ref(candidate, f"source_bundle.urls[{index}]"))
                if parsed.scheme.casefold() not in {"http", "https"}:
                    errors.append(f"source_bundle:urls[{index}]-must-be-http")
            except ValueError as exc:
                errors.append(str(exc))

    attachments = source_bundle.get("attachments")
    if attachments is not None:
        if not isinstance(attachments, list):
            errors.append("source_bundle:attachments-must-be-list")
        else:
            for index, item in enumerate(attachments):
                if not isinstance(item, Mapping):
                    errors.append(f"source_bundle:attachments[{index}]-must-be-object")
                    continue
                unknown_attachment = set(item) - _SOURCE_ATTACHMENT_KEYS
                errors.extend(
                    f"source_bundle:attachments[{index}]-unsupported:{key}"
                    for key in sorted(unknown_attachment)
                )
                if not isinstance(item.get("path"), str) or not item["path"].strip():
                    errors.append(f"source_bundle:attachments[{index}]-path-required")
                checksum = item.get("sha256")
                if checksum is not None and (not isinstance(checksum, str) or not _SHA256.fullmatch(checksum)):
                    errors.append(f"source_bundle:attachments[{index}]-sha256-invalid")
    return errors


def _validate_direction(direction: Any) -> list[str]:
    if not isinstance(direction, Mapping):
        return ["direction:must-be-object"]
    errors = [f"direction:unsupported:{key}" for key in sorted(set(direction) - _DIRECTION_KEYS)]
    for key, value in direction.items():
        if key in _DIRECTION_KEYS and not isinstance(value, str):
            errors.append(f"direction:{key}-must-be-text")
    return errors


def _validate_outputs(outputs: Any) -> list[str]:
    if not isinstance(outputs, Mapping) or not _has_meaningful_value(outputs):
        return ["outputs:must-be-non-empty-object"]
    errors = [f"outputs:unsupported:{key}" for key in sorted(set(outputs) - _OUTPUT_KEYS)]
    if "length" in outputs and outputs["length"] not in {"concise", "standard", "deep"}:
        errors.append("outputs:length-unsupported")
    if "research_mode" in outputs and outputs["research_mode"] not in {"source-only", "verify-enrich"}:
        errors.append("outputs:research_mode-unsupported")
    if "media" in outputs and outputs["media"] not in {"none", "briefs", "generate"}:
        errors.append("outputs:media-unsupported")
    companions = outputs.get("companions")
    if companions is not None and (
        not isinstance(companions, list)
        or any(item not in {"email", "social"} for item in companions)
        or len(companions) != len(set(companions))
    ):
        errors.append("outputs:companions-unsupported")
    target_id = outputs.get("publication_target_id")
    if target_id not in (None, ""):
        try:
            _require_scope_id(target_id, "outputs.publication_target_id")
        except ValueError:
            errors.append("outputs:publication_target_id-invalid")
    return errors


def validate_process_graph(graph: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    if graph != PROCESS_GRAPH:
        errors.append("graph:must-match-fixed-process-graph")
    if graph.get("schema") != PIPELINE_SCHEMA:
        errors.append("graph:unsupported-schema")
    nodes = graph.get("nodes", [])
    node_ids = [node.get("id") for node in nodes if isinstance(node, Mapping)]
    if len(node_ids) != len(set(node_ids)):
        errors.append("graph:duplicate-node")
    known = set(node_ids)
    adjacency = {node_id: [] for node_id in known}
    for edge in graph.get("edges", []):
        if not isinstance(edge, Mapping) or edge.get("from") not in known or edge.get("to") not in known or edge.get("from") == edge.get("to"):
            errors.append("graph:unknown-or-self-edge")
        else:
            adjacency[edge["from"]].append(edge["to"])
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visiting:
            errors.append("graph:cycle")
            return
        if node_id in visited:
            return
        visiting.add(node_id)
        for child in adjacency.get(node_id, []):
            visit(child)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in known:
        visit(node_id)
    return sorted(set(errors))


def validate_pack(pack: Mapping[str, Any]) -> list[str]:
    required = (
        "id", "kind", "version", "project_id", "manifest_ref",
        "process_graph_ref", "request_defaults", "approvals", "release",
        "publication_targets", "legacy_source", "adoption", "hermes_boundary",
    )
    if not isinstance(pack, Mapping):
        return ["pack:must-be-object"]
    errors = [f"missing:{key}" for key in required if key not in pack]
    if pack.get("kind") != "content-factory-project-pack":
        errors.append("kind:unsupported")
    if pack.get("manifest_ref") != f"{TOOL_ID}@{CONTENT_FACTORY_MANIFEST['version']}":
        errors.append("manifest_ref:unsupported")
    if pack.get("process_graph_ref") != PROCESS_GRAPH["id"]:
        errors.append("process_graph_ref:unsupported")
    if not isinstance(pack.get("version"), str) or not _SEMVER.fullmatch(pack["version"]):
        errors.append("version:semver-required")
    for key in ("id", "project_id"):
        if not isinstance(pack.get(key), str) or not _DOMAIN_ID.fullmatch(pack[key]):
            errors.append(f"{key}:safe-id-required")
    for target in pack.get("publication_targets", []):
        if not isinstance(target, Mapping) or not _DOMAIN_ID.fullmatch(str(target.get("connection_id", ""))) or not _DOMAIN_ID.fullmatch(str(target.get("target_id", ""))):
            errors.append("publication_targets:connections-ids-required")
    approvals = pack.get("approvals")
    if not isinstance(approvals, Mapping) or approvals.get("required") is not True or set(approvals.get("actions", [])) != {"approve", "request_changes", "reject", "quarantine"}:
        errors.append("approvals:explicit-human-actions-required")
    release = pack.get("release")
    if not isinstance(release, Mapping) or release.get("immutable") is not True or set(release.get("requires", [])) != {"qa_pass", "human_approval"}:
        errors.append("release:qa-and-human-approval-required")
    if _hermes_owned_fields(pack, "pack"):
        errors.append("orchestration:hermes-owned")
    try:
        _walk_safe(pack, "pack")
    except ValueError as exc:
        errors.append(str(exc))
    return sorted(set(errors))


def validate_run_request(request: Mapping[str, Any]) -> list[str]:
    if not isinstance(request, Mapping):
        return ["request:must-be-object"]
    errors = [f"missing:{key}" for key in sorted(RUN_REQUEST_REQUIRED - set(request))]
    errors.extend(f"unsupported:{key}" for key in sorted(set(request) - RUN_REQUEST_REQUIRED - RUN_REQUEST_OPTIONAL))
    try:
        _require_id(request.get("project_id"), "project_id")
    except ValueError:
        errors.append("project_id:safe-id-required")
    try:
        _require_scope_id(request.get("content_id"), "content_id")
    except ValueError:
        errors.append("content_id:safe-id-required")

    source_bundle = request.get("source_bundle")
    errors.extend(_validate_source_bundle(source_bundle))
    direction = request.get("direction")
    errors.extend(_validate_direction(direction))
    outputs = request.get("outputs")
    errors.extend(_validate_outputs(outputs))
    for field in ("job_name", "topic"):
        if field in request and (not isinstance(request[field], str) or not request[field].strip()):
            errors.append(f"{field}:must-be-non-empty-text")
    project_context = request.get("project_context")
    if project_context is not None and not isinstance(project_context, (str, Mapping)):
        errors.append("project_context:must-be-text-or-object")
    if not _source_bundle_has_material(source_bundle) and not _has_meaningful_value(direction) and not _has_meaningful_value(request.get("topic")):
        errors.append("source-or-direction:required")
    if _hermes_owned_fields(request):
        errors.append("orchestration:hermes-owned")
    try:
        _walk_safe(request)
    except ValueError as exc:
        errors.append(str(exc))
    return sorted(set(errors))


def _action_metadata(kind: str, name: str, payload: Mapping[str, Any], correlation_id: str) -> dict[str, Any]:
    if not isinstance(correlation_id, str) or not _CORRELATION_ID.fullmatch(correlation_id):
        raise ValueError("correlation_id must use its own safe identifier pattern")
    if not isinstance(payload, Mapping):
        raise ValueError("payload must be an object")
    _walk_safe(payload)
    return {"kind": kind, "action" if kind == "command" else "event_kind": name, "correlation_id": correlation_id, "payload": deepcopy(dict(payload))}


def build_command(action: str, payload: Mapping[str, Any], correlation_id: str) -> dict[str, Any]:
    if action not in COMMAND_ACTIONS or not _ACTION_ID.fullmatch(action):
        raise ValueError("command action is not declared by the manifest")
    if action == "run":
        errors = validate_run_request(payload)
        if errors:
            raise ValueError(f"invalid Blog Studio run request: {', '.join(errors)}")
    return _action_metadata("command", action, payload, correlation_id)


def build_event(event_kind: str, payload: Mapping[str, Any], correlation_id: str) -> dict[str, Any]:
    if event_kind not in EVENT_KINDS or not _EVENT_ID.fullmatch(event_kind):
        raise ValueError("event kind is not declared by the manifest")
    return _action_metadata("event", event_kind, payload, correlation_id)


def _assert_public_tree(value: Any, path: str = "release") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized_key = _normalize_key(str(key))
            receipt_field = path.startswith("release.sanitization_receipts")
            if (receipt_field and normalized_key not in _SANITIZATION_KEYS) or (not receipt_field and _forbidden_public_key(normalized_key)):
                raise ValueError(f"private generation field at {path}.{key}")
            _assert_public_tree(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_public_tree(child, f"{path}[{index}]")


def _required_text(mapping: Mapping[str, Any], key: str, path: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path}.{key} is required")
    return value


def _require_exact_keys(mapping: Mapping[str, Any], keys: set[str], path: str) -> None:
    if set(mapping) != keys:
        raise ValueError(f"{path} must contain exactly: {', '.join(sorted(keys))}")


def public_release(release: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and return an immutable public article release."""
    _assert_public_tree(release)
    required = ("schema", "tool_id", "project_id", "workspace_id", "settings_revision", "pipeline_id", "pipeline_version", "consumer_compatibility", "release_id", "content_id", "version", "immutable", "status", "channel", "title", "body", "media", "seo", "qa_receipt", "approval_receipt", "provenance", "sanitization_receipts", "published_at")
    missing = [key for key in required if key not in release]
    if missing:
        raise ValueError(f"release missing required fields: {', '.join(missing)}")
    if release["schema"] != RELEASE_SCHEMA or release["tool_id"] != TOOL_ID:
        raise ValueError("release producer schema or tool identity is invalid")
    _require_id(release["project_id"], "project_id")
    _require_scope_id(release["workspace_id"], "workspace_id")
    _require_id(release["release_id"], "release_id")
    _require_id(release["content_id"], "content_id")
    if type(release["settings_revision"]) is not int or release["settings_revision"] < 0:
        raise ValueError("settings_revision must be a non-negative integer")
    if release["pipeline_id"] != PROCESS_GRAPH["id"] or release["pipeline_version"] != PROCESS_GRAPH["version"] or not isinstance(release["pipeline_version"], str) or not _SEMVER.fullmatch(release["pipeline_version"]):
        raise ValueError("pipeline identity or version is invalid")
    compatibility = release["consumer_compatibility"]
    if not isinstance(compatibility, (list, tuple)) or not compatibility or any(not isinstance(item, str) or not _DOMAIN_ID.fullmatch(item) for item in compatibility):
        raise ValueError("consumer_compatibility must list safe compatibility IDs")
    if "article-release-v1" not in compatibility:
        raise ValueError("consumer_compatibility must include article-release-v1")
    if type(release["version"]) is not int or release["version"] < 1 or release["immutable"] is not True:
        raise ValueError("release version must be a positive immutable version")
    if release["status"] != "published" or release["channel"] not in CHANNELS:
        raise ValueError("release status or channel is invalid")
    _required_text(release, "title", "release")
    if "summary" in release:
        _required_text(release, "summary", "release")
    body = release["body"]
    if not isinstance(body, Mapping) or body.get("format") != "markdown":
        raise ValueError("release.body must be a markdown object")
    _require_exact_keys(body, {"format", "content"}, "release.body")
    _required_text(body, "content", "release.body")
    if not isinstance(release["media"], list):
        raise ValueError("release.media must be a list")
    media_ids: set[str] = set()
    for media in release["media"]:
        if not isinstance(media, Mapping) or any(not media.get(key) for key in ("id", "url", "alt_text", "checksum")) or not isinstance(media.get("alt_text"), str) or not _SHA256.fullmatch(str(media["checksum"])):
            raise ValueError("release.media items require id, url, alt_text, and sha256 checksum")
        _require_exact_keys(media, {"id", "url", "alt_text", "checksum"}, "release.media[]")
        _require_id(media["id"], "media.id")
        if media["id"] in media_ids:
            raise ValueError("release.media IDs must be unique")
        media_ids.add(media["id"])
        _safe_resource_ref(media["url"], "media.url")
    seo = release["seo"]
    if not isinstance(seo, Mapping) or not all(isinstance(seo.get(key), str) and seo[key].strip() for key in ("title", "description", "canonical_url")):
        raise ValueError("release.seo requires title, description, and canonical_url")
    _require_exact_keys(seo, {"title", "description", "canonical_url"}, "release.seo")
    _safe_resource_ref(seo["canonical_url"], "seo.canonical_url")
    qa = release["qa_receipt"]
    if not isinstance(qa, Mapping) or qa.get("decision") != "pass" or not all(qa.get(key) for key in ("receipt_ref", "checked_at")):
        raise ValueError("release requires a passing QA receipt")
    _require_exact_keys(qa, {"decision", "receipt_ref", "checked_at"}, "release.qa_receipt")
    _require_id(qa["receipt_ref"], "qa_receipt.receipt_ref")
    _require_timestamp(qa["checked_at"], "qa_receipt.checked_at")
    approval = release["approval_receipt"]
    if not isinstance(approval, Mapping) or approval.get("decision") != "approve" or not all(approval.get(key) for key in ("receipt_ref", "decided_at")):
        raise ValueError("release requires an approval receipt with approve decision")
    _require_exact_keys(approval, {"decision", "receipt_ref", "decided_at"}, "release.approval_receipt")
    _require_id(approval["receipt_ref"], "approval_receipt.receipt_ref")
    _require_timestamp(approval["decided_at"], "approval_receipt.decided_at")
    provenance = release["provenance"]
    checksums = provenance.get("artifact_checksums") if isinstance(provenance, Mapping) else None
    if not isinstance(provenance, Mapping) or not provenance.get("trace_id") or not isinstance(checksums, Mapping) or not checksums or any(not _SHA256.fullmatch(str(value)) for value in checksums.values()):
        raise ValueError("release requires provenance and artifact checksums")
    _require_exact_keys(provenance, {"trace_id", "artifact_checksums"}, "release.provenance")
    if not isinstance(provenance["trace_id"], str) or not _CORRELATION_ID.fullmatch(provenance["trace_id"]):
        raise ValueError("release.provenance.trace_id must be a safe trace identifier")
    expected_checksums = {
        "body": canonical_sha256(body),
        "seo": canonical_sha256(seo),
        **{f"media:{item['id']}": item["checksum"] for item in release["media"]},
    }
    if set(checksums) != set(expected_checksums) or any(checksums.get(key) != expected for key, expected in expected_checksums.items()):
        raise ValueError("release artifact checksums are missing or do not match public artifacts")
    sanitization = release["sanitization_receipts"]
    if not isinstance(sanitization, Mapping):
        raise ValueError("release requires sanitization receipts")
    _require_exact_keys(sanitization, {"pii_scan", "secret_scan"}, "release.sanitization_receipts")
    for scan_name in ("pii_scan", "secret_scan"):
        scan = sanitization.get(scan_name)
        if not isinstance(scan, Mapping) or scan.get("status") != "passed" or not all(scan.get(key) for key in ("receipt_id", "scanned_at")):
            raise ValueError(f"release requires a passed {scan_name}")
        _require_exact_keys(scan, {"status", "receipt_id", "scanned_at"}, f"release.sanitization_receipts.{scan_name}")
        _require_id(scan["receipt_id"], f"sanitization_receipts.{scan_name}.receipt_id")
        _require_timestamp(scan["scanned_at"], f"sanitization_receipts.{scan_name}.scanned_at")
    _require_timestamp(release["published_at"], "release.published_at")
    public = {key: deepcopy(release[key]) for key in ("schema", "tool_id", "project_id", "workspace_id", "settings_revision", "pipeline_id", "pipeline_version", "consumer_compatibility", "release_id", "content_id", "version", "immutable", "status", "channel", "title", "summary", "body", "media", "seo", "qa_receipt", "approval_receipt", "provenance", "sanitization_receipts", "published_at") if key in release}
    public["release_hash"] = canonical_sha256(public)
    return public


def build_withdrawal_tombstone(*, tombstone_id: str, release_id: str, release_hash: str, signed_by: str, signature: str, withdrawn_at: str) -> dict[str, str]:
    """Create a separate signed tombstone; it never mutates the release."""
    for value, label in ((tombstone_id, "tombstone_id"), (release_id, "release_id"), (signed_by, "signed_by")):
        _require_id(value, label)
    if not _SHA256.fullmatch(release_hash) or not signature.strip() or not withdrawn_at.strip():
        raise ValueError("withdrawal tombstone requires release hash, signature, and timestamp")
    return {"kind": "withdrawal-tombstone", "tombstone_id": tombstone_id, "release_id": release_id, "release_hash": release_hash, "signed_by": signed_by, "signature": signature, "withdrawn_at": withdrawn_at}

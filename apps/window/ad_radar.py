"""Ad Radar's safe Frank/Hermes boundary.

Frank validates operator intent and projects already-redacted Hermes state. It
does not execute the research pipeline or persist a second copy of its data.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
from typing import Any
from urllib.parse import quote, urlsplit

from tool_apps.canonical import canonical_sha256


TOOL_ID = "ad-intelligence"
ACTION = "run"
PIPELINE = ("discover", "resolve", "capture", "normalize", "classify", "media-qa", "publish")
RUN_ID = re.compile(r"trun_[0-9a-f]{32}")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$")
SAFE_ARTIFACT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$")
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
OPERATION_ID = re.compile(r"^op_[0-9a-f]{32}$")
ISO_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
ALLOWED_REQUEST_FIELDS = frozenset({
    "project_id", "name", "markets", "advertisers", "query_terms",
    "include_surrounding", "settings_revision", "source_ids", "operation_id",
})
RUN_STATUSES = frozenset({
    "queued", "ready", "running", "paused", "retryable_failure",
    "quarantined", "awaiting_approval", "published", "completed",
    "failed", "cancelled", "cancelling",
})
ATTENTION_STATUSES = frozenset({"retryable_failure", "quarantined", "awaiting_approval", "failed"})
RUN_STATUS_DIALECT = {
    "waiting_for_approval": "awaiting_approval",
    "blocked": "quarantined",
    "cancelling": "cancelling",
}
EVENT_STATUSES = frozenset({"queued", "running", "ok", "blocked", "error", "completed", "cancelled", "quarantined"})
EVENT_KINDS = frozenset({
    "command.accepted", "run.started", "run.paused", "run.cancelled", "run.failed",
    "run.interrupted", "run.quarantined", "run.completed", "stage.started",
    "stage.completed", "stage.failed", "stage.retrying", "creative.observed",
    "creative.normalized", "classification.recorded", "media-qa.recorded",
    "approval.requested", "approval.approved", "approval.rejected",
    "release.published", "publish.completed",
    "run-started", "stage-completed", "run-quarantined", "publish-completed",
    "settings-validation-completed", "settings-revision-activated", "connection-check-completed",
    "run-paused", "run-resumed", "run-cancelled", "run-completed",
    "stage-started", "stage-retry-scheduled", "stage-failed", "health-snapshot-recorded",
    "creative-observed", "advertiser-resolved", "evidence-captured", "creative-normalized",
    "creative-recapture-completed", "creative-reclassified", "creative-archived", "creative-restored",
    "classification-completed", "media-qa-completed", "creative-quarantined",
    "creative-approved", "creative-rejected", "quarantine-resolved",
    "approval-requested", "approval-recorded", "publish-started", "publish-failed",
    "release-verified", "release-superseded",
})
PRIVATE_SCHEME = re.compile(r"^(?:file|vault|openbao|secret|private):", re.IGNORECASE)
PRIVATE_TEXT = re.compile(
    r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d|"
    r"\b(?:password|passphrase|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\b|"
    r"-----BEGIN|[A-Za-z]:\\|/(?:home|srv|opt|projects|root|tmp|var|etc)/)",
    re.IGNORECASE,
)


def _load_ad_intelligence_core():
    module_name = "_frank_ad_intelligence_core"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    path = Path(__file__).resolve().parent / "tools" / "ad-intelligence" / "core.py"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Ad Intelligence contract loader is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


AD_INTELLIGENCE_CORE = _load_ad_intelligence_core()


class AdRadarInputError(ValueError):
    """An operator request cannot cross the Frank/Hermes boundary."""


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _sequence(value: Any) -> Sequence[Any]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return value
    return ()


def _text(value: Any, *, limit: int, private_fallback: str = "") -> str:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()[:limit]
    if not text:
        return ""
    return private_fallback if PRIVATE_TEXT.search(text) else text


def _input_text(value: Any, label: str, *, limit: int) -> str:
    text = _text(value, limit=limit)
    if value not in (None, "") and not text:
        raise AdRadarInputError(f"{label} contains unsupported or private text")
    return text


def _input_list(value: Any, label: str, *, item_limit: int, max_items: int) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise AdRadarInputError(f"{label} must be a list")
    if len(value) > max_items:
        raise AdRadarInputError(f"{label} accepts at most {max_items} values")
    output: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        text = _input_text(item, f"{label}[{index}]", limit=item_limit)
        if not text:
            continue
        folded = text.casefold()
        if folded not in seen:
            seen.add(folded)
            output.append(text)
    return output


def _safe_id(value: Any, *, limit: int = 160) -> str:
    text = _text(value, limit=limit)
    return text if text and SAFE_ID.fullmatch(text) else ""


def _safe_ref(value: Any) -> str:
    text = _text(value, limit=500)
    if not text or PRIVATE_SCHEME.match(text):
        return ""
    try:
        parsed = urlsplit(text)
    except ValueError:
        return ""
    if parsed.scheme in {"http", "https"}:
        if not parsed.netloc or parsed.username or parsed.password:
            return ""
        return text
    if parsed.scheme:
        return text if parsed.scheme in {"source", "media", "evidence", "receipt", "trace", "settings"} else ""
    return text if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/~-]{0,299}", text) else ""


def _iso_time(value: Any) -> str | None:
    text = str(value).strip()[:40] if isinstance(value, str) else ""
    return text if ISO_TIME.fullmatch(text) else None


def _number(value: Any, *, minimum: float | None = None, maximum: float | None = None) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result):
        return None
    if minimum is not None:
        result = max(minimum, result)
    if maximum is not None:
        result = min(maximum, result)
    return result


def _integer(value: Any, *, minimum: int = 0, maximum: int = 2_147_483_647) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if int(value) != value:
        return None
    return min(maximum, max(minimum, int(value)))


def build_run_command(
    body: Any,
    *,
    project_id: str,
    project_context: str,
    request_id: str,
) -> dict[str, Any]:
    """Validate one manual research request and build the Hermes command."""
    if not isinstance(body, Mapping):
        raise AdRadarInputError("request body must be an object")
    unknown = set(body) - ALLOWED_REQUEST_FIELDS
    if unknown:
        raise AdRadarInputError(f"unsupported request fields: {', '.join(sorted(unknown))}")
    raw_operation_id = body.get("operation_id")
    operation_id = raw_operation_id.strip().lower() if isinstance(raw_operation_id, str) else ""
    if not OPERATION_ID.fullmatch(operation_id):
        raise AdRadarInputError("operation_id must be an opaque Frank operation id")
    settings_revision = body.get("settings_revision", 1)
    if isinstance(settings_revision, bool) or not isinstance(settings_revision, int) or settings_revision < 1:
        raise AdRadarInputError("settings_revision must be a positive integer")
    include_surrounding = body.get("include_surrounding", True)
    if not isinstance(include_surrounding, bool):
        raise AdRadarInputError("include_surrounding must be true or false")
    source_ids = _input_list(body.get("source_ids"), "source_ids", item_limit=80, max_items=20)
    if any(not SAFE_ID.fullmatch(item) for item in source_ids):
        raise AdRadarInputError("source_ids must contain opaque source identifiers")

    if not isinstance(project_context, str) or not project_context.strip():
        raise AdRadarInputError("project_context must be supplied by Frank")
    payload = {
        "job_name": _input_text(body.get("name"), "name", limit=70) or "Ad Radar research",
        "research_brief": {
            "markets": _input_list(body.get("markets"), "markets", item_limit=80, max_items=20),
            "advertisers": _input_list(body.get("advertisers"), "advertisers", item_limit=100, max_items=50),
            "query_terms": _input_list(body.get("query_terms"), "query_terms", item_limit=100, max_items=30),
            "include_surrounding": include_surrounding,
        },
        "source_ids": source_ids,
        "settings_revision": settings_revision,
        "project_context": project_context,
    }
    if not any((payload["research_brief"]["markets"], payload["research_brief"]["advertisers"], payload["research_brief"]["query_terms"], source_ids)):
        raise AdRadarInputError("add at least one market, advertiser, query term, or source")
    # Bind network replay identity to both the client operation and Frank's
    # normalized command. The key remains within Hermes' 128-character limit.
    payload_fingerprint = canonical_sha256(payload)[:32]
    return {
        "schema": "schema://hermes.tool-run-command/v1",
        "request_id": request_id,
        "tool_id": TOOL_ID,
        "action": ACTION,
        "scope": {"project_id": project_id},
        "payload": payload,
        "idempotency_key": f"ad-radar:{project_id}:{operation_id}:{payload_fingerprint}",
    }


def _public_copy(value: Any) -> dict[str, str | None]:
    source = _mapping(value)
    return {
        "headline": _text(source.get("headline"), limit=300, private_fallback="Protected public copy") or None,
        "body": _text(source.get("body"), limit=2_000, private_fallback="Protected public copy") or None,
        "cta": _text(source.get("cta"), limit=120, private_fallback="Protected public copy") or None,
    }


def _public_classification(value: Any) -> dict[str, Any] | None:
    source = _mapping(value)
    label = _text(source.get("label"), limit=100, private_fallback="")
    confidence = _number(source.get("confidence"), minimum=0, maximum=1)
    if not label or confidence is None:
        return None
    return {
        "label": label,
        "confidence": confidence,
        "receipt_refs": [ref for ref in (_safe_ref(item) for item in _sequence(source.get("receipt_refs"))) if ref][:20],
        "provenance_refs": [ref for ref in (_safe_ref(item) for item in _sequence(source.get("provenance_refs"))) if ref][:20],
    }


def _public_media(value: Any) -> dict[str, Any] | None:
    source = _mapping(value)
    asset_ref = _safe_ref(source.get("asset_ref"))
    kind = _text(source.get("kind"), limit=30)
    if not asset_ref or kind not in {"image", "video", "carousel"} or source.get("qa_status") != "passed":
        return None
    return {
        "asset_ref": asset_ref,
        "kind": kind,
        "width": _integer(source.get("width")) if source.get("width") is not None else None,
        "height": _integer(source.get("height")) if source.get("height") is not None else None,
        "qa_status": "passed",
    }


def public_creative(value: Any) -> dict[str, Any] | None:
    source = _mapping(value)
    creative_id = _safe_id(source.get("id"))
    source_ref = _safe_ref(source.get("source_ref"))
    if not creative_id or not source_ref:
        return None
    observed = _mapping(source.get("observed"))
    media = [item for item in (_public_media(raw) for raw in _sequence(source.get("media"))) if item]
    return {
        "id": creative_id,
        "source_ref": source_ref,
        "advertiser": _text(source.get("advertiser"), limit=180, private_fallback="Protected advertiser") or None,
        "market": _text(source.get("market"), limit=120, private_fallback="") or None,
        "category": _text(source.get("category"), limit=120, private_fallback="") or None,
        "copy": _public_copy(source.get("copy")),
        "destination_ref": _safe_ref(source.get("destination_ref")) or None,
        "observed": {
            "first_seen": _iso_time(observed.get("first_seen")),
            "last_seen": _iso_time(observed.get("last_seen")),
        },
        "media": media[:12],
        "classification": _public_classification(source.get("classification")),
    }


def _public_receipt(value: Any) -> dict[str, Any] | None:
    source = _mapping(value)
    receipt_ref = _safe_ref(source.get("receipt_ref") or source.get("ref") or source.get("receipt_id"))
    if not receipt_ref:
        return None
    stage = _text(source.get("stage"), limit=30)
    return {
        "kind": _text(source.get("kind"), limit=40) or "runtime",
        "receipt_ref": receipt_ref,
        "status": _text(source.get("status") or source.get("decision"), limit=40) or "recorded",
        "stage": stage if stage in PIPELINE else None,
        "recorded_at": _iso_time(source.get("recorded_at") or source.get("checked_at") or source.get("scanned_at")),
    }


def _public_release(value: Any) -> dict[str, Any] | None:
    source = _mapping(value)
    try:
        validated = AD_INTELLIGENCE_CORE.AdIntelligenceRelease(
            release_id=source.get("release_id"),
            version=source.get("version"),
            status=source.get("status"),
            released_at=source.get("released_at"),
            immutable=source.get("immutable"),
            project_scope=source.get("project_scope"),
            checksum=source.get("checksum"),
            provenance_refs=tuple(_sequence(source.get("provenance_refs"))),
            trace_refs=tuple(_sequence(source.get("trace_refs"))),
            settings_revision=source.get("settings_revision"),
            settings_ref=source.get("settings_ref"),
            qa_receipt=source.get("qa_receipt"),
            sanitization_receipts=source.get("sanitization_receipts"),
            release_hash=source.get("release_hash"),
            public_export=source.get("public_export"),
            schema=source.get("schema"),
            tool_id=source.get("tool_id"),
            pipeline_id=source.get("pipeline_id"),
            pipeline_version=source.get("pipeline_version"),
            consumer_compatibility=tuple(_sequence(source.get("consumer_compatibility"))),
        )
    except (TypeError, ValueError):
        return None
    source = validated.to_dict()
    if (
        source.get("schema") != "schema://frank.ad-intelligence-release/v1"
        or source.get("tool_id") != TOOL_ID
        or source.get("pipeline_id") != "ad-radar-pipeline"
        or source.get("pipeline_version") != "1.0.0"
        or source.get("consumer_compatibility") != ["ad-intelligence-public-v1"]
        or source.get("status") != "released"
        or source.get("immutable") is not True
    ):
        return None
    checksum = _text(source.get("checksum"), limit=64)
    release_hash = _text(source.get("release_hash"), limit=64)
    revision = source.get("settings_revision")
    if not HEX_64.fullmatch(checksum) or not HEX_64.fullmatch(release_hash) or isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        return None
    public_export = _mapping(source.get("public_export"))
    if public_export.get("schema") != "schema://frank.ad-intelligence-public/v1":
        return None
    release_id = _safe_id(source.get("release_id"))
    project_scope = _safe_id(source.get("project_scope"))
    settings_ref = _safe_ref(source.get("settings_ref"))
    released_at = _iso_time(source.get("released_at"))
    export_project = _safe_id(public_export.get("project"))
    generated_at = _iso_time(public_export.get("generated_at"))
    if not all((release_id, project_scope, settings_ref, released_at, export_project, generated_at)) or export_project != project_scope:
        return None
    creative_count = len(_sequence(public_export.get("creatives")))
    qa = _mapping(source.get("qa_receipt"))
    scans = _mapping(source.get("sanitization_receipts"))
    pii_scan = _mapping(scans.get("pii_scan"))
    secret_scan = _mapping(scans.get("secret_scan"))
    if qa.get("decision") != "pass" or pii_scan.get("status") != "passed" or secret_scan.get("status") != "passed":
        return None
    return {
        "schema": source["schema"],
        "release_id": release_id,
        "version": _text(source.get("version"), limit=40),
        "status": "released",
        "released_at": released_at,
        "immutable": True,
        "project_scope": project_scope,
        "checksum": checksum,
        "release_hash": release_hash,
        "settings_revision": revision,
        "settings_ref": settings_ref,
        "provenance_refs": [ref for ref in (_safe_ref(item) for item in _sequence(source.get("provenance_refs"))) if ref][:100],
        "trace_refs": [ref for ref in (_safe_ref(item) for item in _sequence(source.get("trace_refs"))) if ref][:100],
        "qa_receipt": _public_receipt({"kind": "qa", **qa}),
        "sanitization_receipts": [
            _public_receipt({"kind": "pii-scan", **pii_scan}),
            _public_receipt({"kind": "secret-scan", **secret_scan}),
        ],
        # This exact export is used only to derive the bounded run projection
        # below.  It is removed from the HTTP response so the signed checksum is
        # never presented beside a filtered or truncated lookalike payload.
        "public_export": public_export,
        "creative_count": creative_count,
    }


def _validated_public_export(value: Any) -> dict[str, Any] | None:
    try:
        return AD_INTELLIGENCE_CORE.validate_public_export(value)
    except (TypeError, ValueError):
        return None


def _creative_states(value: Any) -> dict[str, dict[str, Any]]:
    allowed_statuses = {"recorded", "active", "new", "changed", "quarantined", "approved", "stopped", "published"}
    states: dict[str, dict[str, Any]] = {}
    for raw in _sequence(value):
        item = _mapping(raw)
        creative_id = _safe_id(item.get("creative_id"))
        status = _text(item.get("status"), limit=30).lower()
        if not creative_id or status not in allowed_statuses:
            continue
        states[creative_id] = {
            "status": status,
            "observation_id": _safe_id(item.get("observation_id")) or None,
            "receipt_refs": [
                ref for ref in (_safe_ref(candidate) for candidate in _sequence(item.get("receipt_refs"))) if ref
            ][:20],
        }
    return states


def public_run(run: Any) -> dict[str, Any]:
    """Project one Hermes Tool run into Frank's operator-safe shape."""
    source = _mapping(run)
    payload = _mapping(source.get("payload"))
    scope = _mapping(source.get("scope"))
    project_id = _safe_id(scope.get("project_id") or payload.get("project_id"))
    output = _mapping(source.get("output"))
    raw_run_id = _text(source.get("id") or source.get("run_id"), limit=80)
    run_id = raw_run_id if RUN_ID.fullmatch(raw_run_id) else ""
    raw_status = _text(source.get("status"), limit=40)
    status = RUN_STATUS_DIALECT.get(raw_status, raw_status)
    stage = _text(source.get("stage"), limit=40)
    status = status if status in RUN_STATUSES else "queued"
    stage = stage if stage in PIPELINE else PIPELINE[0]
    brief = _mapping(payload.get("research_brief"))
    metrics_source = _mapping(output.get("metrics"))
    metrics = {
        key: _integer(metrics_source.get(key)) or 0
        for key in ("discovered", "resolved", "captured", "normalized", "classified", "media_ready", "quarantined", "published")
    }
    release = _public_release(output.get("release"))
    if release and release.get("project_scope") != project_id:
        release = None
    payload_revision = _integer(payload.get("settings_revision"), minimum=1) or 1
    approval_source = _mapping(output.get("approval"))
    approval_checksum = _text(approval_source.get("expected_checksum"), limit=64)
    approval_revision = _integer(approval_source.get("expected_settings_revision"), minimum=1)
    candidate_export = _validated_public_export(output.get("public_export"))
    candidate_valid = bool(
        candidate_export
        and candidate_export.get("project") == project_id
        and HEX_64.fullmatch(approval_checksum)
        and approval_revision == payload_revision
        and canonical_sha256(candidate_export) == approval_checksum
    )
    approval = None
    if candidate_valid:
        approval = {
            "expected_checksum": approval_checksum,
            "expected_settings_revision": approval_revision,
            "state": _text(approval_source.get("state"), limit=40) or "pending",
            "summary": _text(
                approval_source.get("summary"),
                limit=300,
                private_fallback="Protected approval detail is available in Hermes.",
            ) or None,
            "receipt_ref": _safe_ref(approval_source.get("receipt_ref")) or None,
        }
    visible_export = release.get("public_export") if release else candidate_export if approval else None
    states = _creative_states(output.get("creative_states"))
    creatives = []
    for raw in _sequence(_mapping(visible_export).get("creatives")):
        item = public_creative(raw)
        if not item:
            continue
        item["lifecycle"] = states.get(item["id"], {
            "status": "published" if release else "recorded",
            "observation_id": None,
            "receipt_refs": [],
        })
        creatives.append(item)
        if len(creatives) >= 200:
            break
    creative_ids = {item["id"] for item in creatives}
    receipts = [item for item in (_public_receipt(raw) for raw in _sequence(output.get("receipts"))) if item][:100]
    previews = []
    for raw in _sequence(output.get("previews")):
        item = _mapping(raw)
        name = _text(item.get("name"), limit=120)
        creative_id = _safe_id(item.get("creative_id"))
        kind = _text(item.get("kind"), limit=20)
        if run_id and creative_id in creative_ids and kind in {"image", "video"} and SAFE_ARTIFACT.fullmatch(name):
            previews.append({
                "creative_id": creative_id,
                "name": name,
                "kind": kind,
                "url": (
                    f"/api/ad-radar/runs/{quote(run_id, safe='')}/artifacts/{quote(name, safe='')}"
                    f"?project_id={quote(project_id, safe='')}"
                ),
            })
    health = _mapping(output.get("health"))
    health_status = _text(health.get("status"), limit=30)
    if health_status not in {"ready", "degraded", "blocked", "unavailable", "error"}:
        health_status = "unavailable"
    usage_source = _mapping(output.get("usage"))
    return {
        "id": run_id,
        "request_id": _text(source.get("request_id"), limit=80),
        "status": status,
        "stage": stage,
        "progress": _number(source.get("progress"), minimum=0, maximum=1) or 0,
        "attention": bool(source.get("attention")) or status in ATTENTION_STATUSES,
        "created_at": _iso_time(source.get("created_at")),
        "updated_at": _iso_time(source.get("updated_at")) or _iso_time(source.get("created_at")),
        "title": _text(source.get("title") or payload.get("job_name"), limit=100, private_fallback="Ad Radar research") or "Ad Radar research",
        "project_id": project_id,
        "settings_revision": payload_revision,
        "brief": {
            "markets": [_text(item, limit=80) for item in _sequence(brief.get("markets")) if _text(item, limit=80)][:20],
            "advertisers": [_text(item, limit=100, private_fallback="Protected advertiser") for item in _sequence(brief.get("advertisers")) if _text(item, limit=100, private_fallback="")][:50],
            "query_terms": [_text(item, limit=100) for item in _sequence(brief.get("query_terms")) if _text(item, limit=100)][:30],
            "include_surrounding": bool(brief.get("include_surrounding")),
        },
        "source_ids": [_safe_id(item, limit=80) for item in _sequence(payload.get("source_ids")) if _safe_id(item, limit=80)][:20],
        "metrics": metrics,
        "creatives": creatives,
        "previews": previews[:200],
        "receipts": receipts,
        "approval": approval,
        "release": (
            {key: value for key, value in release.items() if key != "public_export"}
            if release else None
        ),
        "health": {
            "status": health_status,
            "stage": _text(health.get("stage"), limit=30) if _text(health.get("stage"), limit=30) in PIPELINE else None,
            "last_run_at": _iso_time(health.get("last_run_at")),
            "published": _integer(health.get("published")) or 0,
            "quarantined": _integer(health.get("quarantined")) or 0,
        },
        "cost": _number(_mapping(output.get("cost")).get("reported_usd"), minimum=0),
        "usage": {
            key: _integer(usage_source.get(key))
            for key in ("input_tokens", "output_tokens", "total_tokens")
            if _integer(usage_source.get(key)) is not None
        },
        **({
            "error": {
                "code": "ad_radar_run_failed",
                "summary": "The run needs attention. Protected diagnostics remain in Hermes.",
            },
        } if source.get("error") else {}),
    }


def public_run_summary(run: Any) -> dict[str, Any]:
    """Return list-safe run metadata; full evidence is hydrated from the run endpoint."""
    result = public_run(run)
    result["creative_count"] = len(result.get("creatives") or [])
    result["preview_count"] = len(result.get("previews") or [])
    result["receipt_count"] = len(result.get("receipts") or [])
    result["creatives"] = []
    result["previews"] = []
    result["receipts"] = []
    if isinstance(result.get("release"), dict):
        result["release"] = {
            key: result["release"].get(key)
            for key in ("release_id", "version", "status", "released_at", "checksum", "release_hash")
        }
    return result


def public_event(value: Any) -> dict[str, Any]:
    """Reduce one Hermes ledger event to the operator-safe live contract."""
    source = _mapping(value)
    sequence = _integer(source.get("sequence"), maximum=9_007_199_254_740_991)
    raw_kind = _text(source.get("kind"), limit=80)
    kind = raw_kind if raw_kind in EVENT_KINDS else "run.activity"
    status = _text(source.get("status"), limit=30)
    if status not in EVENT_STATUSES:
        status = "running"
    node_id = _text(source.get("node_id"), limit=30)
    data = _mapping(source.get("data"))
    safe_data: dict[str, Any] = {}

    for key, limit in (("summary", 240), ("reason", 300), ("error", 500)):
        if data.get(key) not in (None, ""):
            safe_data[key] = _text(
                data.get(key),
                limit=limit,
                private_fallback="Protected operational detail is available in Hermes.",
            )
    for key in ("attempt", "count", "discovered", "captured", "classified", "quarantined", "published"):
        number = _integer(data.get(key), maximum=10_000_000)
        if number is not None:
            safe_data[key] = number
    for key in ("progress", "confidence", "duration_seconds"):
        number = _number(data.get(key), minimum=0, maximum=1 if key != "duration_seconds" else 86_400)
        if number is not None:
            safe_data[key] = number
    for key in ("will_resume", "attention"):
        if isinstance(data.get(key), bool):
            safe_data[key] = data[key]
    for key in (
        "creative_id", "release_id", "receipt_id", "source_id", "observation_id",
        "classification_id", "media_reference_id",
    ):
        identifier = _safe_id(data.get(key))
        if identifier:
            safe_data[key] = identifier
    for key in ("receipt_ref", "source_ref", "evidence_ref"):
        reference = _safe_ref(data.get(key))
        if reference:
            safe_data[key] = reference
    for key in ("from_stage", "to_stage", "stage"):
        stage = _text(data.get(key), limit=30)
        if stage in PIPELINE:
            safe_data[key] = stage
    change = _text(data.get("change"), limit=30)
    if change in {"new", "changed", "stopped", "active", "quarantined", "approved", "published"}:
        safe_data["change"] = change
    advertiser = _text(data.get("advertiser"), limit=180, private_fallback="Protected advertiser")
    if advertiser:
        safe_data["advertiser"] = advertiser
    checksum = _text(data.get("checksum") or data.get("sha256"), limit=64)
    if HEX_64.fullmatch(checksum):
        safe_data["checksum"] = checksum
    choices = [
        choice for choice in (_text(item, limit=40) for item in _sequence(data.get("choices")))
        if choice in {"approve", "reject", "retry", "pause", "cancel"}
    ]
    if choices:
        safe_data["choices"] = choices[:5]

    return {
        "sequence": sequence if sequence is not None else 0,
        "kind": kind,
        "status": status,
        "timestamp": source.get("timestamp") if _number(source.get("timestamp"), minimum=0) is not None else _iso_time(source.get("timestamp")),
        "node_id": node_id if node_id in PIPELINE else None,
        "data": safe_data,
    }


def public_sse_block(lines: Sequence[str]) -> bytes | None:
    """Sanitize one complete SSE block without forwarding upstream event text."""
    if not lines:
        return None
    if all(line.startswith(":") for line in lines):
        return b": keepalive\n\n"
    data_lines = [line[5:].lstrip() for line in lines if line.startswith("data:")]
    if not data_lines:
        return None
    try:
        raw = json.loads("\n".join(data_lines))
    except (json.JSONDecodeError, TypeError):
        raw = {"kind": "run.activity", "status": "running", "data": {}}
    event = public_event(raw)
    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    return (
        f"id: {event['sequence']}\n"
        f"event: {event['kind']}\n"
        f"data: {payload}\n\n"
    ).encode("utf-8")


def retry_payload(body: Any) -> dict[str, Any]:
    if not isinstance(body, Mapping):
        raise AdRadarInputError("retry body must be an object")
    source = _mapping(body)
    if set(source) - {"from_stage"}:
        raise AdRadarInputError("retry accepts only from_stage")
    stage = _text(source.get("from_stage"), limit=30)
    if stage and stage not in PIPELINE:
        raise AdRadarInputError("from_stage is not part of the Ad Radar pipeline")
    return {"from_stage": stage} if stage else {}


def pause_payload(body: Any) -> dict[str, Any]:
    if not isinstance(body, Mapping):
        raise AdRadarInputError("pause body must be an object")
    source = _mapping(body)
    if set(source) - {"reason"}:
        raise AdRadarInputError("pause accepts only reason")
    return {"reason": _input_text(source.get("reason"), "reason", limit=300)}


def resume_payload(body: Any) -> dict[str, Any]:
    if not isinstance(body, Mapping):
        raise AdRadarInputError("resume body must be an object")
    if body:
        raise AdRadarInputError("resume accepts an empty object")
    return {}


def approval_payload(body: Any) -> dict[str, Any]:
    if not isinstance(body, Mapping):
        raise AdRadarInputError("approval body must be an object")
    source = _mapping(body)
    if set(source) - {"reason", "expected_checksum", "expected_settings_revision"}:
        raise AdRadarInputError("approval contains unsupported fields")
    checksum = _text(source.get("expected_checksum"), limit=64)
    revision = source.get("expected_settings_revision")
    if not HEX_64.fullmatch(checksum):
        raise AdRadarInputError("expected_checksum must be a SHA-256 checksum")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise AdRadarInputError("expected_settings_revision must be a positive integer")
    return {
        "decision": "approve",
        "reason": _input_text(source.get("reason"), "reason", limit=500),
        "expected_checksum": checksum,
        "expected_settings_revision": revision,
    }

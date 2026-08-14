"""Provider-neutral Ad Radar data contracts and public boundary."""

from dataclasses import asdict, dataclass, field
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from types import MappingProxyType
from typing import Any

def _load_pipeline_stages() -> tuple[str, ...]:
    manifest = json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8"))
    pipelines = manifest.get("pipelines") or []
    if len(pipelines) != 1 or not isinstance(pipelines[0].get("nodes"), list):
        raise ValueError("Ad Radar manifest must define one named pipeline with nodes")
    stages = tuple(node.get("id") for node in pipelines[0]["nodes"])
    if not stages or any(not isinstance(stage, str) for stage in stages):
        raise ValueError("Ad Radar pipeline nodes must have string IDs")
    return stages

PIPELINE_STAGES = _load_pipeline_stages()
RELEASE_SCHEMA = "schema://frank.ad-intelligence-release/v1"
TOOL_ID = "ad-intelligence"

_PIPELINE_MANIFEST = json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8"))["pipelines"][0]
PIPELINE_ID = _PIPELINE_MANIFEST["id"]
PIPELINE_VERSION = _PIPELINE_MANIFEST["version"]

_HTML = re.compile(r"</?[a-z][^>]*>|javascript\s*:", re.IGNORECASE)
_FORBIDDEN_KEY = re.compile(
    r"^(?:email|phone|prospect|prospectid|outreach|outreachsequence|agentcontacts?|contactid|recipient|leademail|phonenumber|contactemail|promptref|promptversion|model|rationale|rawpayload|secret|token|apikey|password)$",
    re.IGNORECASE,
)
_PRIVATE_VALUE = re.compile(r"(?:bearer\s+[a-z0-9._~+/=-]{16,}|(?:sk|pk|rk)_(?:live|test)_[a-z0-9]+|-----begin [a-z ]+-----)", re.IGNORECASE)
_PII_VALUE = re.compile(r"(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d)")
_PRIVATE_REF = re.compile(r"^(?:openbao|vault|secret|file)://", re.IGNORECASE)

def _safe_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be non-empty text")
    if _HTML.search(value):
        raise ValueError(f"{field_name} contains HTML or executable markup")
    if _PRIVATE_VALUE.search(value):
        raise ValueError(f"{field_name} contains secret-like text")
    return value

def _reject_unsafe_keys(value: Any, path: str = "public") -> None:
    """Defense in depth for malformed dicts passed to typed public records."""
    if isinstance(value, dict):
        for key, child in value.items():
            if _FORBIDDEN_KEY.fullmatch(re.sub(r"[^a-z0-9]", "", str(key))):
                raise ValueError(f"forbidden public field at {path}.{key}")
            _reject_unsafe_keys(child, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _reject_unsafe_keys(child, f"{path}[{index}]")

@dataclass(frozen=True)
class Taxonomy:
    categories: tuple[str, ...] = ()
    markets: tuple[str, ...] = ()
    languages: tuple[str, ...] = ("en",)

@dataclass(frozen=True)
class SourceConfig:
    id: str
    kind: str = "browser"
    locator: str = "configured-by-hermes"
    access: str = "public-only"

@dataclass(frozen=True)
class ClassificationPolicy:
    prompt_ref: str
    prompt_version: str = "1"
    style_preset: str = "neutral"
    allowed_models: tuple[str, ...] = ()
    fallback: str = "quarantine"
    temperature: float = 0.0

@dataclass(frozen=True)
class MediaPolicy:
    required: bool = True
    min_width: int = 640
    min_height: int = 360
    allowed_types: tuple[str, ...] = ("image", "video")
    ocr: bool = False

@dataclass(frozen=True)
class RetryPolicy:
    max_retries: int = 3
    base_delay_seconds: float = 2.0
    max_delay_seconds: float = 60.0

@dataclass(frozen=True)
class ApprovalPolicy:
    publish: str = "human_or_hermes_policy"
    new_source: str = "human"
    low_confidence: str = "quarantine"

@dataclass(frozen=True)
class PublicCopy:
    """Allowlisted copy fields; raw provider payload and HTML have no slot."""
    headline: str | None = None
    body: str | None = None
    cta: str | None = None

    def __post_init__(self):
        for name, value in (("headline", self.headline), ("body", self.body), ("cta", self.cta)):
            if value is not None: _safe_text(value, f"copy.{name}")
        _reject_unsafe_keys(self.__dict__, "copy")

@dataclass(frozen=True)
class PublicObservation:
    first_seen: str | None = None
    last_seen: str | None = None

    def __post_init__(self):
        for name, value in (("first_seen", self.first_seen), ("last_seen", self.last_seen)):
            if value is not None: _safe_text(value, f"observed.{name}")

@dataclass(frozen=True)
class PublicMedia:
    """A reference and QA result, never captured bytes, HTML, or provider payload."""
    asset_ref: str
    kind: str
    width: int | None = None
    height: int | None = None
    qa_status: str = "passed"

    def __post_init__(self):
        _safe_text(self.asset_ref, "media.asset_ref")
        _safe_text(self.kind, "media.kind")
        _safe_text(self.qa_status, "media.qa_status")
        if self.width is not None and (not isinstance(self.width, int) or self.width < 0): raise ValueError("media.width must be non-negative")
        if self.height is not None and (not isinstance(self.height, int) or self.height < 0): raise ValueError("media.height must be non-negative")
        _reject_unsafe_keys(self.__dict__, "media")

@dataclass(frozen=True)
class PublicClassification:
    label: str
    confidence: float
    receipt_refs: tuple[str, ...] = ()
    provenance_refs: tuple[str, ...] = ()

    def __post_init__(self):
        _safe_text(self.label, "classification.label")
        if not isinstance(self.confidence, (int, float)) or not 0 <= self.confidence <= 1: raise ValueError("classification.confidence must be 0..1")
        for name, values in (("receipt_refs", self.receipt_refs), ("provenance_refs", self.provenance_refs)):
            if not isinstance(values, tuple) or any(not isinstance(value, str) for value in values): raise ValueError(f"classification.{name} must contain text refs")
            for value in values: _safe_text(value, f"classification.{name}")
        _reject_unsafe_keys(self.__dict__, "classification")

@dataclass(frozen=True)
class AdIntelligenceManifest:
    id: str = "ad-intelligence"
    version: str = "1.0.0"
    taxonomy: Taxonomy = field(default_factory=Taxonomy)
    sources: tuple[SourceConfig, ...] = ()
    cadence: dict[str, Any] = field(default_factory=lambda: {"mode": "manual", "interval_minutes": None, "timezone": "UTC"})
    classification: ClassificationPolicy = field(default_factory=lambda: ClassificationPolicy("prompt://ad-intelligence/classify/v1"))
    media: MediaPolicy = field(default_factory=MediaPolicy)
    thresholds: dict[str, Any] = field(default_factory=lambda: {"publish_confidence": .8, "max_missing_fields": 2})
    retention: dict[str, int] = field(default_factory=lambda: {"raw_days": 30, "normalized_days": 365, "receipts_days": 730})
    approval: ApprovalPolicy = field(default_factory=ApprovalPolicy)
    retry: RetryPolicy = field(default_factory=RetryPolicy)

    def __post_init__(self):
        if self.id == "": raise ValueError("manifest id is required")
        if not 0 <= float(self.thresholds.get("publish_confidence", 0)) <= 1: raise ValueError("publish confidence must be 0..1")

    @property
    def pipeline(self): return PIPELINE_STAGES

@dataclass(frozen=True)
class PublicCreative:
    id: str
    source_ref: str
    advertiser: str | None = None
    market: str | None = None
    category: str | None = None
    copy: PublicCopy = field(default_factory=PublicCopy)
    destination_ref: str | None = None
    observed: PublicObservation = field(default_factory=PublicObservation)
    media: tuple[PublicMedia, ...] = ()
    classification: PublicClassification | None = None

    def __post_init__(self):
        _safe_text(self.id, "creative.id")
        _safe_text(self.source_ref, "creative.source_ref")
        for name, value in (("advertiser", self.advertiser), ("market", self.market), ("category", self.category), ("destination_ref", self.destination_ref)):
            if value is not None: _safe_text(value, f"creative.{name}")
        if not isinstance(self.copy, PublicCopy): raise ValueError("creative.copy must be PublicCopy")
        if not isinstance(self.observed, PublicObservation): raise ValueError("creative.observed must be PublicObservation")
        if not isinstance(self.media, tuple) or any(not isinstance(item, PublicMedia) for item in self.media): raise ValueError("creative.media must contain PublicMedia")
        if self.classification is not None and not isinstance(self.classification, PublicClassification): raise ValueError("creative.classification must be PublicClassification")
        _reject_unsafe_keys(self.__dict__, "creative")

@dataclass(frozen=True)
class PublicExport:
    schema: str
    project: str
    generated_at: str
    creatives: tuple[PublicCreative, ...]

@dataclass(frozen=True)
class TraceRecord:
    run_id: str
    stage: str
    status: str
    model: str | None = None
    cost: dict[str, Any] = field(default_factory=dict)
    evidence_refs: tuple[str, ...] = ()
    receipt_refs: tuple[str, ...] = ()
    error: str | None = None

@dataclass(frozen=True)
class HealthSnapshot:
    status: str
    last_run_at: str | None
    stage: str | None
    published: int = 0
    quarantined: int = 0
    error: str | None = None

_EXPORT_KEYS = frozenset({"schema", "project", "generated_at", "creatives"})
_CREATIVE_KEYS = frozenset({"id", "source_ref", "advertiser", "market", "category", "copy", "destination_ref", "observed", "media", "classification"})
_COPY_KEYS = frozenset({"headline", "body", "cta"})
_OBSERVED_KEYS = frozenset({"first_seen", "last_seen"})
_MEDIA_KEYS = frozenset({"asset_ref", "kind", "width", "height", "qa_status"})
_CLASSIFICATION_KEYS = frozenset({"label", "confidence", "receipt_refs", "provenance_refs"})

def _release_walk(value: Any, path: str, key: str = "") -> None:
    if isinstance(value, dict):
        _reject_unsafe_keys(value, path)
        for child_key, child in value.items(): _release_walk(child, f"{path}.{child_key}", str(child_key))
    elif isinstance(value, list):
        for index, child in enumerate(value): _release_walk(child, f"{path}[{index}]", key)
    elif isinstance(value, str):
        if _HTML.search(value) or _PRIVATE_VALUE.search(value): raise ValueError(f"unsafe release value at {path}")
        if key not in {"generated_at", "first_seen", "last_seen"} and _PII_VALUE.search(value): raise ValueError(f"PII-like release value at {path}")
    elif value is not None and not isinstance(value, (int, float, bool)):
        raise ValueError(f"unsupported release value at {path}")

def _release_keys(value: Any, allowed: frozenset[str], path: str) -> None:
    if not isinstance(value, dict) or set(value) != allowed: raise ValueError(f"{path} must have only its allowlisted fields")
    _reject_unsafe_keys(value, path)

def _safe_public_ref(value: Any, path: str) -> None:
    if not isinstance(value, str) or not value.strip() or _PRIVATE_REF.search(value) or _PRIVATE_VALUE.search(value): raise ValueError(f"unsafe public ref at {path}")

def _validate_release_export(payload: dict[str, Any]) -> dict[str, Any]:
    _release_keys(payload, _EXPORT_KEYS, "public_export")
    if payload["schema"] != "schema://frank.ad-intelligence-public/v1": raise ValueError("unsupported public export schema")
    if not isinstance(payload["project"], str) or not isinstance(payload["generated_at"], str) or not isinstance(payload["creatives"], list): raise ValueError("invalid public export envelope")
    for index, creative in enumerate(payload["creatives"]):
        path = f"public_export.creatives[{index}]"
        _release_keys(creative, _CREATIVE_KEYS, path)
        for field_name in ("id", "source_ref", "advertiser", "market", "category", "destination_ref"):
            if creative[field_name] is not None and not isinstance(creative[field_name], str): raise ValueError(f"{path}.{field_name} must be text")
        _safe_public_ref(creative["source_ref"], f"{path}.source_ref")
        if creative["destination_ref"] is not None: _safe_public_ref(creative["destination_ref"], f"{path}.destination_ref")
        _release_keys(creative["copy"], _COPY_KEYS, f"{path}.copy")
        _release_keys(creative["observed"], _OBSERVED_KEYS, f"{path}.observed")
        if not isinstance(creative["media"], list): raise ValueError(f"{path}.media must be a list")
        for media_index, media in enumerate(creative["media"]):
            media_path = f"{path}.media[{media_index}]"
            _release_keys(media, _MEDIA_KEYS, media_path)
            if not isinstance(media["asset_ref"], str) or not isinstance(media["kind"], str) or not isinstance(media["qa_status"], str): raise ValueError(f"{media_path} has invalid text")
            _safe_public_ref(media["asset_ref"], f"{media_path}.asset_ref")
            if any(media[field_name] is not None and (not isinstance(media[field_name], int) or media[field_name] < 0) for field_name in ("width", "height")): raise ValueError(f"{media_path} has invalid dimensions")
        classification = creative["classification"]
        if classification is not None:
            classification_path = f"{path}.classification"
            _release_keys(classification, _CLASSIFICATION_KEYS, classification_path)
            if not isinstance(classification["label"], str) or not isinstance(classification["confidence"], (int, float)) or not 0 <= classification["confidence"] <= 1: raise ValueError(f"{classification_path} has invalid result")
            if any(not isinstance(ref, str) for ref in classification["receipt_refs"] + classification["provenance_refs"]): raise ValueError(f"{classification_path} refs must be text")
    _release_walk(payload, "public_export")
    return deepcopy(payload)

def _freeze(value: Any) -> Any:
    if isinstance(value, dict): return MappingProxyType({key: _freeze(child) for key, child in value.items()})
    if isinstance(value, list): return tuple(_freeze(child) for child in value)
    return value

def _thaw(value: Any) -> Any:
    if isinstance(value, MappingProxyType): return {key: _thaw(child) for key, child in value.items()}
    if isinstance(value, tuple): return [_thaw(child) for child in value]
    return value

def _validate_refs(values: tuple[str, ...], field_name: str) -> None:
    if not isinstance(values, tuple) or any(not isinstance(value, str) for value in values): raise ValueError(f"{field_name} must contain text refs")
    for value in values: _safe_text(value, field_name)

@dataclass(frozen=True)
class AdIntelligenceRelease:
    release_id: str
    version: str
    status: str
    immutable: bool
    project_scope: str
    checksum: str
    provenance_refs: tuple[str, ...]
    trace_refs: tuple[str, ...]
    settings_refs: tuple[str, ...]
    qa_receipt_ref: str
    sanitization_receipt_refs: tuple[str, ...]
    qa_approved: bool
    pii_sanitized: bool
    secret_sanitized: bool
    public_export: Any
    schema: str = RELEASE_SCHEMA
    tool_id: str = TOOL_ID
    pipeline_id: str = PIPELINE_ID
    pipeline_version: str = PIPELINE_VERSION
    consumer_compatibility: tuple[str, ...] = ("ad-intelligence-public-v1",)

    def __post_init__(self):
        if self.schema != RELEASE_SCHEMA or self.tool_id != TOOL_ID:
            raise ValueError("release schema or tool identity is invalid")
        if self.pipeline_id != PIPELINE_ID or self.pipeline_version != PIPELINE_VERSION:
            raise ValueError("release pipeline identity or version is invalid")
        for field_name, value in (("release_id", self.release_id), ("version", self.version), ("status", self.status), ("project_scope", self.project_scope), ("checksum", self.checksum)):
            _safe_text(value, field_name)
        if self.status != "released" or self.immutable is not True or not self.qa_approved or not self.pii_sanitized or not self.secret_sanitized: raise ValueError("release must be immutable, released, approved, and sanitized")
        for field_name, values in (("provenance_refs", self.provenance_refs), ("trace_refs", self.trace_refs), ("settings_refs", self.settings_refs), ("sanitization_receipt_refs", self.sanitization_receipt_refs)):
            _validate_refs(values, field_name)
            if not values: raise ValueError(f"{field_name} must not be empty")
        _safe_text(self.qa_receipt_ref, "qa_receipt_ref")
        _validate_refs(self.consumer_compatibility, "consumer_compatibility")
        if not self.consumer_compatibility: raise ValueError("consumer_compatibility must not be empty")
        payload = _validate_release_export(self.public_export)
        checksum = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        if checksum != self.checksum: raise ValueError("release checksum does not match public export")
        object.__setattr__(self, "public_export", _freeze(payload))

    def to_dict(self) -> dict[str, Any]:
        result = {
            "schema": self.schema, "tool_id": self.tool_id,
            "pipeline_id": self.pipeline_id, "pipeline_version": self.pipeline_version,
            "consumer_compatibility": list(self.consumer_compatibility),
            "release_id": self.release_id, "version": self.version, "status": self.status,
            "immutable": self.immutable, "project_scope": self.project_scope,
            "checksum": self.checksum, "provenance_refs": list(self.provenance_refs),
            "trace_refs": list(self.trace_refs), "settings_refs": list(self.settings_refs),
            "qa_receipt_ref": self.qa_receipt_ref,
            "sanitization_receipt_refs": list(self.sanitization_receipt_refs),
            "qa_approved": self.qa_approved, "pii_sanitized": self.pii_sanitized,
            "secret_sanitized": self.secret_sanitized,
        }
        result["public_export"] = _thaw(self.public_export)
        return result

def build_release(release_id: str, version: str, project_scope: str, public_export: dict[str, Any], *, provenance_refs: tuple[str, ...], trace_refs: tuple[str, ...], settings_refs: tuple[str, ...], qa_receipt_ref: str, sanitization_receipt_refs: tuple[str, ...], consumer_compatibility: tuple[str, ...] = ("ad-intelligence-public-v1",)) -> AdIntelligenceRelease:
    payload = _validate_release_export(public_export)
    checksum = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return AdIntelligenceRelease(release_id, version, "released", True, project_scope, checksum, provenance_refs, trace_refs, settings_refs, qa_receipt_ref, sanitization_receipt_refs, True, True, True, payload, consumer_compatibility=consumer_compatibility)

def _json_ready(value: Any) -> Any:
    if isinstance(value, dict): return {key: _json_ready(child) for key, child in value.items()}
    if isinstance(value, tuple): return [_json_ready(child) for child in value]
    return value

def export_public(project: str, generated_at: str, creatives: list[PublicCreative]) -> dict[str, Any]:
    """Serialize only typed, allowlisted public fields; no arbitrary nested payloads."""
    _safe_text(project, "project")
    _safe_text(generated_at, "generated_at")
    if not isinstance(creatives, list) or any(not isinstance(item, PublicCreative) for item in creatives):
        raise ValueError("creatives must be a list of PublicCreative")
    result = asdict(PublicExport("schema://frank.ad-intelligence-public/v1", project, generated_at, tuple(creatives)))
    return _json_ready(result)

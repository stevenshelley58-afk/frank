"""Strict public Verified Prospect release contract.

The release contains only opaque references. Contact data and the detailed
validation, Australian-attribution, repair, and revert evidence remain behind
the Hermes data-plane receipts referenced here.
"""

from copy import deepcopy
from datetime import datetime
import math
import re
from typing import Any, Mapping, Sequence

from tool_apps.canonical import canonical_sha256


RELEASE_SCHEMA = "schema://frank.prospect-discovery-release/v1"
TOOL_ID = "prospect-discovery"
PIPELINE_ID = "discover-enrich-qualify"
PIPELINE_VERSION = "1.0.0"
REQUIRED_COMPATIBILITY = "prospect-release-v1"

_EXACT_RELEASE_KEYS = frozenset({
    "schema", "tool_id", "pipeline_id", "pipeline_version",
    "consumer_compatibility", "release_id", "version", "status",
    "released_at", "immutable", "project_scope", "settings_revision",
    "settings_ref", "trace_refs", "sanitization_receipt_refs",
    "verification_receipt_refs", "candidates", "release_hash",
})
_EXACT_CANDIDATE_KEYS = frozenset({
    "prospect_ref", "contact_ref", "evidence_refs", "qualification",
    "verification_receipt_ref",
})
_EXACT_QUALIFICATION_KEYS = frozenset({"decision", "score", "policy_ref"})

_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_HASH = re.compile(r"^[0-9a-f]{64}$")
_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
_OPAQUE_PATH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$")
_COMPATIBILITY = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_PHONE_LIKE_REF = re.compile(r"[0-9](?:[/._-]?[0-9]){7,}")
_MARKUP_OR_SECRET = re.compile(
    r"(?:</?[a-z][^>]*>|javascript\s*:|bearer\s+[a-z0-9._~+/=-]{12,}|"
    r"(?:sk|pk|rk)_(?:live|test)_[a-z0-9]+|api[_-]?key[_-][a-z0-9]+|"
    r"gh[pousr]_[a-z0-9]+|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|"
    r"-----begin [a-z ]+-----)",
    re.IGNORECASE,
)


def _require_exact_keys(value: Mapping[str, Any], expected: frozenset[str], path: str) -> None:
    if set(value) != expected:
        raise ValueError(f"{path} must contain exactly: {', '.join(sorted(expected))}")


def _safe_id(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(f"{path} must be a safe opaque identifier")
    return value


def _safe_timestamp(value: Any, path: str) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP.fullmatch(value):
        raise ValueError(f"{path} must be an ISO-8601 timestamp with timezone")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{path} must be an ISO-8601 timestamp with timezone") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{path} must be an ISO-8601 timestamp with timezone")
    return parsed


def _opaque_ref(value: Any, scheme: str, path: str) -> str:
    prefix = f"{scheme}://"
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError(f"{path} must be an opaque {scheme} reference")
    opaque_path = value[len(prefix):]
    if not _OPAQUE_PATH.fullmatch(opaque_path) or ".." in opaque_path:
        raise ValueError(f"{path} must be an opaque {scheme} reference")
    if _PHONE_LIKE_REF.search(opaque_path):
        raise ValueError(f"{path} must not contain a raw phone number")
    if "@" in value or "?" in value or "#" in value or _MARKUP_OR_SECRET.search(value):
        raise ValueError(f"{path} contains contact data, markup, or secret-like text")
    return value


def _refs(value: Any, scheme: str, path: str) -> list[str]:
    if not isinstance(value, (list, tuple)) or not value:
        raise ValueError(f"{path} must be a non-empty list")
    refs = [_opaque_ref(item, scheme, f"{path}[]") for item in value]
    if len(refs) != len(set(refs)):
        raise ValueError(f"{path} must not contain duplicates")
    return refs


def _qualification(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{path} must be an object")
    _require_exact_keys(value, _EXACT_QUALIFICATION_KEYS, path)
    if value["decision"] != "qualified":
        raise ValueError(f"{path}.decision must be qualified")
    score = value["score"]
    if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
        raise ValueError(f"{path}.score must be a finite number from 0 to 1")
    return {
        "decision": "qualified",
        "score": score,
        "policy_ref": _opaque_ref(value["policy_ref"], "policy", f"{path}.policy_ref"),
    }


def _candidate(value: Any, index: int) -> dict[str, Any]:
    path = f"release.candidates[{index}]"
    if not isinstance(value, Mapping):
        raise ValueError(f"{path} must be an object")
    _require_exact_keys(value, _EXACT_CANDIDATE_KEYS, path)
    return {
        "prospect_ref": _opaque_ref(value["prospect_ref"], "prospect", f"{path}.prospect_ref"),
        "contact_ref": _opaque_ref(value["contact_ref"], "contact", f"{path}.contact_ref"),
        "evidence_refs": _refs(value["evidence_refs"], "evidence", f"{path}.evidence_refs"),
        "qualification": _qualification(value["qualification"], f"{path}.qualification"),
        "verification_receipt_ref": _opaque_ref(
            value["verification_receipt_ref"], "receipt", f"{path}.verification_receipt_ref"
        ),
    }


def _release_hash(value: Mapping[str, Any]) -> str:
    return canonical_sha256({key: item for key, item in value.items() if key != "release_hash"})


def validate_release(release: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and return a detached Verified Prospect public release."""
    if not isinstance(release, Mapping):
        raise TypeError("release must be an object")
    _require_exact_keys(release, _EXACT_RELEASE_KEYS, "release")
    if release["schema"] != RELEASE_SCHEMA or release["tool_id"] != TOOL_ID:
        raise ValueError("release schema or tool identity is invalid")
    if release["pipeline_id"] != PIPELINE_ID or release["pipeline_version"] != PIPELINE_VERSION:
        raise ValueError("release pipeline identity or version is invalid")

    _safe_id(release["release_id"], "release.release_id")
    if not isinstance(release["version"], str) or not _SEMVER.fullmatch(release["version"]):
        raise ValueError("release.version must be semantic version text")
    if release["status"] != "released" or release["immutable"] is not True:
        raise ValueError("release must be immutable and released")
    _safe_timestamp(release["released_at"], "release.released_at")
    _safe_id(release["project_scope"], "release.project_scope")
    if type(release["settings_revision"]) is not int or release["settings_revision"] < 1:
        raise ValueError("release.settings_revision must be a positive integer")

    compatibility = release["consumer_compatibility"]
    if not isinstance(compatibility, (list, tuple)) or not compatibility:
        raise ValueError("release.consumer_compatibility must be a non-empty list")
    if any(not isinstance(item, str) or not _COMPATIBILITY.fullmatch(item) for item in compatibility):
        raise ValueError("release.consumer_compatibility contains an invalid ID")
    if list(compatibility) != [REQUIRED_COMPATIBILITY]:
        raise ValueError(f"release.consumer_compatibility must be exactly {REQUIRED_COMPATIBILITY}")

    settings_ref = _opaque_ref(release["settings_ref"], "settings", "release.settings_ref")
    trace_refs = _refs(release["trace_refs"], "trace", "release.trace_refs")
    sanitization_refs = _refs(
        release["sanitization_receipt_refs"], "receipt", "release.sanitization_receipt_refs"
    )
    verification_refs = _refs(
        release["verification_receipt_refs"], "receipt", "release.verification_receipt_refs"
    )

    raw_candidates = release["candidates"]
    if not isinstance(raw_candidates, (list, tuple)) or not raw_candidates:
        raise ValueError("release.candidates must be a non-empty list")
    candidates = [_candidate(value, index) for index, value in enumerate(raw_candidates)]
    prospect_refs = [candidate["prospect_ref"] for candidate in candidates]
    contact_refs = [candidate["contact_ref"] for candidate in candidates]
    if len(prospect_refs) != len(set(prospect_refs)) or len(contact_refs) != len(set(contact_refs)):
        raise ValueError("release candidate prospect and contact references must be unique")
    candidate_verification_refs = [candidate["verification_receipt_ref"] for candidate in candidates]
    if verification_refs != candidate_verification_refs:
        raise ValueError("release.verification_receipt_refs must exactly match candidate verification receipts")

    result = {
        "schema": RELEASE_SCHEMA,
        "tool_id": TOOL_ID,
        "pipeline_id": PIPELINE_ID,
        "pipeline_version": PIPELINE_VERSION,
        "consumer_compatibility": list(compatibility),
        "release_id": release["release_id"],
        "version": release["version"],
        "status": "released",
        "released_at": release["released_at"],
        "immutable": True,
        "project_scope": release["project_scope"],
        "settings_revision": release["settings_revision"],
        "settings_ref": settings_ref,
        "trace_refs": trace_refs,
        "sanitization_receipt_refs": sanitization_refs,
        "verification_receipt_refs": verification_refs,
        "candidates": candidates,
        "release_hash": release["release_hash"],
    }
    if not isinstance(result["release_hash"], str) or not _HASH.fullmatch(result["release_hash"]):
        raise ValueError("release.release_hash must be lowercase SHA-256")
    if _release_hash(result) != result["release_hash"]:
        raise ValueError("release.release_hash does not match the RFC 8785 release envelope")
    return deepcopy(result)


def build_release(
    *,
    release_id: str,
    version: str,
    released_at: str,
    project_scope: str,
    settings_revision: int,
    settings_ref: str,
    trace_refs: Sequence[str],
    sanitization_receipt_refs: Sequence[str],
    candidates: Sequence[Mapping[str, Any]],
    consumer_compatibility: Sequence[str] = (REQUIRED_COMPATIBILITY,),
) -> dict[str, Any]:
    """Build a hash-addressed public release without performing any I/O."""
    candidate_values = [_candidate(value, index) for index, value in enumerate(candidates)]
    values: dict[str, Any] = {
        "schema": RELEASE_SCHEMA,
        "tool_id": TOOL_ID,
        "pipeline_id": PIPELINE_ID,
        "pipeline_version": PIPELINE_VERSION,
        "consumer_compatibility": list(consumer_compatibility),
        "release_id": release_id,
        "version": version,
        "status": "released",
        "released_at": released_at,
        "immutable": True,
        "project_scope": project_scope,
        "settings_revision": settings_revision,
        "settings_ref": settings_ref,
        "trace_refs": list(trace_refs),
        "sanitization_receipt_refs": list(sanitization_receipt_refs),
        "verification_receipt_refs": [
            candidate["verification_receipt_ref"] for candidate in candidate_values
        ],
        "candidates": candidate_values,
    }
    values["release_hash"] = _release_hash(values)
    return validate_release(values)

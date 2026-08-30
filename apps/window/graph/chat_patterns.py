"""Privacy-preserving aggregate chat-pattern candidates (Step 7C)."""
from __future__ import annotations

import copy
import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

from .control_plane import canonical_bytes

THEMES = frozenset({"competing_versions", "repeated_validation", "local_vps_confusion", "missing_oss_search", "lost_duplicate_skills", "unclear_deployment_truth", "busy_ui"})
COUNT_BUCKETS = {"3-5": (3, 5), "6-10": (6, 10), "11+": (11, 10**9)}
_FORBIDDEN = frozenset({"text", "body", "content", "prompt", "transcript", "messages", "conversation", "memory", "completion", "chain_of_thought", "reasoning"})
_REVISION = re.compile(r"^(?:rev_[0-9a-f]{40,64}|[0-9a-f]{40,64})$")
_STABLE = re.compile(r"^(?:rule|skill|project|capability|finding|proposal):[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")
_RECEIPT = re.compile(r"^receipt:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")
_CONVERSATION = re.compile(r"^conversation:[A-Za-z0-9_-]{1,128}$")


class ChatPatternError(ValueError):
    pass


def _digest(value: object) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _reject_private(value: object, path: str = "aggregate") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if not isinstance(key, str) or key.casefold() in _FORBIDDEN:
                raise ChatPatternError(f"private chat content at {path}")
            _reject_private(child, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_private(child, path)
    elif isinstance(value, str) and len(value) > 256:
        raise ChatPatternError("aggregate field is too long")


def normalize_aggregate(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Accept only Hermes' aggregate shape; no transcript-bearing variants."""
    if not isinstance(payload, Mapping):
        raise ChatPatternError("aggregate must be an object")
    _reject_private(payload)
    allowed = {"theme", "count_bucket", "scope", "dates", "owned_conversation_references", "evidence_receipt_ids"}
    if set(payload) - allowed:
        raise ChatPatternError("aggregate contains unsupported fields")
    theme = payload.get("theme")
    if theme not in THEMES:
        raise ChatPatternError("theme is not allowlisted")
    bucket = payload.get("count_bucket")
    if bucket not in COUNT_BUCKETS:
        raise ChatPatternError("count_bucket must suppress low-count patterns")
    scope = payload.get("scope")
    if not isinstance(scope, str) or not re.fullmatch(r"(?:frank|mini-frank|blockwise|project:[a-z0-9]+(?:-[a-z0-9]+)*)", scope):
        raise ChatPatternError("aggregate scope is required")
    dates = payload.get("dates")
    if not isinstance(dates, Mapping) or not isinstance(dates.get("from"), str) or not isinstance(dates.get("to"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dates["from"]) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dates["to"]) or dates["from"] > dates["to"]:
        raise ChatPatternError("aggregate dates are required")
    references = payload.get("owned_conversation_references", [])
    if not isinstance(references, list) or not references or len(references) > 100 or any(not isinstance(item, str) or not _CONVERSATION.fullmatch(item) for item in references):
        raise ChatPatternError("owned conversation references are required and opaque")
    evidence = payload.get("evidence_receipt_ids", [])
    if not isinstance(evidence, list) or not evidence or any(not isinstance(item, str) or not _RECEIPT.fullmatch(item) for item in evidence):
        raise ChatPatternError("evidence receipt IDs are required")
    return {"theme": theme, "count_bucket": bucket, "scope": scope, "dates": {"from": dates["from"], "to": dates["to"]}, "owned_conversation_references": sorted(set(references)), "evidence_receipt_ids": sorted(set(evidence))}


def make_candidate(payload: Mapping[str, Any], *, base_revision: str) -> dict[str, Any]:
    aggregate = normalize_aggregate(payload)
    if not isinstance(base_revision, str) or not _REVISION.fullmatch(base_revision):
        raise ChatPatternError("base revision is required")
    key = _digest({"aggregate": aggregate, "base_revision": base_revision})[7:31]
    slug = aggregate["theme"].replace("_", "-")
    return {"id": f"finding:chat-pattern/{slug}-{key}", "kind": "chat_pattern", "status": "candidate", "theme": aggregate["theme"], "count_bucket": aggregate["count_bucket"], "scope": aggregate["scope"], "dates": aggregate["dates"], "evidence_receipt_ids": aggregate["evidence_receipt_ids"], "owned_conversation_references": aggregate["owned_conversation_references"], "base_revision": base_revision, "mutated": False}


def make_proposal(candidate: Mapping[str, Any], *, target_id: str, evidence_receipt_ids: Sequence[str] | None = None) -> dict[str, Any]:
    if candidate.get("status") != "candidate" or candidate.get("mutated") is not False:
        raise ChatPatternError("only unmodified candidates can become proposals")
    if not isinstance(target_id, str) or not _STABLE.fullmatch(target_id):
        raise ChatPatternError("proposal target must be a stable ID")
    evidence = sorted(set(evidence_receipt_ids or candidate.get("evidence_receipt_ids", [])))
    if not evidence or any(not item.startswith("receipt:") for item in evidence):
        raise ChatPatternError("proposal evidence is required")
    proposal_id = "proposal:chat-pattern/" + str(candidate["id"]).split("/", 1)[-1]
    return {"id": proposal_id, "kind": "chat_pattern", "status": "awaiting owner action", "target_id": target_id, "expected_base_revision": str(candidate["base_revision"]), "summary": f"Review repeated {candidate['theme']} pattern for {candidate['scope']}", "evidence_receipt_ids": evidence}


def make_receipt(candidate: Mapping[str, Any], *, receipt_id: str) -> dict[str, Any]:
    if not isinstance(receipt_id, str) or not _RECEIPT.fullmatch(receipt_id):
        raise ChatPatternError("receipt ID is invalid")
    captured = _now()
    return {"id": receipt_id, "kind": "chat_pattern_candidate", "subject_ids": [str(candidate["id"])], "producer": "runtime:hermes-default", "source_revision_set": {"base": str(candidate["base_revision"])}, "deployed_revision_set": {}, "captured_at": captured, "fresh_until": None, "outcome": "partial", "evidence_uris": [f"chat-pattern/{_digest(candidate)[7:]}.json"], "redaction": "secret_filtered", "schema": "frank.chat-pattern/v1", "facts": {"theme": candidate["theme"], "count_bucket": candidate["count_bucket"], "candidate_only": True, "mutated": False}}


__all__ = ["ChatPatternError", "COUNT_BUCKETS", "THEMES", "make_candidate", "make_proposal", "make_receipt", "normalize_aggregate"]

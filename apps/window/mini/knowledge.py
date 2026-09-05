"""Typed Hermes/Hindsight binding without a second memory implementation."""
from __future__ import annotations

from copy import deepcopy
import time

KNOWLEDGE_BINDING_SCHEMA = "schema://frank.mini-knowledge-binding/v1"
INDUSTRY_CANDIDATES_SCHEMA = "schema://frank.mini-industry-candidates/v1"
SHARED_LIBRARY_PROVIDER = "service:frank-central-library"
SHARED_LIBRARY_SKILL = "shared-library"

_STATUS_CACHE: dict = {"at": 0.0, "value": None}


def shared_library_status(max_age_seconds: float = 30.0) -> dict:
    """Truthful availability of the central file-backed reference library.

    Probes the library read-only and never creates directories. Cached briefly
    so prompt building stays cheap. Reports the reference library only — this
    is not the Hindsight industry-memory adapter, which remains unavailable.
    """
    now = time.monotonic()
    cached = _STATUS_CACHE["value"]
    if cached is not None and now - _STATUS_CACHE["at"] < max_age_seconds:
        return cached
    try:
        from shared_library import CentralLibrary
        health = CentralLibrary(create=False).health()
        status = {
            "status": str(health.get("status") or "unavailable"),
            "approved_count": int(health.get("approved_count") or 0),
            "candidate_queue_writable": bool(health.get("candidate_queue_writable")),
        }
    except Exception:
        status = {"status": "unavailable", "approved_count": 0, "candidate_queue_writable": False}
    _STATUS_CACHE.update(at=now, value=status)
    return status


def shared_library_root(data_root) -> "object":
    """Runtime library root inside the caller's data mount (container-safe)."""
    from pathlib import Path
    return Path(data_root) / "knowledge/shared-library"


def queue_public_candidates(value, library_root=None) -> dict:
    """Queue only public, evidence-backed candidates to the central library.

    Customer-derived, uncertain and private material never leaves the private
    workspace. Failures degrade to a status report; the private artifact stays
    authoritative regardless.
    """
    candidates = [
        item for item in (value.get("candidates") or [])
        if isinstance(item, dict)
        and item.get("source_kind") == "public_source"
        and item.get("sensitivity") == "public_general"
    ]
    if not candidates:
        return {"status": "nothing_public", "queued_count": 0}
    try:
        from shared_library import CentralLibrary
        root = shared_library_root(library_root) if library_root is not None else None
        library = CentralLibrary(create=True) if root is None else CentralLibrary(root=root, create=True)
        receipts = library.contribute_industry(
            "mini-frank", {"industry": value.get("industry"), "candidates": candidates}
        )
    except Exception:
        return {"status": "queue_unavailable", "queued_count": 0}
    return {"status": "queued" if receipts else "nothing_public", "queued_count": len(receipts)}


def knowledge_binding(account_id: str, job_id: str = "", *, intake_id: str = "") -> dict:
    item_kind = "job" if job_id else "intake"
    item_id = job_id or intake_id
    private_scope = f"mini-{item_kind}/{item_id}" if item_id else ""
    library = shared_library_status()
    return {
        "schema": KNOWLEDGE_BINDING_SCHEMA,
        "version": "central-library-v1",
        "account_id": str(account_id or ""),
        "private": {
            "status": "active" if private_scope else "unavailable",
            "provider_route": "hermes_session_memory",
            "scope": private_scope,
            "isolation": "one_customer_item",
        },
        "shared_industry": {
            "status": "unavailable",
            "reason": (
                "Hermes has not yet exposed a verified approved-industry-bank adapter "
                "that preserves account isolation."
            ),
            "adapter_seam": "HermesExecutionPort.knowledge_binding.shared_industry",
            "required_provider": "service:hindsight",
        },
        "reference_context": {
            "status": library["status"],
            "provider": SHARED_LIBRARY_PROVIDER,
            "approved_count": library["approved_count"],
            "mode": "approved_public_references_context_only",
            "skill": SHARED_LIBRARY_SKILL,
        },
        "candidate_contribution": {
            "status": "available" if library["candidate_queue_writable"] else "unavailable",
            "provider": SHARED_LIBRARY_PROVIDER,
            "mode": "public_candidates_queue_central_library",
        },
        "candidate_handoff": {
            "status": "hermes_optional_private",
            "schema": INDUSTRY_CANDIDATES_SCHEMA,
            "path": "/workspace/industry-candidates.json",
            "promotion": "public_candidates_queue_central_library",
        },
        "client_scope_control": False,
        "direct_frank_memory_access": False,
    }


def validate_industry_candidates(value) -> dict | None:
    """Validate the private candidate artifact; never promote it here."""
    required = {"schema", "industry", "candidates"}
    if not isinstance(value, dict) or set(value) != required:
        return None
    if value.get("schema") != INDUSTRY_CANDIDATES_SCHEMA:
        return None
    industry = " ".join(str(value.get("industry") or "").split()).strip()
    raw_candidates = value.get("candidates")
    if not industry or len(industry) > 100 or not isinstance(raw_candidates, list) or len(raw_candidates) > 50:
        return None
    candidates: list[dict] = []
    fields = {"fact", "source_kind", "source_reference", "confidence", "sensitivity", "valid_until"}
    for raw in raw_candidates:
        if not isinstance(raw, dict) or set(raw) != fields:
            return None
        fact = " ".join(str(raw.get("fact") or "").split()).strip()
        source_reference = " ".join(str(raw.get("source_reference") or "").split()).strip()
        source_kind = str(raw.get("source_kind") or "")
        confidence = str(raw.get("confidence") or "")
        sensitivity = str(raw.get("sensitivity") or "")
        valid_until = str(raw.get("valid_until") or "")
        if not (10 <= len(fact) <= 800) or len(source_reference) > 500:
            return None
        if source_kind not in {"public_source", "customer_derived", "inference"}:
            return None
        if confidence not in {"low", "medium", "high"}:
            return None
        if sensitivity not in {"public_general", "private_customer", "uncertain"}:
            return None
        if len(valid_until) > 32:
            return None
        candidates.append({
            "fact": fact, "source_kind": source_kind, "source_reference": source_reference,
            "confidence": confidence, "sensitivity": sensitivity, "valid_until": valid_until,
        })
    return {"schema": INDUSTRY_CANDIDATES_SCHEMA, "industry": industry, "candidates": candidates}


def industry_candidate_prompt() -> str:
    return f"""
If this build produces genuinely reusable industry knowledge, write it privately to
/workspace/industry-candidates.json using schema {INDUSTRY_CANDIDATES_SCHEMA}. The object must contain
exactly schema, industry, and candidates. Each candidate must contain exactly fact, source_kind,
source_reference, confidence, sensitivity, and valid_until. source_kind is public_source,
customer_derived, or inference; sensitivity is public_general, private_customer, or uncertain;
confidence is low, medium, or high. Never put customer names, contacts, credentials, health data,
private URLs, customer performance, private strategy, chat excerpts, or recognisable customer
artifacts in a public_general candidate. This file is only a typed candidate handoff. Do not claim it
was promoted to shared memory: the approved shared-industry adapter is currently unavailable.
""".strip()

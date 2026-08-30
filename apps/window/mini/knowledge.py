"""Typed Hermes/Hindsight binding without a second memory implementation."""
from __future__ import annotations

from copy import deepcopy


KNOWLEDGE_BINDING_SCHEMA = "schema://frank.mini-knowledge-binding/v1"
INDUSTRY_CANDIDATES_SCHEMA = "schema://frank.mini-industry-candidates/v1"


def knowledge_binding(account_id: str, job_id: str = "", *, intake_id: str = "") -> dict:
    item_kind = "job" if job_id else "intake"
    item_id = job_id or intake_id
    private_scope = f"mini-{item_kind}/{item_id}" if item_id else ""
    return {
        "schema": KNOWLEDGE_BINDING_SCHEMA,
        "version": "baseline-v0",
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
        "candidate_handoff": {
            "status": "hermes_optional_private",
            "schema": INDUSTRY_CANDIDATES_SCHEMA,
            "path": "/workspace/industry-candidates.json",
            "promotion": "unavailable_until_shared_industry_adapter",
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

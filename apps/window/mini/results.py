"""Versioned result guidance and honest self-hosting contracts."""
from __future__ import annotations

from copy import deepcopy
from typing import Iterable


GUIDANCE_SCHEMA = "schema://frank.mini-guidance/v1"
SELF_HOST_SCHEMA = "schema://frank.mini-self-host/v1"
RESULT_SUPPORT_FIELDS = {"guidance", "self_host"}


def _text(value, limit: int, *, minimum: int = 1) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split()).strip()
    if len(cleaned) < minimum or len(cleaned) > limit:
        return None
    return cleaned


def _string_list(value, *, count: int, limit: int) -> list[str] | None:
    if not isinstance(value, list) or len(value) > count:
        return None
    result: list[str] = []
    for raw in value:
        item = _text(raw, limit)
        if not item:
            return None
        result.append(item)
    return result


def _project_items(value, *, count: int) -> list[dict] | None:
    if not isinstance(value, list) or len(value) > count:
        return None
    cleaned: list[dict] = []
    for raw in value:
        if not isinstance(raw, dict) or set(raw) != {"title", "why", "prompt"}:
            return None
        title = _text(raw.get("title"), 100)
        why = _text(raw.get("why"), 280)
        prompt = _text(raw.get("prompt"), 500)
        if not title or not why or not prompt:
            return None
        cleaned.append({"title": title, "why": why, "prompt": prompt})
    return cleaned


def validate_guidance(value) -> dict | None:
    """Validate optional Hermes guidance without accepting authority fields."""
    required = {
        "schema", "use_now", "free_revisions", "related_free_projects",
        "larger_project",
    }
    if not isinstance(value, dict) or set(value) != required or value.get("schema") != GUIDANCE_SCHEMA:
        return None
    use_now = _project_items(value.get("use_now"), count=5)
    revisions = _project_items(value.get("free_revisions"), count=5)
    related = _project_items(value.get("related_free_projects"), count=5)
    larger_raw = value.get("larger_project")
    if not isinstance(larger_raw, dict) or set(larger_raw) not in (
        {"status", "reason"}, {"status", "title", "why", "owner_prompt"},
    ):
        return None
    status = str(larger_raw.get("status") or "")
    if status == "needs_owner_input" and set(larger_raw) == {"status", "reason"}:
        reason = _text(larger_raw.get("reason"), 280)
        if not reason:
            return None
        larger = {"status": status, "reason": reason}
    elif status == "ready" and set(larger_raw) == {"status", "title", "why", "owner_prompt"}:
        title = _text(larger_raw.get("title"), 100)
        why = _text(larger_raw.get("why"), 280)
        owner_prompt = _text(larger_raw.get("owner_prompt"), 500)
        if not title or not why or not owner_prompt:
            return None
        larger = {"status": status, "title": title, "why": why, "owner_prompt": owner_prompt}
    else:
        return None
    if use_now is None or not use_now or revisions is None or related is None:
        return None
    return {
        "schema": GUIDANCE_SCHEMA,
        "source": "hermes_supplied",
        "use_now": use_now,
        "free_revisions": {"available": True, "items": revisions},
        "related_free_projects": {
            "status": "ready" if related else "needs_owner_input",
            "items": related,
        },
        "larger_project": larger,
    }


def validate_self_host_guide(value) -> dict | None:
    required = {
        "schema", "applicability", "overview", "requirements", "steps",
        "operations", "service_reason",
    }
    if not isinstance(value, dict) or set(value) != required or value.get("schema") != SELF_HOST_SCHEMA:
        return None
    applicability = str(value.get("applicability") or "")
    if applicability not in {"not_required", "static_files", "application"}:
        return None
    overview = _text(value.get("overview"), 600, minimum=10)
    requirements = _string_list(value.get("requirements"), count=12, limit=300)
    service_reason = _text(value.get("service_reason"), 400, minimum=10)
    raw_steps = value.get("steps")
    raw_operations = value.get("operations")
    if not overview or requirements is None or not service_reason:
        return None
    if not isinstance(raw_steps, list) or not isinstance(raw_operations, list):
        return None
    if len(raw_steps) > 15 or len(raw_operations) > 12:
        return None
    steps: list[dict] = []
    for raw in raw_steps:
        if not isinstance(raw, dict) or set(raw) != {"title", "detail"}:
            return None
        title = _text(raw.get("title"), 100)
        detail = _text(raw.get("detail"), 500)
        if not title or not detail:
            return None
        steps.append({"title": title, "detail": detail})
    operations: list[dict] = []
    for raw in raw_operations:
        if not isinstance(raw, dict) or set(raw) != {"area", "detail"}:
            return None
        area = _text(raw.get("area"), 80)
        detail = _text(raw.get("detail"), 400)
        if not area or not detail:
            return None
        operations.append({"area": area, "detail": detail})
    if applicability != "not_required" and (not requirements or not steps or not operations):
        return None
    return {
        "schema": SELF_HOST_SCHEMA,
        "source": "hermes_supplied",
        "applicability": applicability,
        "overview": overview,
        "requirements": requirements,
        "steps": steps,
        "operations": operations,
        "service": {
            "available": True,
            "reason": service_reason,
            "price_status": "scope_required",
        },
    }


def _artifact_items(result: dict) -> Iterable[dict]:
    artifacts = result.get("artifacts")
    if isinstance(artifacts, list):
        return (item for item in artifacts if isinstance(item, dict))
    legacy = []
    if result.get("artifact_url"):
        legacy.append({"kind": "interactive", "label": "your finished result", "url": result["artifact_url"]})
    if result.get("source_url"):
        legacy.append({"kind": "download", "label": "the source package", "url": result["source_url"]})
    return iter(legacy)


def _fallback_guidance(result: dict) -> dict:
    use_now = []
    for item in list(_artifact_items(result))[:5]:
        label = str(item.get("label") or "your finished result")[:80]
        url = str(item.get("url") or "")
        if not url:
            continue
        use_now.append({
            "title": f"Open {label}"[:100],
            "why": "Frank verified that this finished artifact exists for the current revision.",
            "prompt": url,
        })
    if not use_now:
        use_now.append({
            "title": "Review the finished result",
            "why": "Frank has marked this revision structurally ready, but has not assessed whether it fits your business.",
            "prompt": "Open the result and tell Frank what should change.",
        })
    return {
        "schema": GUIDANCE_SCHEMA,
        "source": "frank_known",
        "use_now": use_now,
        "free_revisions": {
            "available": True,
            "items": [{
                "title": "Ask for a free revision",
                "why": "Revisions to this Mini Frank project remain free.",
                "prompt": "Tell Frank what does not fit, what is missing, or what you want changed.",
            }],
        },
        "related_free_projects": {"status": "needs_owner_input", "items": []},
        "larger_project": {
            "status": "needs_owner_input",
            "reason": "Frank needs your direction before suggesting a larger paid project for this result.",
        },
    }


def _fallback_self_host(result: dict) -> dict:
    kinds = {str(item.get("kind") or "") for item in _artifact_items(result)}
    if "interactive" not in kinds:
        return {
            "schema": SELF_HOST_SCHEMA,
            "source": "frank_known",
            "applicability": "not_required",
            "overview": "This revision contains downloadable work and Frank does not know of a website or service that needs hosting.",
            "requirements": [],
            "steps": [],
            "operations": [],
            "service": {
                "available": True,
                "reason": "If you later turn the result into a live service, Frank can scope hosting after the runtime and traffic are known.",
                "price_status": "scope_required",
            },
        }
    return {
        "schema": SELF_HOST_SCHEMA,
        "source": "frank_known",
        "applicability": "static_files",
        "overview": "Frank's current hosted preview is a static, offline result. You can self-host the deployable public files on a static host; Frank cannot truthfully name provider-specific settings until you choose a provider.",
        "requirements": [
            "A deployable copy of the public files. If no source package is listed, ask for a free revision that adds one.",
            "A static host with HTTPS and, if you want one, access to your domain's DNS settings.",
            "A private backup of the exact files you publish.",
        ],
        "steps": [
            {"title": "Get the deployable files", "detail": "Download the listed source package, or ask Frank for a free revision that packages the public result. Do not use private attachments as a public deployment folder."},
            {"title": "Create a static site", "detail": "Choose a static hosting provider and upload the public files so index.html is at the site root. Follow that provider's current documentation for its exact upload method."},
            {"title": "Verify before sharing", "detail": "Open the HTTPS address on desktop and mobile, then test every listed download and local page link."},
            {"title": "Connect a domain if needed", "detail": "Add only the DNS records supplied by your chosen host, wait for HTTPS to become valid, and keep the temporary host address until the domain works."},
            {"title": "Keep it healthy", "detail": "Retain a backup, check the public URL after each update, and roll back to the last working file set if a change fails."},
        ],
        "operations": [
            {"area": "Configuration", "detail": "Provider settings, domain records and HTTPS must stay correct."},
            {"area": "Monitoring", "detail": "Someone must notice outages, broken downloads and expired domains or certificates."},
            {"area": "Updates", "detail": "Each revision must be uploaded, checked and recoverable."},
            {"area": "Support", "detail": "Someone must diagnose hosting, browser and domain problems when they occur."},
        ],
        "service": {
            "available": True,
            "reason": "Frank can scope managed hosting if you would rather not own configuration, monitoring, updates and recovery.",
            "price_status": "scope_required",
        },
    }


def build_result_support(result: dict, raw_guidance=None, raw_self_host=None) -> tuple[dict, dict]:
    guidance = validate_guidance(raw_guidance) or _fallback_guidance(result)
    self_host = validate_self_host_guide(raw_self_host) or _fallback_self_host(result)
    try:
        revision = max(1, int(result.get("revision") or 1))
    except (TypeError, ValueError):
        revision = 1
    guidance["revision"] = revision
    guidance["status"] = "ready"
    self_host["revision"] = revision
    return deepcopy(guidance), deepcopy(self_host)


def result_support_prompt() -> str:
    """Prompt fragment for Hermes; the server still validates every field."""
    return f"""
Also include optional `guidance` and `self_host` objects in result.json when you can make them
specific and truthful. `guidance` must use schema {GUIDANCE_SCHEMA} and contain exactly schema,
use_now, free_revisions, related_free_projects, and larger_project. The first four project lists use
objects with exactly title, why, and prompt. use_now must have at least one item; each list may have
at most five. larger_project is either {{\"status\":\"needs_owner_input\",\"reason\":\"...\"}} or
{{\"status\":\"ready\",\"title\":\"...\",\"why\":\"...\",\"owner_prompt\":\"...\"}}. Suggestions
must add value to this exact result; do not write a generic sales footer.

`self_host` must use schema {SELF_HOST_SCHEMA} and contain exactly schema, applicability, overview,
requirements, steps, operations, and service_reason. applicability is not_required, static_files, or
application. steps use exactly title and detail; operations use exactly area and detail. Write a real,
useful guide based only on files and requirements you actually know. State unknown provider-specific
values as unknown. Explain the genuine configuration, monitoring, update, backup, recovery, and support
work without inventing difficulty. Use not_required with empty lists when the result does not need hosting.
""".strip()

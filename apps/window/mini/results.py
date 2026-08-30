"""Versioned result guidance and honest self-hosting contracts."""
from __future__ import annotations

from copy import deepcopy
import re
from typing import Iterable


GUIDANCE_SCHEMA = "schema://frank.mini-guidance/v1"
SELF_HOST_SCHEMA = "schema://frank.mini-self-host/v1"
RESULT_SUPPORT_FIELDS = {"guidance", "self_host"}


# Result manifests are written by the build runtime.  They are *not* a safe
# customer-facing boundary by themselves: an otherwise useful result must not
# expose a workspace, an internal product name, or credentials in its title,
# labels, help text, or notes.  Keep this deliberately high-confidence.  The
# normal result view is plain-business language; the separate self-host guide
# may still explain genuine hosting work such as DNS, HTTPS and Docker.
_PRIVATE_RESULT_PATTERNS = (
    re.compile(r"\b(?:hermes|blockwise|hindsight)\b", re.IGNORECASE),
    re.compile(r"\b(?:workspace|system\s+prompt|tool\s+policy|memory\s+scope|"
               r"agent\s+loop|prompt\s+file|tool\s+(?:call|output|result)|"
               r"skills?\s+(?:loaded|path|folder|file)|chain[- ]of[- ]thought|reasoning\s+trace|"
               r"run\s*(?:id|identifier)|session\s*(?:id|identifier)|"
               r"canonical\s+(?:path|workspace)|internal\s+system|control\s+plane|"
               r"root[- ]owned|dispatcher|AGENTS\.md|BUILD_GUIDE\.md|result\.json)\b", re.IGNORECASE),
    re.compile(r"(?:[A-Za-z]:[\\/]|/(?:workspace|projects|srv|home|root|tmp|var|etc)/)", re.IGNORECASE),
    re.compile(r"\b(?:id_rsa|id_ed25519)\b", re.IGNORECASE),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE),
    re.compile(r"\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}", re.IGNORECASE),
    re.compile(
        r"\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|PASSWORD|SECRET)\s*(?:=|:)\s*"
        r"(?!(?:[<{\[])?(?:your|replace|example|placeholder|redacted|change[-_]?me|x{3,}))\S+",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*(?:=|:)\s*"
        r"(?!(?:[<{\[])?(?:your|replace|example|placeholder|redacted|required|needed|unknown|"
        r"not[-_ ]?set|change[-_]?me|x{3,}))\S+",
        re.IGNORECASE,
    ),
)
_DEFAULT_RESULT_TECHNICAL_PATTERNS = (
    re.compile(r"\b(?:terminal|sandbox|repository|repo|source\s+code|tool\s+call|runtime|"
               r"frontend|backend|docker|kubernetes|next\.?js)\b", re.IGNORECASE),
    re.compile(r"\b(?:API|SDK)\s+(?:key|endpoint|integration|call|client)\b", re.IGNORECASE),
    re.compile(r"\b(?:web|software|application)\s+framework\b", re.IGNORECASE),
    re.compile(r"\b(?:javascript|typescript|html|css|python)\s+(?:code|file|bundle|script)\b", re.IGNORECASE),
    re.compile(r"\b(?:built|written|implemented|runs?)\s+(?:in|with|using|on)\s+"
               r"(?:javascript|typescript|html|css|python|docker|next\.?js)\b", re.IGNORECASE),
)

DEFAULT_RESULT_TITLE = "Your solution is ready"
DEFAULT_RESULT_SUMMARY = (
    "Open it below and tell us what you want changed. Changes to this project are free."
)


def _contains_private_detail(text: str) -> bool:
    return any(pattern.search(text) for pattern in _PRIVATE_RESULT_PATTERNS)


def customer_safe_text(value, *, self_host: bool = False) -> bool:
    """Return whether one customer-visible string is safe to show.

    This is a privacy boundary rather than a style grader.  It rejects
    unambiguous internal/runtime references everywhere and additionally keeps
    technical implementation language out of the ordinary result surface.
    Self-host guidance is the explicit progressive-disclosure exception.
    """
    if not isinstance(value, str):
        return False
    text = " ".join(value.split()).strip()
    if not text or any(ord(character) < 32 for character in text):
        return False
    if _contains_private_detail(text):
        return False
    return bool(self_host or not any(pattern.search(text) for pattern in _DEFAULT_RESULT_TECHNICAL_PATTERNS))


def customer_safe_build_notes(value) -> bool:
    """Build notes are a normal result surface, not a developer log."""
    if not isinstance(value, str) or not 1 <= len(value) <= 64 * 1024:
        return False
    # Check each non-empty line so a harmless heading cannot mask a leaked
    # runtime detail elsewhere in a longer note.
    lines = [line for line in value.splitlines() if line.strip()]
    return bool(lines) and all(
        customer_safe_text(line, self_host=False)
        for line in lines
    )


def _validated_normalised_guidance(value) -> dict | None:
    """Convert a stored normalised guide back through the strict input validator."""
    expected = {
        "schema", "source", "use_now", "free_revisions", "related_free_projects",
        "larger_project", "revision", "status",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("source") != "hermes_supplied"
        or value.get("status") != "ready"
    ):
        return None
    free_revisions = value.get("free_revisions")
    related = value.get("related_free_projects")
    if (
        not isinstance(free_revisions, dict)
        or set(free_revisions) != {"available", "items"}
        or free_revisions.get("available") is not True
        or not isinstance(related, dict)
        or set(related) != {"status", "items"}
        or related.get("status") not in {"ready", "needs_owner_input"}
    ):
        return None
    raw = {
        "schema": value.get("schema"),
        "use_now": value.get("use_now"),
        "free_revisions": free_revisions.get("items"),
        "related_free_projects": related.get("items"),
        "larger_project": value.get("larger_project"),
    }
    return raw if validate_guidance(raw) is not None else None


def _validated_normalised_self_host(value) -> dict | None:
    """Convert a stored normalised self-host guide through its exact validator."""
    expected = {
        "schema", "source", "applicability", "overview", "requirements", "steps",
        "operations", "service", "revision",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("source") != "hermes_supplied"
    ):
        return None
    service = value.get("service")
    if (
        not isinstance(service, dict)
        or set(service) != {"available", "reason", "price_status"}
        or service.get("available") is not True
        or service.get("price_status") != "scope_required"
    ):
        return None
    raw = {
        "schema": value.get("schema"),
        "applicability": value.get("applicability"),
        "overview": value.get("overview"),
        "requirements": value.get("requirements"),
        "steps": value.get("steps"),
        "operations": value.get("operations"),
        "service_reason": service.get("reason"),
    }
    return raw if validate_self_host_guide(raw) is not None else None


def _safe_annotation(value):
    if isinstance(value, list):
        if len(value) > 20 or not all(customer_safe_text(item) for item in value):
            return None
        return list(value)
    if isinstance(value, dict):
        if len(value) > 20 or not all(
            customer_safe_text(key) and customer_safe_text(item)
            for key, item in value.items()
        ):
            return None
        return dict(value)
    return None


def customer_result_projection(result: dict, *, include_details: bool, job_id: str) -> dict:
    """Return a safe, useful result projection without changing its artifacts.

    Old jobs can contain an already-stored manifest from before this boundary
    existed.  Projection therefore sanitises every public route as well as new
    result loading.  A bad label/copy block never hides a valid artifact.
    """
    if not isinstance(result, dict):
        return {}
    safe_job_id = str(job_id or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", safe_job_id):
        return {}
    try:
        revision = max(1, int(result.get("revision") or 1))
    except (TypeError, ValueError):
        revision = 1
    cleaned = {
        "job_id": safe_job_id,
        "revision": revision,
        "title": (
            result.get("title")
            if customer_safe_text(result.get("title"))
            else DEFAULT_RESULT_TITLE
        ),
        "summary": (
            result.get("summary")
            if customer_safe_text(result.get("summary"))
            else DEFAULT_RESULT_SUMMARY
        ),
    }
    schema = str(result.get("schema") or "")
    if re.fullmatch(r"schema://frank\.mini-result/v[12]", schema):
        cleaned["schema"] = schema
    result_type = str(result.get("result_type") or "")
    raw_artifacts = result.get("artifacts")
    if not isinstance(raw_artifacts, list):
        # Normalise legacy result URLs before they reach the client.  The old
        # client would label source_url "the source package", which turns a
        # perfectly useful download into developer-facing copy.
        raw_artifacts = []
        if isinstance(result.get("artifact_url"), str) and result["artifact_url"]:
            raw_artifacts.append({
                "kind": "interactive", "label": "Open your solution",
                "url": result["artifact_url"],
            })
        if isinstance(result.get("source_url"), str) and result["source_url"]:
            raw_artifacts.append({
                "kind": "download", "label": "Download your solution",
                "url": result["source_url"],
            })
    canonical_prefix = f"https://preview.frank.fail/mini/{safe_job_id}/"
    artifacts = []
    for item in raw_artifacts[:20]:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "")
        url = str(item.get("url") or "")
        if kind not in {"interactive", "download"} or not url.startswith(canonical_prefix):
            continue
        relative = url[len(canonical_prefix):]
        if "?" in relative or "#" in relative or "\\" in relative or ".." in relative.split("/"):
            continue
        if kind == "interactive" and relative not in {"", "index.html"}:
            continue
        if kind == "download" and not (
            re.fullmatch(r"downloads/[A-Za-z0-9][A-Za-z0-9._-]{0,179}", relative)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,179}", relative)
        ):
            continue
        label = item.get("label")
        if not customer_safe_text(label):
            label = "Open your solution" if kind == "interactive" else "Download your solution"
        artifact = {"kind": kind, "label": label, "url": url}
        media_type = str(item.get("media_type") or "")
        if media_type and re.fullmatch(r"[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+", media_type):
            artifact["media_type"] = media_type
        artifacts.append(artifact)
    if artifacts:
        cleaned["artifacts"] = artifacts
    kinds = {item["kind"] for item in artifacts}
    expected_type = "combined" if kinds == {"interactive", "download"} else (
        "interactive" if kinds == {"interactive"} else "download" if kinds == {"download"} else ""
    )
    if result_type == expected_type and result_type:
        cleaned["result_type"] = result_type
    elif expected_type:
        cleaned["result_type"] = expected_type
    if include_details:
        expected_details = f"{canonical_prefix}build-notes.txt"
        if result.get("details_url") == expected_details:
            cleaned["details_url"] = expected_details
    for field in ("checks", "limitations"):
        annotation = _safe_annotation(result.get(field))
        if annotation is not None:
            cleaned[field] = annotation
    guidance_input = _validated_normalised_guidance(result.get("guidance"))
    self_host_input = _validated_normalised_self_host(result.get("self_host"))
    guidance, self_host = build_result_support(cleaned, guidance_input, self_host_input)
    cleaned["guidance"] = guidance
    cleaned["self_host"] = self_host
    return cleaned


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
    cleaned = {
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
    visible = [
        *(text for item in use_now for text in item.values()),
        *(text for item in revisions for text in item.values()),
        *(text for item in related for text in item.values()),
        *(text for key, text in larger.items() if key != "status"),
    ]
    if not all(customer_safe_text(text) for text in visible):
        return None
    return cleaned


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
    cleaned = {
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
    visible = [
        overview, service_reason, *requirements,
        *(text for item in steps for text in item.values()),
        *(text for item in operations for text in item.values()),
    ]
    if not all(customer_safe_text(text, self_host=True) for text in visible):
        return None
    return cleaned


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
            "why": "This is your finished solution and it is ready to try now.",
            "prompt": url,
        })
    if not use_now:
        use_now.append({
            "title": "Review your finished solution",
            "why": "Your solution is ready to try. Tell Frank what does and does not fit your business.",
            "prompt": "Open your solution and tell Frank what should change.",
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
            "reason": "Tell Frank what would make this more valuable before it suggests a larger paid project.",
        },
    }


def _fallback_self_host(result: dict) -> dict:
    kinds = {str(item.get("kind") or "") for item in _artifact_items(result)}
    if "interactive" not in kinds:
        return {
            "schema": SELF_HOST_SCHEMA,
            "source": "frank_known",
            "applicability": "not_required",
            "overview": "This solution contains files you can download. There is no website or service to host.",
            "requirements": [],
            "steps": [],
            "operations": [],
            "service": {
                "available": True,
                "reason": "If you later turn this into a live service, Frank can help once we know how it will be used.",
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

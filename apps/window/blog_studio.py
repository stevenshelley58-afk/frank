"""Thin, closed Frank projection for Hermes-owned Blog Studio runs."""

from __future__ import annotations

import json
import hashlib
import ipaddress
import math
from pathlib import Path
import re
import secrets
from typing import Any, Callable
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, Response, abort, jsonify, request, stream_with_context
from werkzeug.exceptions import HTTPException


TOOL_ID = "content-factory"
RUN_ID = re.compile(r"trun_[0-9a-f]{32}")
SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")
SAFE_FILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}")
PROJECT_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
STAGES = (
    "source", "research", "brief", "draft", "edit", "package", "qa",
    "human-approval", "release",
)
STAGE_ALIASES = {
    "intake": "source", "outline": "brief", "write": "draft",
    "writing": "draft", "critique": "edit", "revise": "edit",
    "fact-check": "qa", "fact_check": "qa", "seo": "package",
    "media": "package", "review": "human-approval",
    "approval": "human-approval", "published": "release",
    "immutable-release": "release",
}
PUBLIC_STATUSES = {
    "queued", "running", "waiting_review", "changes_requested", "releasing",
    "published", "failed", "quarantined", "cancelled", "withdrawn",
    "unavailable",
}
TERMINAL_STATUSES = {"published", "failed", "quarantined", "cancelled", "withdrawn"}
ARTIFACT_EXTENSIONS = {".md", ".json", ".txt", ".png", ".jpg", ".jpeg", ".webp"}
ARTIFACT_MIMES = {
    ".md": "text/markdown; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
EVENT_KINDS = {
    "command.accepted", "command.queued", "run.started", "run.recovered",
    "run.interrupted", "run.resumed", "run.rerun", "run.completed",
    "run.failed", "run.cancelled", "run.quarantined", "stage.started", "stage.completed",
    "artifact.created", "review.requested", "review.approved",
    "review.recorded", "review.changes-requested", "review.rejected", "provider.attempt",
    "provider.fallback", "tool.started", "tool.completed", "subagent.start",
    "subagent.complete", "release.created", "release.published", "release.withdrawn",
}
EVENT_STATUSES = {"queued", "running", "ok", "blocked", "error", "cancelled"}
EVENT_FIELDS = {
    "command.accepted": {"action"},
    "command.queued": {"action", "summary"},
    "run.started": {"summary"},
    "run.recovered": {"summary", "will_resume"},
    "run.interrupted": {"summary", "will_resume"},
    "run.resumed": {"summary", "from_stage"},
    "run.rerun": {"summary", "from_stage"},
    "run.completed": {"summary"},
    "run.failed": {"error"},
    "run.cancelled": {"reason"},
    "run.quarantined": {"reason", "blockers"},
    "stage.started": {"summary"},
    "stage.completed": {"summary", "artifact_count", "duration_seconds"},
    "artifact.created": {"name", "type", "title", "version", "status", "media_type", "size", "sha256"},
    "review.requested": {"choices", "blockers", "warnings", "gate"},
    "review.approved": {"decision", "version"},
    "review.recorded": {"decision", "version", "summary"},
    "review.changes-requested": {"decision", "from_stage", "summary"},
    "review.rejected": {"decision", "summary"},
    "provider.attempt": {"attempt", "timeout_seconds"},
    "provider.fallback": {"attempt", "reason"},
    "tool.started": {"tool"},
    "tool.completed": {"tool", "duration_seconds", "error"},
    "subagent.start": {"role"},
    "subagent.complete": {"role", "duration_seconds", "error"},
    "release.created": {"release_id", "version", "sha256", "artifact_name", "status"},
    "release.published": {"release_id", "version", "sha256", "artifact_name", "status"},
    "release.withdrawn": {"release_id", "version", "sha256", "status"},
}
SECRET_PATTERNS = (
    re.compile(r"\b(?:password|passphrase|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+", re.I),
    re.compile(r"\b(?:sk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,}\b", re.I),
    re.compile(r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b"),
)
PRIVATE_PATH = re.compile(r"[A-Za-z]:\\[^\s\"']+|/(?:srv|opt|projects|root|tmp|var|etc)/[^\s\"']+")


def _text(value: Any, limit: int, *, multiline: bool = False) -> str:
    if value is None or isinstance(value, (dict, list, tuple, set, bool)):
        return ""
    text = str(value or "").replace("\x00", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if multiline:
        text = "\n".join(line.rstrip() for line in text.split("\n")).strip()
    else:
        text = re.sub(r"\s+", " ", text).strip()
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    text = PRIVATE_PATH.sub("[private path]", text)
    return text[:limit]


def _number(value: Any, default: float | None = None) -> float | None:
    if isinstance(value, bool) or value in (None, ""):
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _integer(value: Any, default: int = 0, *, minimum: int = 0, maximum: int = 10_000_000) -> int:
    number = _number(value)
    if number is None:
        return default
    return min(maximum, max(minimum, int(number)))


def _stage(value: Any) -> str:
    candidate = _text(value, 40).lower().replace("_", "-").replace(" ", "-")
    if candidate in STAGES:
        return candidate
    return STAGE_ALIASES.get(candidate, "source")


def _action_stage(value: Any, *, default: str | None = None) -> str | None:
    if value in (None, ""):
        return default
    if not isinstance(value, str):
        abort(400, "stage must be text")
    candidate = value.strip().lower().replace("_", "-").replace(" ", "-")
    stage = candidate if candidate in STAGES else STAGE_ALIASES.get(candidate)
    if stage not in STAGES or stage in {"human-approval", "release"}:
        abort(400, "stage must be one of source, research, brief, draft, edit, package, or qa")
    return stage


def _safe_url(value: Any) -> str:
    candidate = str(value or "").replace("\x00", "").strip()[:1_500]
    if not candidate:
        return ""
    try:
        parsed = urllib.parse.urlsplit(candidate)
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return ""
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".localhost"):
        return ""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and (
        address.is_private or address.is_loopback or address.is_link_local
        or address.is_multicast or address.is_reserved or address.is_unspecified
    ):
        return ""
    try:
        port = parsed.port
    except ValueError:
        return ""
    if port is not None and port not in {80, 443}:
        return ""
    for key, _ in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True):
        lowered = key.casefold()
        if any(token in lowered for token in ("token", "secret", "signature", "apikey", "api_key", "authorization")):
            return ""
    return _text(urllib.parse.urlunsplit(parsed), 1_500)


def _string_list(value: Any, *, limit: int = 30, item_limit: int = 500) -> list[str]:
    if not isinstance(value, list):
        return []
    return [cleaned for item in value[:limit] if (cleaned := _text(item, item_limit))]


def _upstream_failure(error: Exception):
    if isinstance(error, urllib.error.HTTPError):
        detail = error.read().decode("utf-8", errors="replace")[:1_200]
        message = f"Hermes returned HTTP {error.code}."
        try:
            parsed = json.loads(detail)
            candidate = parsed.get("error") if isinstance(parsed, dict) else None
            if isinstance(candidate, dict):
                candidate = candidate.get("message")
            if not candidate and isinstance(parsed, dict):
                candidate = parsed.get("message") or parsed.get("detail")
            if candidate:
                message = _text(candidate, 1_200)
        except json.JSONDecodeError:
            pass
        status = error.code if 400 <= error.code < 500 else 502
        return jsonify({"error": message}), status
    return jsonify({"error": f"Could not reach Hermes: {_text(error, 180)}"}), 502


def _public_article(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    markdown = _text(raw.get("markdown") or raw.get("content") or raw.get("body_markdown"), 120_000, multiline=True)
    result = {
        "title": _text(raw.get("title"), 240),
        "dek": _text(raw.get("dek") or raw.get("subtitle"), 500),
        "markdown": markdown,
        "excerpt": _text(raw.get("excerpt") or raw.get("summary"), 800),
        "word_count": _integer(raw.get("word_count"), len(markdown.split()), maximum=20_000),
    }
    return {key: value for key, value in result.items() if value not in ("", None)}


def _public_research(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    sources = []
    for item in raw.get("sources") if isinstance(raw.get("sources"), list) else []:
        if not isinstance(item, dict):
            continue
        url = _safe_url(item.get("url"))
        if not url:
            continue
        sources.append({
            key: value for key, value in {
                "title": _text(item.get("title"), 300),
                "url": url,
                "publisher": _text(item.get("publisher"), 180),
                "published_at": _text(item.get("published_at"), 80),
                "evidence_ref": _text(item.get("evidence_ref"), 128),
            }.items() if value
        })
        if len(sources) >= 40:
            break
    return {
        "summary": _text(raw.get("summary") or raw.get("research_summary"), 8_000, multiline=True),
        "sources": sources,
        "open_questions": _string_list(raw.get("open_questions"), limit=20, item_limit=500),
    }


def _public_seo(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    return {key: value for key, value in {
        "title": _text(raw.get("title") or raw.get("seo_title"), 180),
        "description": _text(raw.get("description") or raw.get("meta_description"), 400),
        "slug": _text(raw.get("slug"), 160),
        "canonical_url": _safe_url(raw.get("canonical_url") or raw.get("canonical")),
        "keywords": _string_list(raw.get("keywords"), limit=20, item_limit=80),
        "schema_type": _text(raw.get("schema_type"), 80),
    }.items() if value not in ("", [], None)}


def _public_quality(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    result: dict[str, Any] = {
        "fact_check": _text(raw.get("fact_check"), 80),
        "style": _text(raw.get("style"), 80),
        "issues": _string_list(raw.get("issues"), limit=40, item_limit=700),
        "blockers": _string_list(raw.get("blockers"), limit=20, item_limit=700),
        "warnings": _string_list(raw.get("warnings"), limit=30, item_limit=700),
    }
    for key in ("score", "citation_coverage", "readability"):
        number = _number(raw.get(key))
        if number is not None:
            result[key] = number
    claims = []
    for claim in raw.get("claims") if isinstance(raw.get("claims"), list) else []:
        if not isinstance(claim, dict):
            continue
        claims.append({key: value for key, value in {
            "id": _text(claim.get("id"), 80),
            "text": _text(claim.get("text"), 600),
            "paragraph": _integer(claim.get("paragraph"), 0, maximum=10_000),
            "status": _text(claim.get("status"), 40),
            "evidence_refs": _string_list(claim.get("evidence_refs"), limit=20, item_limit=128),
        }.items() if value not in ("", [], None)})
        if len(claims) >= 100:
            break
    if claims:
        result["claims"] = claims
    return {key: value for key, value in result.items() if value not in ("", [], None)}


def _public_artifacts(value: Any, run_id: str, project_id: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    artifacts = []
    for item in value[:100]:
        if not isinstance(item, dict):
            continue
        name = _text(item.get("name"), 120)
        if not SAFE_FILE.fullmatch(name) or Path(name).suffix.lower() not in ARTIFACT_EXTENSIONS:
            continue
        sha256 = _text(item.get("sha256"), 64).lower()
        if sha256 and not re.fullmatch(r"[0-9a-f]{64}", sha256):
            sha256 = ""
        query = urllib.parse.urlencode({"project_id": project_id})
        artifact = {
            "name": name,
            "type": _text(item.get("type"), 80),
            "title": _text(item.get("title"), 240),
            "version": _integer(item.get("version"), 1, minimum=1, maximum=100_000),
            "status": _text(item.get("status"), 40),
            "media_type": ARTIFACT_MIMES[Path(name).suffix.lower()].split(";", 1)[0],
            "size": _integer(item.get("size"), 0, maximum=20 * 1024 * 1024),
            "sha256": sha256,
            "url": f"/api/blog-studio/runs/{run_id}/artifacts/{urllib.parse.quote(name, safe='')}?{query}",
        }
        artifacts.append({key: value for key, value in artifact.items() if value not in ("", None)})
    return artifacts


def _public_review(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    status = _text(raw.get("status"), 40)
    return {
        "status": status if status in {"pending", "ready", "approved", "changes_requested", "rejected", "quarantined"} else "pending",
        "blockers": _string_list(raw.get("blockers"), limit=20, item_limit=700),
        "warnings": _string_list(raw.get("warnings"), limit=30, item_limit=700),
        "recommended_stage": _stage(raw.get("recommended_stage")) if raw.get("recommended_stage") else "",
    }


def _public_release(value: Any, run_id: str, project_id: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not value:
        return {}
    raw = value
    raw_status = _text(raw.get("status"), 40).lower()
    if raw_status == "pending_approval":
        return {
            "status": "pending_approval",
            "version": _integer(raw.get("version"), 1, minimum=1, maximum=100_000),
        }
    if raw_status not in {"released", "published", "withdrawn"}:
        return {}
    name = _text(raw.get("artifact_name"), 120)
    if not SAFE_FILE.fullmatch(name) or Path(name).suffix.lower() not in ARTIFACT_EXTENSIONS:
        return {}
    sha256 = _text(raw.get("sha256") or raw.get("release_hash"), 64).lower()
    release_id = _text(raw.get("release_id"), 128)
    if not re.fullmatch(r"[0-9a-f]{64}", sha256) or not SAFE_ID.fullmatch(release_id):
        return {}
    result = {
        "status": "withdrawn" if raw_status == "withdrawn" else "published",
        "version": _integer(raw.get("version"), 1, minimum=1, maximum=100_000),
        "release_id": release_id,
        "sha256": sha256,
        "artifact_name": name,
        "url": _safe_url(raw.get("url")),
    }
    query = urllib.parse.urlencode({"project_id": project_id, "download": "1"})
    result["download_url"] = f"/api/blog-studio/runs/{run_id}/artifacts/{urllib.parse.quote(name, safe='')}?{query}"
    return {key: value for key, value in result.items() if value not in ("", None)}


def _public_status(run: dict[str, Any], release: dict[str, Any]) -> str:
    raw = _text(run.get("status"), 40).lower()
    release_status = _text(release.get("status"), 40).lower()
    if release_status == "withdrawn":
        return "withdrawn"
    if release_status == "published":
        return "published"
    if raw in {"waiting_for_approval", "waiting-review", "waiting_review"}:
        return "waiting_review"
    if raw in {"blocked", "quarantined"}:
        return "quarantined"
    if raw in {"completed", "released", "published"}:
        return "unavailable"
    if raw in {"queued", "running", "changes_requested", "releasing", "failed", "cancelled", "withdrawn"}:
        return raw
    return "unavailable"


def _public_stage_states(current: str, status: str) -> list[dict[str, str]]:
    current_index = STAGES.index(current)
    stages = []
    for index, stage_id in enumerate(STAGES):
        state = "pending"
        if index < current_index or status in {"published", "withdrawn"}:
            state = "complete"
        elif index == current_index:
            state = "failed" if status in {"failed", "quarantined"} else ("complete" if status in {"published", "withdrawn"} else "current")
        stages.append({"id": stage_id, "state": state})
    return stages


def public_blog_run(run: Any) -> dict[str, Any]:
    """Return the only run shape the Window is allowed to render."""
    if not isinstance(run, dict):
        return {"id": "", "status": "unavailable", "stage": "source", "progress": 0, "attention": True}
    run_id = _text(run.get("id") or run.get("run_id"), 80)
    payload = run.get("payload") if isinstance(run.get("payload"), dict) else {}
    scope = run.get("scope") if isinstance(run.get("scope"), dict) else {}
    project_id = _text(scope.get("project_id") or payload.get("project_id"), 80)
    output = run.get("output") if isinstance(run.get("output"), dict) else {}
    candidate = output.get("candidate") if isinstance(output.get("candidate"), dict) else output
    article = _public_article(candidate.get("article") or candidate.get("article_final"))
    research = _public_research(candidate.get("research") or candidate.get("research_brief"))
    seo = _public_seo(candidate.get("seo") or candidate.get("seo_package"))
    quality = _public_quality(candidate.get("quality") or candidate.get("qa") or candidate.get("qa_report"))
    artifacts = _public_artifacts(candidate.get("artifacts"), run_id, project_id)
    review = _public_review(candidate.get("review"))
    release = _public_release(output.get("release") or candidate.get("release"), run_id, project_id)
    status = _public_status(run, release)
    current_stage = _stage(run.get("stage"))
    source_bundle = payload.get("source_bundle") if isinstance(payload.get("source_bundle"), dict) else {}
    attachments = source_bundle.get("attachments") if isinstance(source_bundle.get("attachments"), list) else []
    raw_urls = source_bundle.get("urls") if isinstance(source_bundle.get("urls"), list) else []
    descriptors = source_bundle.get("sources") if isinstance(source_bundle.get("sources"), list) else []
    descriptor_kinds = [
        _text(item.get("kind"), 40).lower()
        for item in descriptors[:100]
        if isinstance(item, dict)
    ]
    persisted_attachments = [
        {key: value for key, value in {
            "name": _text(item.get("name"), 180),
            "media_type": _text(item.get("media_type"), 120),
            "size": _integer(item.get("size"), 0, maximum=50 * 1024 * 1024),
            "sha256": _text(item.get("sha256"), 64).lower()
            if re.fullmatch(r"[0-9a-f]{64}", _text(item.get("sha256"), 64).lower()) else "",
        }.items() if value not in ("", None)}
        for item in descriptors[:100]
        if isinstance(item, dict) and _text(item.get("kind"), 40).lower() == "attachment"
    ]
    urls = [_safe_url(item) for item in raw_urls]
    urls = [item for item in urls if item]
    source = {
        "has_text": bool(source_bundle.get("text")) or "text" in descriptor_kinds,
        "text_length": _integer(
            source_bundle.get("text_length"),
            sum(
                _integer(item.get("size"), 0, maximum=2 * 1024 * 1024)
                for item in descriptors[:100]
                if isinstance(item, dict) and _text(item.get("kind"), 40).lower() == "text"
            ),
            maximum=8 * 1024 * 1024,
        ),
        "source_count": min(100, len(descriptors)) if descriptors else len(raw_urls) + len(attachments) + (1 if source_bundle.get("text") else 0),
        "url_count": descriptor_kinds.count("url") if descriptors else len(raw_urls),
        "attachment_count": descriptor_kinds.count("attachment") if descriptors else len(attachments),
        "urls": urls[:12],
        "attachments": persisted_attachments or [
            {key: value for key, value in {
                "name": _text(item.get("name"), 180),
                "media_type": _text(item.get("media_type"), 120),
                "size": _integer(item.get("size"), 0, maximum=20 * 1024 * 1024),
            }.items() if value not in ("", None)}
            for item in attachments[:20] if isinstance(item, dict)
        ],
    }
    outline_value = candidate.get("outline")
    if isinstance(outline_value, list):
        outline = [
            _text(item.get("title") or item.get("heading"), 300) if isinstance(item, dict) else _text(item, 300)
            for item in outline_value[:40]
        ]
        outline = [item for item in outline if item]
    else:
        outline = []
    result = {
        "id": run_id,
        "request_id": _text(run.get("request_id"), 128),
        "status": status if status in PUBLIC_STATUSES else "unavailable",
        "stage": current_stage,
        "progress": min(1.0, max(0.0, _number(run.get("progress"), 0.0) or 0.0)),
        "attention": bool(run.get("attention")) or status in {"waiting_review", "failed", "quarantined", "unavailable"},
        "created_at": _number(run.get("created_at"), 0) or 0,
        "updated_at": _number(run.get("updated_at") or run.get("created_at"), 0) or 0,
        "title": _text(run.get("title") or payload.get("job_name") or payload.get("topic") or article.get("title") or "Article", 240),
        "project_id": project_id,
        "source": source,
        "stages": _public_stage_states(current_stage, status),
        "artifacts": artifacts,
        "article": article,
        "research": research,
        "outline": outline,
        "seo": seo,
        "quality": quality,
        "review": review,
        "release": release,
    }
    cost = _number((output.get("cost") or {}).get("reported_usd") if isinstance(output.get("cost"), dict) else output.get("cost"))
    if cost is not None:
        result["cost"] = cost
    usage = output.get("usage") if isinstance(output.get("usage"), dict) else {}
    safe_usage = {key: _integer(usage.get(key), 0, maximum=2_000_000_000) for key in ("input_tokens", "output_tokens", "total_tokens") if usage.get(key) is not None}
    if safe_usage:
        result["usage"] = safe_usage
    if run.get("error"):
        result["error"] = _text(run.get("error"), 1_200)
    return result


def public_event(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    kind = _text(value.get("kind"), 80)
    if kind not in EVENT_KINDS:
        return None
    data = value.get("data") if isinstance(value.get("data"), dict) else {}
    public_data: dict[str, Any] = {}
    for key in EVENT_FIELDS.get(kind, set()):
        raw = data.get(key)
        if key in {"artifact_count", "attempt", "version", "size"}:
            public_data[key] = _integer(raw, 0, maximum=20_000_000)
        elif key in {"duration_seconds", "timeout_seconds"}:
            public_data[key] = _number(raw, 0) or 0
        elif key == "will_resume":
            public_data[key] = bool(raw)
        elif key in {"blockers", "warnings", "choices"}:
            public_data[key] = _string_list(raw, limit=30, item_limit=500)
        elif raw is not None:
            public_data[key] = _text(raw, 1_000)
    status = _text(value.get("status"), 40).lower()
    return {
        "sequence": _integer(value.get("sequence"), 0, maximum=2_000_000_000),
        "kind": kind,
        "status": status if status in EVENT_STATUSES else "ok",
        "timestamp": _number(value.get("timestamp"), 0) or 0,
        "node_id": _stage(value.get("node_id")),
        "data": public_data,
    }


def _clean_create_body(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        abort(400, "request body must be an object")
    allowed = {
        "project_id", "job_name", "topic", "source_text", "source_urls",
        "attachments", "direction", "outputs", "client_request_id",
    }
    if any(key not in allowed for key in body):
        abort(400, "request body contains unsupported fields")
    scalar_limits = {
        "project_id": 48, "job_name": 120, "topic": 500,
        "source_text": 100_000, "client_request_id": 128,
    }
    for key, limit in scalar_limits.items():
        if key not in body:
            continue
        value = body[key]
        if not isinstance(value, str) or len(value) > limit:
            abort(400, f"{key} must be text no longer than {limit} characters")
    if "source_urls" in body and not isinstance(body["source_urls"], list):
        abort(400, "source_urls must be a list")
    if "attachments" in body and not isinstance(body["attachments"], list):
        abort(400, "attachments must be a list")
    if "direction" in body and not isinstance(body["direction"], dict):
        abort(400, "direction must be an object")
    if "outputs" in body and not isinstance(body["outputs"], dict):
        abort(400, "outputs must be an object")
    project_id = _text(body.get("project_id"), 48).lower()
    if not PROJECT_ID.fullmatch(project_id):
        abort(400, "choose a valid project")
    topic = _text(body.get("topic"), 500)
    source_text = _text(body.get("source_text"), 100_000, multiline=True)
    raw_urls = body.get("source_urls") if isinstance(body.get("source_urls"), list) else []
    if len(raw_urls) > 12 or any(not isinstance(item, str) or len(item) > 1_500 for item in raw_urls):
        abort(400, "source_urls accepts at most 12 bounded URLs")
    source_urls = [_safe_url(item) for item in raw_urls[:12]]
    source_urls = [item for item in source_urls if item]
    if raw_urls and len(source_urls) != len(raw_urls[:12]):
        abort(400, "source URLs must be safe http or https URLs")
    direction = body.get("direction") if isinstance(body.get("direction"), dict) else {}
    outputs = body.get("outputs") if isinstance(body.get("outputs"), dict) else {}
    if any(key not in {"audience", "outcome", "cta", "locale", "must_include", "must_avoid", "slug"} for key in direction):
        abort(400, "direction contains unsupported fields")
    if any(key not in {"length", "research_mode", "media", "companions", "publication_target_id"} for key in outputs):
        abort(400, "outputs contains unsupported fields")
    direction_limits = {
        "audience": 500, "outcome": 500, "cta": 300, "locale": 40,
        "must_include": 4_000, "must_avoid": 4_000, "slug": 160,
    }
    for key, limit in direction_limits.items():
        if key in direction and (not isinstance(direction[key], str) or len(direction[key]) > limit):
            abort(400, f"direction.{key} must be bounded text")
    for key in ("length", "research_mode", "media", "publication_target_id"):
        if key in outputs and not isinstance(outputs[key], str):
            abort(400, f"outputs.{key} must be text")
    raw_companions = outputs.get("companions", [])
    if not isinstance(raw_companions, list) or any(item not in {"email", "social"} for item in raw_companions):
        abort(400, "outputs.companions may contain only email and social")
    if len(raw_companions) > 2:
        abort(400, "outputs.companions accepts at most two values")
    raw_attachments = body.get("attachments") if isinstance(body.get("attachments"), list) else []
    if len(raw_attachments) > 20:
        abort(400, "Blog Studio accepts at most 20 source attachments")
    meaningful_direction = any(
        _text(direction.get(key), direction_limits[key], multiline=key in {"must_include", "must_avoid"})
        for key in ("audience", "outcome", "cta", "must_include", "must_avoid", "slug")
    )
    if not (topic or source_text or source_urls or raw_attachments or meaningful_direction):
        abort(400, "add a topic, source material, or editorial direction")
    length = _text(outputs.get("length"), 20).lower() or "standard"
    research_mode = _text(outputs.get("research_mode"), 30).lower() or "verify-enrich"
    media = _text(outputs.get("media"), 20).lower() or "briefs"
    companions = list(dict.fromkeys(raw_companions))
    if length not in {"concise", "standard", "deep"}:
        abort(400, "invalid article length")
    if research_mode not in {"source-only", "verify-enrich"}:
        abort(400, "invalid research mode")
    if media not in {"none", "briefs", "generate"}:
        abort(400, "invalid media output")
    publication_target_id = _text(outputs.get("publication_target_id"), 160)
    if publication_target_id and not SAFE_ID.fullmatch(publication_target_id):
        abort(400, "publication target must be an opaque Connections target ID")
    return {
        "project_id": project_id,
        "job_name": _text(body.get("job_name"), 120) or topic[:120]
        or _text(direction.get("outcome") or direction.get("audience"), 120)
        or "Source-led article",
        "topic": topic,
        "source_text": source_text,
        "source_urls": source_urls,
        "attachments": raw_attachments,
        "direction": {
            "audience": _text(direction.get("audience"), 500),
            "outcome": _text(direction.get("outcome"), 500),
            "cta": _text(direction.get("cta"), 300),
            "locale": _text(direction.get("locale"), 40) or "en-AU",
            "must_include": _text(direction.get("must_include"), 4_000, multiline=True),
            "must_avoid": _text(direction.get("must_avoid"), 4_000, multiline=True),
            "slug": _text(direction.get("slug"), 160),
        },
        "outputs": {
            "length": length,
            "research_mode": research_mode,
            "media": media,
            "companions": companions,
            "publication_target_id": publication_target_id,
        },
        "client_request_id": _text(body.get("client_request_id"), 128),
    }


def create_blog_studio_blueprint(
    *,
    project_getter: Callable[[str], dict | None],
    project_context: Callable[[dict], Any],
    hermes_request: Callable[..., dict],
    hermes_base: Callable[[], str],
    hermes_key: Callable[[], str],
    clean_attachments: Callable[[Any], list[dict]],
    upload_target: Callable[[str], Path | None],
) -> Blueprint:
    api = Blueprint("blog_studio", __name__)

    def run_path(run_id: str, suffix: str = "") -> str:
        if not RUN_ID.fullmatch(run_id):
            abort(404)
        return f"/v1/tool-runs/{urllib.parse.quote(run_id, safe='')}{suffix}"

    def requested_project_id() -> str:
        project_id = _text(request.args.get("project_id"), 48).lower()
        if not project_id or not PROJECT_ID.fullmatch(project_id):
            abort(400, "a valid project_id query parameter is required")
        return project_id

    def require_blog_run(run_id: str) -> dict[str, Any]:
        project_id = requested_project_id()
        data = hermes_request(run_path(run_id), timeout=8)
        raw = data.get("run") if isinstance(data.get("run"), dict) else data
        if not isinstance(raw, dict):
            abort(404)
        scope = raw.get("scope") if isinstance(raw.get("scope"), dict) else {}
        run_project = _text(scope.get("project_id"), 48).lower()
        if (
            raw.get("tool_id") != TOOL_ID
            or run_project != project_id
            or not project_getter(run_project)
        ):
            abort(404)
        return raw

    def source_attachment(attachment: dict[str, Any]) -> dict[str, Any]:
        target = upload_target(str(attachment.get("id") or ""))
        if target is None or not target.is_file():
            abort(400, "a source attachment is no longer available")
        media_type = _text(attachment.get("type"), 120)
        if not (media_type.startswith("text/") or media_type in {"application/pdf", "application/json", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}):
            abort(400, "Blog Studio accepts text, PDF, JSON, and Word source files")
        if int(attachment.get("size") or 0) > 20 * 1024 * 1024:
            abort(400, "a source attachment exceeds the 20 MB limit")
        return {
            "path": attachment["hermes_path"],
            "name": _text(attachment.get("name"), 180),
            "size": int(attachment.get("size") or 0),
            "media_type": media_type,
            "origin": _text(attachment.get("origin"), 40) or "device",
        }

    @api.post("/api/blog-studio/runs")
    def create_run():
        body = _clean_create_body(request.get_json(silent=True) or {})
        project = project_getter(body["project_id"])
        if not project:
            abort(404, "project not found")
        attachments = clean_attachments(body["attachments"])
        if len(attachments) != len(body["attachments"]):
            abort(400, "one or more source attachments are invalid")
        source_attachments = [source_attachment(item) for item in attachments]
        client_request_id = body["client_request_id"]
        if client_request_id and not SAFE_ID.fullmatch(client_request_id):
            abort(400, "client_request_id is invalid")
        opaque_request = client_request_id or f"browser-{secrets.token_hex(16)}"
        content_id = "content_" + hashlib.sha256(
            f"{body['project_id']}:{opaque_request}".encode("utf-8")
        ).hexdigest()[:24]
        payload = {
            "project_id": body["project_id"],
            "content_id": content_id,
            "job_name": body["job_name"],
            "topic": body["topic"],
            "source_bundle": {
                "text": body["source_text"],
                "text_length": len(body["source_text"]),
                "urls": body["source_urls"],
                "attachments": source_attachments,
            },
            "direction": body["direction"],
            "outputs": body["outputs"],
            "project_context": project_context(project),
        }
        command = {
            "schema": "schema://hermes.tool-run-command/v1",
            "request_id": f"req_{secrets.token_hex(16)}",
            "tool_id": TOOL_ID,
            "action": "run",
            "scope": {"project_id": body["project_id"]},
            "payload": payload,
            "idempotency_key": f"blog-studio:{opaque_request}",
        }
        try:
            data = hermes_request("/v1/tool-runs", command, method="POST", timeout=20)
            raw = data.get("run") if isinstance(data.get("run"), dict) else data
            raw_scope = raw.get("scope") if isinstance(raw, dict) and isinstance(raw.get("scope"), dict) else {}
            if not isinstance(raw, dict) or raw.get("tool_id") != TOOL_ID or raw_scope.get("project_id") != body["project_id"]:
                return jsonify({"error": "Hermes returned a run outside the Blog Studio project boundary"}), 502
            run = public_blog_run(raw)
            if not RUN_ID.fullmatch(run.get("id", "")):
                return jsonify({"error": "Hermes did not return a valid Blog Studio run"}), 502
            for attachment in attachments:
                target = upload_target(str(attachment.get("id") or ""))
                if target is not None:
                    try:
                        target.unlink(missing_ok=True)
                    except OSError:
                        pass
            return jsonify({"ok": True, "run": run}), 202
        except Exception as error:
            return _upstream_failure(error)

    @api.get("/api/blog-studio/runs")
    def list_runs():
        project_id = _text(request.args.get("project_id"), 48).lower()
        if project_id and not PROJECT_ID.fullmatch(project_id):
            abort(400, "invalid project")
        query = urllib.parse.urlencode({
            "tool_id": TOOL_ID,
            "project_id": project_id,
            "limit": min(200, max(1, request.args.get("limit", type=int) or 100)),
        })
        try:
            data = hermes_request(f"/v1/tool-runs?{query}", timeout=8)
        except Exception as error:
            return _upstream_failure(error)
        raw_runs = data.get("runs") if isinstance(data.get("runs"), list) else data.get("data", [])
        runs = []
        for item in raw_runs:
            if not isinstance(item, dict) or item.get("tool_id") != TOOL_ID:
                continue
            scope = item.get("scope") if isinstance(item.get("scope"), dict) else {}
            if project_id and scope.get("project_id") != project_id:
                continue
            runs.append(public_blog_run(item))
        return jsonify({"runs": runs})

    @api.get("/api/blog-studio/runs/<run_id>")
    def get_run(run_id: str):
        try:
            raw = require_blog_run(run_id)
        except HTTPException:
            raise
        except Exception as error:
            return _upstream_failure(error)
        return jsonify({"run": public_blog_run(raw)})

    @api.get("/api/blog-studio/runs/<run_id>/events")
    def events(run_id: str):
        try:
            require_blog_run(run_id)
        except HTTPException:
            raise
        except Exception as error:
            return _upstream_failure(error)
        after = request.args.get("after", type=int)
        if after is None:
            try:
                after = int(request.headers.get("Last-Event-ID") or -1)
            except ValueError:
                after = -1
        url = hermes_base() + run_path(run_id, "/events") + "?" + urllib.parse.urlencode({"after": max(-1, after)})

        def generate():
            headers = {"Accept": "text/event-stream"}
            key = hermes_key()
            if key:
                headers["Authorization"] = f"Bearer {key}"
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=75) as upstream:
                    data_lines: list[str] = []
                    buffered_bytes = 0
                    while True:
                        raw_line = upstream.readline(16_385)
                        if not raw_line:
                            break
                        if len(raw_line) > 16_384:
                            return
                        line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                        if line.startswith("data:"):
                            buffered_bytes += len(raw_line)
                            if buffered_bytes > 65_536 or len(data_lines) >= 100:
                                return
                            data_lines.append(line[5:].lstrip())
                            continue
                        if line != "":
                            continue
                        if not data_lines:
                            continue
                        try:
                            item = public_event(json.loads("\n".join(data_lines)))
                        except (json.JSONDecodeError, TypeError):
                            item = None
                        data_lines = []
                        buffered_bytes = 0
                        if item is None:
                            continue
                        payload = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
                        yield f"id: {item['sequence']}\nevent: {item['kind']}\ndata: {payload}\n\n".encode()
            except (urllib.error.URLError, TimeoutError):
                yield b"event: disconnected\ndata: {}\n\n"

        return Response(stream_with_context(generate()), mimetype="text/event-stream", headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        })

    @api.get("/api/blog-studio/runs/<run_id>/artifacts/<name>")
    def artifact(run_id: str, name: str):
        if not SAFE_FILE.fullmatch(name):
            abort(404)
        suffix = Path(name).suffix.lower()
        if suffix not in ARTIFACT_EXTENSIONS:
            abort(404)
        try:
            require_blog_run(run_id)
        except HTTPException:
            raise
        except Exception as error:
            return _upstream_failure(error)
        url = hermes_base() + run_path(run_id, f"/artifacts/{urllib.parse.quote(name, safe='')}")
        headers = {"Accept": ARTIFACT_MIMES[suffix].split(";", 1)[0]}
        key = hermes_key()
        if key:
            headers["Authorization"] = f"Bearer {key}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as upstream:
                maximum = 2 * 1024 * 1024 if suffix in {".md", ".json", ".txt"} else 20 * 1024 * 1024
                data = upstream.read(maximum + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if hasattr(error, "code") and getattr(error, "code") == 404:
                abort(404)
            return jsonify({"error": f"Could not reach Hermes: {_text(error, 180)}"}), 502
        if len(data) > maximum:
            abort(413)
        disposition = "attachment" if request.args.get("download") == "1" else "inline"
        return Response(data, content_type=ARTIFACT_MIMES[suffix], headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'{disposition}; filename="{name}"',
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
        })

    def proxy_action(run_id: str, suffix: str, body: dict[str, Any]) -> Response:
        try:
            require_blog_run(run_id)
            data = hermes_request(run_path(run_id, suffix), body, method="POST", timeout=20)
        except HTTPException:
            raise
        except Exception as error:
            return _upstream_failure(error)
        raw = data.get("run") if isinstance(data.get("run"), dict) else data
        return jsonify({"ok": True, "run": public_blog_run(raw)})

    @api.post("/api/blog-studio/runs/<run_id>/cancel")
    def cancel(run_id: str):
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or any(key not in {"reason"} for key in body):
            abort(400, "invalid cancel action")
        return proxy_action(run_id, "/cancel", {"reason": _text(body.get("reason"), 1_000)})

    @api.post("/api/blog-studio/runs/<run_id>/resume")
    def resume(run_id: str):
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or any(key not in {"from_stage"} for key in body):
            abort(400, "invalid resume action")
        return proxy_action(run_id, "/retry", {
            "stage": _action_stage(body.get("from_stage")),
            "instructions": "",
            "mode": "resume",
        })

    @api.post("/api/blog-studio/runs/<run_id>/rerun")
    def rerun(run_id: str):
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or any(key not in {"from_stage", "instructions"} for key in body):
            abort(400, "invalid rerun action")
        return proxy_action(run_id, "/retry", {
            "stage": _action_stage(body.get("from_stage"), default="draft"),
            "instructions": _text(body.get("instructions"), 4_000, multiline=True),
            "mode": "rerun",
        })

    @api.post("/api/blog-studio/runs/<run_id>/review")
    def review(run_id: str):
        body = request.get_json(silent=True) or {}
        allowed = {"decision", "note", "from_stage", "artifact_versions"}
        if not isinstance(body, dict) or any(key not in allowed for key in body):
            abort(400, "invalid review action")
        decision = _text(body.get("decision"), 40).lower()
        if decision not in {"approve", "request_changes", "reject", "quarantine"}:
            abort(400, "invalid review decision")
        from_stage = _action_stage(body.get("from_stage"))
        if decision == "request_changes" and from_stage is None:
            from_stage = "edit"
        if decision != "request_changes" and from_stage is not None:
            abort(400, "from_stage is only valid when requesting changes")
        raw_versions = body.get("artifact_versions") if isinstance(body.get("artifact_versions"), dict) else {}
        versions = {
            _text(key, 80): _integer(value, 1, minimum=1, maximum=100_000)
            for key, value in list(raw_versions.items())[:100]
            if SAFE_ID.fullmatch(_text(key, 80))
        }
        return proxy_action(run_id, "/approval", {
            "decision": decision,
            "note": _text(body.get("note"), 4_000, multiline=True),
            "from_stage": from_stage,
            "artifact_versions": versions,
        })

    @api.post("/api/blog-studio/runs/<run_id>/withdraw")
    def withdraw(run_id: str):
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or any(key not in {"reason"} for key in body):
            abort(400, "invalid withdrawal")
        reason = _text(body.get("reason"), 2_000, multiline=True)
        if not reason:
            abort(400, "withdrawal reason is required")
        return proxy_action(run_id, "/approval", {"decision": "withdraw", "note": reason})

    return api

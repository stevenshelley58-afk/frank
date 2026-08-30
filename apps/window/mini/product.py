"""Deterministic Mini product policy over records owned by Frank."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from copy import deepcopy


SHARE_MODES = {"restricted", "link", "published"}
SHARE_SCOPES = {"result", "project"}
SHARE_ROLES = {"viewer", "commenter", "editor"}
COMMENT_ROLES = {"commenter", "editor"}
SERVICE_KINDS = {
    "self_host_help", "managed_hosting", "video_call", "perth_visit", "custom_project",
}
CONTACT_METHODS = {"email", "phone", "whatsapp", "other"}
MAX_STORED_COMMENTS = 100
MAX_SHARED_COMMENTS = 50
MAX_SHARED_COMMENTS_PER_RESOURCE = 25


class ProductValidation(ValueError):
    pass


class ProductConflict(RuntimeError):
    pass


class ProductCapacity(RuntimeError):
    pass


def _clean_text(value, limit: int, *, required: bool = False) -> str:
    cleaned = " ".join(str(value or "").split()).strip()
    if len(cleaned) > limit or (required and not cleaned):
        raise ProductValidation("invalid text")
    return cleaned


def quality_projection(job: dict) -> dict:
    revision = max(1, int(job.get("revision") or 1))
    safe_ready = bool(
        job.get("stage") == "ready"
        and isinstance(job.get("result"), dict)
        and int(job.get("published_revision") or 0) == revision
    )
    return {
        "policy_version": "baseline-v0",
        "assessment": "not_evaluated",
        "safe_ready": safe_ready,
        "safe_ready_meaning": (
            "The current revision passed Frank's structural, publication and safety checks. "
            "It is not a claim that the result is useful, complete, or commercially effective."
        ),
    }


def append_audit(job: dict, event: str, *, actor: str, created_at: int, metadata: dict | None = None) -> list[dict]:
    """Append a bounded audit event containing no customer content or bearer data."""
    if actor not in {"owner", "share_viewer", "share_commenter", "share_editor", "system"}:
        raise ProductValidation("invalid audit actor")
    safe_metadata: dict[str, object] = {}
    allowed = {"mode", "scope", "role", "kind", "status", "revision", "share_id", "request_id"}
    for key, value in (metadata or {}).items():
        if key not in allowed:
            continue
        if isinstance(value, bool):
            safe_metadata[key] = value
        elif isinstance(value, int):
            safe_metadata[key] = value
        else:
            text = str(value or "")
            if 0 < len(text) <= 100 and all(ord(char) >= 32 for char in text):
                safe_metadata[key] = text
    item = {"event": _clean_text(event, 80, required=True), "actor": actor, "created_at": int(created_at)}
    if safe_metadata:
        item["metadata"] = safe_metadata
    audit = [dict(raw) for raw in job.get("audit") or [] if isinstance(raw, dict)]
    audit.append(item)
    return audit[-100:]


def _default_sharing(job: dict) -> dict:
    raw = job.get("sharing") if isinstance(job.get("sharing"), dict) else {}
    mode = str(raw.get("mode") or "restricted")
    scope = str(raw.get("scope") or "result")
    role = str(raw.get("role") or "viewer")
    return {
        "mode": mode if mode in SHARE_MODES else "restricted",
        "scope": scope if scope in SHARE_SCOPES else "result",
        "role": role if role in SHARE_ROLES else "viewer",
        "version": max(1, int(raw.get("version") or 1)),
        "active_link": dict(raw.get("active_link")) if isinstance(raw.get("active_link"), dict) else None,
        "published_at": max(0, int(raw.get("published_at") or 0)),
    }


def _public_link(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None
    return {
        "id": str(value.get("id") or ""),
        "role": str(value.get("role") or "viewer"),
        "scope": str(value.get("scope") or "result"),
        "created_at": int(value.get("created_at") or 0),
        "revoked_at": int(value.get("revoked_at") or 0),
        "generation": max(1, int(value.get("generation") or 1)),
    }


def owner_sharing(job: dict) -> dict:
    state = _default_sharing(job)
    return {
        "mode": state["mode"], "scope": state["scope"], "role": state["role"],
        "version": state["version"], "active_link": _public_link(state["active_link"]),
        "published_at": state["published_at"],
        "named_people": {
            "available": False,
            "reason": "Verified named-person invitations are deferred; link sharing works now.",
        },
        "authority": {
            "shared_can_execute": False, "shared_can_pay": False, "shared_can_request_service": False,
        },
    }


def update_sharing(job: dict, body: dict, *, now: int) -> tuple[dict, dict]:
    state = _default_sharing(job)
    try:
        expected = int(body.get("expected_version"))
    except (TypeError, ValueError) as error:
        raise ProductValidation("expected_version is required") from error
    if expected != state["version"]:
        raise ProductConflict("sharing version changed")
    mode = str(body.get("mode") or state["mode"])
    scope = str(body.get("scope") or state["scope"])
    role = str(body.get("role") or state["role"])
    if mode not in SHARE_MODES or scope not in SHARE_SCOPES or role not in SHARE_ROLES:
        raise ProductValidation("invalid sharing setting")
    active = state["active_link"]
    if mode == "link":
        if not active or int(active.get("revoked_at") or 0):
            raise ProductValidation("create a new share link to enter link mode")
        active = {**active, "scope": scope, "role": role}
    elif active:
        active = {**active, "revoked_at": int(now)}
    updated = {
        "mode": mode, "scope": scope, "role": role,
        "version": state["version"] + 1,
        "active_link": active,
        "published_at": int(now) if mode == "published" else 0,
    }
    return updated, owner_sharing({**job, "sharing": updated})


def _share_hash(token: str, key: bytes) -> str:
    return hmac.new(key, f"mini-share:{token}".encode("utf-8"), hashlib.sha256).hexdigest()


def create_share(
    job: dict,
    *,
    key: bytes,
    now: int,
    expected_version: int,
    scope: str = "",
    role: str = "",
    token: str = "",
) -> tuple[dict, str, dict]:
    state = _default_sharing(job)
    if int(expected_version) != state["version"]:
        raise ProductConflict("sharing version changed")
    scope = str(scope or state["scope"])
    role = str(role or state["role"])
    if scope not in SHARE_SCOPES or role not in SHARE_ROLES:
        raise ProductValidation("invalid sharing setting")
    share_id = "shr_" + secrets.token_urlsafe(10)
    token = str(token or ("ms1_" + secrets.token_urlsafe(24)))
    if not token.startswith("ms1_") or len(token) > 100:
        raise ProductValidation("invalid share token")
    link = {
        "id": share_id,
        "token_hash": _share_hash(token, key),
        "role": role,
        "scope": scope,
        "created_at": int(now), "revoked_at": 0, "generation": 1,
    }
    updated = {
        **state, "mode": "link", "scope": scope, "role": role,
        "active_link": link, "published_at": 0, "version": state["version"] + 1,
    }
    return updated, token, _public_link(link) or {}


def rotate_share(
    job: dict,
    *,
    key: bytes,
    now: int,
    expected_version: int,
    token: str = "",
) -> tuple[dict, str, dict]:
    state = _default_sharing(job)
    active = state["active_link"]
    if int(expected_version) != state["version"]:
        raise ProductConflict("sharing version changed")
    if not active or int(active.get("revoked_at") or 0):
        raise ProductValidation("no active share link")
    token = str(token or ("ms1_" + secrets.token_urlsafe(24)))
    if not token.startswith("ms1_") or len(token) > 100:
        raise ProductValidation("invalid share token")
    link = {
        **active,
        "token_hash": _share_hash(token, key),
        "created_at": int(now), "revoked_at": 0,
        "generation": max(1, int(active.get("generation") or 1)) + 1,
    }
    updated = {**state, "active_link": link, "version": state["version"] + 1}
    return updated, token, _public_link(link) or {}


def revoke_share(job: dict, *, now: int, expected_version: int) -> tuple[dict, dict]:
    state = _default_sharing(job)
    if int(expected_version) != state["version"]:
        raise ProductConflict("sharing version changed")
    active = state["active_link"]
    if not active or int(active.get("revoked_at") or 0):
        raise ProductValidation("no active share link")
    link = {**active, "revoked_at": int(now)}
    updated = {**state, "mode": "restricted", "active_link": link, "published_at": 0, "version": state["version"] + 1}
    return updated, owner_sharing({**job, "sharing": updated})


def find_share(jobs: list[dict], token: str, *, key: bytes) -> tuple[dict, dict] | None:
    token = str(token or "").strip()
    if not token.startswith("ms1_") or len(token) > 100:
        return None
    digest = _share_hash(token, key)
    for job in jobs:
        state = _default_sharing(job)
        link = state["active_link"]
        if (
            state["mode"] == "link" and isinstance(link, dict)
            and not int(link.get("revoked_at") or 0)
            and hmac.compare_digest(str(link.get("token_hash") or ""), digest)
        ):
            return job, link
    return None


def _shared_result(job: dict) -> dict:
    return deepcopy(job.get("result")) if isinstance(job.get("result"), dict) else {}


def share_projection(job: dict, link: dict) -> dict:
    scope = str(link.get("scope") or "result")
    role = str(link.get("role") or "viewer")
    payload = {
        "revision": int(job.get("revision") or 1),
        "stage": str(job.get("stage") or ""),
        "title": str((_shared_result(job) or {}).get("title") or "Shared Mini Frank result"),
        "result": _shared_result(job),
        "share": {
            "id": str(link.get("id") or ""), "scope": scope, "role": role,
            "can_comment": role in COMMENT_ROLES, "can_suggest": role == "editor",
            "can_execute": False, "can_pay": False, "can_request_service": False,
        },
    }
    if scope == "project":
        payload["problem"] = str(job.get("problem") or "")
        payload["comments"] = shared_comments(job, link)
    return payload


def published_projection(job: dict) -> dict | None:
    state = _default_sharing(job)
    if state["mode"] != "published" or job.get("stage") != "ready":
        return None
    pseudo_link = {"id": "published", "scope": state["scope"], "role": "viewer"}
    return share_projection(job, pseudo_link)


def _stored_comments(job: dict) -> list[dict]:
    return [deepcopy(raw) for raw in job.get("comments") or [] if isinstance(raw, dict)]


def _public_comment(raw: dict) -> dict:
    return {
        "id": str(raw.get("id") or ""), "text": str(raw.get("text") or ""),
        "kind": str(raw.get("kind") or "comment"), "author": str(raw.get("author") or "owner"),
        "created_at": int(raw.get("created_at") or 0),
    }


def owner_comments(job: dict) -> list[dict]:
    comments = []
    for raw in _stored_comments(job):
        comments.append(_public_comment(raw))
    return comments


def shared_comments(job: dict, link: dict) -> list[dict]:
    """Return only comments created through this exact share resource.

    Legacy/unscoped comments and owner comments deliberately remain owner-only.
    Scope, generation, and revision binding prevent a later link or a narrower
    result-only share from inheriting an earlier project discussion.
    """
    share_id = str(link.get("id") or "")
    share_scope = str(link.get("scope") or "result")
    share_generation = max(1, int(link.get("generation") or 1))
    revision = max(1, int(job.get("revision") or 1))
    return [
        _public_comment(raw)
        for raw in _stored_comments(job)
        if str(raw.get("share_id") or "") == share_id
        and str(raw.get("share_scope") or "") == share_scope
        and max(0, int(raw.get("share_generation") or 0)) == share_generation
        and max(0, int(raw.get("revision") or 0)) == revision
    ]


def add_comment(
    job: dict,
    body: dict,
    *,
    actor: str,
    now: int,
    allowed_to_comment: bool,
    share: dict | None = None,
) -> tuple[list[dict], int, dict]:
    if not allowed_to_comment:
        raise ProductValidation("commenting is not allowed")
    current_version = max(0, int(job.get("comment_version") or 0))
    try:
        expected = int(body.get("expected_version"))
    except (TypeError, ValueError) as error:
        raise ProductValidation("expected_version is required") from error
    if expected != current_version:
        raise ProductConflict("comment version changed")
    kind = str(body.get("kind") or "comment")
    if kind not in ({"comment", "suggestion"} if actor == "share_editor" else {"comment"}):
        raise ProductValidation("invalid comment kind")
    comments = _stored_comments(job)
    if len(comments) >= MAX_STORED_COMMENTS:
        raise ProductCapacity("comment capacity reached")
    item = {
        "id": "cmt_" + secrets.token_urlsafe(9),
        "text": _clean_text(body.get("text"), 2000, required=True),
        "kind": kind, "author": actor.removeprefix("share_"), "created_at": int(now),
    }
    if actor.startswith("share_"):
        if not isinstance(share, dict) or not str(share.get("id") or ""):
            raise ProductValidation("share resource is required")
        share_id = str(share["id"])
        shared_count = sum(1 for raw in comments if str(raw.get("share_id") or ""))
        resource_count = sum(
            1 for raw in comments if str(raw.get("share_id") or "") == share_id
        )
        if (
            shared_count >= MAX_SHARED_COMMENTS
            or resource_count >= MAX_SHARED_COMMENTS_PER_RESOURCE
        ):
            raise ProductCapacity("shared comment capacity reached")
        item.update({
            "share_id": share_id,
            "share_scope": str(share.get("scope") or "result"),
            "share_generation": max(1, int(share.get("generation") or 1)),
            "revision": max(1, int(job.get("revision") or 1)),
        })
    comments.append(item)
    return comments, current_version + 1, _public_comment(item)


def create_service_request(job: dict, body: dict, *, now: int, idempotency_key: str = "") -> tuple[list[dict], dict, bool]:
    unexpected = set(body) - {"kind", "owner_reviewed", "note", "contact"}
    if unexpected:
        raise ProductValidation("invalid service request field")
    kind = str(body.get("kind") or "")
    if kind not in SERVICE_KINDS:
        raise ProductValidation("invalid service kind")
    if body.get("owner_reviewed") is not True:
        raise ProductValidation("owner_reviewed must be true")
    note = _clean_text(body.get("note"), 2000)
    raw_contact = body.get("contact")
    if not isinstance(raw_contact, dict) or set(raw_contact) != {"method", "value"}:
        raise ProductValidation("contact must contain method and value")
    method = str(raw_contact.get("method") or "").strip().lower()
    if method not in CONTACT_METHODS:
        raise ProductValidation("invalid contact method")
    contact = {
        "method": method,
        "value": _clean_text(raw_contact.get("value"), 200, required=True),
    }
    key = _clean_text(idempotency_key, 128)
    requests = [dict(raw) for raw in job.get("service_requests") or [] if isinstance(raw, dict)]
    if key:
        for existing in requests:
            if existing.get("idempotency_key") == key:
                if (
                    existing.get("kind") != kind
                    or existing.get("note") != note
                    or existing.get("contact") != contact
                ):
                    raise ProductConflict("idempotency key changed")
                return requests, deepcopy(existing), True
    item = {
        "id": "svc_" + secrets.token_urlsafe(10), "kind": kind,
        "status": "saved_for_review", "owner_reviewed": True,
        "note": note, "created_at": int(now), "updated_at": int(now),
        "price_status": "scope_required", "notification_sent": False,
        "contact": contact,
    }
    if key:
        item["idempotency_key"] = key
    requests.append(item)
    return requests[-50:], deepcopy(item), False

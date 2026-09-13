"""Signed native Frappe reply events stop matching owner Mautic nurture."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
from email import policy
from email.parser import Parser
from email.utils import getaddresses
from typing import Any, Mapping

from flask import jsonify, request

try:
    from mautic_flows import (
        ApiError, FLOWS, Mautic, NURTURE_EXIT_FIELD, UUID_PATTERN,
        contact_value, ensure_segments, find_email_contacts,
    )
except ModuleNotFoundError as error:  # Repository path before service packaging.
    if error.name != "mautic_flows":
        raise
    from infra.owner_email_flows.mautic_flows import (
        ApiError, FLOWS, Mautic, NURTURE_EXIT_FIELD, UUID_PATTERN,
        contact_value, ensure_segments, find_email_contacts,
    )

ROUTE = "/api/owner-mail-events/reply"
SIGNATURE_HEADER = "X-Frappe-Webhook-Signature"
OWNER_INBOX = "hello@blockwise.sale"
MAX_BODY_BYTES = 32 * 1024
MAX_HEADER_CHARACTERS = 16 * 1024
PAYLOAD_KEYS = frozenset({
    "event_id", "sender", "recipients", "cc", "bcc",
    "communication_medium", "sent_or_received", "in_reply_to", "email_headers",
})
_EVENT_ID = re.compile(r"^[A-Za-z0-9._:/@-]{1,140}$")


class ReplyPayloadError(ValueError):
    pass


def _text(payload: Mapping[str, Any], key: str, maximum: int) -> str:
    value = payload.get(key)
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        raise ReplyPayloadError("invalid payload")
    return value.strip()


def _headers(raw: str) -> dict[str, str]:
    if not raw:
        return {}
    if len(raw) > MAX_HEADER_CHARACTERS or "\x00" in raw:
        raise ReplyPayloadError("invalid payload")
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError:
        decoded = None
    if decoded is not None:
        if not isinstance(decoded, dict) or len(decoded) > 100:
            raise ReplyPayloadError("invalid payload")
        result = {}
        for key, value in decoded.items():
            if not isinstance(key, str) or not isinstance(value, str):
                raise ReplyPayloadError("invalid payload")
            if len(key) > 100 or len(value) > 4096:
                raise ReplyPayloadError("invalid payload")
            result[key.lower()] = value.strip()
        return result
    parsed = Parser(policy=policy.default).parsestr(raw, headersonly=True)
    result = {}
    for key in parsed.keys():
        values = parsed.get_all(key, [])
        if len(values) > 20:
            raise ReplyPayloadError("invalid payload")
        result[key.lower()] = ", ".join(str(value).strip() for value in values)
    return result


def _addresses(*values: str) -> set[str]:
    return {
        address.strip().lower()
        for _display, address in getaddresses([value for value in values if value])
        if address.strip()
    }


def _human_reply(payload: Mapping[str, Any]) -> str | None:
    if _text(payload, "communication_medium", 20).lower() != "email":
        return None
    if _text(payload, "sent_or_received", 20).lower() != "received":
        return None
    recipients = (_text(payload, "recipients", 2048), _text(payload, "cc", 2048), _text(payload, "bcc", 2048))
    if OWNER_INBOX not in _addresses(*recipients):
        return None
    senders = _addresses(_text(payload, "sender", 1024))
    if len(senders) != 1:
        return None
    sender = next(iter(senders))
    if len(sender) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", sender):
        return None
    local = sender.partition("@")[0]
    if sender == OWNER_INBOX or local in {"mailer-daemon", "postmaster"} or local.startswith("bounce"):
        return None
    headers = _headers(_text(payload, "email_headers", MAX_HEADER_CHARACTERS))
    automatic = headers.get("auto-submitted", "").strip().lower()
    if automatic and automatic != "no":
        return None
    if headers.get("precedence", "").strip().lower() in {"bulk", "junk", "list"}:
        return None
    if any(headers.get(name, "").strip() for name in ("list-id", "x-autoreply", "x-autorespond", "x-auto-response-suppress")):
        return None
    if headers.get("return-path", "").replace(" ", "") == "<>":
        return None
    linked = _text(payload, "in_reply_to", 512) or headers.get("in-reply-to", "") or headers.get("references", "")
    return sender if linked else None


def _contact_id(contact: Mapping[str, Any], sender: str) -> int | None:
    profile_id = contact_value(dict(contact), "blockwise_profile_id")
    workspace_id = contact_value(dict(contact), "blockwise_workspace_id")
    actual_email = contact_value(dict(contact), "email") or contact.get("email")
    if not isinstance(profile_id, str) or not UUID_PATTERN.fullmatch(profile_id):
        return None
    if not isinstance(workspace_id, str) or not UUID_PATTERN.fullmatch(workspace_id):
        return None
    if not isinstance(actual_email, str) or actual_email.lower() != sender:
        return None
    try:
        value = int(contact["id"])
    except (KeyError, TypeError, ValueError):
        return None
    return value if value > 0 else None


def _stop(api: Mautic, sender: str) -> str:
    contacts = find_email_contacts(api, sender)
    if len(contacts) != 1:
        return "ignored_identity"
    contact_id = _contact_id(contacts[0], sender)
    if contact_id is None:
        return "ignored_identity"
    if contact_value(contacts[0], NURTURE_EXIT_FIELD) != "stopped":
        api.request("PATCH", f"contacts/{contact_id}/edit", {NURTURE_EXIT_FIELD: "stopped"})
    segments = ensure_segments(api, apply=False)
    if set(segments) != {flow.key for flow in FLOWS}:
        raise ApiError("native owner segment set is incomplete")
    for flow in FLOWS:
        api.request("POST", f"segments/{segments[flow.key]}/contact/{contact_id}/remove")
    return "stopped"


def _verified(secret: str) -> Mapping[str, Any]:
    raw = request.get_data(cache=True)
    if not raw or len(raw) > MAX_BODY_BYTES:
        raise ReplyPayloadError("invalid payload")
    try:
        supplied = base64.b64decode(request.headers.get(SIGNATURE_HEADER, ""), validate=True)
    except (ValueError, binascii.Error):
        supplied = b""
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).digest()
    if len(supplied) != len(expected) or not hmac.compare_digest(supplied, expected):
        raise PermissionError("invalid signature")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReplyPayloadError("invalid payload") from exc
    if not isinstance(payload, dict) or set(payload) != PAYLOAD_KEYS:
        raise ReplyPayloadError("invalid payload")
    if not _EVENT_ID.fullmatch(_text(payload, "event_id", 140)):
        raise ReplyPayloadError("invalid payload")
    return payload


def register_owner_mail_reply(app: Any, config: Mapping[str, Any]) -> None:
    """Register POST /api/owner-mail-events/reply on a Flask app."""
    secret = str(config.get("OWNER_MAIL_REPLY_SECRET") or "")
    username = str(config.get("OWNER_MAIL_EVENTS_MAUTIC_USERNAME") or config.get("OWNER_MAIL_REPLY_MAUTIC_USERNAME") or config.get("OWNER_EMAIL_FLOWS_MAUTIC_USERNAME") or "owner")
    password = str(config.get("OWNER_MAIL_EVENTS_MAUTIC_PASSWORD") or config.get("OWNER_MAIL_REPLY_MAUTIC_PASSWORD") or config.get("OWNER_EMAIL_FLOWS_MAUTIC_PASSWORD") or "")
    url = str(config.get("OWNER_MAIL_REPLY_MAUTIC_URL") or "http://127.0.0.1:18106")
    if len(secret) < 32 or not username or not password:
        raise RuntimeError("owner mail reply receiver configuration is incomplete")
    if url.rstrip("/") != "http://127.0.0.1:18106":
        raise RuntimeError("owner mail reply Mautic target must be loopback")

    def receive_owner_mail_reply():
        try:
            payload = _verified(secret)
        except PermissionError:
            return jsonify({"status": "rejected"}), 403
        except ReplyPayloadError:
            return jsonify({"status": "invalid"}), 400
        try:
            sender = _human_reply(payload)
            if sender is None:
                return jsonify({"status": "ignored"}), 200
            result = _stop(Mautic(url, username, password), sender)
        except ReplyPayloadError:
            return jsonify({"status": "invalid"}), 400
        except ApiError:
            return jsonify({"status": "retry"}), 503
        return jsonify({"status": result}), 200

    app.add_url_rule(ROUTE, endpoint="owner_mail_reply", view_func=receive_owner_mail_reply, methods=["POST"])

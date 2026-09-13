"""Signed native Frappe reply events stop matching owner Mautic nurture."""
from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
import hashlib
import hmac
import imaplib
import json
import re
from typing import Any, Mapping
from zoneinfo import ZoneInfo

from flask import jsonify, request

try:
    from mautic_flows import (
        ApiError, FLOWS, Mautic, NURTURE_EXIT_FIELD, UUID_PATTERN,
        contact_value, ensure_segments, find_email_contacts,
    )
except ModuleNotFoundError as error:
    if error.name != "mautic_flows":
        raise
    from infra.owner_email_flows.mautic_flows import (
        ApiError, FLOWS, Mautic, NURTURE_EXIT_FIELD, UUID_PATTERN,
        contact_value, ensure_segments, find_email_contacts,
    )

ROUTE = "/api/owner-mail-events/reply"
SIGNATURE_HEADER = "X-Frappe-Webhook-Signature"
OWNER_INBOX = "hello@blockwise.sale"
OWNER_EMAIL_ACCOUNT = "Blockwise Owner Inbox"
IMAP_HOST = "imap.purelymail.com"
IMAP_PORT = 993
IMAP_FOLDER = "INBOX"
FRAPPE_TIME_ZONE = ZoneInfo("Australia/Perth")
MAX_BODY_BYTES = 32 * 1024
MAX_HEADER_BYTES = 32 * 1024
PAYLOAD_KEYS = frozenset({
    "event_id", "sender", "recipients", "cc", "bcc",
    "communication_medium", "sent_or_received", "in_reply_to",
    "uid", "email_account", "communication_date", "message_id",
})
_EVENT_ID = re.compile(r"^[A-Za-z0-9._:/@-]{1,140}$")
_UID = re.compile(r"^[1-9][0-9]{0,14}$")
_MESSAGE_ID = re.compile(r"^[^<>\s@]+@[^<>\s@]+$")


class ReplyPayloadError(ValueError):
    pass


class HeaderSourceUnavailable(RuntimeError):
    pass


def _text(payload: Mapping[str, Any], key: str, maximum: int) -> str:
    value = payload.get(key)
    if value is None:
        return ""
    if isinstance(value, int) and not isinstance(value, bool) and key == "uid":
        value = str(value)
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        raise ReplyPayloadError("invalid payload")
    return value.strip()


def _addresses(*values: str) -> set[str]:
    return {
        address.strip().lower()
        for _display, address in getaddresses([value for value in values if value])
        if address.strip()
    }


def _message_id(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith("<") and normalized.endswith(">"):
        normalized = normalized[1:-1].strip()
    if not normalized:
        return ""
    if len(normalized) > 998 or not _MESSAGE_ID.fullmatch(normalized):
        raise ReplyPayloadError("invalid message identity")
    return normalized.lower()


def _signed_date(value: str) -> datetime:
    if not value or len(value) > 64:
        raise ReplyPayloadError("invalid communication date")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ReplyPayloadError("invalid communication date") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=FRAPPE_TIME_ZONE)
    return parsed.astimezone(timezone.utc)


def _raw_date(value: str) -> datetime:
    if not value or len(value) > 998:
        raise ReplyPayloadError("invalid source date")
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError) as error:
        raise ReplyPayloadError("invalid source date") from error
    if parsed is None or parsed.tzinfo is None:
        raise ReplyPayloadError("invalid source date")
    return parsed.astimezone(timezone.utc)


class ImapHeaderReader:
    """Read exactly one message's headers by UID from the fixed owner INBOX."""

    def __init__(self, username: str, password: str, expected_uidvalidity: str):
        if not username or not password or not _UID.fullmatch(expected_uidvalidity):
            raise RuntimeError("owner mail IMAP configuration is incomplete")
        self.username = username
        self.password = password
        self.expected_uidvalidity = expected_uidvalidity

    def read(self, uid: str) -> bytes:
        if not _UID.fullmatch(uid):
            raise ReplyPayloadError("invalid payload")
        client = None
        try:
            client = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=10)
            status, _ = client.login(self.username, self.password)
            if status != "OK":
                raise HeaderSourceUnavailable("owner mailbox login failed")
            status, _ = client.select(IMAP_FOLDER, readonly=True)
            if status != "OK":
                raise HeaderSourceUnavailable("owner mailbox folder unavailable")
            response = client.response("UIDVALIDITY")
            values = response[1] if isinstance(response, tuple) and len(response) == 2 else None
            actual = ""
            if isinstance(values, (list, tuple)) and len(values) == 1 and isinstance(values[0], bytes):
                actual = values[0].decode("ascii", "strict")
            if actual != self.expected_uidvalidity:
                raise HeaderSourceUnavailable("owner mailbox UID validity changed")
            status, parts = client.uid("fetch", uid, "(UID BODY.PEEK[HEADER])")
            if status != "OK" or not isinstance(parts, list):
                raise HeaderSourceUnavailable("owner mailbox header fetch failed")
            bodies: list[bytes] = []
            metadata = b""
            for part in parts:
                if isinstance(part, tuple) and len(part) == 2 and isinstance(part[0], bytes) and isinstance(part[1], bytes):
                    metadata += part[0]
                    bodies.append(part[1])
            if len(bodies) != 1 or not re.search(rb"\bUID\s+" + re.escape(uid.encode("ascii")) + rb"\b", metadata):
                raise ReplyPayloadError("source message identity did not resolve")
            raw = bodies[0]
            if not raw or len(raw) > MAX_HEADER_BYTES or b"\x00" in raw:
                raise ReplyPayloadError("source headers exceeded safe bounds")
            return raw
        except ReplyPayloadError:
            raise
        except HeaderSourceUnavailable:
            raise
        except (imaplib.IMAP4.error, OSError, TimeoutError, UnicodeError) as error:
            raise HeaderSourceUnavailable("owner mailbox header source unavailable") from error
        finally:
            if client is not None:
                try:
                    client.logout()
                except (imaplib.IMAP4.error, OSError):
                    pass


def _source_human_reply(payload: Mapping[str, Any], raw_headers: bytes) -> str | None:
    try:
        message = BytesParser(policy=policy.default).parsebytes(raw_headers, headersonly=True)
    except Exception as error:
        raise ReplyPayloadError("invalid source headers") from error

    signed_recipients = _addresses(
        _text(payload, "recipients", 2048),
        _text(payload, "cc", 2048),
        _text(payload, "bcc", 2048),
    )
    raw_recipients = _addresses(
        *(str(value) for name in ("to", "cc", "bcc") for value in (message.get_all(name, []) or []))
    )
    signed_senders = _addresses(_text(payload, "sender", 1024))
    raw_senders = _addresses(*(str(value) for value in (message.get_all("from", []) or [])))
    if len(signed_senders) != 1 or raw_senders != signed_senders or raw_recipients != signed_recipients:
        return None
    sender = next(iter(signed_senders))
    if OWNER_INBOX not in signed_recipients:
        return None
    if len(sender) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", sender):
        return None
    local = sender.partition("@")[0]
    if sender == OWNER_INBOX or local in {"mailer-daemon", "postmaster"} or local.startswith("bounce"):
        return None

    automatic = str(message.get("Auto-Submitted", "")).strip().lower()
    precedence = str(message.get("Precedence", "")).strip().lower()
    if automatic and automatic != "no":
        return None
    if precedence in {"bulk", "junk", "list"}:
        return None
    if any(str(message.get(name, "")).strip() for name in (
        "List-Id", "X-Autoreply", "X-Autorespond", "X-Auto-Response-Suppress",
        "X-Failed-Recipients",
    )):
        return None
    if str(message.get("Return-Path", "")).replace(" ", "") == "<>":
        return None
    if message.get_content_type().lower() == "multipart/report":
        return None
    if not str(message.get("In-Reply-To", "")).strip() and not str(message.get("References", "")).strip():
        return None

    signed_date = _signed_date(_text(payload, "communication_date", 64))
    source_date = str(message.get("Date", "")).strip()
    if source_date and abs((_raw_date(source_date) - signed_date).total_seconds()) > 2:
        return None
    raw_message_id = _message_id(str(message.get("Message-ID", "")))
    signed_message_id = _message_id(_text(payload, "message_id", 998))
    if raw_message_id != signed_message_id:
        return None
    return sender


def _human_reply(payload: Mapping[str, Any], reader: ImapHeaderReader) -> str | None:
    if _text(payload, "communication_medium", 20).lower() != "email":
        return None
    if _text(payload, "sent_or_received", 20).lower() != "received":
        return None
    if _text(payload, "email_account", 140) != OWNER_EMAIL_ACCOUNT:
        return None
    signed_recipients = _addresses(
        _text(payload, "recipients", 2048),
        _text(payload, "cc", 2048),
        _text(payload, "bcc", 2048),
    )
    if OWNER_INBOX not in signed_recipients:
        return None
    signed_senders = _addresses(_text(payload, "sender", 1024))
    if len(signed_senders) != 1:
        return None
    uid = _text(payload, "uid", 15)
    if not _UID.fullmatch(uid):
        return None
    return _source_human_reply(payload, reader.read(uid))


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
    username = str(config.get("OWNER_MAIL_EVENTS_MAUTIC_USERNAME") or "")
    password = str(config.get("OWNER_MAIL_EVENTS_MAUTIC_PASSWORD") or "")
    url = str(config.get("OWNER_MAIL_REPLY_MAUTIC_URL") or "http://127.0.0.1:18106")
    imap_username = str(config.get("OWNER_MAIL_EVENTS_IMAP_USERNAME") or "")
    imap_password = str(config.get("OWNER_MAIL_EVENTS_IMAP_PASSWORD") or "")
    imap_host = str(config.get("OWNER_MAIL_EVENTS_IMAP_HOST") or "")
    imap_folder = str(config.get("OWNER_MAIL_EVENTS_IMAP_FOLDER") or "")
    uidvalidity = str(config.get("OWNER_MAIL_EVENTS_IMAP_UIDVALIDITY") or "")
    if len(secret) < 32 or not username or not password:
        raise RuntimeError("owner mail reply receiver configuration is incomplete")
    if url.rstrip("/") != "http://127.0.0.1:18106":
        raise RuntimeError("owner mail reply Mautic target must be loopback")
    if imap_host != IMAP_HOST or imap_folder != IMAP_FOLDER:
        raise RuntimeError("owner mail reply IMAP target is not the fixed INBOX")
    reader = ImapHeaderReader(imap_username, imap_password, uidvalidity)

    def receive_owner_mail_reply():
        try:
            payload = _verified(secret)
        except PermissionError:
            return jsonify({"status": "rejected"}), 403
        except ReplyPayloadError:
            return jsonify({"status": "invalid"}), 400
        try:
            sender = _human_reply(payload, reader)
            if sender is None:
                return jsonify({"status": "ignored"}), 200
            result = _stop(Mautic(url, username, password), sender)
        except ReplyPayloadError:
            return jsonify({"status": "invalid"}), 400
        except (ApiError, HeaderSourceUnavailable):
            return jsonify({"status": "retry"}), 503
        return jsonify({"status": result}), 200

    app.add_url_rule(ROUTE, endpoint="owner_mail_reply", view_func=receive_owner_mail_reply, methods=["POST"])

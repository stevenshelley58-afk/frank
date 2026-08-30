"""Central Frank bindings and server-derived Mini ownership scopes."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from copy import deepcopy


BINDING_VERSION = "baseline-v0"
BINDING_SCHEMA = "schema://frank.project-binding/v1"
ACCOUNT_ID_RE = re.compile(r"^acct_[A-Za-z0-9_-]{16,40}$")

# These IDs are references already declared by Frank's canonical
# ``governance/control-plane`` catalog.  This receipt deliberately does not
# invent a second Mini capability/skill/policy catalog.  A future Control Plane
# release can add finer-grained declarations and update this consumer pin.
_BINDING_BODY = {
    "schema": BINDING_SCHEMA,
    "version": BINDING_VERSION,
    "source": "governance/control-plane",
    "consumer": "project:mini-frank",
    "references": {
        "project": "project:mini-frank",
        "frank": "project:frank",
        "runtime": "runtime:hermes-default",
        "memory_provider": "service:hindsight",
        "state_store": "store:mini-frank-projects",
        "knowledge_capability": "capability:frank/mini-knowledge-flow",
        "central_skill_library": "skill:frank",
    },
    "runtime_contract": {
        "brain": "runtime:hermes-default",
        "brain_exclusive": True,
        "state_owner": "store:mini-frank-projects",
        "second_runtime_allowed": False,
        "second_catalog_allowed": False,
    },
}


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


_BINDING_BODY["receipt_id"] = "bind_" + hashlib.sha256(_canonical(_BINDING_BODY)).hexdigest()[:24]


def binding_receipt() -> dict:
    """Return a defensive copy of the centrally pinned Mini binding."""
    return deepcopy(_BINDING_BODY)


def new_account_id() -> str:
    return "acct_" + secrets.token_urlsafe(15)


def derive_legacy_account_id(record: dict, key: bytes) -> str:
    """Give pre-account records a stable opaque account without client input."""
    seed = str(record.get("claim_hash") or record.get("requester_hash") or record.get("id") or "")
    digest = hmac.new(key, f"mini-legacy-account:{seed}".encode("utf-8"), hashlib.sha256).digest()
    return "acct_" + base64.urlsafe_b64encode(digest[:15]).decode("ascii").rstrip("=")


def account_claim_token(account_id: str, key: bytes) -> str:
    if not ACCOUNT_ID_RE.fullmatch(str(account_id or "")):
        raise ValueError("invalid Mini account id")
    payload = base64.urlsafe_b64encode(account_id.encode("ascii")).decode("ascii").rstrip("=")
    signature = hmac.new(key, f"mini-account:{payload}".encode("ascii"), hashlib.sha256).digest()[:18]
    encoded_signature = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
    return f"ma1.{payload}.{encoded_signature}"


def verify_account_claim(token: str, key: bytes) -> str | None:
    parts = str(token or "").strip().split(".")
    if len(parts) != 3 or parts[0] != "ma1":
        return None
    payload, supplied_signature = parts[1:]
    try:
        padded = payload + "=" * (-len(payload) % 4)
        account_id = base64.urlsafe_b64decode(padded.encode("ascii")).decode("ascii")
    except (ValueError, UnicodeError):
        return None
    if not ACCOUNT_ID_RE.fullmatch(account_id):
        return None
    expected = account_claim_token(account_id, key).rsplit(".", 1)[-1]
    if not hmac.compare_digest(supplied_signature, expected):
        return None
    return account_id


_RESERVED_SCOPE_FIELDS = {
    "account_id", "project_id", "job_id", "scope_id", "memory_scope",
    "binding", "binding_receipt", "capabilities", "policies", "skills",
    "brain", "provider", "owner_id", "requester_hash", "claim_hash",
}


def reject_client_scope_fields(body: dict) -> list[str]:
    """Return forbidden authority fields supplied by an untrusted thin client."""
    if not isinstance(body, dict):
        return []
    return sorted(_RESERVED_SCOPE_FIELDS.intersection(body))

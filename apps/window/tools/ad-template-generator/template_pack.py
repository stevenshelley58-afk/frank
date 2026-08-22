"""Provider-neutral TemplatePack validation, checksums and Ed25519 signatures."""

from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import json
import re
from typing import Any, Mapping

import rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


SCHEMA = "schema://frank.template-pack/v1"
PACK_VERSION = "1.0.0"
PLACEMENTS = frozenset({"feed", "square", "portrait", "story"})
FORBIDDEN_KEYS = re.compile(r"(?:raw_source|source_bytes|private_prompt|credential|reviewer_identity|filesystem_path|temporary_url)", re.I)
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def canonical_bytes(pack: Mapping[str, Any], *, include_signature: bool = False) -> bytes:
    value = deepcopy(dict(pack))
    integrity = value.get("integrity")
    if isinstance(integrity, dict):
        integrity.pop("checksum", None)
        if not include_signature:
            integrity.pop("signature", None)
    return rfc8785.dumps(value)


def checksum(pack: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_bytes(pack)).hexdigest()


def sign(pack: Mapping[str, Any], private_key: Ed25519PrivateKey, *, key_id: str) -> dict[str, Any]:
    result = deepcopy(dict(pack))
    result.setdefault("integrity", {})["checksum"] = checksum(result)
    signature = private_key.sign(canonical_bytes(result))
    result["integrity"]["signature"] = {
        "algorithm": "Ed25519",
        "key_id": key_id,
        "value": base64.b64encode(signature).decode("ascii"),
    }
    return result


def verify_signature(pack: Mapping[str, Any], public_key: Ed25519PublicKey) -> bool:
    try:
        integrity = pack["integrity"]
        if integrity.get("checksum") != checksum(pack):
            return False
        signature = integrity["signature"]
        if signature.get("algorithm") != "Ed25519":
            return False
        public_key.verify(base64.b64decode(signature["value"], validate=True), canonical_bytes(pack))
        return True
    except (KeyError, TypeError, ValueError):
        return False


def _walk_forbidden(value: Any, path: str = "pack") -> list[str]:
    errors: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            if FORBIDDEN_KEYS.search(str(key)):
                errors.append(f"{path}.{key} is private and cannot be released")
            errors.extend(_walk_forbidden(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            errors.extend(_walk_forbidden(child, f"{path}[{index}]"))
    elif isinstance(value, str) and (value.startswith(("file://", "/srv/", "/vps/", "/projects/")) or "?token=" in value.lower()):
        errors.append(f"{path} contains a private or temporary reference")
    return errors


def validate(pack: Any, *, require_signature: bool = True) -> list[str]:
    if not isinstance(pack, Mapping):
        return ["pack must be an object"]
    errors: list[str] = []
    required = {"schema", "pack_version", "id", "compatibility", "document", "layouts", "assets", "fields", "ad", "editor", "previews", "provenance", "qa", "approval", "integrity"}
    for field in sorted(required - set(pack)):
        errors.append(f"missing pack.{field}")
    if pack.get("schema") != SCHEMA:
        errors.append("pack.schema is unsupported")
    if pack.get("pack_version") != PACK_VERSION:
        errors.append("pack.pack_version is unsupported")
    layouts = pack.get("layouts")
    if not isinstance(layouts, Mapping) or not {"feed", "story"}.issubset(layouts):
        errors.append("layouts must include feed and story")
    elif any(key not in PLACEMENTS for key in layouts):
        errors.append("layouts contains an unsupported placement")
    fields = pack.get("fields")
    if not isinstance(fields, Mapping) or not isinstance(fields.get("images"), list) or not isinstance(fields.get("text"), list):
        errors.append("fields must declare image and text slots")
    ad = pack.get("ad")
    if not isinstance(ad, Mapping) or not isinstance(ad.get("copy"), Mapping) or not isinstance(ad.get("cta"), Mapping):
        errors.append("ad must declare copy and CTA contracts")
    provenance = pack.get("provenance")
    if not isinstance(provenance, Mapping) or not provenance.get("model_policy_revision") or not provenance.get("release_trace_ref"):
        errors.append("provenance must pin model policy and release trace")
    qa = pack.get("qa")
    if not isinstance(qa, Mapping) or qa.get("all_gates_passed") is not True or qa.get("subject_invariance_passed") is not True or qa.get("source_identity_leakage") != 0:
        errors.append("all QA, subject-invariance and source-identity gates must pass")
    approval = pack.get("approval")
    if not isinstance(approval, Mapping) or approval.get("confirmed_100_percent") is not True:
        errors.append("100% zoom human approval is required")
    integrity = pack.get("integrity")
    if not isinstance(integrity, Mapping) or not SHA256.fullmatch(str(integrity.get("checksum") or "")):
        errors.append("integrity.checksum must be SHA-256")
    if require_signature and (not isinstance(integrity, Mapping) or not isinstance(integrity.get("signature"), Mapping)):
        errors.append("integrity.signature is required")
    errors.extend(_walk_forbidden(pack))
    return errors


def load_and_validate(raw: bytes | str, *, require_signature: bool = True) -> dict[str, Any]:
    pack = json.loads(raw)
    errors = validate(pack, require_signature=require_signature)
    if errors:
        raise ValueError("; ".join(errors))
    return pack
